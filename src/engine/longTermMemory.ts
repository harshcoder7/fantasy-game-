/**
 * Everdawn Vale — long-term memory: offline ingestion + live vector retrieval.
 *
 * The RAG pattern behind most agent-memory stacks: an offline phase chunks
 * documents and embeds every chunk into a vector index; a live phase embeds
 * the incoming query with the same function and cosine-ranks the index.
 * Distinct from a villager's memory stream (memory.ts — episodic, lexical,
 * per-agent): this is one shared, semantic index for the vale's lore, built
 * once and queried by anyone.
 *
 * Pure engine module: no three.js, no DOM, no fetch.
 */
import type { LongTermMemoryApi, LoreChunk, LoreDoc, LoreHit } from '../types'
import { LORE_CHUNK_MAX_WORDS, LORE_CHUNK_OVERLAP_WORDS, LORE_RETRIEVE_K } from '../constants'
import { cosineSimilarity, embed } from './embeddings'

/**
 * Split a document into overlapping word-count windows — the "chunking"
 * step of offline ingestion. Short documents pass through as a single chunk.
 */
export function chunkText(
  text: string,
  maxWords: number = LORE_CHUNK_MAX_WORDS,
  overlap: number = LORE_CHUNK_OVERLAP_WORDS,
): string[] {
  const words = text.trim().split(/\s+/).filter((w) => w !== '')
  if (words.length === 0) return []
  if (words.length <= maxWords) return [words.join(' ')]

  const chunks: string[] = []
  const step = Math.max(1, maxWords - overlap)
  for (let start = 0; start < words.length; start += step) {
    chunks.push(words.slice(start, start + maxWords).join(' '))
    if (start + maxWords >= words.length) break
  }
  return chunks
}

export function createLongTermMemory(): LongTermMemoryApi {
  const chunks: LoreChunk[] = []
  let nextId = 1

  return {
    ingest(docs: LoreDoc[]): void {
      for (const doc of docs) {
        for (const text of chunkText(doc.text)) {
          chunks.push({ id: `${doc.id}#${nextId++}`, docId: doc.id, text, embedding: embed(text) })
        }
      }
    },

    retrieve(query: string, k: number = LORE_RETRIEVE_K): LoreHit[] {
      if (chunks.length === 0 || k <= 0) return []
      const queryVector = embed(query)
      const scored = chunks.map((c) => ({ c, score: cosineSimilarity(queryVector, c.embedding) }))
      // best-first; ties broken deterministically by chunk id
      scored.sort((a, b) => b.score - a.score || a.c.id.localeCompare(b.c.id))
      return scored.slice(0, k).map(({ c, score }) => ({ id: c.id, docId: c.docId, text: c.text, score }))
    },

    count(): number {
      return chunks.length
    },

    all(): readonly LoreChunk[] {
      return chunks
    },
  }
}
