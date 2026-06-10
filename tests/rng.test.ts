import { describe, expect, it } from 'vitest'
import { createRng } from '../src/engine/rng'
import { SIM_SEED } from '../src/constants'

describe('createRng (mulberry32)', () => {
  it('is deterministic: same seed → identical stream', () => {
    const a = createRng(SIM_SEED)
    const b = createRng(SIM_SEED)
    for (let i = 0; i < 200; i++) {
      expect(a.next()).toBe(b.next())
    }
  })

  it('different seeds produce different streams', () => {
    const a = createRng(1)
    const b = createRng(2)
    const seqA = Array.from({ length: 10 }, () => a.next())
    const seqB = Array.from({ length: 10 }, () => b.next())
    expect(seqA).not.toEqual(seqB)
  })

  it('next() stays in [0, 1)', () => {
    const rng = createRng(12345)
    for (let i = 0; i < 5000; i++) {
      const v = rng.next()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('next() actually varies (not a constant generator)', () => {
    const rng = createRng(99)
    const values = new Set(Array.from({ length: 100 }, () => rng.next()))
    expect(values.size).toBeGreaterThan(90)
  })

  it('range(min, max) stays in [min, max)', () => {
    const rng = createRng(7)
    for (let i = 0; i < 2000; i++) {
      const v = rng.range(-20, 20)
      expect(v).toBeGreaterThanOrEqual(-20)
      expect(v).toBeLessThan(20)
    }
  })

  it('int(min, max) is inclusive of both ends and covers the whole range', () => {
    const rng = createRng(4242)
    const seen = new Set<number>()
    for (let i = 0; i < 1000; i++) {
      const v = rng.int(1, 4)
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThanOrEqual(4)
      seen.add(v)
    }
    expect([...seen].sort()).toEqual([1, 2, 3, 4])
  })

  it('int(n, n) returns n', () => {
    const rng = createRng(5)
    expect(rng.int(3, 3)).toBe(3)
  })

  it('pick returns an element of the array', () => {
    const rng = createRng(11)
    const arr = ['a', 'b', 'c', 'd'] as const
    for (let i = 0; i < 200; i++) {
      expect(arr).toContain(rng.pick(arr))
    }
  })

  it('chance(0) is never true, chance(1) is always true', () => {
    const rng = createRng(3)
    for (let i = 0; i < 100; i++) {
      expect(rng.chance(0)).toBe(false)
      expect(rng.chance(1)).toBe(true)
    }
  })

  it('chance(p) roughly tracks p', () => {
    const rng = createRng(2026)
    let hits = 0
    const trials = 5000
    for (let i = 0; i < trials; i++) if (rng.chance(0.3)) hits++
    expect(hits / trials).toBeGreaterThan(0.25)
    expect(hits / trials).toBeLessThan(0.35)
  })

  describe('shuffle', () => {
    it('returns the same array reference, mutated in place', () => {
      const rng = createRng(8)
      const arr = [1, 2, 3, 4, 5]
      expect(rng.shuffle(arr)).toBe(arr)
    })

    it('produces a permutation (same multiset of elements)', () => {
      const rng = createRng(123)
      const original = Array.from({ length: 50 }, (_, i) => i)
      const shuffled = rng.shuffle([...original])
      expect([...shuffled].sort((a, b) => a - b)).toEqual(original)
    })

    it('is deterministic for the same seed and actually reorders', () => {
      const mk = () => Array.from({ length: 20 }, (_, i) => i)
      const a = createRng(777).shuffle(mk())
      const b = createRng(777).shuffle(mk())
      expect(a).toEqual(b)
      // with 20 elements the identity permutation is astronomically unlikely
      expect(a).not.toEqual(mk())
    })
  })
})
