import { describe, expect, it } from 'vitest'
import { cosineSimilarity, embed } from '../src/engine/embeddings'
import { chunkText, createLongTermMemory } from '../src/engine/longTermMemory'
import { createAgentMemory } from '../src/engine/agentMemory'
import { LORE_DOCS } from '../src/data/lore'
import { EMBED_DIM } from '../src/constants'

describe('embed', () => {
  it('is deterministic: identical text yields the identical vector', () => {
    const a = embed('the harvest moon festival lights the market square')
    const b = embed('the harvest moon festival lights the market square')
    expect(a).toEqual(b)
  })

  it('is L2-normalized (unit length) for non-empty text', () => {
    const v = embed('forging horseshoes at the smithy')
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0))
    expect(norm).toBeCloseTo(1, 10)
  })

  it('returns a dim-length zero vector for text with no usable tokens', () => {
    const v = embed('the of and to')
    expect(v).toHaveLength(EMBED_DIM)
    expect(v.every((x) => x === 0)).toBe(true)
  })

  it('shares more signal between related texts than unrelated ones', () => {
    const query = embed('when is the harvest moon festival held')
    const related = embed(LORE_DOCS.find((d) => d.id === 'harvest-moon-festival')!.text)
    const unrelated = embed(LORE_DOCS.find((d) => d.id === 'emberhand-smithy')!.text)
    expect(cosineSimilarity(query, related)).toBeGreaterThan(cosineSimilarity(query, unrelated))
  })
})

describe('cosineSimilarity', () => {
  it('is 1 for identical unit vectors, ~0 for a text with no shared vocabulary', () => {
    const v = embed('lanterns and bunting bloom across the market square')
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 10)
    const disjoint = embed('quenching hot iron in the forge')
    expect(cosineSimilarity(embed('gathering mushrooms in the grove'), disjoint)).toBe(0)
  })
})

describe('chunkText', () => {
  it('passes a short document through as a single chunk', () => {
    const chunks = chunkText('a short sentence about the vale', 70, 15)
    expect(chunks).toEqual(['a short sentence about the vale'])
  })

  it('splits a long document into overlapping windows covering every word', () => {
    const words = Array.from({ length: 200 }, (_, i) => `w${i}`)
    const chunks = chunkText(words.join(' '), 70, 15)
    expect(chunks.length).toBeGreaterThan(1)
    // every chunk stays within budget
    for (const c of chunks) expect(c.split(/\s+/).length).toBeLessThanOrEqual(70)
    // first and last words of the source both survive in the chunked output
    expect(chunks[0]).toContain('w0')
    expect(chunks[chunks.length - 1]).toContain('w199')
  })

  it('returns [] for empty/whitespace-only text', () => {
    expect(chunkText('')).toEqual([])
    expect(chunkText('   ')).toEqual([])
  })
})

describe('createLongTermMemory (offline ingestion + live vector retrieval)', () => {
  it('starts empty', () => {
    const ltm = createLongTermMemory()
    expect(ltm.count()).toBe(0)
    expect(ltm.retrieve('anything')).toEqual([])
  })

  it('ingests documents into chunks, each carrying an embedding', () => {
    const ltm = createLongTermMemory()
    ltm.ingest(LORE_DOCS)
    expect(ltm.count()).toBeGreaterThanOrEqual(LORE_DOCS.length)
    for (const chunk of ltm.all()) {
      expect(chunk.embedding).toHaveLength(EMBED_DIM)
      expect(chunk.text.length).toBeGreaterThan(0)
    }
  })

  it('retrieve() surfaces the most relevant chunk first for a targeted query', () => {
    const ltm = createLongTermMemory()
    ltm.ingest(LORE_DOCS)

    const festival = ltm.retrieve('when does the Harvest Moon Festival happen', 3)
    expect(festival.length).toBeGreaterThan(0)
    expect(festival[0].docId).toBe('harvest-moon-festival')

    const smithy = ltm.retrieve('who forges horseshoes and blades at the smithy', 3)
    expect(smithy[0].docId).toBe('emberhand-smithy')

    const well = ltm.retrieve('tell me about the old well in the market square', 3)
    expect(well[0].docId).toBe('old-well')
  })

  it('retrieve() results are sorted best-first by score', () => {
    const ltm = createLongTermMemory()
    ltm.ingest(LORE_DOCS)
    const hits = ltm.retrieve('lake lumen moonlight fishing', 5)
    for (let i = 1; i < hits.length; i++) expect(hits[i - 1].score).toBeGreaterThanOrEqual(hits[i].score)
  })

  it('retrieve() respects k and returns [] for k<=0', () => {
    const ltm = createLongTermMemory()
    ltm.ingest(LORE_DOCS)
    expect(ltm.retrieve('festival', 2)).toHaveLength(2)
    expect(ltm.retrieve('festival', 0)).toEqual([])
  })
})

describe('createAgentMemory (the 4-layer model: internal / long-term / short-term / context window)', () => {
  it('internal knowledge is static and never mutated by other layers', () => {
    const ltm = createLongTermMemory()
    ltm.ingest(LORE_DOCS)
    const facts = ['Everdawn Vale has nine villagers.', 'The Wanderer is invisible.']
    const mem = createAgentMemory(facts, ltm)
    expect(mem.internalKnowledge()).toEqual(facts)
    mem.pushTurn('wanderer', 'hello')
    mem.buildContextWindow('hello')
    expect(mem.internalKnowledge()).toEqual(facts)
  })

  it('short-term memory keeps a bounded, ordered turn buffer', () => {
    const mem = createAgentMemory([], createLongTermMemory())
    for (let i = 0; i < 30; i++) mem.pushTurn(i % 2 === 0 ? 'wanderer' : 'agent', `turn ${i}`)
    const recent = mem.recentTurns(6)
    expect(recent).toHaveLength(6)
    expect(recent[recent.length - 1].text).toBe('turn 29')
    // the buffer is capped — very old turns are evicted, not retained forever
    const all = mem.recentTurns(1000)
    expect(all.length).toBeLessThan(30)
  })

  it('buildContextWindow assembles all four layers for one query', () => {
    const ltm = createLongTermMemory()
    ltm.ingest(LORE_DOCS)
    const mem = createAgentMemory(['Everdawn Vale is a fantasy village.'], ltm)
    mem.pushTurn('wanderer', 'Hello there!')
    mem.pushTurn('agent', 'Well met, traveler.')

    const ctx = mem.buildContextWindow('when is the Harvest Moon Festival?', { longTermK: 2, recentTurns: 2 })
    expect(ctx.query).toBe('when is the Harvest Moon Festival?')
    expect(ctx.internalKnowledge).toEqual(['Everdawn Vale is a fantasy village.'])
    expect(ctx.longTermHits.length).toBeGreaterThan(0)
    expect(ctx.longTermHits[0].docId).toBe('harvest-moon-festival')
    expect(ctx.shortTermTurns).toHaveLength(2)
  })
})
