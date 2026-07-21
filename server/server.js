/**
 * Everdawn Vale — LLM relay + static server (plain Node ESM + express).
 *
 * Launch:  node --env-file-if-exists=.env server/server.js
 * Env:     OPENROUTER_API_KEY    OpenRouter key (never reaches the browser, never logged)
 *          OPENROUTER_MODELS     comma-separated model list, tried in order
 *          PORT                  default 3001
 *
 * Endpoints (no others):
 *   POST /api/llm     { system, user, maxTokens?, temperature? } → { text, model }
 *   GET  /api/health  → { ok, llm }
 * Serves ../dist statically (with index.html fallback) when a build exists.
 */
import express from 'express'
import compression from 'compression'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.resolve(here, '../dist')

const API_KEY = process.env.OPENROUTER_API_KEY ?? ''
const MODELS = (process.env.OPENROUTER_MODELS ?? 'meta-llama/llama-3.3-70b-instruct:free')
  .split(',')
  .map((m) => m.trim())
  .filter((m) => m !== '')
const PORT = Number.parseInt(process.env.PORT ?? '3001', 10) || 3001

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const MAX_IN_FLIGHT = 4
const ATTEMPT_TIMEOUT_MS = 25_000
const MAX_ATTEMPTS = 3
const DEFAULT_MAX_TOKENS = 700
const DEFAULT_TEMPERATURE = 0.85

let inFlight = 0
let lastGoodModel = 0 // index of the most recently successful model

function clampNumber(value, lo, hi, fallback) {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(hi, Math.max(lo, n))
}

const app = express()
app.use(compression()) // gzip/br the JS/CSS bundle + JSON responses (~700KB -> ~200KB)
app.use(express.json({ limit: '1mb' }))

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, llm: Boolean(API_KEY) })
})

app.post('/api/llm', async (req, res) => {
  const body = req.body ?? {}
  const system = typeof body.system === 'string' ? body.system : ''
  const user = typeof body.user === 'string' ? body.user : ''
  if (system === '' || user === '') {
    res.status(400).json({ error: 'system and user must be non-empty strings' })
    return
  }
  if (API_KEY === '') {
    res.status(502).json({ error: 'OPENROUTER_API_KEY is not configured' })
    return
  }
  if (inFlight >= MAX_IN_FLIGHT) {
    res.status(503).json({ error: 'busy' })
    return
  }

  const maxTokens = Math.round(clampNumber(body.maxTokens, 1, 4000, DEFAULT_MAX_TOKENS))
  const temperature = clampNumber(body.temperature, 0, 2, DEFAULT_TEMPERATURE)

  inFlight += 1
  try {
    const attempts = Math.min(MAX_ATTEMPTS, MODELS.length)
    for (let i = 0; i < attempts; i += 1) {
      const idx = (lastGoodModel + i) % MODELS.length
      const model = MODELS[idx]
      const t0 = Date.now()
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS)
      try {
        const upstream = await fetch(OPENROUTER_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://everdawn-vale.local',
            'X-Title': 'Everdawn Vale',
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
            max_tokens: maxTokens,
            temperature,
          }),
          signal: controller.signal,
        })
        clearTimeout(timer)
        const ms = Date.now() - t0
        if (!upstream.ok) {
          console.log(`[${new Date().toISOString().slice(11, 19)}] [llm] ${model} ${ms}ms http${upstream.status}`)
          continue
        }
        const data = await upstream.json()
        const text = data?.choices?.[0]?.message?.content
        if (typeof text !== 'string' || text.trim() === '') {
          console.log(`[${new Date().toISOString().slice(11, 19)}] [llm] ${model} ${ms}ms empty`)
          continue
        }
        lastGoodModel = idx
        console.log(`[${new Date().toISOString().slice(11, 19)}] [llm] ${model} ${ms}ms ${text.length}ch`)
        res.json({ text, model })
        return
      } catch (err) {
        clearTimeout(timer)
        const ms = Date.now() - t0
        const reason = err instanceof Error && err.name === 'AbortError' ? 'timeout' : 'error'
        console.log(`[${new Date().toISOString().slice(11, 19)}] [llm] ${model} ${ms}ms ${reason}`)
      }
    }
    res.status(502).json({ error: 'all model attempts failed' })
  } finally {
    inFlight -= 1
  }
})

if (existsSync(distDir)) {
  // vite content-hashes everything under assets/ (e.g. index-B7K53IE3.js), so a
  // changed file always gets a new URL — safe to cache those forever. index.html
  // is the one file that must always be revalidated, or a stale build would stick.
  app.use(express.static(distDir, { index: false, setHeaders(res, filePath) {
    if (filePath.includes(`${path.sep}assets${path.sep}`)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    }
  } }))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      next()
      return
    }
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

// malformed bodies (e.g. broken JSON) → compact JSON error, never a stack trace
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  res.status(400).json({ error: 'invalid request' })
})

app.listen(PORT, () => {
  const llmState = API_KEY !== '' ? 'enabled' : 'disabled (no OPENROUTER_API_KEY)'
  console.log(`[everdawn] http://localhost:${PORT} — llm ${llmState} — models: ${MODELS.join(', ')}`)
})
