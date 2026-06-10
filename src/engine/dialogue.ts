/**
 * Everdawn Vale — conversation manager (ai-town state machine).
 *
 * Proximity triggers an invitation roll (affection-scaled, with pair/agent
 * cooldowns and a per-pair attempt backoff). Accepted pairs walk to a midpoint
 * ('walking'), stop and face each other ('talking'), and ONE async brain op
 * generates the whole transcript + summaries + affection delta — turns are
 * then revealed one per TURN_REVEAL_MIN game-minutes. The rumor to pass (if
 * any) is chosen deterministically BEFORE generation, so information diffusion
 * is testable regardless of LLM flavor.
 *
 * Pure engine module: no three.js, no DOM, no fetch.
 */
import type {
  AgentApi,
  ChronicleEntry,
  Dialogue,
  DialogueManagerApi,
  DialogueTurn,
  WorldApi,
} from '../types'
import {
  AFFECTION_CLAMP,
  AGENT_TALK_COOLDOWN_MIN,
  CONVERSATION_DISTANCE,
  DEFAULT_AFFECTION,
  FESTIVAL_RUMOR_ID,
  INVITE_ACCEPT_PROB,
  MAX_DIALOGUE_MIN,
  MAX_TURNS,
  PAIR_TALK_COOLDOWN_MIN,
  RUMOR_SPREAD_PROB,
  TALK_RADIUS,
  TALK_SOCIAL_GAIN,
  TURN_REVEAL_MIN,
  WALKOVER_TIMEOUT_MIN,
} from '../constants'
import { firstName, type AgentInternal } from './agent'
import { scoreImportance } from './memory'

/** failed invitation rolls back off this many game-minutes before re-rolling */
const ATTEMPT_BACKOFF_MIN = 30

interface DialogueState extends Dialogue {
  /** rumor direction, fixed when the talk begins (speaker -> listener) */
  rumorFromId: string | null
  rumorToId: string | null
  /** the single converse op has been accepted by the op runner */
  genScheduled: boolean
  /** when 'talking' began — MAX_DIALOGUE_MIN is measured from here */
  talkSinceMin: number
  /** next game-minute a pending turn may be revealed */
  nextRevealMin: number
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function dist(a: AgentApi, b: AgentApi): number {
  return Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z)
}

function pairKey(aId: string, bId: string): string {
  return aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`
}

/** First ~7 words of a phrase, lowercased lead unless it names someone. */
function snippet(text: string): string {
  const words = text.replace(/^[Ii]\s+/, '').trim().split(/\s+/).filter((w) => w !== '')
  const head = words.slice(0, 7).join(' ')
  if (head === '') return 'this and that'
  const eased = /^[A-Z][a-z]/.test(head) && words[0].length > 1 && !/^[A-Z]/.test(words[1] ?? '')
    ? head.charAt(0).toLowerCase() + head.slice(1)
    : head
  return words.length > 7 ? `${eased}…` : eased
}

export function createDialogueManager(world: WorldApi): DialogueManagerApi {
  const dialogues = new Map<string, DialogueState>()
  const pairCooldownUntil = new Map<string, number>()
  const agentCooldownUntil = new Map<string, number>()
  const attemptBackoffUntil = new Map<string, number>()
  let counter = 0

  function chronicle(icon: string, text: string, kind: ChronicleEntry['kind'], agentIds: string[]): void {
    const entry: ChronicleEntry = { icon, text, kind, agentIds }
    world.bus.emit('chronicle', entry)
  }

  // ------------------------------------------------------------------ start
  function maybeStart(a: AgentApi, b: AgentApi, nowMin: number): boolean {
    if (a.persona.id === b.persona.id) return false
    if (!a.interruptible() || !b.interruptible()) return false
    if (dist(a, b) >= TALK_RADIUS) return false
    const aId = a.persona.id
    const bId = b.persona.id
    const key = pairKey(aId, bId)
    if (nowMin < (pairCooldownUntil.get(key) ?? -Infinity)) return false
    if (nowMin < (agentCooldownUntil.get(aId) ?? -Infinity)) return false
    if (nowMin < (agentCooldownUntil.get(bId) ?? -Infinity)) return false
    if (nowMin < (attemptBackoffUntil.get(key) ?? -Infinity)) return false
    // one roll per backoff window — a failed roll doesn't re-roll every minute
    attemptBackoffUntil.set(key, nowMin + ATTEMPT_BACKOFF_MIN)
    const avgAffection = (a.affection(bId) + b.affection(aId)) / 2
    const acceptProb = clamp(
      INVITE_ACCEPT_PROB + (avgAffection - DEFAULT_AFFECTION) / 100,
      0.15,
      0.95,
    )
    if (!world.rng.chance(acceptProb)) return false

    const id = `dlg_${++counter}`
    const midpoint = world.grid.nearestWalkable({
      x: (a.pos.x + b.pos.x) / 2,
      z: (a.pos.z + b.pos.z) / 2,
    })
    const d: DialogueState = {
      id,
      aId,
      bId,
      state: 'walking',
      turns: [],
      pending: [],
      startedMin: nowMin,
      lastTurnMin: nowMin,
      summary: null,
      rumorId: null,
      rumorFromId: null,
      rumorToId: null,
      genScheduled: false,
      talkSinceMin: nowMin,
      nextRevealMin: Infinity,
    }
    dialogues.set(id, d)
    a.setDialogue(id)
    a.setAction(
      {
        kind: 'talk',
        description: `going to speak with ${firstName(b.persona)}`,
        emoji: '💬',
        withAgentId: bId,
        endMin: Infinity,
      },
      midpoint,
    )
    b.setDialogue(id)
    b.setAction(
      {
        kind: 'talk',
        description: `going to speak with ${firstName(a.persona)}`,
        emoji: '💬',
        withAgentId: aId,
        endMin: Infinity,
      },
      midpoint,
    )
    world.bus.emit('dialogue:start', { dialogue: d })
    return true
  }

  // ---------------------------------------------------------------- talking
  function beginTalking(d: DialogueState, a: AgentInternal, b: AgentInternal, nowMin: number): void {
    d.state = 'talking'
    d.talkSinceMin = nowMin
    // stop both (setAction without a target clears any remaining path)
    a.setAction({
      kind: 'talk',
      description: `speaking with ${firstName(b.persona)}`,
      emoji: '💬',
      withAgentId: d.bId,
      endMin: Infinity,
    })
    b.setAction({
      kind: 'talk',
      description: `speaking with ${firstName(a.persona)}`,
      emoji: '💬',
      withAgentId: d.aId,
      endMin: Infinity,
    })
    // face each other directly
    a.face(Math.atan2(b.pos.x - a.pos.x, b.pos.z - a.pos.z))
    b.face(Math.atan2(a.pos.x - b.pos.x, a.pos.z - b.pos.z))
    // choose the rumor (and its direction) deterministically, on the sim thread
    if (world.rng.chance(RUMOR_SPREAD_PROB)) {
      let rumor = world.rumors.pickToSpread(d.aId, d.bId)
      if (rumor !== null) {
        d.rumorFromId = d.aId
        d.rumorToId = d.bId
      } else {
        rumor = world.rumors.pickToSpread(d.bId, d.aId)
        if (rumor !== null) {
          d.rumorFromId = d.bId
          d.rumorToId = d.aId
        }
      }
      d.rumorId = rumor?.id ?? null
    }
    tryScheduleConverse(d, a, b)
  }

  /** ONE converse op, on participant A; retried next tick if A's slot is busy. */
  function tryScheduleConverse(d: DialogueState, a: AgentInternal, b: AgentInternal): void {
    d.genScheduled = world.ops.schedule(d.aId, 'converse', async () => {
      const now = world.clock.time.totalMin
      const ctxA = a.memory.retrieve(`my thoughts about ${firstName(b.persona)}`, now, 5)
      const ctxB = b.memory.retrieve(`my thoughts about ${firstName(a.persona)}`, now, 5)
      const rumorText = d.rumorId !== null ? world.rumors.get(d.rumorId)?.text ?? null : null
      const result = await world.brain.converse(
        a.persona, b.persona, ctxA, ctxB, a.affection(d.bId), rumorText,
        { ...world.clock.time },
      )
      return () => {
        if (d.state !== 'talking') return // ended/cancelled while generating
        d.pending = result.turns
          .filter(
            (t): t is DialogueTurn =>
              typeof t?.text === 'string' &&
              t.text.trim() !== '' &&
              (t.speakerId === d.aId || t.speakerId === d.bId),
          )
          .slice(0, MAX_TURNS)
        d.summary = {
          aSummary: result.aSummary,
          bSummary: result.bSummary,
          affectionDelta: result.affectionDelta,
        }
        d.nextRevealMin = 0 // first turn reveals immediately
      }
    })
  }

  function reveal(d: DialogueState, a: AgentInternal, b: AgentInternal, nowMin: number): void {
    const turn = d.pending.shift()
    if (turn === undefined) return
    d.turns.push(turn)
    d.lastTurnMin = nowMin
    d.nextRevealMin = nowMin + TURN_REVEAL_MIN
    a.needs.satisfy('social', TALK_SOCIAL_GAIN)
    b.needs.satisfy('social', TALK_SOCIAL_GAIN)
    world.bus.emit('dialogue:turn', { dialogue: d, turn })
  }

  // -------------------------------------------------------------------- end
  function topicOf(d: DialogueState): string {
    if (d.rumorId === FESTIVAL_RUMOR_ID) return 'the Harvest Moon Festival'
    if (d.rumorId !== null) {
      const rumor = world.rumors.get(d.rumorId)
      if (rumor !== undefined) return snippet(rumor.text)
    }
    if (d.summary !== null) return snippet(d.summary.aSummary)
    return 'the small doings of the vale'
  }

  function end(d: DialogueState, a: AgentInternal, b: AgentInternal, nowMin: number): void {
    dialogues.delete(d.id)
    d.state = 'done'
    const s = d.summary
    if (s !== null) {
      // +1 over the heuristic for the social weight of a real conversation
      a.memory.add(
        'dialogue', s.aSummary,
        Math.min(10, scoreImportance(s.aSummary) + 1), nowMin, [d.bId],
      )
      b.memory.add(
        'dialogue', s.bSummary,
        Math.min(10, scoreImportance(s.bSummary) + 1), nowMin, [d.aId],
      )
      const delta = clamp(s.affectionDelta, AFFECTION_CLAMP[0], AFFECTION_CLAMP[1])
      a.adjustAffection(d.bId, delta)
      b.adjustAffection(d.aId, delta)
      if (d.rumorId !== null && d.rumorFromId !== null && d.rumorToId !== null) {
        const rumor = world.rumors.get(d.rumorId)
        if (rumor !== undefined && world.rumors.learn(d.rumorToId, d.rumorId, d.rumorFromId)) {
          const listener = world.getAgent(d.rumorToId)
          listener?.memory.add('observation', rumor.text, rumor.spice, nowMin, [
            d.rumorFromId,
            rumor.id,
          ])
        }
      }
    }
    world.bus.emit('dialogue:end', { dialogue: d })
    chronicle(
      '💬',
      `${firstName(a.persona)} and ${firstName(b.persona)} spoke of ${topicOf(d)}.`,
      'talk',
      [d.aId, d.bId],
    )
    a.setDialogue(null) // also clears their talk actions, so minuteTick re-plans
    b.setDialogue(null)
    const key = pairKey(d.aId, d.bId)
    pairCooldownUntil.set(key, nowMin + PAIR_TALK_COOLDOWN_MIN)
    agentCooldownUntil.set(d.aId, nowMin + AGENT_TALK_COOLDOWN_MIN)
    agentCooldownUntil.set(d.bId, nowMin + AGENT_TALK_COOLDOWN_MIN)
  }

  /** silent cancellation (walkover timed out / forced while still walking) */
  function cancel(d: DialogueState, a: AgentInternal, b: AgentInternal, nowMin: number): void {
    dialogues.delete(d.id)
    d.state = 'done'
    a.setDialogue(null)
    b.setDialogue(null)
    attemptBackoffUntil.set(pairKey(d.aId, d.bId), nowMin + ATTEMPT_BACKOFF_MIN)
  }

  function participants(d: DialogueState): [AgentInternal, AgentInternal] | null {
    const a = world.getAgent(d.aId) as AgentInternal | undefined
    const b = world.getAgent(d.bId) as AgentInternal | undefined
    if (a === undefined || b === undefined) return null
    return [a, b]
  }

  // ------------------------------------------------------------------- tick
  return {
    minuteTick(nowMin: number): void {
      // (1) proximity scan over all pairs (cheap gates inside maybeStart)
      const agents = world.agents
      for (let i = 0; i < agents.length; i++) {
        for (let j = i + 1; j < agents.length; j++) {
          maybeStart(agents[i], agents[j], nowMin)
        }
      }

      // (2)+(3) advance every active dialogue
      for (const d of [...dialogues.values()]) {
        const pair = participants(d)
        if (pair === null) {
          dialogues.delete(d.id)
          continue
        }
        const [a, b] = pair

        if (d.state === 'walking') {
          if (dist(a, b) <= CONVERSATION_DISTANCE) {
            beginTalking(d, a, b, nowMin)
          } else if (nowMin - d.startedMin >= WALKOVER_TIMEOUT_MIN) {
            cancel(d, a, b, nowMin)
            continue
          }
        }

        if (d.state === 'talking') {
          if (!d.genScheduled) tryScheduleConverse(d, a, b)
          if (d.pending.length === 0 && d.summary !== null) {
            end(d, a, b, nowMin)
            continue
          }
          if (nowMin - d.talkSinceMin >= MAX_DIALOGUE_MIN) {
            end(d, a, b, nowMin) // end with whatever was revealed
            continue
          }
          if (d.pending.length > 0 && nowMin >= d.nextRevealMin) reveal(d, a, b, nowMin)
        }
      }
    },

    maybeStart,

    active(): Dialogue[] {
      return [...dialogues.values()]
    },

    get(id: string): Dialogue | undefined {
      return dialogues.get(id)
    },

    endNow(id: string): void {
      const d = dialogues.get(id)
      if (d === undefined) return
      const pair = participants(d)
      if (pair === null) {
        dialogues.delete(d.id)
        return
      }
      const nowMin = world.clock.time.totalMin
      if (d.state === 'talking') end(d, pair[0], pair[1], nowMin)
      else cancel(d, pair[0], pair[1], nowMin)
    },
  }
}
