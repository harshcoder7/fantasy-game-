/**
 * Everdawn Vale — daily-plan validation and the deterministic routine fallback.
 *
 * validatePlanSteps() is the gatekeeper for LLM-produced plans (llm/brain.ts):
 * it coerces "HH:MM" starts, clamps times and durations, filters unknown
 * places, sorts, drops overlaps and backfills emoji — or returns null when
 * the material is hopeless so the caller can fall back.
 *
 * routineToPlan() turns a persona's hand-authored routine into a concrete
 * plan with seeded jitter, and on Festival day carves out the evening for
 * every villager who knows the rumor.
 *
 * Pure engine module: no three.js, no DOM, no fetch.
 */
import type { PlaceDef, Persona, PlanStep, Rng } from '../types'
import {
  FESTIVAL_DAY,
  FESTIVAL_END_MIN,
  FESTIVAL_PLACE_ID,
  FESTIVAL_START_MIN,
  PLAN_MAX_STEPS,
  ROUTINE_JITTER_MIN,
} from '../constants'

const DAY_MIN = 1440
const MIN_STEP_MIN = 10
const MAX_STEP_MIN = 600
const MIN_VALID_STEPS = 3

// ------------------------------------------------------------- emoji default

const DEFAULT_EMOJI = '✨'

/** Small keyword → emoji map for steps that arrive without one; first match wins. */
const EMOJI_BY_KEYWORD: ReadonlyArray<readonly [RegExp, string]> = [
  [/sleep|slumber|doze/, '😴'],
  [/festival|celebrat|danc|lantern/, '🎉'],
  [/eat|meal|supper|dinner|lunch|breakfast|porridge|stew|bread|cook|honey/, '🍲'],
  [/forge|forging|hammer|anvil|smith|iron|quench/, '🔨'],
  [/ale|mead|brew|tavern|pour/, '🍺'],
  [/pray|devotion|bless|vesper|candle|worship/, '🕯️'],
  [/sing|song|perform|lute|music|ballad/, '🎶'],
  [/stud|read|tome|scroll|codex|translat|catalog|ledger|petition/, '📖'],
  [/scry|crystal|star|moon/, '🔮'],
  [/herb|tincture|salve|mushroom|flower|garden/, '🌿'],
  [/harvest|wheat|till|sow|plough|plow|farm|hen|egg/, '🌾'],
  [/mill|grain/, '🌬️'],
  [/fish|lake|water|swim/, '🎣'],
  [/market|stall|haggl|sell|wares|browse|trade|coin|shop/, '🛒'],
  [/gossip|chat|talk|news|counsel|court|visit/, '💬'],
  [/sweep|clean|wipe|tidy|scrub/, '🧹'],
  [/walk|wander|stroll|pace|patrol/, '🚶'],
  [/rest|hearth|relax|nap/, '☕'],
]

function emojiFor(activity: string): string {
  const lower = activity.toLowerCase()
  for (const [pattern, emoji] of EMOJI_BY_KEYWORD) {
    if (pattern.test(lower)) return emoji
  }
  return DEFAULT_EMOJI
}

// ----------------------------------------------------------------- utilities

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value))
}

/** Accepts a minutes-since-midnight number, a numeric string, or "HH:MM". */
function parseStartValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
  if (typeof value === 'string') {
    const hhmm = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(value)
    if (hhmm !== null) return Number(hhmm[1]) * 60 + Number(hhmm[2])
    if (value.trim() !== '') {
      const n = Number(value)
      if (Number.isFinite(n)) return Math.round(n)
    }
  }
  return null
}

function parseDurationValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    if (Number.isFinite(n)) return Math.round(n)
  }
  return null
}

function isSleepStep(activity: string): boolean {
  return /sleep/i.test(activity)
}

// ------------------------------------------------------------------ validate

/**
 * Validate untrusted plan material (typically LLM JSON). Accepts an array of
 * { start | startMin, durationMin, placeId, activity, emoji? }; coerces
 * "HH:MM" starts; clamps startMin 0..1439 and durations 10..600; filters
 * unknown placeIds; sorts by startMin; drops overlapping steps (keeping the
 * earlier); backfills missing emoji from the activity; caps at
 * PLAN_MAX_STEPS. Returns null unless at least 3 valid steps survive.
 */
export function validatePlanSteps(raw: unknown, places: PlaceDef[]): PlanStep[] | null {
  if (!Array.isArray(raw)) return null
  const placeIds = new Set(places.map((p) => p.id))

  const cleaned: PlanStep[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const rec = item as Record<string, unknown>

    let startMin = parseStartValue(rec['startMin'])
    if (startMin === null) startMin = parseStartValue(rec['start'])
    if (startMin === null) continue
    startMin = clamp(startMin, 0, DAY_MIN - 1)

    const duration = parseDurationValue(rec['durationMin'])
    if (duration === null) continue
    const durationMin = clamp(duration, MIN_STEP_MIN, MAX_STEP_MIN)

    const placeId = typeof rec['placeId'] === 'string' ? rec['placeId'].trim() : ''
    if (!placeIds.has(placeId)) continue

    const activity = typeof rec['activity'] === 'string' ? rec['activity'].trim() : ''
    if (activity === '') continue

    const emojiRaw = typeof rec['emoji'] === 'string' ? rec['emoji'].trim() : ''
    const emoji = emojiRaw !== '' ? emojiRaw : emojiFor(activity)

    cleaned.push({ startMin, durationMin, placeId, activity, emoji })
  }

  cleaned.sort((a, b) => a.startMin - b.startMin)

  const result: PlanStep[] = []
  let prevEnd = -Infinity
  for (const step of cleaned) {
    if (step.startMin < prevEnd) continue // overlaps the kept earlier step
    result.push(step)
    prevEnd = step.startMin + step.durationMin
    if (result.length >= PLAN_MAX_STEPS) break
  }

  return result.length >= MIN_VALID_STEPS ? result : null
}

// ------------------------------------------------------------------- routine

function parseRoutineStart(start: string): number | null {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(start)
  if (m === null) return null
  return clamp(Number(m[1]) * 60 + Number(m[2]), 0, DAY_MIN - 1)
}

/**
 * Carve the festival window out of a chronological plan. Steps fully inside
 * the window vanish; steps straddling its edges are trimmed/split; sleep
 * steps overlapping it are pushed to start after it, duration intact.
 */
function carveFestivalWindow(steps: PlanStep[]): PlanStep[] {
  const fs = FESTIVAL_START_MIN
  const fe = FESTIVAL_END_MIN
  const carved: PlanStep[] = []
  for (const step of steps) {
    const start = step.startMin
    const end = step.startMin + step.durationMin
    if (end <= fs || start >= fe) {
      carved.push(step)
      continue
    }
    if (isSleepStep(step.activity)) {
      // bedtime falls inside the festivities — sleep afterwards, full night kept
      carved.push({ ...step, startMin: fe })
      continue
    }
    const headDur = fs - start
    if (headDur >= MIN_STEP_MIN) carved.push({ ...step, durationMin: headDur })
    const tailDur = end - fe
    if (tailDur >= MIN_STEP_MIN) carved.push({ ...step, startMin: fe, durationMin: tailDur })
  }
  carved.push({
    startMin: fs,
    durationMin: fe - fs,
    placeId: FESTIVAL_PLACE_ID,
    activity: 'celebrating the Harvest Moon Festival',
    emoji: '🎉',
  })
  return carved
}

/**
 * Deterministic fallback plan from persona.routine: parse "HH:MM" starts,
 * jitter every non-sleep step by ±ROUTINE_JITTER_MIN via the seeded rng
 * (clamping to the previous step's end so order stays valid), and — when the
 * villager knows the festival rumor and it is Festival day — carve out
 * 19:00-22:00 for the Harvest Moon Festival at the market.
 */
export function routineToPlan(p: Persona, rng: Rng, knowsFestival: boolean, day: number): PlanStep[] {
  const steps: PlanStep[] = []
  let prevEnd = 0
  for (const r of p.routine) {
    const base = parseRoutineStart(r.start)
    if (base === null) continue
    const sleep = isSleepStep(r.activity)
    let startMin = sleep
      ? base
      : base + Math.round(rng.range(-ROUTINE_JITTER_MIN, ROUTINE_JITTER_MIN))
    startMin = clamp(startMin, 0, DAY_MIN - 1)
    if (startMin < prevEnd) startMin = clamp(prevEnd, 0, DAY_MIN - 1)
    const durationMin = Math.max(1, Math.round(r.durationMin))
    steps.push({
      startMin,
      durationMin,
      placeId: r.placeId,
      activity: r.activity,
      emoji: r.emoji !== '' ? r.emoji : emojiFor(r.activity),
    })
    prevEnd = startMin + durationMin
  }

  const plan = knowsFestival && day === FESTIVAL_DAY ? carveFestivalWindow(steps) : steps

  // final ordering pass: sort, then nudge any residual overlap to the previous end
  plan.sort((a, b) => a.startMin - b.startMin)
  let end = 0
  for (const step of plan) {
    if (step.startMin < end) step.startMin = end
    end = step.startMin + step.durationMin
  }

  return plan.slice(0, PLAN_MAX_STEPS)
}
