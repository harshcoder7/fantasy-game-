import type { EventBus, Unsubscribe } from '../types'

type Listener = (payload: unknown) => void

/**
 * Minimal synchronous pub/sub bus (topic → Set of listeners).
 *
 * - `on` returns an unsubscribe function; unsubscribing twice is harmless.
 * - `emit` iterates a snapshot of the listener set, so listeners may safely
 *   subscribe/unsubscribe during dispatch (listeners added mid-emit do not
 *   receive that emit; listeners removed mid-emit are skipped).
 * - Listener errors are isolated: one throwing listener never breaks the
 *   simulation loop or starves its siblings (try/catch per listener).
 */
export function createEventBus(): EventBus {
  const topics = new Map<string, Set<Listener>>()

  const on = <T = unknown>(topic: string, fn: (payload: T) => void): Unsubscribe => {
    let set = topics.get(topic)
    if (!set) {
      set = new Set<Listener>()
      topics.set(topic, set)
    }
    const listener = fn as Listener
    set.add(listener)
    return () => {
      const current = topics.get(topic)
      if (!current) return
      current.delete(listener)
      if (current.size === 0) topics.delete(topic)
    }
  }

  const emit = (topic: string, payload?: unknown): void => {
    const set = topics.get(topic)
    if (!set || set.size === 0) return
    for (const listener of [...set]) {
      if (!set.has(listener)) continue // unsubscribed by an earlier listener
      try {
        listener(payload)
      } catch (err) {
        console.warn(`[events] listener error on "${topic}"`, err)
      }
    }
  }

  return { on, emit }
}
