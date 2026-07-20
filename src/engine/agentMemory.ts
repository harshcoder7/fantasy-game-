/**
 * Everdawn Vale — the four-layer agent memory model.
 *
 *  1. Internal knowledge — static facts handed in at creation, never mutated
 *     at runtime; stands in for what would otherwise be baked into a model's
 *     weights.
 *  2. Long-term memory    — LongTermMemoryApi (longTermMemory.ts): offline
 *     ingestion, live vector retrieval.
 *  3. Short-term memory   — the rolling conversation buffer kept here.
 *  4. Context window       — assembled fresh per call by buildContextWindow,
 *     drawing on all three layers above; this is the exact slice a caller
 *     would hand to an LLM.
 *
 * Pure engine module: no three.js, no DOM, no fetch.
 */
import type { AgentMemoryApi, ContextWindow, ConversationTurn, LongTermMemoryApi, LoreHit } from '../types'

const SHORT_TERM_CAP = 20
const DEFAULT_RECENT_TURNS = 6
const DEFAULT_LONG_TERM_K = 4

export function createAgentMemory(internalKnowledge: string[], longTerm: LongTermMemoryApi): AgentMemoryApi {
  const turns: ConversationTurn[] = []

  return {
    internalKnowledge(): readonly string[] {
      return internalKnowledge
    },

    pushTurn(speaker: string, text: string): void {
      turns.push({ speaker, text })
      if (turns.length > SHORT_TERM_CAP) turns.shift()
    },

    recentTurns(n: number = DEFAULT_RECENT_TURNS): ConversationTurn[] {
      if (n <= 0) return []
      return turns.slice(-n)
    },

    longTermRetrieve(query: string, k: number = DEFAULT_LONG_TERM_K): LoreHit[] {
      return longTerm.retrieve(query, k)
    },

    buildContextWindow(query: string, opts: { longTermK?: number; recentTurns?: number } = {}): ContextWindow {
      return {
        query,
        internalKnowledge,
        longTermHits: longTerm.retrieve(query, opts.longTermK ?? DEFAULT_LONG_TERM_K),
        shortTermTurns: turns.slice(-(opts.recentTurns ?? DEFAULT_RECENT_TURNS)),
      }
    },
  }
}
