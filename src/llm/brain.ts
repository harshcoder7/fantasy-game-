/**
 * Everdawn Vale — the Brain: LLM-first with per-call LocalBrain fallback.
 *
 * Every method builds a prompt, asks the transport, robust-parses the reply
 * (fence stripping + JSON block extraction), validates and clamps the result,
 * and falls back to the deterministic LocalBrain on ANY failure. A rejection
 * never escapes. live() tracks the last transport outcome and emits
 * 'llm:status' { live } on the bus only when the state transitions.
 */
import type {
  Brain,
  ChatTurn,
  ConverseResult,
  DialogueTurn,
  EventBus,
  GameTime,
  LlmTransport,
  MemoryRecord,
  Persona,
  PlaceDef,
  PlanStep,
  Rng,
} from '../types'
import {
  AFFECTION_CLAMP,
  FESTIVAL_DAY,
  FESTIVAL_END_MIN,
  FESTIVAL_PLACE_ID,
  FESTIVAL_START_MIN,
  MAX_TURNS,
} from '../constants'
import { validatePlanSteps } from '../engine/planner'
import {
  chatPrompt,
  conversePrompt,
  firstName,
  planPrompt,
  reflectPrompt,
  summarizeChatPrompt,
  type PromptPair,
} from './prompts'
import {
  localChatReply,
  localConverse,
  localPlan,
  localReflect,
  localSummarizeChat,
} from './localBrain'

// ------------------------------------------------------------ text utilities

function stripFences(text: string): string {
  return text.replace(/```[a-zA-Z]*/g, '').trim()
}

/** Strip fences, then try the whole text, the first {...} block, the first [...] block. */
function robustParse(text: string): unknown {
  const cleaned = stripFences(text)
  const candidates: string[] = [cleaned]
  const oStart = cleaned.indexOf('{')
  const oEnd = cleaned.lastIndexOf('}')
  if (oStart !== -1 && oEnd > oStart) candidates.push(cleaned.slice(oStart, oEnd + 1))
  const aStart = cleaned.indexOf('[')
  const aEnd = cleaned.lastIndexOf(']')
  if (aStart !== -1 && aEnd > aStart) candidates.push(cleaned.slice(aStart, aEnd + 1))
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch {
      // try the next candidate
    }
  }
  return null
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function stripQuotes(text: string): string {
  return text.replace(/^["'“”‘’]+/, '').replace(/["'“”‘’]+$/, '').trim()
}

function capChars(text: string, max: number): string {
  const t = text.trim()
  if (t.length <= max) return t
  return t.slice(0, max).replace(/\s+\S*$/, '').trim()
}

/** Coerce an unknown to a trimmed, unquoted, capped string ('' when not a string). */
function cleanString(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  return capChars(stripQuotes(value.trim()), max)
}

function clampInt(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(value)))
}

// ----------------------------------------------------------- plan validation

const FESTIVAL_ACTIVITY = 'celebrating the Harvest Moon Festival'
const MIN_TRIMMED_STEP_MIN = 10

/**
 * Guarantee the festival step on Festival day for villagers who know the
 * rumor: if the LLM forgot it, carve the 19:00-22:00 window out of the plan
 * (trimming straddlers, pushing sleep after) and inject the market step.
 */
function ensureFestivalStep(steps: PlanStep[], knowsFestival: boolean, day: number): PlanStep[] {
  if (!knowsFestival || day !== FESTIVAL_DAY) return steps
  const present = steps.some(
    (s) =>
      s.placeId === FESTIVAL_PLACE_ID &&
      s.startMin < FESTIVAL_END_MIN &&
      s.startMin + s.durationMin > FESTIVAL_START_MIN,
  )
  if (present) return steps

  const out: PlanStep[] = []
  for (const s of steps) {
    const end = s.startMin + s.durationMin
    if (end <= FESTIVAL_START_MIN || s.startMin >= FESTIVAL_END_MIN) {
      out.push(s)
      continue
    }
    if (/sleep/i.test(s.activity)) {
      out.push({ ...s, startMin: FESTIVAL_END_MIN })
      continue
    }
    const head = FESTIVAL_START_MIN - s.startMin
    if (head >= MIN_TRIMMED_STEP_MIN) out.push({ ...s, durationMin: head })
    const tail = end - FESTIVAL_END_MIN
    if (tail >= MIN_TRIMMED_STEP_MIN) {
      out.push({ ...s, startMin: FESTIVAL_END_MIN, durationMin: tail })
    }
  }
  out.push({
    startMin: FESTIVAL_START_MIN,
    durationMin: FESTIVAL_END_MIN - FESTIVAL_START_MIN,
    placeId: FESTIVAL_PLACE_ID,
    activity: FESTIVAL_ACTIVITY,
    emoji: '🎉',
  })
  out.sort((x, y) => x.startMin - y.startMin)
  let end = 0
  for (const s of out) {
    if (s.startMin < end) s.startMin = end
    end = s.startMin + s.durationMin
  }
  return out
}

// ------------------------------------------------------- converse validation

function speakerToId(raw: unknown, a: Persona, b: Persona): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim().toLowerCase()
  if (s === '') return null
  const aKeys = [a.id, firstName(a.name), a.name].map((k) => k.toLowerCase())
  const bKeys = [b.id, firstName(b.name), b.name].map((k) => k.toLowerCase())
  if (aKeys.some((k) => s === k || s.includes(k))) return a.id
  if (bKeys.some((k) => s === k || s.includes(k))) return b.id
  return null
}

/** First-person fallback summary built from the transcript. */
function synthSummary(other: Persona, turns: DialogueTurn[]): string {
  const longest = turns.reduce((m, t) => (t.text.length > m.text.length ? t : m), turns[0])
  return capChars(`I spoke with ${other.name}; "${capChars(longest.text, 90)}" stayed with me.`, 200)
}

function parseConverse(parsed: unknown, a: Persona, b: Persona): ConverseResult | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const obj = parsed as Record<string, unknown>
  const rawTurns = obj['turns']
  if (!Array.isArray(rawTurns)) return null

  const mapped: DialogueTurn[] = []
  for (const item of rawTurns) {
    if (typeof item !== 'object' || item === null) continue
    const rec = item as Record<string, unknown>
    const speakerId = speakerToId(rec['speaker'], a, b)
    const text = cleanString(rec['text'], 200)
    if (speakerId === null || text === '') continue
    mapped.push({ speakerId, text })
  }

  // first speaker must be a; then enforce alternation by dropping repeats
  while (mapped.length > 0 && mapped[0].speakerId !== a.id) mapped.shift()
  const turns: DialogueTurn[] = []
  for (const t of mapped) {
    if (turns.length > 0 && turns[turns.length - 1].speakerId === t.speakerId) continue
    turns.push(t)
    if (turns.length >= MAX_TURNS) break
  }
  if (turns.length < 2) return null

  const rawDelta = obj['affectionDelta']
  const n =
    typeof rawDelta === 'number' ? rawDelta : typeof rawDelta === 'string' ? Number(rawDelta) : NaN
  const affectionDelta = Number.isFinite(n)
    ? clampInt(n, AFFECTION_CLAMP[0], AFFECTION_CLAMP[1])
    : 0

  const aSummary = cleanString(obj['aSummary'], 200) || synthSummary(b, turns)
  const bSummary = cleanString(obj['bSummary'], 200) || synthSummary(a, turns)

  return { turns, aSummary, bSummary, affectionDelta }
}

// -------------------------------------------------------------------- brain

export function createBrain(transport: LlmTransport | null, rng: Rng, bus?: EventBus): Brain {
  let liveNow = false

  function setLive(live: boolean): void {
    if (live === liveNow) return
    liveNow = live
    if (bus !== undefined) bus.emit('llm:status', { live })
  }

  /** One transport round-trip; updates live() on every attempt; never throws. */
  async function ask(
    prompt: PromptPair,
    maxTokens: number,
    temperature: number,
  ): Promise<string | null> {
    if (transport === null) return null
    let text: string | null = null
    try {
      text = await transport.complete(prompt.system, prompt.user, { maxTokens, temperature })
    } catch {
      text = null
    }
    setLive(text !== null)
    return text
  }

  return {
    live(): boolean {
      return liveNow
    },

    async dailyPlan(
      p: Persona,
      day: number,
      yesterdaySummary: string,
      context: MemoryRecord[],
      places: PlaceDef[],
      knowsFestival: boolean,
    ): Promise<PlanStep[]> {
      try {
        const text = await ask(
          planPrompt(p, day, yesterdaySummary, context, places, knowsFestival),
          900,
          0.7,
        )
        if (text !== null) {
          const parsed = robustParse(text)
          let rawSteps: unknown = null
          if (Array.isArray(parsed)) rawSteps = parsed
          else if (typeof parsed === 'object' && parsed !== null) {
            rawSteps = (parsed as { steps?: unknown }).steps ?? null
          }
          const valid = rawSteps === null ? null : validatePlanSteps(rawSteps, places)
          if (valid !== null) return ensureFestivalStep(valid, knowsFestival, day)
        }
      } catch {
        // fall through to local
      }
      return localPlan(p, rng, knowsFestival, day)
    },

    async reflect(p: Persona, memories: MemoryRecord[]): Promise<string[]> {
      try {
        const text = await ask(reflectPrompt(p, memories), 300, 0.8)
        if (text !== null) {
          const parsed = robustParse(text)
          let rawList: unknown = parsed
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            rawList = (parsed as { insights?: unknown }).insights
          }
          if (Array.isArray(rawList)) {
            const insights = rawList
              .filter((s): s is string => typeof s === 'string')
              .map((s) => capChars(stripQuotes(s.trim()), 160))
              .filter((s) => s !== '')
              .slice(0, 3)
            if (insights.length >= 1) return insights
          }
        }
      } catch {
        // fall through to local
      }
      return localReflect(p, memories, rng)
    },

    async converse(
      a: Persona,
      b: Persona,
      ctxA: MemoryRecord[],
      ctxB: MemoryRecord[],
      affectionAtoB: number,
      rumorText: string | null,
      time: GameTime,
    ): Promise<ConverseResult> {
      try {
        const text = await ask(
          conversePrompt(a, b, ctxA, ctxB, affectionAtoB, rumorText, time),
          700,
          0.9,
        )
        if (text !== null) {
          const result = parseConverse(robustParse(text), a, b)
          if (result !== null) return result
        }
      } catch {
        // fall through to local
      }
      return localConverse(a, b, affectionAtoB, rumorText, rng, time)
    },

    async chatReply(
      p: Persona,
      status: string,
      context: MemoryRecord[],
      history: ChatTurn[],
      summary: string,
      playerMsg: string,
      time: GameTime,
    ): Promise<string> {
      try {
        const text = await ask(
          chatPrompt(p, status, context, history, summary, playerMsg, time),
          240,
          0.85,
        )
        if (text !== null) {
          let reply = stripQuotes(stripFences(text))
          const prefix = new RegExp(
            `^(?:${escapeRegExp(p.name)}|${escapeRegExp(firstName(p.name))})\\s*[:—–-]\\s*`,
            'i',
          )
          reply = capChars(stripQuotes(reply.replace(prefix, '').trim()), 700)
          if (reply !== '') return reply
        }
      } catch {
        // fall through to local
      }
      return localChatReply(p, status, context, playerMsg, rng)
    },

    async summarizeChat(p: Persona, history: ChatTurn[], prevSummary: string): Promise<string> {
      try {
        const text = await ask(summarizeChatPrompt(p, history, prevSummary), 160, 0.5)
        if (text !== null) {
          const summary = capChars(stripQuotes(stripFences(text)), 400)
          if (summary !== '') return summary
        }
      } catch {
        // fall through to local
      }
      return localSummarizeChat(p, history, prevSummary)
    },
  }
}
