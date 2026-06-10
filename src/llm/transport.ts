/**
 * Everdawn Vale — browser-side LLM transport.
 *
 * complete() POSTs /api/llm (Vite dev-proxies it to server/server.js) behind a
 * client-side FIFO concurrency gate of LLM_MAX_CONCURRENT, with an
 * AbortController timeout of LLM_TIMEOUT_MS per request. It resolves the model
 * text on success and null on ANY failure (network, timeout, 429/500, missing
 * text) — it never throws, so the Brain can fall back to LocalBrain per call.
 */
import type { LlmTransport } from '../types'
import { LLM_MAX_CONCURRENT, LLM_TIMEOUT_MS } from '../constants'

/** GET /api/health → { ok, llm }; { ok: false, llm: false } on any failure. */
export async function checkHealth(): Promise<{ ok: boolean; llm: boolean }> {
  try {
    const res = await fetch('/api/health')
    if (!res.ok) return { ok: false, llm: false }
    const data = (await res.json()) as { ok?: unknown; llm?: unknown } | null
    return { ok: data?.ok === true, llm: data?.llm === true }
  } catch {
    return { ok: false, llm: false }
  }
}

export function createTransport(): LlmTransport {
  let active = 0
  /** FIFO queue of waiters for a free concurrency slot. */
  const waiters: Array<() => void> = []

  function acquire(): Promise<void> {
    if (active < LLM_MAX_CONCURRENT) {
      active += 1
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      waiters.push(() => {
        active += 1
        resolve()
      })
    })
  }

  function release(): void {
    active -= 1
    const next = waiters.shift()
    if (next !== undefined) next()
  }

  return {
    async complete(system, user, opts) {
      await acquire()
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS)
      try {
        const res = await fetch('/api/llm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system,
            user,
            maxTokens: opts?.maxTokens,
            temperature: opts?.temperature,
          }),
          signal: controller.signal,
        })
        if (!res.ok) return null
        const data = (await res.json()) as { text?: unknown } | null
        const text = data?.text
        if (typeof text !== 'string' || text.trim() === '') return null
        return text
      } catch {
        return null
      } finally {
        clearTimeout(timer)
        release()
      }
    },
  }
}
