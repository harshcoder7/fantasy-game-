import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createOpRunner } from '../src/engine/ops'
import { OP_TIMEOUT_MS } from '../src/constants'

/** let the schedule() promise chain settle (real macrotask) */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

type Apply = () => void
interface Deferred {
  promise: Promise<Apply>
  resolve: (apply: Apply) => void
  reject: (err: unknown) => void
}
function deferred(): Deferred {
  let resolve!: (apply: Apply) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<Apply>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('createOpRunner', () => {
  let fakeNow: number

  beforeEach(() => {
    fakeNow = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => fakeNow)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('enforces one op per agent; other agents are independent', async () => {
    const runner = createOpRunner()
    const d = deferred()
    let secondWorkRan = false

    expect(runner.schedule('thorin', 'plan', () => d.promise)).toBe(true)
    expect(runner.busy('thorin')).toBe(true)
    expect(
      runner.schedule('thorin', 'reflect', async () => {
        secondWorkRan = true
        return () => {}
      }),
    ).toBe(false)
    expect(runner.schedule('elara', 'plan', () => deferred().promise)).toBe(true)
    expect(runner.inFlight()).toBe(2)

    await flush()
    expect(secondWorkRan).toBe(false) // rejected schedule never launched its work

    d.resolve(() => {})
    await flush()
    expect(runner.busy('thorin')).toBe(false)
    expect(runner.inFlight()).toBe(1)
  })

  it('apply callbacks run only via drain(), in completion order', async () => {
    const runner = createOpRunner()
    const a = deferred()
    const b = deferred()
    const order: string[] = []

    runner.schedule('a', 'plan', () => a.promise)
    runner.schedule('b', 'converse', () => b.promise)
    await flush()

    // b completes before a → b's apply must run first
    b.resolve(() => order.push('b'))
    await flush()
    a.resolve(() => order.push('a'))
    await flush()

    expect(order).toEqual([]) // nothing applies before drain
    expect(runner.inFlight()).toBe(0) // both resolved, awaiting drain
    runner.drain()
    expect(order).toEqual(['b', 'a'])
    runner.drain() // queue is consumed — no double-apply
    expect(order).toEqual(['b', 'a'])
  })

  it('frees the slot once the result is queued, allowing a follow-up op', async () => {
    const runner = createOpRunner()
    let applied = 0
    runner.schedule('pip', 'plan', async () => () => applied++)
    await flush()
    expect(runner.busy('pip')).toBe(false)
    expect(runner.schedule('pip', 'reflect', async () => () => applied++)).toBe(true)
    await flush()
    runner.drain()
    expect(applied).toBe(2)
  })

  it('a rejected op clears the slot and applies nothing', async () => {
    const runner = createOpRunner()
    runner.schedule('bram', 'chat', () => Promise.reject(new Error('llm down')))
    expect(runner.busy('bram')).toBe(true)
    await flush()
    expect(runner.busy('bram')).toBe(false)
    expect(runner.inFlight()).toBe(0)
    runner.drain() // nothing queued, nothing throws
    expect(runner.schedule('bram', 'chat', async () => () => {})).toBe(true)
  })

  it('a synchronously-throwing work fn is treated as a rejection', async () => {
    const runner = createOpRunner()
    runner.schedule('greta', 'plan', () => {
      throw new Error('boom')
    })
    await flush()
    expect(runner.busy('greta')).toBe(false)
  })

  it('a throwing apply callback does not break the drain of later applies', async () => {
    const runner = createOpRunner()
    let secondRan = false
    runner.schedule('a', 'plan', async () => () => {
      throw new Error('bad apply')
    })
    runner.schedule('b', 'plan', async () => () => {
      secondRan = true
    })
    await flush()
    expect(() => runner.drain()).not.toThrow()
    expect(secondRan).toBe(true)
  })

  describe('watchdog (mocked Date.now — no real waiting)', () => {
    it('reaps an op stuck longer than OP_TIMEOUT_MS and frees the agent', async () => {
      const runner = createOpRunner()
      const stuck = deferred()
      runner.schedule('finn', 'converse', () => stuck.promise)
      await flush()
      expect(runner.busy('finn')).toBe(true)

      fakeNow += OP_TIMEOUT_MS + 1
      expect(runner.busy('finn')).toBe(false) // reaped
      expect(runner.inFlight()).toBe(0)
      expect(runner.schedule('finn', 'plan', async () => () => {})).toBe(true)
    })

    it('an op just under the timeout survives', async () => {
      const runner = createOpRunner()
      runner.schedule('maeve', 'reflect', () => deferred().promise)
      await flush()
      fakeNow += OP_TIMEOUT_MS - 1
      expect(runner.busy('maeve')).toBe(true)
    })

    it("a reaped op's late result is dropped, never clobbering the newer op", async () => {
      const runner = createOpRunner()
      const stale = deferred()
      let staleApplied = false
      let freshApplied = false

      runner.schedule('caelum', 'plan', () => stale.promise)
      await flush()
      fakeNow += OP_TIMEOUT_MS + 1
      expect(runner.busy('caelum')).toBe(false)

      // schedule a replacement, then let the zombie resolve
      runner.schedule('caelum', 'plan', async () => () => {
        freshApplied = true
      })
      stale.resolve(() => {
        staleApplied = true
      })
      await flush()
      expect(runner.busy('caelum')).toBe(false)

      runner.drain()
      expect(staleApplied).toBe(false)
      expect(freshApplied).toBe(true)
    })
  })
})
