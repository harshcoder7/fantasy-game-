import { describe, expect, it } from 'vitest'
import {
  createMemoryStream,
  relevanceScore,
  scoreImportance,
  tokenize,
} from '../src/engine/memory'

describe('tokenize', () => {
  it('lowercases, strips punctuation and stopwords, keeps digits', () => {
    const tokens = tokenize('The Harvest Moon Festival is on Day 3, in the Market Square!')
    expect(tokens).toContain('harvest')
    expect(tokens).toContain('festival')
    expect(tokens).toContain('3')
    expect(tokens).toContain('market')
    expect(tokens).not.toContain('the')
    expect(tokens).not.toContain('is')
    expect(tokens).not.toContain('on')
    expect(tokens.every((t) => t === t.toLowerCase())).toBe(true)
  })

  it('returns [] for empty or stopword-only text', () => {
    expect(tokenize('')).toEqual([])
    expect(tokenize('the of and to')).toEqual([])
  })
})

describe('relevanceScore', () => {
  it('identical texts score higher than disjoint texts', () => {
    const same = relevanceScore('forging horseshoes at the smithy', 'forging horseshoes at the smithy')
    const disjoint = relevanceScore('forging horseshoes at the smithy', 'gathering mushrooms beneath wet leaves')
    expect(same).toBeGreaterThan(disjoint)
    expect(same).toBeCloseTo(1, 10)
    expect(disjoint).toBe(0)
  })

  it('partial overlap lands strictly between 0 and 1', () => {
    const partial = relevanceScore('festival in the market square', 'Seraphine spoke of the festival')
    expect(partial).toBeGreaterThan(0)
    expect(partial).toBeLessThan(1)
  })

  it('returns 0 when either side has no usable tokens', () => {
    expect(relevanceScore('', 'festival in the market')).toBe(0)
    expect(relevanceScore('festival in the market', '')).toBe(0)
    expect(relevanceScore('the of', 'the of')).toBe(0)
  })
})

describe('scoreImportance', () => {
  it('always lands in 1..10', () => {
    const samples = [
      '',
      'saw a sparrow',
      'festival secret love quarrel dragon gift moon celebration',
      'I realize that my friends at the festival matter to me deeply',
      'walked to the well',
    ]
    for (const s of samples) {
      const v = scoreImportance(s)
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThanOrEqual(10)
    }
  })

  it('ranks event/secret memories above mundane saw/walked ones', () => {
    const festival = scoreImportance('Seraphine is planning a grand festival in the market square')
    const secret = scoreImportance('Bram told me a secret about the cellar')
    const saw = scoreImportance('saw Thorin by the well')
    const walked = scoreImportance('walked along the dirt path to the farm')
    expect(festival).toBeGreaterThan(saw)
    expect(festival).toBeGreaterThan(walked)
    expect(secret).toBeGreaterThan(saw)
    expect(secret).toBeGreaterThan(walked)
    // purely mundane verbs cap low
    expect(saw).toBeLessThanOrEqual(2)
    expect(walked).toBeLessThanOrEqual(2)
  })

  it('reflective first-person insight scores high', () => {
    const insight = scoreImportance('I have spent much of my time with Maeve; they matter to me')
    expect(insight).toBeGreaterThanOrEqual(6)
  })
})

describe('createMemoryStream', () => {
  it('add() assigns increasing ids, clamps importance, copies subjects', () => {
    const stream = createMemoryStream()
    const subjects = ['thorin']
    const a = stream.add('observation', 'first', 99, 10, subjects)
    const b = stream.add('observation', 'second', -5, 20)
    expect(b.id).toBeGreaterThan(a.id)
    expect(a.importance).toBe(10)
    expect(b.importance).toBe(1)
    expect(a.createdMin).toBe(10)
    expect(a.lastAccessMin).toBe(10)
    subjects.push('mutated')
    expect(a.subjects).toEqual(['thorin'])
    expect(stream.count()).toBe(2)
  })

  it('recent() returns newest first; byKind filters', () => {
    const stream = createMemoryStream()
    stream.add('seed', 'one', 5, 0)
    stream.add('observation', 'two', 3, 1)
    stream.add('reflection', 'three', 7, 2)
    expect(stream.recent(2).map((r) => r.text)).toEqual(['three', 'two'])
    expect(stream.byKind('reflection').map((r) => r.text)).toEqual(['three'])
    expect(stream.recent(0)).toEqual([])
  })

  it('retrieve ranks an old-but-relevant-and-important memory above fresh mundane ones', () => {
    const stream = createMemoryStream()
    const festival = stream.add(
      'seed',
      'Castellan Seraphine is organizing the Harvest Moon Festival on Day 3 in the Market Square',
      9,
      0,
    )
    // three game-days of fresh, trivial noise
    const mundane = [
      'saw a sparrow hop near the well',
      'walked along the dirt path past the farm',
      'stood a while watching the windmill turn',
      'swept the doorstep slowly',
      'sat idle by the hearth a moment',
      'saw a chicken peck the dust',
      'wandered around the square aimlessly',
      'waited for the kettle to boil',
    ]
    mundane.forEach((text, i) => stream.add('observation', text, 2, 4000 + i * 30))

    const results = stream.retrieve('the harvest moon festival in the market square', 4320, 3)
    expect(results.length).toBe(3)
    expect(results[0].id).toBe(festival.id)
  })

  it('retrieve returns at most k, sorted best-first, and bumps lastAccessMin of the returned set', () => {
    const stream = createMemoryStream()
    const hit = stream.add('seed', 'the dragon hoards treasure in the deep mountain', 8, 0)
    stream.add('observation', 'saw rain on the thatch', 2, 100)
    stream.add('observation', 'walked to the lake', 2, 100)
    const out = stream.retrieve('dragon treasure mountain', 500, 2)
    expect(out.length).toBe(2)
    expect(out[0].id).toBe(hit.id)
    expect(hit.lastAccessMin).toBe(500) // bumped
  })

  it('lastAccess bump changes subsequent recency ranking', () => {
    const stream = createMemoryStream()
    const a = stream.add('seed', 'the wolf prowls greenhollow farm', 5, 0)
    const b = stream.add('seed', 'the codex hides beneath the tower', 5, 0)
    // access only A at t=1000 (query matches A's text, k=1)
    const first = stream.retrieve('wolf prowls greenhollow farm', 1000, 1)
    expect(first.map((r) => r.id)).toEqual([a.id])
    expect(a.lastAccessMin).toBe(1000)
    expect(b.lastAccessMin).toBe(0)
    // an irrelevant query much later: equal importance, zero relevance —
    // recency alone must now favor A. (Without the bump the newer-id tie-break
    // would have returned B.)
    const second = stream.retrieve('zanzibar quagmire', 10000, 1)
    expect(second.map((r) => r.id)).toEqual([a.id])
  })

  it('unreflectedImportance sums since markReflected and resets', () => {
    const stream = createMemoryStream()
    expect(stream.unreflectedImportance()).toBe(0)
    stream.add('observation', 'a', 4, 0)
    stream.add('observation', 'b', 7, 1)
    expect(stream.unreflectedImportance()).toBe(11)
    stream.markReflected()
    expect(stream.unreflectedImportance()).toBe(0)
    stream.add('reflection', 'c', 6, 2)
    expect(stream.unreflectedImportance()).toBe(6)
  })

  it('retrieve on an empty stream or k<=0 returns []', () => {
    const stream = createMemoryStream()
    expect(stream.retrieve('anything', 100)).toEqual([])
    stream.add('seed', 'something', 5, 0)
    expect(stream.retrieve('anything', 100, 0)).toEqual([])
  })
})
