import { describe, expect, it } from 'vitest'
import { createEventBus } from '../src/engine/events'
import { createRumorBoard } from '../src/engine/rumors'
import { RUMOR_SEEDS } from '../src/data/agents'
import type { RumorSeed } from '../src/types'

interface SpreadPayload {
  rumorId: string
  fromId: string
  toId: string
  knownCount: number
}

function makeBoard(seeds: RumorSeed[] = RUMOR_SEEDS) {
  const bus = createEventBus()
  const events: SpreadPayload[] = []
  bus.on<SpreadPayload>('rumor:spread', (p) => events.push(p))
  const board = createRumorBoard(bus)
  for (const s of seeds) board.seed(s)
  return { board, events }
}

describe('createRumorBoard', () => {
  it('seed() preserves text/spice/provenance and the event fields', () => {
    const { board } = makeBoard()
    const festival = board.get('festival')
    expect(festival).toBeDefined()
    expect(festival!.spice).toBe(9)
    expect(festival!.sourceId).toBe('seraphine')
    expect(festival!.eventDay).toBe(3)
    expect(festival!.eventStartMin).toBe(19 * 60)
    expect(festival!.eventPlaceId).toBe('market')
    expect(board.all().map((r) => r.id).sort()).toEqual(['festival', 'tower-lights', 'wolf'])
  })

  it('knows() reflects the seeded knownBy', () => {
    const { board } = makeBoard()
    expect(board.knows('seraphine', 'festival')).toBe(true)
    expect(board.knows('bram', 'festival')).toBe(false)
    expect(board.knows('bram', 'tower-lights')).toBe(true)
    expect(board.knows('bram', 'no-such-rumor')).toBe(false)
  })

  describe('learn', () => {
    it('is idempotent: first learn true, repeat false, knownBy unchanged', () => {
      const { board, events } = makeBoard()
      expect(board.learn('bram', 'festival', 'seraphine')).toBe(true)
      expect(board.learn('bram', 'festival', 'pip')).toBe(false)
      expect(board.learn('bram', 'festival')).toBe(false)
      expect(board.get('festival')!.knownBy.size).toBe(2)
      expect(events.length).toBe(1)
    })

    it("emits 'rumor:spread' with the full payload when fromId is given", () => {
      const { board, events } = makeBoard()
      board.learn('bram', 'festival', 'seraphine')
      expect(events).toEqual([
        { rumorId: 'festival', fromId: 'seraphine', toId: 'bram', knownCount: 2 },
      ])
      board.learn('pip', 'festival', 'bram')
      expect(events[1]).toEqual({ rumorId: 'festival', fromId: 'bram', toId: 'pip', knownCount: 3 })
    })

    it('does not emit without a fromId (e.g. self-discovery), but still records', () => {
      const { board, events } = makeBoard()
      expect(board.learn('elara', 'festival')).toBe(true)
      expect(events).toEqual([])
      expect(board.knows('elara', 'festival')).toBe(true)
    })

    it('returns false for an unknown rumor id', () => {
      const { board, events } = makeBoard()
      expect(board.learn('bram', 'ghost-story', 'pip')).toBe(false)
      expect(events).toEqual([])
    })
  })

  it('knownByAgent lists exactly the rumors an agent knows', () => {
    const { board } = makeBoard()
    expect(board.knownByAgent('bram').map((r) => r.id)).toEqual(['tower-lights'])
    board.learn('bram', 'festival', 'seraphine')
    expect(board.knownByAgent('bram').map((r) => r.id).sort()).toEqual(['festival', 'tower-lights'])
    expect(board.knownByAgent('nobody')).toEqual([])
  })

  describe('pickToSpread', () => {
    it('picks the spiciest rumor the speaker knows and the listener does not', () => {
      const { board } = makeBoard()
      // seraphine knows festival(9); teach her wolf(6) too
      board.learn('seraphine', 'wolf')
      expect(board.pickToSpread('seraphine', 'bram')!.id).toBe('festival')
      // once bram knows the festival, the next-spiciest is offered
      board.learn('bram', 'festival', 'seraphine')
      expect(board.pickToSpread('seraphine', 'bram')!.id).toBe('wolf')
    })

    it('never spreads a rumor that is about the listener', () => {
      const { board } = makeBoard([
        {
          id: 'thorin-secret',
          text: 'Thorin Emberhand is secretly forging a crown for the Castellan',
          spice: 10,
          sourceId: 'pip',
          knownBy: ['pip'],
        },
        { id: 'wolf', text: 'A grey wolf has been prowling near Greenhollow Farm at dusk', spice: 6, sourceId: 'greta', knownBy: ['pip', 'greta'] },
      ])
      // to Thorin's face: skip the juicy rumor about him, hand over the wolf instead
      expect(board.pickToSpread('pip', 'thorin')!.id).toBe('wolf')
      // to anyone else the spicier one wins
      expect(board.pickToSpread('pip', 'bram')!.id).toBe('thorin-secret')
    })

    it('returns null when the listener already knows everything the speaker does', () => {
      const { board } = makeBoard()
      expect(board.pickToSpread('seraphine', 'seraphine')).toBeNull()
      board.learn('bram', 'festival')
      expect(board.pickToSpread('seraphine', 'bram')).toBeNull()
      // speaker who knows nothing has nothing to offer
      expect(board.pickToSpread('caelum', 'bram')).toBeNull()
    })
  })
})
