/**
 * World-sim integration test — the crown jewel: a full 3-game-day run of
 * Everdawn Vale on the deterministic LocalBrain at speed 10. Asserts the
 * emergent behaviors the design promises: stable positions, daily sleep/wake
 * cycles, morning plans, conversations, festival-rumor diffusion, the Day-3
 * Harvest Moon Festival, bounded memory and at least one reflection.
 */
import { describe, expect, it } from 'vitest'
import type { Dialogue, WorldApi } from '../src/types'
import { FESTIVAL_DAY, FESTIVAL_RUMOR_ID, SIM_SEED } from '../src/constants'
import { createRng } from '../src/engine/rng'
import { createWorld } from '../src/engine/world'
import { createBrain } from '../src/llm/brain'
import { PLACES } from '../src/data/places'
import { PERSONAS, RUMOR_SEEDS } from '../src/data/agents'

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

interface DayCycle {
  slept: boolean
  woke: boolean
}

describe('world simulation — three full days in Everdawn Vale', () => {
  it('runs 3+ game days with sleep cycles, plans, talk, rumor diffusion and the festival', async () => {
    const world: WorldApi = createWorld({
      places: PLACES,
      personas: PERSONAS,
      rumorSeeds: RUMOR_SEEDS,
      brain: createBrain(null, createRng(SIM_SEED + 1)),
      seed: SIM_SEED,
      // default start: day 1, 06:55
    })
    expect(world.agents.length).toBe(9)
    world.clock.speed = 10 // 20 game-minutes per real second

    // ----------------------------------------------------------- listeners
    let conversations = 0
    const conversationPairs = new Set<string>()
    world.bus.on<{ dialogue: Dialogue }>('dialogue:end', ({ dialogue }) => {
      if (dialogue.turns.length >= 2 && dialogue.summary !== null) {
        conversations++
        conversationPairs.add([dialogue.aId, dialogue.bId].sort().join('|'))
      }
    })

    let reflections = 0
    world.bus.on('agent:reflection', () => reflections++)

    let festivalStartDay = -1
    let festivalStartHour = -1
    let knewFestivalAtStart = -1
    world.bus.on('festival:start', () => {
      festivalStartDay = world.clock.time.day
      festivalStartHour = world.clock.time.hour
      knewFestivalAtStart = world.rumors.get(FESTIVAL_RUMOR_ID)!.knownBy.size
    })
    let festivalEnded = false
    world.bus.on('festival:end', () => {
      festivalEnded = true
    })

    // --------------------------------------------------------------- run it
    const cycles = new Map<string, DayCycle>() // "day|agentId"
    const cycleOf = (day: number, id: string): DayCycle => {
      const key = `${day}|${id}`
      let c = cycles.get(key)
      if (c === undefined) {
        c = { slept: false, woke: false }
        cycles.set(key, c)
      }
      return c
    }

    let knownByEveningDay3 = -1
    let celebrantActionsSeen = 0
    const startWall = Date.now()

    // day 1 06:55 → past day 4 07:00 (≥ 3 full game days)
    const endTotalMin = (4 - 1) * 1440 + 7 * 60
    let updates = 0
    while (world.clock.time.totalMin < endTotalMin) {
      world.update(0.5) // 10 game-minutes per update at speed 10
      await flush()
      updates++
      expect(updates).toBeLessThan(1000) // hard safety bound

      const t = world.clock.time

      // positions stay finite (sampled every 10 game-minutes ≥ hourly)
      for (const agent of world.agents) {
        expect(Number.isFinite(agent.pos.x), `${agent.persona.id} pos.x finite`).toBe(true)
        expect(Number.isFinite(agent.pos.z), `${agent.persona.id} pos.z finite`).toBe(true)
        expect(Math.abs(agent.pos.x)).toBeLessThanOrEqual(world.grid.worldSize)
        expect(Math.abs(agent.pos.z)).toBeLessThanOrEqual(world.grid.worldSize)
      }

      // sleep/wake observation per agent per day
      for (const agent of world.agents) {
        const c = cycleOf(t.day, agent.persona.id)
        if (agent.asleep) c.slept = true
        else c.woke = true
      }

      // festival-rumor reach, snapshotted at day 3, 19:00
      if (knownByEveningDay3 === -1 && t.day === FESTIVAL_DAY && t.hour >= 19) {
        knownByEveningDay3 = world.rumors.get(FESTIVAL_RUMOR_ID)!.knownBy.size
      }

      // celebrants visibly celebrating during the festival window
      if (world.festivalActive) {
        const celebrating = world.agents.filter(
          (a) => a.action !== null && /Harvest Moon Festival/i.test(a.action.description),
        ).length
        celebrantActionsSeen = Math.max(celebrantActionsSeen, celebrating)
      }
    }

    expect(Date.now() - startWall, 'wall time must stay well under 60s').toBeLessThan(55_000)

    // ------------------------------------------------ daily sleep/wake cycle
    for (let day = 1; day <= 3; day++) {
      for (const agent of world.agents) {
        const c = cycleOf(day, agent.persona.id)
        expect(c.slept, `${agent.persona.id} should sleep on day ${day}`).toBe(true)
        expect(c.woke, `${agent.persona.id} should be awake on day ${day}`).toBe(true)
      }
    }

    // -------------------------------------------------- a plan every morning
    for (const agent of world.agents) {
      const plans = agent.memory.byKind('plan')
      expect(
        plans.length,
        `${agent.persona.id} should hold ≥3 daily-plan memories, got ${plans.length}`,
      ).toBeGreaterThanOrEqual(3)
      expect(agent.plan.length).toBeGreaterThanOrEqual(3)
    }

    // ------------------------------------------------------------ society
    expect(conversations, 'at least 4 conversations should complete').toBeGreaterThanOrEqual(4)
    expect(conversationPairs.size).toBeGreaterThanOrEqual(2)
    expect(reflections, 'at least one reflection should happen').toBeGreaterThanOrEqual(1)

    // ----------------------------------------------------- rumor diffusion
    expect(
      knownByEveningDay3,
      'festival rumor should reach ≥5 of 9 villagers by day 3, 19:00',
    ).toBeGreaterThanOrEqual(5)

    // ------------------------------------------------------------ festival
    expect(festivalStartDay, 'festival:start must fire on day 3').toBe(FESTIVAL_DAY)
    expect(festivalStartHour).toBe(19)
    expect(festivalEnded).toBe(true)
    expect(knewFestivalAtStart).toBeGreaterThanOrEqual(5)
    expect(
      celebrantActionsSeen,
      '≥5 agents should hold the festival action during the festival',
    ).toBeGreaterThanOrEqual(5)
    const withFestivalMemory = world.agents.filter((a) =>
      a.memory.all().some((m) => m.text.includes('joined the Harvest Moon Festival')),
    ).length
    expect(withFestivalMemory, '≥5 agents should remember the festival').toBeGreaterThanOrEqual(5)

    // ------------------------------------------------------- memory bounds
    for (const agent of world.agents) {
      expect(
        agent.memory.count(),
        `${agent.persona.id} memory stream should stay bounded`,
      ).toBeLessThan(3000)
    }
  }, 60_000)
})
