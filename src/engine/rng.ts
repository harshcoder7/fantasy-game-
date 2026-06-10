import type { Rng } from '../types'

/**
 * Seeded deterministic PRNG — mulberry32.
 *
 * All engine randomness flows through a single Rng created from SIM_SEED, so a
 * given seed replays the exact same vale (tests rely on this). mulberry32 keeps
 * 32-bit state, does one imul mix per draw (period ≈ 2^32) and uses only int32
 * math, so the stream is identical across browsers and node.
 */
export function createRng(seed: number): Rng {
  let state = seed >>> 0

  /** uniform [0, 1) */
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  return {
    next,

    /** uniform float in [min, max) */
    range(min: number, max: number): number {
      return min + next() * (max - min)
    },

    /** uniform integer, inclusive of BOTH ends; tolerates swapped arguments */
    int(min: number, max: number): number {
      if (max < min) {
        const tmp = min
        min = max
        max = tmp
      }
      const lo = Math.ceil(min)
      const hi = Math.floor(max)
      if (hi <= lo) return lo
      return lo + Math.floor(next() * (hi - lo + 1))
    },

    /** uniform element of a non-empty array */
    pick<T>(arr: readonly T[]): T {
      return arr[Math.floor(next() * arr.length)]
    },

    /** true with probability p (p ≤ 0 → never, p ≥ 1 → always) */
    chance(p: number): boolean {
      return next() < p
    },

    /** Fisher-Yates, in place; returns the same array */
    shuffle<T>(arr: T[]): T[] {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        const tmp = arr[i]
        arr[i] = arr[j]
        arr[j] = tmp
      }
      return arr
    },
  }
}
