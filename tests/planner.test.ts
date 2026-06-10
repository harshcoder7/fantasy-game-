import { describe, expect, it } from 'vitest'
import { routineToPlan, validatePlanSteps } from '../src/engine/planner'
import { createRng } from '../src/engine/rng'
import { PLACES } from '../src/data/places'
import { PERSONAS } from '../src/data/agents'
import {
  FESTIVAL_DAY,
  FESTIVAL_END_MIN,
  FESTIVAL_PLACE_ID,
  FESTIVAL_START_MIN,
  PLAN_MAX_STEPS,
  ROUTINE_JITTER_MIN,
} from '../src/constants'
import type { PlanStep } from '../src/types'

const parseHHMM = (s: string) => {
  const [h, m] = s.split(':').map(Number)
  return h * 60 + m
}

const overlapsFestival = (s: PlanStep) =>
  s.startMin < FESTIVAL_END_MIN && s.startMin + s.durationMin > FESTIVAL_START_MIN

function expectChronologicalNonOverlapping(plan: PlanStep[]) {
  let prevEnd = -Infinity
  for (const step of plan) {
    expect(step.startMin).toBeGreaterThanOrEqual(prevEnd)
    expect(step.durationMin).toBeGreaterThan(0)
    prevEnd = step.startMin + step.durationMin
  }
}

describe('validatePlanSteps', () => {
  const goodSteps = [
    { start: '07:30', durationMin: 60, placeId: 'market', activity: 'browsing the stalls', emoji: '🛒' },
    { startMin: 540, durationMin: 90, placeId: 'forge', activity: 'forging horseshoes', emoji: '🔨' },
    { startMin: '660', durationMin: 60, placeId: 'tavern', activity: 'sharing a hot meal', emoji: '🍲' },
  ]

  it('coerces "HH:MM" starts and numeric strings to minutes-since-midnight', () => {
    const plan = validatePlanSteps(goodSteps, PLACES)
    expect(plan).not.toBeNull()
    expect(plan!.map((s) => s.startMin)).toEqual([450, 540, 660])
  })

  it('drops steps with unknown placeIds', () => {
    const plan = validatePlanSteps(
      [...goodSteps, { start: '13:00', durationMin: 60, placeId: 'moonbase', activity: 'low-gravity lunch', emoji: '🌑' }],
      PLACES,
    )
    expect(plan).not.toBeNull()
    expect(plan!.length).toBe(3)
    expect(plan!.some((s) => s.placeId === 'moonbase')).toBe(false)
  })

  it('sorts by startMin and resolves overlaps by keeping the earlier step', () => {
    const plan = validatePlanSteps(
      [
        { start: '12:00', durationMin: 120, placeId: 'tavern', activity: 'pouring ale', emoji: '🍺' },
        { start: '08:00', durationMin: 60, placeId: 'market', activity: 'browsing', emoji: '🛒' },
        { start: '12:30', durationMin: 60, placeId: 'forge', activity: 'hammering a blade', emoji: '⚒️' }, // inside 12:00-14:00
        { start: '14:00', durationMin: 60, placeId: 'well', activity: 'drawing water', emoji: '🪣' }, // back-to-back is fine
      ],
      PLACES,
    )
    expect(plan).not.toBeNull()
    expect(plan!.map((s) => s.placeId)).toEqual(['market', 'tavern', 'well'])
    expectChronologicalNonOverlapping(plan!)
  })

  it('returns null for non-arrays and when fewer than 3 steps survive', () => {
    expect(validatePlanSteps(null, PLACES)).toBeNull()
    expect(validatePlanSteps({ steps: [] }, PLACES)).toBeNull()
    expect(validatePlanSteps([], PLACES)).toBeNull()
    expect(validatePlanSteps(goodSteps.slice(0, 2), PLACES)).toBeNull()
    // 3 raw steps but one is garbage → only 2 valid → null
    expect(
      validatePlanSteps([goodSteps[0], goodSteps[1], { start: 'noon', durationMin: 60, placeId: 'market', activity: 'x' }], PLACES),
    ).toBeNull()
  })

  it('clamps starts into 0..1439 and durations into 10..600', () => {
    const plan = validatePlanSteps(
      [
        { startMin: -50, durationMin: 5, placeId: 'market', activity: 'early haggling' },
        { startMin: 600, durationMin: 5000, placeId: 'forge', activity: 'an endless shift' },
        { startMin: 99999, durationMin: 60, placeId: 'tavern', activity: 'late ale' },
      ],
      PLACES,
    )
    expect(plan).not.toBeNull()
    expect(plan![0].startMin).toBe(0)
    expect(plan![0].durationMin).toBe(10)
    expect(plan![1].durationMin).toBe(600)
    expect(plan![2].startMin).toBe(1439)
  })

  it('backfills a sensible emoji when missing', () => {
    const plan = validatePlanSteps(
      [
        { start: '08:00', durationMin: 60, placeId: 'market', activity: 'browsing the stalls' },
        { start: '12:00', durationMin: 60, placeId: 'tavern', activity: 'eating a meal' },
        { start: '22:00', durationMin: 480, placeId: 'tavern', activity: 'sleeping' },
      ],
      PLACES,
    )
    expect(plan).not.toBeNull()
    for (const s of plan!) expect(s.emoji).not.toBe('')
    expect(plan![2].emoji).toBe('😴')
  })

  it('caps the plan at PLAN_MAX_STEPS', () => {
    const raw = Array.from({ length: 30 }, (_, i) => ({
      startMin: i * 45,
      durationMin: 30,
      placeId: 'market',
      activity: `errand ${i}`,
      emoji: '🛒',
    }))
    const plan = validatePlanSteps(raw, PLACES)
    expect(plan).not.toBeNull()
    expect(plan!.length).toBe(PLAN_MAX_STEPS)
  })
})

describe('routineToPlan', () => {
  const seraphine = PERSONAS.find((p) => p.id === 'seraphine')!
  const thorin = PERSONAS.find((p) => p.id === 'thorin')!

  it('is deterministic for the same seed', () => {
    const a = routineToPlan(thorin, createRng(101), false, 1)
    const b = routineToPlan(thorin, createRng(101), false, 1)
    expect(a).toEqual(b)
  })

  it('keeps one step per routine entry with jitter within ±ROUTINE_JITTER_MIN (sleep unjittered)', () => {
    const plan = routineToPlan(thorin, createRng(7), false, 1)
    expect(plan.length).toBe(thorin.routine.length)
    let prevEnd = 0
    let jittered = false
    plan.forEach((step, i) => {
      const r = thorin.routine[i]
      const base = parseHHMM(r.start)
      expect(step.placeId).toBe(r.placeId)
      expect(step.activity).toBe(r.activity)
      expect(step.durationMin).toBe(r.durationMin)
      if (/sleep/i.test(r.activity)) {
        expect(step.startMin).toBe(Math.max(base, prevEnd))
      } else {
        expect(step.startMin).toBeGreaterThanOrEqual(base - ROUTINE_JITTER_MIN)
        expect(step.startMin).toBeLessThanOrEqual(Math.max(base + ROUTINE_JITTER_MIN, prevEnd))
        if (step.startMin !== base) jittered = true
      }
      prevEnd = step.startMin + step.durationMin
    })
    expect(jittered).toBe(true) // the rng actually moved something
    expectChronologicalNonOverlapping(plan)
  })

  it('injects the festival step on FESTIVAL_DAY when the rumor is known, replacing overlapping steps', () => {
    const plan = routineToPlan(seraphine, createRng(20260610), true, FESTIVAL_DAY)
    const festivalSteps = plan.filter((s) => /festival/i.test(s.activity))
    expect(festivalSteps).toEqual([
      {
        startMin: FESTIVAL_START_MIN,
        durationMin: FESTIVAL_END_MIN - FESTIVAL_START_MIN,
        placeId: FESTIVAL_PLACE_ID,
        activity: expect.stringMatching(/festival/i),
        emoji: '🎉',
      },
    ])
    // nothing else may overlap the festival window
    for (const s of plan) {
      if (s === festivalSteps[0]) continue
      expect(overlapsFestival(s), `${s.activity} @${s.startMin}`).toBe(false)
    }
    expectChronologicalNonOverlapping(plan)
    // sleep was pushed past the festivities with its full duration intact
    const sleep = plan.find((s) => /sleep/i.test(s.activity))!
    expect(sleep.startMin).toBeGreaterThanOrEqual(FESTIVAL_END_MIN)
    expect(sleep.durationMin).toBe(540)
  })

  it('plans the festival for every persona who knows the rumor on day 3', () => {
    for (const p of PERSONAS) {
      const plan = routineToPlan(p, createRng(5), true, FESTIVAL_DAY)
      const fest = plan.filter(
        (s) => s.placeId === FESTIVAL_PLACE_ID && s.startMin === FESTIVAL_START_MIN && /festival/i.test(s.activity),
      )
      expect(fest.length, p.id).toBe(1)
      expectChronologicalNonOverlapping(plan)
    }
  })

  it('does NOT inject the festival on other days, or when the rumor is unknown', () => {
    const wrongDay = routineToPlan(seraphine, createRng(3), true, FESTIVAL_DAY + 1)
    const unknowing = routineToPlan(seraphine, createRng(3), false, FESTIVAL_DAY)
    for (const plan of [wrongDay, unknowing]) {
      expect(plan.some((s) => /festival/i.test(s.activity))).toBe(false)
      // the ordinary evening routine survives, so something overlaps 19:00-22:00
      expect(plan.some(overlapsFestival)).toBe(true)
    }
  })

  it('never exceeds PLAN_MAX_STEPS', () => {
    for (const p of PERSONAS) {
      expect(routineToPlan(p, createRng(1), true, FESTIVAL_DAY).length).toBeLessThanOrEqual(PLAN_MAX_STEPS)
    }
  })
})
