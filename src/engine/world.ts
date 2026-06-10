/**
 * Everdawn Vale — the world: clock, grid, bus, rumor board, op runner, agents
 * and dialogues wired together, plus orchestration of the seeded emergent
 * event (the Day-3 Harvest Moon Festival).
 *
 * update(dtSec) advances the clock; for every crossed game-minute (capped so a
 * background tab can't unleash an avalanche) it runs each agent's minuteTick,
 * the dialogue manager and the festival triggers; every frame it runs agent
 * movement interpolation and drains completed async brain ops.
 *
 * Pure engine module: no three.js, no DOM, no fetch.
 */
import type {
  AgentApi,
  ChronicleEntry,
  DialogueManagerApi,
  PlaceDef,
  Vec2,
  WorldApi,
  WorldOptions,
} from '../types'
import {
  BASE_RATE,
  CELL,
  FESTIVAL_DAY,
  FESTIVAL_DRESS_MIN,
  FESTIVAL_END_MIN,
  FESTIVAL_PLACE_ID,
  FESTIVAL_RUMOR_ID,
  FESTIVAL_START_MIN,
  START_TIME,
  WORLD_SIZE,
} from '../constants'
import { createRng } from './rng'
import { createEventBus } from './events'
import { createClock } from './time'
import { createGrid } from './grid'
import { createRumorBoard } from './rumors'
import { createOpRunner } from './ops'
import { createAgent } from './agent'
import { createDialogueManager } from './dialogue'

/** cap on minute-ticks processed per update — a stalled tab can't avalanche */
const MAX_MINUTES_PER_UPDATE = 30
/** the well's blocking footprint (round stone collar, not its bounding rect) */
const WELL_BLOCK_RADIUS = 1.6
/** festival-goers spread out, keeping this margin inside the square's footprint */
const FESTIVAL_SPREAD_MARGIN = 4

const FESTIVAL_ACTIVITY = 'celebrating the Harvest Moon Festival'

export function createWorld(opts: WorldOptions): WorldApi {
  const bus = createEventBus()
  const rng = createRng(opts.seed)
  const clock = createClock(opts.start ?? START_TIME, BASE_RATE)

  // ------------------------------------------------------------------- grid
  const grid = createGrid(WORLD_SIZE, CELL)
  for (const place of opts.places) {
    if (!place.solid) continue
    if (place.kind === 'well') grid.blockCircle(place.x, place.z, WELL_BLOCK_RADIUS)
    else grid.blockRect(place.x, place.z, place.w, place.d)
  }

  // ----------------------------------------------------------------- boards
  const rumors = createRumorBoard(bus)
  for (const seed of opts.rumorSeeds) rumors.seed(seed)
  const ops = createOpRunner()

  const placeMap = new Map<string, PlaceDef>()
  for (const place of opts.places) placeMap.set(place.id, place)

  const agents: AgentApi[] = []
  const agentMap = new Map<string, AgentApi>()

  let dialogues!: DialogueManagerApi
  let festivalActive = false
  let dressFired = false
  let startFired = false
  let endFired = false

  function chronicle(icon: string, text: string, kind: ChronicleEntry['kind'], agentIds: string[]): void {
    const entry: ChronicleEntry = { icon, text, kind, agentIds }
    bus.emit('chronicle', entry)
  }

  function agentsNear(p: Vec2, radius: number, excludeId?: string): AgentApi[] {
    const result: AgentApi[] = []
    for (const a of agents) {
      if (excludeId !== undefined && a.persona.id === excludeId) continue
      const dx = a.pos.x - p.x
      const dz = a.pos.z - p.z
      if (dx * dx + dz * dz <= radius * radius) result.push(a)
    }
    return result
  }

  // --------------------------------------------------------------- festival
  function festivalSpot(market: PlaceDef): Vec2 {
    const hw = Math.max(1, market.w / 2 - FESTIVAL_SPREAD_MARGIN)
    const hd = Math.max(1, market.d / 2 - FESTIVAL_SPREAD_MARGIN)
    return grid.nearestWalkable({
      x: market.x + rng.range(-hw, hw),
      z: market.z + rng.range(-hd, hd),
    })
  }

  function fireDress(): void {
    dressFired = true
    bus.emit('festival:dress', {})
    chronicle(
      '🏮',
      'Lantern strings and bunting bloom across the Market Square — something is coming.',
      'event',
      [],
    )
  }

  function fireStart(): void {
    startFired = true
    festivalActive = true
    bus.emit('festival:start', {})
    const market = placeMap.get(FESTIVAL_PLACE_ID)
    const minOfDay = clock.time.hour * 60 + clock.time.minute
    const festivalEndAbs = clock.time.totalMin - minOfDay + FESTIVAL_END_MIN
    const celebrants: string[] = []
    for (const agent of agents) {
      if (!rumors.knows(agent.persona.id, FESTIVAL_RUMOR_ID)) continue
      celebrants.push(agent.persona.id)
      const dlgId = agent.dialogueId
      if (dlgId !== null) dialogues.endNow(dlgId)
      if (market !== undefined) {
        agent.setAction(
          {
            kind: 'do',
            description: FESTIVAL_ACTIVITY,
            emoji: '🎉',
            placeId: FESTIVAL_PLACE_ID,
            endMin: festivalEndAbs,
          },
          festivalSpot(market),
        )
      }
      agent.observe(
        'I joined the Harvest Moon Festival in the Market Square — lanterns, music, and the whole vale together',
        8,
      )
    }
    chronicle(
      '🎉',
      'The bonfire roars to life — the Harvest Moon Festival begins in the Market Square!',
      'event',
      celebrants,
    )
  }

  function fireEnd(): void {
    endFired = true
    festivalActive = false
    bus.emit('festival:end', {})
    const now = clock.time.totalMin
    const drifters: string[] = []
    for (const agent of agents) {
      const action = agent.action
      if (action === null || action.description !== FESTIVAL_ACTIVITY) continue
      drifters.push(agent.persona.id)
      // an already-finished action: next minuteTick resumes plans / sleep
      agent.setAction({
        kind: 'do',
        description: 'drifting home beneath the harvest moon',
        emoji: '🌙',
        placeId: FESTIVAL_PLACE_ID,
        endMin: now,
      })
    }
    chronicle(
      '🌙',
      'The last embers settle; the Harvest Moon Festival draws to a close.',
      'event',
      drifters,
    )
  }

  function festivalTick(): void {
    const t = clock.time
    if (t.day !== FESTIVAL_DAY) {
      // a long pause could jump straight past day 3 — close out cleanly
      if (startFired && !endFired && t.day > FESTIVAL_DAY) fireEnd()
      return
    }
    const minOfDay = t.hour * 60 + t.minute
    if (!dressFired && minOfDay >= FESTIVAL_DRESS_MIN) fireDress()
    if (!startFired && minOfDay >= FESTIVAL_START_MIN) fireStart()
    if (startFired && !endFired && minOfDay >= FESTIVAL_END_MIN) fireEnd()
  }

  // ------------------------------------------------------------------ world
  const world: WorldApi = {
    clock,
    bus,
    grid,
    rng,
    places: opts.places,
    agents,
    rumors,
    get dialogues(): DialogueManagerApi {
      return dialogues
    },
    ops,
    brain: opts.brain,
    get festivalActive(): boolean {
      return festivalActive
    },

    getAgent(id: string): AgentApi | undefined {
      return agentMap.get(id)
    },

    getPlace(id: string): PlaceDef | undefined {
      return placeMap.get(id)
    },

    agentsNear,

    update(dtSec: number): void {
      const minutes = clock.update(dtSec)
      const ticks = Math.min(minutes, MAX_MINUTES_PER_UPDATE)
      for (let i = 0; i < ticks; i++) {
        for (const agent of agents) agent.minuteTick()
        dialogues.minuteTick(clock.time.totalMin)
        festivalTick()
      }
      for (const agent of agents) agent.frame(dtSec, clock.minutesPerSecond())
      ops.drain()
    },
  }

  dialogues = createDialogueManager(world)

  // spawn order = personas order (deterministic rng draws)
  for (const persona of opts.personas) {
    const agent = createAgent(world, persona)
    agents.push(agent)
    agentMap.set(persona.id, agent)
  }

  return world
}
