import { describe, expect, it } from 'vitest'
import { createClock } from '../src/engine/time'
import { BASE_RATE } from '../src/constants'

const at = (hour: number, minute: number, day = 1) =>
  createClock({ day, hour, minute }, BASE_RATE)

describe('createClock', () => {
  it('initializes time from the start spec', () => {
    const clock = at(6, 55)
    expect(clock.time).toMatchObject({ day: 1, hour: 6, minute: 55 })
    expect(clock.time.totalMin).toBe(6 * 60 + 55)
  })

  it('the exposed time object is live (same reference stays current)', () => {
    const clock = at(6, 0)
    const ref = clock.time
    clock.update(60 / BASE_RATE) // +60 game-minutes
    expect(ref.hour).toBe(7)
    expect(ref.minute).toBe(0)
  })

  describe('update / listener counts', () => {
    it('fires onMinute once per whole crossed minute', () => {
      const clock = at(8, 0)
      let minutes = 0
      clock.onMinute(() => minutes++)
      // 0.5s at BASE_RATE 2, speed 1 → exactly 1 game-minute
      expect(clock.update(0.5)).toBe(1)
      expect(minutes).toBe(1)
      expect(clock.time.minute).toBe(1)
    })

    it('accumulates fractional minutes across updates', () => {
      const clock = at(8, 0)
      let minutes = 0
      clock.onMinute(() => minutes++)
      expect(clock.update(0.2)).toBe(0) // 0.4 game-min
      expect(minutes).toBe(0)
      expect(clock.update(0.2)).toBe(0) // 0.8
      expect(clock.update(0.2)).toBe(1) // 1.2 → one minute crossed
      expect(minutes).toBe(1)
    })

    it('handles multi-minute jumps: correct minute/hour/day counts', () => {
      const clock = at(23, 30)
      clock.speed = 10 // 20 game-min per real second
      let minutes = 0
      let hours = 0
      let days = 0
      clock.onMinute(() => minutes++)
      clock.onHour(() => hours++)
      clock.onNewDay(() => days++)

      // 6 real seconds → 120 game-minutes: 23:30 → day 2, 01:30
      expect(clock.update(6)).toBe(120)
      expect(minutes).toBe(120)
      expect(hours).toBe(2) // 00:00 and 01:00
      expect(days).toBe(1) // midnight crossing
      expect(clock.time).toMatchObject({ day: 2, hour: 1, minute: 30 })
      expect(clock.time.totalMin).toBe(23 * 60 + 30 + 120)
    })

    it('hour listener sees a consistent time at the boundary', () => {
      const clock = at(6, 59)
      const seen: Array<{ hour: number; minute: number }> = []
      clock.onHour((t) => seen.push({ hour: t.hour, minute: t.minute }))
      clock.update(2) // +4 minutes → crosses 7:00
      expect(seen).toEqual([{ hour: 7, minute: 0 }])
    })

    it('many small updates cross the same number of minutes as one big one', () => {
      const small = at(10, 0)
      const big = at(10, 0)
      let crossedSmall = 0
      for (let i = 0; i < 240; i++) crossedSmall += small.update(0.25)
      const crossedBig = big.update(60)
      expect(crossedSmall).toBe(crossedBig)
      expect(crossedSmall).toBe(120)
      expect(small.time.totalMin).toBe(big.time.totalMin)
    })

    it('unsubscribe stops a listener', () => {
      const clock = at(9, 0)
      let count = 0
      const off = clock.onMinute(() => count++)
      clock.update(1)
      off()
      clock.update(1)
      expect(count).toBe(2)
    })
  })

  describe('speed', () => {
    it('speed 0 freezes time: no crossing, no listeners, dayFraction static', () => {
      const clock = at(12, 0)
      clock.speed = 0
      let fired = 0
      clock.onMinute(() => fired++)
      const fracBefore = clock.dayFraction()
      expect(clock.update(1000)).toBe(0)
      expect(fired).toBe(0)
      expect(clock.time).toMatchObject({ day: 1, hour: 12, minute: 0 })
      expect(clock.dayFraction()).toBe(fracBefore)
      expect(clock.minutesPerSecond()).toBe(0)
    })

    it('minutesPerSecond = BASE_RATE * speed', () => {
      const clock = at(0, 0)
      for (const s of [0, 1, 3, 10]) {
        clock.speed = s
        expect(clock.minutesPerSecond()).toBe(BASE_RATE * s)
      }
    })
  })

  describe('dayFraction', () => {
    it('is 0 at midnight, 0.5 at noon, 0.75 at 18:00', () => {
      expect(at(0, 0).dayFraction()).toBe(0)
      expect(at(12, 0).dayFraction()).toBeCloseTo(0.5, 10)
      expect(at(18, 0).dayFraction()).toBeCloseTo(0.75, 10)
    })

    it('moves smoothly with the sub-minute fraction', () => {
      const clock = at(12, 0)
      const before = clock.dayFraction()
      clock.update(0.1) // 0.2 game-min, no whole minute crossed
      expect(clock.time.minute).toBe(0)
      expect(clock.dayFraction()).toBeGreaterThan(before)
      expect(clock.dayFraction()).toBeCloseTo((12 * 60 + 0.2) / 1440, 10)
    })
  })

  describe('phase boundaries', () => {
    it.each([
      [4, 59, 'night'],
      [5, 0, 'dawn'],
      [6, 59, 'dawn'],
      [7, 0, 'day'],
      [17, 59, 'day'],
      [18, 0, 'dusk'],
      [19, 59, 'dusk'],
      [20, 0, 'night'],
      [23, 59, 'night'],
      [0, 0, 'night'],
    ] as const)('%i:%i → %s', (h, m, phase) => {
      expect(at(h, m).phase()).toBe(phase)
    })

    it('phase transitions as the clock runs across 5:00', () => {
      const clock = at(4, 58)
      expect(clock.phase()).toBe('night')
      clock.update(2 / BASE_RATE) // advance exactly 2 game-minutes
      expect(clock.time.hour).toBe(5)
      expect(clock.time.minute).toBe(0)
      expect(clock.phase()).toBe('dawn')
    })
  })
})
