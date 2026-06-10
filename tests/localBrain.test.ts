/**
 * LocalBrain behavioral tests — deterministic, rng-driven fallbacks.
 * localPlan / localConverse / localChatReply / localReflect.
 */
import { describe, expect, it } from 'vitest'
import type { GameTime, MemoryRecord, PlanStep } from '../src/types'
import {
  AFFECTION_CLAMP,
  FESTIVAL_DAY,
  FESTIVAL_END_MIN,
  FESTIVAL_PLACE_ID,
  FESTIVAL_START_MIN,
} from '../src/constants'
import { createRng } from '../src/engine/rng'
import { PLACES } from '../src/data/places'
import { PERSONAS } from '../src/data/agents'
import {
  localChatReply,
  localConverse,
  localPlan,
  localReflect,
} from '../src/llm/localBrain'

const PLACE_IDS = new Set(PLACES.map((p) => p.id))

const T_MORNING: GameTime = { day: 1, hour: 9, minute: 30, totalMin: 570 }

function mem(id: number, text: string, importance = 5): MemoryRecord {
  return { id, kind: 'seed', text, createdMin: 0, lastAccessMin: 0, importance, subjects: [] }
}

function assertOrderedValidSteps(steps: PlanStep[], personaHomeId: string): void {
  expect(steps.length).toBeGreaterThanOrEqual(3)
  let prevEnd = 0
  for (const s of steps) {
    expect(PLACE_IDS.has(s.placeId), `unknown placeId ${s.placeId}`).toBe(true)
    expect(s.durationMin).toBeGreaterThan(0)
    expect(s.startMin).toBeGreaterThanOrEqual(0)
    expect(s.startMin).toBeLessThan(1440)
    // ordered and non-overlapping: each step starts at/after the previous end
    expect(s.startMin, 'steps must be ordered and non-overlapping').toBeGreaterThanOrEqual(prevEnd)
    prevEnd = s.startMin + s.durationMin
    expect(s.activity).not.toBe('')
    expect(s.emoji).not.toBe('')
  }
  const last = steps[steps.length - 1]
  expect(/sleep/i.test(last.activity), 'last step must be sleeping').toBe(true)
  expect(last.placeId, 'last step must be at home').toBe(personaHomeId)
}

describe('localPlan', () => {
  it('produces valid ordered steps ending with sleep at home for ALL 9 personas', () => {
    expect(PERSONAS.length).toBe(9)
    const rng = createRng(101)
    for (const p of PERSONAS) {
      const steps = localPlan(p, rng, false, 1)
      assertOrderedValidSteps(steps, p.homeId)
    }
  })

  it('injects the festival step on day 3 when the persona knows the festival', () => {
    for (const p of PERSONAS) {
      const rng = createRng(202)
      const steps = localPlan(p, rng, true, FESTIVAL_DAY)
      assertOrderedValidSteps(steps, p.homeId)
      const festival = steps.filter(
        (s) =>
          s.placeId === FESTIVAL_PLACE_ID &&
          /festival/i.test(s.activity) &&
          s.startMin < FESTIVAL_END_MIN &&
          s.startMin + s.durationMin > FESTIVAL_START_MIN,
      )
      expect(festival.length, `${p.id} must have exactly one festival step`).toBe(1)
      expect(festival[0].startMin).toBe(FESTIVAL_START_MIN)
      expect(festival[0].startMin + festival[0].durationMin).toBe(FESTIVAL_END_MIN)
      // nothing else may overlap the festival window
      for (const s of steps) {
        if (s === festival[0]) continue
        const overlaps =
          s.startMin < FESTIVAL_END_MIN && s.startMin + s.durationMin > FESTIVAL_START_MIN
        expect(overlaps, `${p.id}: "${s.activity}" overlaps the festival window`).toBe(false)
      }
    }
  })

  it('does NOT inject the festival step when the day or knowledge is wrong', () => {
    const noFestival = (knows: boolean, day: number): void => {
      for (const p of PERSONAS) {
        const steps = localPlan(p, createRng(303), knows, day)
        expect(steps.some((s) => /festival/i.test(s.activity))).toBe(false)
      }
    }
    noFestival(true, FESTIVAL_DAY - 1) // knows, wrong day
    noFestival(false, FESTIVAL_DAY) // right day, doesn't know
  })

  it('is deterministic for a fixed seed', () => {
    for (const p of PERSONAS) {
      const a = localPlan(p, createRng(7), true, FESTIVAL_DAY)
      const b = localPlan(p, createRng(7), true, FESTIVAL_DAY)
      expect(a).toEqual(b)
    }
  })
})

describe('localConverse', () => {
  const a = PERSONAS.find((p) => p.id === 'seraphine')!
  const b = PERSONAS.find((p) => p.id === 'thorin')!

  it('returns 4-6 alternating turns starting with a, with non-empty summaries and clamped delta', () => {
    // shape must hold across many rng states, not just one lucky seed
    for (let seed = 1; seed <= 25; seed++) {
      const rng = createRng(seed)
      const res = localConverse(a, b, 60, null, rng, T_MORNING)
      expect(res.turns.length).toBeGreaterThanOrEqual(4)
      expect(res.turns.length).toBeLessThanOrEqual(6)
      expect(res.turns[0].speakerId).toBe(a.id)
      for (let i = 0; i < res.turns.length; i++) {
        const expected = i % 2 === 0 ? a.id : b.id
        expect(res.turns[i].speakerId).toBe(expected)
        expect(res.turns[i].text.trim()).not.toBe('')
      }
      expect(res.aSummary.trim()).not.toBe('')
      expect(res.bSummary.trim()).not.toBe('')
      expect(res.affectionDelta).toBeGreaterThanOrEqual(AFFECTION_CLAMP[0])
      expect(res.affectionDelta).toBeLessThanOrEqual(AFFECTION_CLAMP[1])
      expect(Number.isInteger(res.affectionDelta)).toBe(true)
    }
  })

  it('reflects the rumor text in the transcript and both summaries when one is passed', () => {
    const rumor = 'A grey wolf has been prowling near Greenhollow Farm at dusk'
    for (let seed = 1; seed <= 10; seed++) {
      const res = localConverse(a, b, 40, rumor, createRng(seed), T_MORNING)
      expect(res.turns.some((t) => t.text.includes(rumor))).toBe(true)
      // both participants remember it as passed news
      expect(res.aSummary).toContain('news')
      expect(res.aSummary.toLowerCase()).toContain('wolf')
      expect(res.bSummary.toLowerCase()).toContain('wolf')
      expect(res.bSummary).toContain(a.name)
      expect(res.aSummary).toContain(b.name)
    }
  })

  it('is deterministic for a fixed seed', () => {
    const r1 = localConverse(a, b, 55, null, createRng(99), T_MORNING)
    const r2 = localConverse(a, b, 55, null, createRng(99), T_MORNING)
    expect(r1).toEqual(r2)
  })
})

describe('localChatReply', () => {
  const greta = PERSONAS.find((p) => p.id === 'greta')!
  const status = '🌾 harvesting wheat — Greenhollow Farm'

  it('greets in character, naming the persona', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const reply = localChatReply(greta, status, [], 'Hello!', createRng(seed))
      expect(reply.trim()).not.toBe('')
      expect(reply).toContain(greta.name)
    }
  })

  it('references the most relevant provided memory', () => {
    const context = [
      mem(1, 'A grey wolf was prowling near Greenhollow Farm at dusk'),
      mem(2, 'My new honey mead is nearly ready'),
      mem(3, 'The dawn light through the east window is lovely'),
    ]
    for (let seed = 1; seed <= 10; seed++) {
      const reply = localChatReply(
        greta, status, context, 'Have you heard anything about a wolf?', createRng(seed),
      )
      expect(reply).toContain('wolf was prowling near Greenhollow Farm')
      expect(reply).not.toContain('honey mead')
    }
  })

  it('stays in character with no relevant memory: mentions name, role or a goal', () => {
    for (let seed = 1; seed <= 15; seed++) {
      const reply = localChatReply(
        greta, status, [], 'What lies beyond the eastern mountains of Zanzibar?', createRng(seed),
      )
      expect(reply.trim()).not.toBe('')
      const lower = reply.toLowerCase()
      const inCharacter =
        lower.includes(greta.name.toLowerCase()) ||
        lower.includes(greta.role.toLowerCase()) ||
        greta.goals.some((g) => lower.includes(g.toLowerCase()))
      expect(inCharacter, `not in character: "${reply}"`).toBe(true)
    }
  })

  it('mentions the current doing when the wanderer asks what they are up to', () => {
    const reply = localChatReply(greta, status, [], 'What are you doing right now?', createRng(4))
    expect(reply.toLowerCase()).toContain('harvesting wheat')
  })

  it('is deterministic for a fixed seed', () => {
    const ctx = [mem(1, 'The plough blade is cracked; Thorin is the only smith I trust')]
    const r1 = localChatReply(greta, status, ctx, 'Tell me of the smith', createRng(31))
    const r2 = localChatReply(greta, status, ctx, 'Tell me of the smith', createRng(31))
    expect(r1).toBe(r2)
  })
})

describe('localReflect', () => {
  const maeve = PERSONAS.find((p) => p.id === 'maeve')!

  it('produces two first-person insights about the dominant person and topic', () => {
    const memories: MemoryRecord[] = [
      { ...mem(1, 'Brother Caelum is tending the candles at the Temple'), subjects: ['caelum'] },
      { ...mem(2, 'Brother Caelum is sweeping the nave at the Temple'), subjects: ['caelum'] },
      { ...mem(3, 'Brother Caelum is offering counsel at the Temple'), subjects: ['caelum'] },
      mem(4, 'The moonpetal harvest must happen under the harvest moonpetal sky'),
      mem(5, 'I dried moonpetal herbs all afternoon'),
    ]
    const insights = localReflect(maeve, memories, createRng(11))
    expect(insights.length).toBe(2)
    expect(insights.some((s) => s.includes('Caelum'))).toBe(true)
    for (const s of insights) expect(s.trim()).not.toBe('')
    // deterministic
    expect(localReflect(maeve, memories, createRng(11))).toEqual(insights)
  })

  it('falls back to goal insights when memories are empty', () => {
    const insights = localReflect(maeve, [], createRng(12))
    expect(insights.length).toBe(2)
    const joined = insights.join(' ').toLowerCase()
    expect(maeve.goals.some((g) => joined.includes(g.toLowerCase()))).toBe(true)
  })
})
