import { describe, expect, it } from 'vitest'
import { createNeeds } from '../src/engine/needs'
import { createRng } from '../src/engine/rng'
import {
  ENERGY_DECAY,
  ENERGY_RECOVER_ASLEEP,
  HUNGER_DECAY,
  NEED_START,
  NEED_URGENT,
  SOCIAL_DECAY,
  SPIRIT_DECAY,
} from '../src/constants'
import type { NeedId } from '../src/types'

const ALL: NeedId[] = ['energy', 'hunger', 'social', 'spirit']

const mkNeeds = (seed = 42) => createNeeds(createRng(seed))

/** drive a need to an exact value via satisfy() deltas */
function setNeed(needs: ReturnType<typeof mkNeeds>, id: NeedId, value: number) {
  needs.satisfy(id, value - needs.values[id])
}

describe('createNeeds', () => {
  it('starts every need near NEED_START and is deterministic per rng seed', () => {
    const a = mkNeeds(7)
    const b = mkNeeds(7)
    for (const id of ALL) {
      expect(a.values[id]).toBeGreaterThanOrEqual(NEED_START - 6)
      expect(a.values[id]).toBeLessThanOrEqual(NEED_START + 6)
      expect(a.values[id]).toBe(b.values[id])
    }
  })

  it('awake tick decays each need by its per-minute constant', () => {
    const needs = mkNeeds()
    const before = { ...needs.values }
    needs.tickMinute(false)
    expect(needs.values.energy).toBeCloseTo(before.energy - ENERGY_DECAY, 10)
    expect(needs.values.hunger).toBeCloseTo(before.hunger - HUNGER_DECAY, 10)
    expect(needs.values.social).toBeCloseTo(before.social - SOCIAL_DECAY, 10)
    expect(needs.values.spirit).toBeCloseTo(before.spirit - SPIRIT_DECAY, 10)
  })

  it('asleep tick RECOVERS energy while the others keep slowly decaying', () => {
    const needs = mkNeeds()
    const before = { ...needs.values }
    needs.tickMinute(true)
    expect(needs.values.energy).toBeCloseTo(before.energy + ENERGY_RECOVER_ASLEEP, 10)
    expect(needs.values.hunger).toBeLessThan(before.hunger)
    expect(needs.values.social).toBeLessThan(before.social)
    expect(needs.values.spirit).toBeLessThan(before.spirit)
    // asleep decay is gentler than awake decay
    expect(before.hunger - needs.values.hunger).toBeLessThan(HUNGER_DECAY)
  })

  it('values clamp to [0, 100] under extreme satisfy and long decay', () => {
    const needs = mkNeeds()
    needs.satisfy('hunger', 10_000)
    expect(needs.values.hunger).toBe(100)
    needs.satisfy('hunger', -10_000)
    expect(needs.values.hunger).toBe(0)
    // two full game-days awake: nothing may go negative
    for (let i = 0; i < 2880; i++) needs.tickMinute(false)
    for (const id of ALL) {
      expect(needs.values[id]).toBeGreaterThanOrEqual(0)
      expect(needs.values[id]).toBeLessThanOrEqual(100)
    }
    // a long sleep cannot push energy past 100
    for (let i = 0; i < 1000; i++) needs.tickMinute(true)
    expect(needs.values.energy).toBe(100)
  })

  it('satisfy adds (and clamps) the given amount', () => {
    const needs = mkNeeds()
    setNeed(needs, 'social', 40)
    needs.satisfy('social', 15)
    expect(needs.values.social).toBeCloseTo(55, 10)
  })

  describe('urgent()', () => {
    it('is null while every need sits above its threshold', () => {
      const needs = mkNeeds()
      expect(needs.urgent()).toBeNull()
    })

    it('a need exactly AT its threshold is not urgent', () => {
      const needs = mkNeeds()
      setNeed(needs, 'hunger', NEED_URGENT.hunger)
      expect(needs.urgent()).toBeNull()
    })

    it('reports the single need below threshold', () => {
      const needs = mkNeeds()
      setNeed(needs, 'spirit', NEED_URGENT.spirit - 1)
      expect(needs.urgent()).toBe('spirit')
    })

    it('with several urgent needs, the lowest threshold-ratio wins', () => {
      const needs = mkNeeds()
      setNeed(needs, 'energy', NEED_URGENT.energy * 0.5) // ratio 0.5
      setNeed(needs, 'hunger', NEED_URGENT.hunger * 0.25) // ratio 0.25 — most urgent
      setNeed(needs, 'social', NEED_URGENT.social * 0.9) // ratio 0.9
      expect(needs.urgent()).toBe('hunger')
      // hunger gets fed → energy becomes the worst
      needs.satisfy('hunger', 100)
      expect(needs.urgent()).toBe('energy')
    })
  })
})
