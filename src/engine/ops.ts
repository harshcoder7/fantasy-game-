/**
 * Everdawn Vale — async brain-op runner (ai-town pattern).
 *
 * Agent logic never awaits. schedule() launches at most one async op per
 * agent; the op's resolved value is an APPLY callback queued for drain(),
 * which the world calls on the sim thread every frame. Rejections clear the
 * slot, and a real-time watchdog (OP_TIMEOUT_MS) reaps stuck ops so a hung
 * LLM call can never wedge a villager.
 *
 * Pure engine module: no three.js, no DOM, no fetch.
 */
import type { OpKind, OpRunnerApi } from '../types'
import { OP_TIMEOUT_MS } from '../constants'

interface FlightRecord {
  kind: OpKind
  startedAtMs: number
  /** guards against a reaped op's late result clobbering a newer op */
  token: number
}

/** Module-local system-clock read — the single source of real time in here. */
function now(): number {
  return Date.now()
}

export function createOpRunner(): OpRunnerApi {
  const inflight = new Map<string, FlightRecord>()
  const applyQueue: Array<() => void> = []
  let tokenCounter = 0

  /** Watchdog: drop any op older than OP_TIMEOUT_MS real milliseconds. */
  function reapExpired(): void {
    const t = now()
    for (const [agentId, record] of inflight) {
      if (t - record.startedAtMs > OP_TIMEOUT_MS) {
        inflight.delete(agentId)
        console.warn(
          `[ops] '${record.kind}' op for "${agentId}" timed out after ${OP_TIMEOUT_MS}ms — slot cleared`,
        )
      }
    }
  }

  return {
    schedule(agentId: string, kind: OpKind, work: () => Promise<() => void>): boolean {
      reapExpired()
      if (inflight.has(agentId)) return false
      const token = ++tokenCounter
      inflight.set(agentId, { kind, startedAtMs: now(), token })
      const isCurrent = (): boolean => inflight.get(agentId)?.token === token
      // Promise.resolve().then(work) folds synchronous throws into rejections.
      void Promise.resolve()
        .then(work)
        .then(
          (apply) => {
            // if the watchdog already reaped this op, drop the stale result
            if (!isCurrent()) return
            inflight.delete(agentId)
            applyQueue.push(apply)
          },
          (err: unknown) => {
            if (isCurrent()) inflight.delete(agentId)
            console.warn(`[ops] '${kind}' op for "${agentId}" failed:`, err)
          },
        )
      return true
    },

    busy(agentId: string): boolean {
      reapExpired()
      return inflight.has(agentId)
    },

    drain(): void {
      reapExpired()
      if (applyQueue.length === 0) return
      // take a snapshot so anything enqueued mid-drain waits for the next frame
      const pending = applyQueue.splice(0, applyQueue.length)
      for (const apply of pending) {
        try {
          apply()
        } catch (err) {
          console.warn('[ops] apply callback failed:', err)
        }
      }
    },

    inFlight(): number {
      reapExpired()
      return inflight.size
    },
  }
}
