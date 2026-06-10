/**
 * Dialogue manager tests — real createWorld with a LocalBrain
 * (createBrain(null, rng)): proximity trigger, walking→talking state machine,
 * memories + symmetric affection + cooldowns on end, and rumor diffusion.
 */
import { describe, expect, it } from 'vitest'
import type { AgentApi, Dialogue, RumorSeed, WorldApi } from '../src/types'
import {
  AFFECTION_CLAMP,
  PAIR_TALK_COOLDOWN_MIN,
  SIM_SEED,
} from '../src/constants'
import { createRng } from '../src/engine/rng'
import { createWorld } from '../src/engine/world'
import { createBrain } from '../src/llm/brain'
import { PLACES } from '../src/data/places'
import { PERSONAS, RUMOR_SEEDS } from '../src/data/agents'

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

function buildWorld(seed: number, rumorSeeds: RumorSeed[] = RUMOR_SEEDS): WorldApi {
  return createWorld({
    places: PLACES,
    personas: PERSONAS,
    rumorSeeds,
    brain: createBrain(null, createRng(seed + 1)),
    seed,
    start: { day: 1, hour: 9, minute: 0 },
  })
}

/** A remote walkable corner, far from every routine destination. */
function quietSpot(world: WorldApi): { x: number; z: number } {
  const spot = world.grid.nearestWalkable({ x: -100, z: -100 })
  expect(world.grid.isWalkableAt(spot)).toBe(true)
  return spot
}

function teleportPair(world: WorldApi, a: AgentApi, b: AgentApi): void {
  const spot = quietSpot(world)
  a.pos.x = spot.x
  a.pos.z = spot.z
  b.pos.x = spot.x + 1.2
  b.pos.z = spot.z
}

/**
 * Drive the world one game-minute per call (speed 1, dt 0.5s) until cond(),
 * re-teleporting the pair adjacent whenever both are free so a conversation
 * can trigger and complete in isolation.
 */
async function runUntil(
  world: WorldApi,
  a: AgentApi,
  b: AgentApi,
  cond: () => boolean,
  maxMinutes: number,
): Promise<boolean> {
  for (let i = 0; i < maxMinutes; i++) {
    if (cond()) return true
    if (a.dialogueId === null && b.dialogueId === null) teleportPair(world, a, b)
    world.update(0.5)
    await flush()
  }
  return cond()
}

describe('dialogue manager (real world, local brain)', () => {
  it('runs a full conversation: trigger, walking→talking, memories, symmetric affection, cooldowns', async () => {
    const world = buildWorld(SIM_SEED)
    const a = world.getAgent('maeve')!
    const b = world.getAgent('caelum')!

    // --- interruptibility gate: an agent already in a dialogue never accepts
    teleportPair(world, a, b)
    b.setDialogue('occupied')
    expect(world.dialogues.maybeStart(a, b, world.clock.time.totalMin)).toBe(false)
    b.setDialogue(null)

    // --- watch the state machine through the bus
    let sawWalking = false
    let sawTalking = false
    let ended: Dialogue | null = null
    let turnEvents = 0
    world.bus.on<{ dialogue: Dialogue }>('dialogue:start', ({ dialogue }) => {
      if (dialogue.aId !== a.persona.id && dialogue.bId !== a.persona.id) return
      if (dialogue.state === 'walking') sawWalking = true
    })
    world.bus.on<{ dialogue: Dialogue }>('dialogue:turn', ({ dialogue }) => {
      if (dialogue.aId === a.persona.id || dialogue.bId === a.persona.id) {
        turnEvents++
        if (dialogue.state === 'talking') sawTalking = true
      }
    })
    world.bus.on<{ dialogue: Dialogue }>('dialogue:end', ({ dialogue }) => {
      const pair = [dialogue.aId, dialogue.bId]
      if (pair.includes(a.persona.id) && pair.includes(b.persona.id)) ended = dialogue
    })

    const affAB0 = a.affection(b.persona.id)
    const affBA0 = b.affection(a.persona.id)
    const aDlgMem0 = a.memory.byKind('dialogue').length
    const bDlgMem0 = b.memory.byKind('dialogue').length

    const done = await runUntil(world, a, b, () => ended !== null, 600)
    expect(done, 'conversation should complete within 600 game-minutes').toBe(true)

    const d = ended! as Dialogue
    // state machine went walking → talking → done, with revealed turns
    expect(sawWalking).toBe(true)
    expect(sawTalking).toBe(true)
    expect(d.state).toBe('done')
    expect(d.turns.length).toBeGreaterThanOrEqual(4)
    expect(d.turns.length).toBeLessThanOrEqual(6)
    expect(turnEvents).toBe(d.turns.length)
    expect(d.summary).not.toBeNull()

    // both hold a fresh dialogue memory carrying their own summary
    const aDlgMems = a.memory.byKind('dialogue')
    const bDlgMems = b.memory.byKind('dialogue')
    expect(aDlgMems.length).toBe(aDlgMem0 + 1)
    expect(bDlgMems.length).toBe(bDlgMem0 + 1)
    expect(aDlgMems[aDlgMems.length - 1].text).toBe(d.summary!.aSummary)
    expect(bDlgMems[bDlgMems.length - 1].text).toBe(d.summary!.bSummary)

    // affection changed symmetrically, by the clamped delta
    const deltaA = a.affection(b.persona.id) - affAB0
    const deltaB = b.affection(a.persona.id) - affBA0
    expect(deltaA).toBe(deltaB)
    expect(deltaA).toBeGreaterThanOrEqual(AFFECTION_CLAMP[0])
    expect(deltaA).toBeLessThanOrEqual(AFFECTION_CLAMP[1])
    expect(deltaA).toBe(d.summary!.affectionDelta)
    // maeve & caelum are old friends (affection >= 60) → local brain drifts warmer
    expect(deltaA).toBeGreaterThan(0)

    // both are free again
    expect(a.dialogueId).toBeNull()
    expect(b.dialogueId).toBeNull()

    // pair cooldown blocks a restart for PAIR_TALK_COOLDOWN_MIN, however close they stand
    const endMin = world.clock.time.totalMin
    teleportPair(world, a, b)
    for (let t = endMin; t < endMin + PAIR_TALK_COOLDOWN_MIN - 1; t += 20) {
      expect(world.dialogues.maybeStart(a, b, t), `cooldown must block at +${t - endMin}min`).toBe(false)
    }
  }, 30_000)

  it('passes a seeded rumor: the listener learns it, remembers it, and rumor:spread fires', async () => {
    // one ultra-spicy rumor known ONLY by maeve — direction is forced a→b
    const secret: RumorSeed = {
      id: 'secret-dragon',
      text: 'A dragon was seen circling the peaks beyond the vale',
      spice: 10,
      sourceId: 'maeve',
      knownBy: ['maeve'],
    }
    const world = buildWorld(SIM_SEED + 5, [secret])
    const a = world.getAgent('maeve')!
    const b = world.getAgent('caelum')!

    const spreads: Array<{ rumorId: string; fromId: string; toId: string; knownCount: number }> = []
    world.bus.on<{ rumorId: string; fromId: string; toId: string; knownCount: number }>(
      'rumor:spread',
      (p) => spreads.push(p),
    )
    const endedWithRumor: Dialogue[] = []
    world.bus.on<{ dialogue: Dialogue }>('dialogue:end', ({ dialogue }) => {
      if (dialogue.rumorId === secret.id) endedWithRumor.push(dialogue)
    })

    expect(world.rumors.knows('caelum', secret.id)).toBe(false)

    // rumor roll is 65% per conversation; give them a few conversations' worth of time
    const learned = await runUntil(
      world, a, b,
      () => world.rumors.knows('caelum', secret.id),
      4000,
    )
    expect(learned, 'caelum should learn the rumor through conversation').toBe(true)

    // rumor:spread fired with full provenance
    const hop = spreads.find((s) => s.rumorId === secret.id)
    expect(hop).toBeDefined()
    expect(hop!.fromId).toBe('maeve')
    expect(hop!.toId).toBe('caelum')
    expect(hop!.knownCount).toBe(2)

    // the conversation that carried it actually voiced the rumor
    expect(endedWithRumor.length).toBeGreaterThanOrEqual(1)
    const carrier = endedWithRumor.find((d) => d.turns.some((t) => t.text.includes('dragon')))
    expect(carrier, 'transcript should reflect the rumor text').toBeDefined()

    // the listener holds a memory of the rumor with the teller as a subject
    const memOfIt = b.memory
      .all()
      .find((m) => m.text === secret.text && m.subjects.includes('maeve'))
    expect(memOfIt).toBeDefined()
    expect(memOfIt!.importance).toBe(secret.spice)
  }, 60_000)
})
