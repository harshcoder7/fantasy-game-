import type { ClockApi, GamePhase, GameTime, Unsubscribe } from '../types'

const MIN_PER_DAY = 24 * 60

type TimeListener = (t: GameTime) => void

/**
 * Game clock. Accumulates fractional game-minutes (dtSec * baseRate * speed)
 * and fires listeners once per WHOLE minute crossed, with hour/day listeners
 * at their boundaries. The exposed `time` object is mutated in place — holding
 * a reference to it is safe and always current.
 *
 * Listener errors are isolated (try/catch + console.warn) so a misbehaving
 * subscriber can never desync the minute loop.
 */
export function createClock(
  start: { day: number; hour: number; minute: number },
  baseRate: number,
): ClockApi {
  // Normalize the start (folds hour/minute overflow, clamps to day 1, 00:00).
  const startTotal = Math.max(
    0,
    Math.round((start.day - 1) * MIN_PER_DAY + start.hour * 60 + start.minute),
  )

  const time: GameTime = {
    day: Math.floor(startTotal / MIN_PER_DAY) + 1,
    hour: Math.floor((startTotal % MIN_PER_DAY) / 60),
    minute: startTotal % 60,
    totalMin: startTotal,
  }

  /** fraction of the next game-minute accumulated so far, always in [0, 1) */
  let frac = 0

  const minuteFns = new Set<TimeListener>()
  const hourFns = new Set<TimeListener>()
  const dayFns = new Set<TimeListener>()

  const fire = (set: Set<TimeListener>, label: string): void => {
    if (set.size === 0) return
    for (const fn of [...set]) {
      if (!set.has(fn)) continue // unsubscribed by an earlier listener
      try {
        fn(time)
      } catch (err) {
        console.warn(`[clock] ${label} listener error`, err)
      }
    }
  }

  const subscribe = (set: Set<TimeListener>, fn: TimeListener): Unsubscribe => {
    set.add(fn)
    return () => {
      set.delete(fn)
    }
  }

  const api: ClockApi = {
    time,
    speed: 1,

    update(dtSec: number): number {
      const advanceMin = dtSec * baseRate * api.speed
      if (!Number.isFinite(advanceMin) || advanceMin <= 0) return 0
      frac += advanceMin
      let crossed = 0
      while (frac >= 1) {
        frac -= 1
        crossed++
        time.totalMin += 1
        time.minute += 1
        let newHour = false
        let newDay = false
        if (time.minute >= 60) {
          time.minute = 0
          time.hour += 1
          newHour = true
        }
        if (time.hour >= 24) {
          time.hour = 0
          time.day += 1
          newDay = true
        }
        // time is fully consistent before any listener sees it
        fire(minuteFns, 'minute')
        if (newHour) fire(hourFns, 'hour')
        if (newDay) fire(dayFns, 'day')
      }
      return crossed
    },

    minutesPerSecond(): number {
      return baseRate * api.speed
    },

    dayFraction(): number {
      // includes the sub-minute fraction so the sun arc moves smoothly
      return (time.hour * 60 + time.minute + frac) / MIN_PER_DAY
    },

    phase(): GamePhase {
      const m = time.hour * 60 + time.minute
      if (m >= 5 * 60 && m < 7 * 60) return 'dawn'
      if (m >= 7 * 60 && m < 18 * 60) return 'day'
      if (m >= 18 * 60 && m < 20 * 60) return 'dusk'
      return 'night'
    },

    onMinute(fn: TimeListener): Unsubscribe {
      return subscribe(minuteFns, fn)
    },

    onHour(fn: TimeListener): Unsubscribe {
      return subscribe(hourFns, fn)
    },

    onNewDay(fn: TimeListener): Unsubscribe {
      return subscribe(dayFns, fn)
    },
  }

  return api
}
