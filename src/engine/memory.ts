/**
 * Everdawn Vale — memory stream (Stanford Generative Agents pattern).
 *
 * A per-villager append-only stream of MemoryRecords with scored retrieval:
 *   score = minmax(recency) + minmax(importance) + minmax(relevance)
 * where recency = RECENCY_DECAY ^ gameHoursSinceLastAccess and relevance is a
 * deterministic lexical cosine over stopword-filtered term-frequency maps
 * (no embeddings — offline and testable).
 *
 * Pure engine module: no three.js, no DOM, no fetch.
 */
import type { MemoryKind, MemoryRecord, MemoryStreamApi } from '../types'
import { RECENCY_DECAY, RETRIEVE_K } from '../constants'

// ------------------------------------------------------------------ tokenize

/** ~60 common English stopwords stripped before relevance scoring. */
const STOPWORDS: ReadonlySet<string> = new Set([
  // articles / conjunctions / qualifiers
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'so', 'than', 'too', 'very',
  'not', 'no', 'nor', 'only',
  // pronouns / demonstratives
  'i', 'me', 'my', 'we', 'us', 'our', 'you', 'your', 'he', 'him', 'his',
  'she', 'her', 'it', 'its', 'they', 'them', 'their', 'this', 'that',
  'these', 'those', 'who', 'what', 'which',
  // be / have / do / modals
  'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'do', 'does', 'did', 'have', 'has', 'had', 'will', 'would', 'should', 'could',
  // prepositions
  'of', 'at', 'by', 'for', 'with', 'to', 'from', 'in', 'on', 'as', 'about',
])

/**
 * Lowercase, strip punctuation, drop single letters (digits survive — "Day 3")
 * and remove common stopwords.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]/g, '') // collapse apostrophes: "day's" -> "days"
    .split(/[^a-z0-9]+/)
    .filter((w) => w !== '' && (w.length > 1 || /[0-9]/.test(w)) && !STOPWORDS.has(w))
}

// ----------------------------------------------------------------- relevance

function termFreq(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>()
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
  return tf
}

/**
 * Lexical cosine similarity (0..1) between term-frequency maps of the
 * tokenized inputs. Returns 0 when either side has no usable tokens.
 */
export function relevanceScore(query: string, text: string): number {
  const queryTokens = tokenize(query)
  const textTokens = tokenize(text)
  if (queryTokens.length === 0 || textTokens.length === 0) return 0
  const qf = termFreq(queryTokens)
  const tf = termFreq(textTokens)
  let dot = 0
  for (const [term, qc] of qf) {
    const tc = tf.get(term)
    if (tc !== undefined) dot += qc * tc
  }
  if (dot === 0) return 0
  let qNorm = 0
  for (const c of qf.values()) qNorm += c * c
  let tNorm = 0
  for (const c of tf.values()) tNorm += c * c
  return dot / (Math.sqrt(qNorm) * Math.sqrt(tNorm))
}

// ---------------------------------------------------------------- importance

/** Emotional / social / event keywords — each distinct hit boosts importance. */
const EMOTIONAL_KEYWORDS: ReadonlySet<string> = new Set([
  'festival', 'festivals', 'feast', 'feasting',
  'secret', 'secrets',
  'wolf', 'wolves', 'danger', 'dangerous', 'dragon', 'dragons',
  'love', 'loves', 'loved',
  'gift', 'gifts',
  'quarrel', 'quarrels', 'quarreled', 'quarrelled',
  'promise', 'promises', 'promised',
  'moon', 'moonlight',
  'celebration', 'celebrations', 'celebrate', 'celebrates', 'celebrating',
  'friend', 'friends', 'friendship',
  'worry', 'worries', 'worried', 'fear', 'fears', 'afraid',
  'treasure', 'mystery', 'mysterious', 'strange',
  'invite', 'invited', 'invitation',
  'lonely', 'loneliness', 'surprise', 'surprised',
])

/** Phrase markers for conversation-derived memories (+1). */
const DIALOGUE_MARKERS: readonly string[] = [
  'spoke with', 'spoke to', 'talked with', 'talked to', 'chatted', 'conversation',
]

/** Phrase markers for reflective, first-person insight phrasing (+3). */
const REFLECTIVE_MARKERS: readonly string[] = [
  'i realize', 'i realise', 'i have come to', 'i understand now', 'i see now',
  'it occurs to me', 'matters to me', 'matter to me', 'i have spent much',
]

/** Routine verbs — an unboosted memory containing one is capped at 2. */
const MUNDANE_VERBS: ReadonlySet<string> = new Set([
  'saw', 'walked', 'walking', 'idle', 'idling', 'idled',
  'swept', 'sweeping', 'strolled', 'strolling',
  'waited', 'waiting', 'stood', 'sat', 'watched', 'watching',
  'passed', 'passing', 'wandered', 'wandering',
  'browsing', 'browsed', 'rested', 'resting', 'tidied',
])

function clampImportance(value: number): number {
  return Math.min(10, Math.max(1, Math.round(value)))
}

/**
 * Local importance heuristic (1..10), no LLM call: base 3; up to three
 * emotional/event keyword hits at +2 each; dialogue phrasing +1; reflective
 * phrasing +3; purely mundane texts capped at 2.
 */
export function scoreImportance(text: string): number {
  const lower = text.toLowerCase()
  const tokens = tokenize(text)
  const keywordHits = new Set<string>()
  for (const t of tokens) if (EMOTIONAL_KEYWORDS.has(t)) keywordHits.add(t)
  const keywordBoost = Math.min(keywordHits.size, 3) * 2
  const isDialogue = DIALOGUE_MARKERS.some((m) => lower.includes(m))
  const isReflective = REFLECTIVE_MARKERS.some((m) => lower.includes(m))
  const isMundane = tokens.some((t) => MUNDANE_VERBS.has(t))
  let score = 3 + keywordBoost + (isDialogue ? 1 : 0) + (isReflective ? 3 : 0)
  if (isMundane && keywordHits.size === 0 && !isDialogue && !isReflective) {
    score = Math.min(score, 2)
  }
  return clampImportance(score)
}

// -------------------------------------------------------------------- stream

/** Min-max normalize; a degenerate spread contributes 0 to every candidate. */
function minMaxNormalize(values: number[]): number[] {
  let min = Infinity
  let max = -Infinity
  for (const v of values) {
    if (v < min) min = v
    if (v > max) max = v
  }
  const span = max - min
  if (!(span > 1e-12)) return values.map(() => 0)
  return values.map((v) => (v - min) / span)
}

export function createMemoryStream(): MemoryStreamApi {
  const records: MemoryRecord[] = []
  let nextId = 1
  let reflectedCount = 0

  return {
    add(kind: MemoryKind, text: string, importance: number, nowMin: number, subjects: string[] = []): MemoryRecord {
      const record: MemoryRecord = {
        id: nextId++,
        kind,
        text,
        createdMin: nowMin,
        lastAccessMin: nowMin,
        importance: clampImportance(importance),
        subjects: [...subjects],
      }
      records.push(record)
      return record
    },

    retrieve(query: string, nowMin: number, k: number = RETRIEVE_K): MemoryRecord[] {
      if (records.length === 0 || k <= 0) return []
      const recencies: number[] = []
      const importances: number[] = []
      const relevances: number[] = []
      for (const r of records) {
        const hoursSince = Math.max(0, nowMin - r.lastAccessMin) / 60
        recencies.push(Math.pow(RECENCY_DECAY, hoursSince))
        importances.push(r.importance)
        relevances.push(relevanceScore(query, r.text))
      }
      const nRec = minMaxNormalize(recencies)
      const nImp = minMaxNormalize(importances)
      const nRel = minMaxNormalize(relevances)
      const ranked = records.map((r, i) => ({ r, score: nRec[i] + nImp[i] + nRel[i] }))
      // best-first; ties go to the newer memory for determinism
      ranked.sort((a, b) => b.score - a.score || b.r.id - a.r.id)
      const top = ranked.slice(0, k)
      // bump lastAccessMin AFTER scoring so the bump never affects this pass
      for (const { r } of top) r.lastAccessMin = nowMin
      return top.map(({ r }) => r)
    },

    recent(n: number): MemoryRecord[] {
      if (n <= 0) return []
      return records.slice(-n).reverse()
    },

    byKind(kind: MemoryKind): MemoryRecord[] {
      return records.filter((r) => r.kind === kind)
    },

    unreflectedImportance(): number {
      let sum = 0
      for (let i = reflectedCount; i < records.length; i++) sum += records[i].importance
      return sum
    },

    markReflected(): void {
      reflectedCount = records.length
    },

    count(): number {
      return records.length
    },

    all(): readonly MemoryRecord[] {
      return records
    },
  }
}
