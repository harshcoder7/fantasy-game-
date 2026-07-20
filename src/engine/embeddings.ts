/**
 * Everdawn Vale — local embeddings (feature hashing).
 *
 * Turns text into a dense unit vector with no network call and no model
 * weights, so the long-term memory pipeline works fully offline — same
 * "pull the network cable and it still works" philosophy as llm/localBrain.ts.
 * Swap for a real embedding model later: longTermMemory.ts only depends on
 * the embed()/cosineSimilarity() contract below, not on how the vector
 * is produced.
 *
 * Pure engine module: no three.js, no DOM, no fetch.
 */
import { tokenize } from './memory'
import { EMBED_DIM } from '../constants'

/** djb2, folded to an unsigned 32-bit int. */
function hash(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return h >>> 0
}

/**
 * The hashing trick: each token lands in one of `dim` buckets (a second,
 * independent hash gives its sign), accumulated as a bag-of-words vector,
 * then L2-normalized. Identical text always yields the identical vector;
 * two texts sharing vocabulary land closer together under cosine similarity.
 */
export function embed(text: string, dim: number = EMBED_DIM): number[] {
  const vec = new Array<number>(dim).fill(0)
  for (const token of tokenize(text)) {
    const bucket = hash(token) % dim
    const sign = hash(`${token}#sign`) % 2 === 0 ? 1 : -1
    vec[bucket] += sign
  }
  let normSq = 0
  for (const v of vec) normSq += v * v
  const norm = Math.sqrt(normSq)
  if (norm < 1e-12) return vec
  return vec.map((v) => v / norm)
}

/** Both inputs are expected L2-normalized (embed() guarantees it), so this is just the dot product. */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return dot
}
