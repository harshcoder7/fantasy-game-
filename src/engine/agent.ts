/**
 * Everdawn Vale — the villager: perception, needs preemption, plan-following,
 * sleep, daily planning and reflection (Stanford Generative Agents loop).
 *
 * frame() does path-following and facing interpolation; minuteTick() does the
 * cognition: needs decay, perception of neighbours, async plan/reflection ops
 * (never blocking — ai-town pattern via world.ops) and choosing the next
 * action: urgent needs first, then the current plan step. Movement to a plan
 * step is a 'goto' action that MORPHS into its 'do'/'sleep' payload when the
 * path runs out.
 *
 * Pure engine module: no three.js, no DOM, no fetch.
 */
import type {
  AgentAction,
  AgentApi,
  ChronicleEntry,
  NeedId,
  Persona,
  PlaceDef,
  PlanStep,
  Vec2,
  WorldApi,
} from '../types'
import {
  ARRIVE_EPS,
  DEFAULT_AFFECTION,
  FESTIVAL_RUMOR_ID,
  MEAL_SATISFY,
  NEED_REMEDY_MIN,
  OBSERVE_DEDUP_MIN,
  PERCEIVE_RADIUS,
  PLAN_HOUR,
  REFLECTION_THRESHOLD,
  REFLECT_WINDOW,
  SEED_IMPORTANCE,
  WALK_SPEED,
} from '../constants'
import { createMemoryStream, scoreImportance } from './memory'
import { createNeeds } from './needs'
import { routineToPlan } from './planner'
import { PERSONAS } from '../data/agents'

const DAY_MIN = 1440
/** no needs preemption this close (game-min) before the plan's sleep step */
const SLEEP_GUARD_MIN = 90
/** energy restored by the "taking a short rest" remedy */
const REST_SATISFY = 25
/** facing turn responsiveness (per-second lerp rate) */
const FACE_TURN_RATE = 8
/** plan-step approach points are jittered ± this many world units */
const ENTRANCE_JITTER = 2

/** Internal surface the dialogue manager needs beyond AgentApi. */
export interface AgentInternal extends AgentApi {
  /** snap facing directly (conversation partners turn to face each other) */
  face(rad: number): void
}

/** Given name of a persona — the name word matching the id, else the first word. */
export function firstName(p: Persona): string {
  const words = p.name.split(/\s+/).filter((w) => w !== '')
  const given = words.find((w) => w.toLowerCase() === p.id.toLowerCase())
  if (given !== undefined) return given
  return words.length > 0 ? words[0] : p.id
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function normalizeAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a))
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isSleepActivity(activity: string): boolean {
  return /sleep/i.test(activity)
}

export function createAgent(world: WorldApi, persona: Persona): AgentInternal {
  const id = persona.id
  const memory = createMemoryStream()
  const needs = createNeeds(world.rng)

  // ------------------------------------------------------------------ spawn
  const home = world.getPlace(persona.homeId)
  const spawnAt = home !== undefined ? home.entrance : { x: 0, z: 0 }
  const spawned = world.grid.nearestWalkable({ x: spawnAt.x, z: spawnAt.z })
  const pos: Vec2 = { x: spawned.x, z: spawned.z }
  let facing = world.rng.range(-Math.PI, Math.PI)

  // ------------------------------------------------------------------ state
  let path: Vec2[] = []
  let action: AgentAction | null = null
  let plan: PlanStep[] = []
  let asleep = false
  let dialogueId: string | null = null
  /** what a 'goto' becomes when the path runs out */
  let morphKind: 'do' | 'sleep' | null = null
  /** runs when the (arrived, non-goto) action's endMin is reached */
  let onComplete: (() => void) | null = null
  /** chronicle flavor of the action currently being walked to / performed */
  let chronicleKind: 'arrive' | 'need' = 'arrive'
  /** chronicle throttle — only meaningful changes get a feed line */
  let lastAnnounced: { placeId: string | undefined; description: string } | null = null
  /** day a daily-plan op was last (successfully) scheduled for */
  let scheduledPlanDay = 0
  /** perception dedup: "otherId|description" -> last recorded totalMin */
  const observed = new Map<string, number>()

  // -------------------------------------------------------------- affection
  const affectionMap = new Map<string, number>()
  for (const [otherId, value] of Object.entries(persona.seedAffection)) {
    affectionMap.set(otherId, clamp(value, 0, 100))
  }

  // ---------------------------------------------------------- seed memories
  // Subjects = ids of villagers whose given name appears in the seed text.
  const knownPersonas = new Map<string, Persona>()
  for (const p of PERSONAS) knownPersonas.set(p.id, p)
  for (const a of world.agents) knownPersonas.set(a.persona.id, a.persona)
  const nowAtSpawn = world.clock.time.totalMin
  for (const seed of persona.seedMemories) {
    const subjects: string[] = []
    for (const p of knownPersonas.values()) {
      if (p.id === id) continue
      const pattern = new RegExp(`\\b${escapeRegExp(firstName(p))}\\b`, 'i')
      if (pattern.test(seed)) subjects.push(p.id)
    }
    const importance = /festival/i.test(seed) ? 9 : SEED_IMPORTANCE
    memory.add('seed', seed, importance, nowAtSpawn, subjects)
  }

  // ------------------------------------------------------------- chronicle
  function chronicle(icon: string, text: string, kind: ChronicleEntry['kind']): void {
    const entry: ChronicleEntry = { icon, text, kind, agentIds: [id] }
    world.bus.emit('chronicle', entry)
  }

  function placeNameOf(placeId: string | undefined): string {
    if (placeId === undefined) return 'the road'
    return world.getPlace(placeId)?.name ?? 'the road'
  }

  /** Emit agent:action (+ a throttled chronicle line) for a freshly started non-goto action. */
  function announce(a: AgentAction): void {
    world.bus.emit('agent:action', { agentId: id, action: a })
    if (
      lastAnnounced !== null &&
      lastAnnounced.placeId === a.placeId &&
      lastAnnounced.description === a.description
    ) {
      return
    }
    lastAnnounced = { placeId: a.placeId, description: a.description }
    const place = placeNameOf(a.placeId)
    const text =
      a.kind === 'sleep'
        ? `${firstName(persona)} turns in for the night at ${place}.`
        : `${firstName(persona)} is ${a.description} at ${place}.`
    chronicle(a.emoji, text, chronicleKind)
  }

  // -------------------------------------------------------------- movement
  function clearTransients(): void {
    path = []
    morphKind = null
    onComplete = null
  }

  /** Path ran out: morph goto into its payload, or settle into a sleep action. */
  function onPathDone(): void {
    if (action === null) return
    if (action.kind === 'goto') {
      const kind = morphKind ?? 'do'
      morphKind = null
      action = {
        kind,
        description: action.description,
        emoji: action.emoji,
        placeId: action.placeId,
        endMin: action.endMin,
      }
      if (kind === 'sleep') asleep = true
      announce(action)
    } else if (action.kind === 'sleep') {
      asleep = true
    }
  }

  /**
   * Begin an internally-chosen action: walk to `target`, then become the
   * 'do'/'sleep' payload (the goto carries the final description/emoji/
   * placeId/endMin, so the morph just changes the kind).
   */
  function startInternal(
    kind: 'do' | 'sleep',
    description: string,
    emoji: string,
    placeId: string,
    endMin: number,
    target: Vec2,
    ck: 'arrive' | 'need',
    complete: (() => void) | null,
  ): void {
    clearTransients()
    morphKind = kind
    onComplete = complete
    chronicleKind = ck
    const dest = world.grid.nearestWalkable(target)
    path = world.grid.findPath(pos, dest)
    action = { kind: 'goto', description, emoji, placeId, endMin }
    if (path.length === 0) onPathDone() // already there (or unreachable) — act in place
  }

  function jitteredEntrance(place: PlaceDef): Vec2 {
    return world.grid.nearestWalkable({
      x: place.entrance.x + world.rng.range(-ENTRANCE_JITTER, ENTRANCE_JITTER),
      z: place.entrance.z + world.rng.range(-ENTRANCE_JITTER, ENTRANCE_JITTER),
    })
  }

  // ------------------------------------------------------------ perception
  function perceive(now: number): void {
    const nearby = world.agentsNear(pos, PERCEIVE_RADIUS, id)
    for (const other of nearby) {
      const act = other.action
      if (act === null || act.description === '') continue
      const key = `${other.persona.id}|${act.description}`
      const last = observed.get(key)
      if (last !== undefined && now - last < OBSERVE_DEDUP_MIN) continue
      observed.set(key, now)
      const text = `${other.persona.name} is ${act.description} at ${placeNameOf(act.placeId)}`
      memory.add('observation', text, scoreImportance(text), now, [other.persona.id])
    }
  }

  // ---------------------------------------------------------- daily planning
  function applyPlan(steps: PlanStep[], summaryText: string): void {
    plan = [...steps].sort((a, b) => a.startMin - b.startMin)
    const now = world.clock.time.totalMin
    memory.add('plan', summaryText, 5, now)
    world.bus.emit('agent:plan', { agentId: id, day: world.clock.time.day })
    chronicle('📜', `${firstName(persona)} charts the day ahead.`, 'plan')
  }

  function schedulePlanOp(day: number): void {
    const ok = world.ops.schedule(id, 'plan', async () => {
      const now = world.clock.time.totalMin
      const context = memory.retrieve('plans and intentions for today', now, 8)
      const planMemories = memory.byKind('plan')
      const yesterday =
        planMemories.length > 0 ? planMemories[planMemories.length - 1].text : ''
      const knowsFestival = world.rumors.knows(id, FESTIVAL_RUMOR_ID)
      const steps = await world.brain.dailyPlan(
        persona, day, yesterday, context, world.places, knowsFestival,
      )
      return () => {
        const usable =
          steps.length > 0 ? steps : routineToPlan(persona, world.rng, knowsFestival, day)
        const intentions = usable.slice(0, 4).map((s) => s.activity).join(', ')
        applyPlan(usable, `On day ${day} I intend: ${intentions}`)
      }
    })
    if (ok) scheduledPlanDay = day
  }

  // -------------------------------------------------------------- reflection
  function scheduleReflectOp(): void {
    world.ops.schedule(id, 'reflect', async () => {
      const recent = memory.recent(REFLECT_WINDOW)
      const insights = await world.brain.reflect(persona, recent)
      return () => {
        const now = world.clock.time.totalMin
        const kept = insights
          .filter((s) => typeof s === 'string' && s.trim() !== '')
          .slice(0, 3)
        for (const insight of kept) {
          memory.add('reflection', insight, Math.min(9, scoreImportance(insight) + 3), now)
        }
        memory.markReflected()
        if (kept.length > 0) {
          world.bus.emit('agent:reflection', { agentId: id, insights: kept })
          chronicle('✨', `${firstName(persona)} reflects: ${kept[0]}`, 'reflect')
        }
      }
    })
  }

  // -------------------------------------------------------- needs preemption
  function nearestServesFood(): PlaceDef | null {
    let best: PlaceDef | null = null
    let bestD = Infinity
    for (const p of world.places) {
      if (p.servesFood !== true) continue
      const dx = p.entrance.x - pos.x
      const dz = p.entrance.z - pos.z
      const d = dx * dx + dz * dz
      if (d < bestD) {
        bestD = d
        best = p
      }
    }
    return best
  }

  /** minutes until the plan's sleep step starts (wrap-aware), or null without one */
  function minutesUntilSleep(minOfDay: number): number | null {
    const sleepStep = plan.find((s) => isSleepActivity(s.activity))
    if (sleepStep === undefined) return null
    return (sleepStep.startMin - minOfDay + DAY_MIN) % DAY_MIN
  }

  /** true if a remedial action was started */
  function startRemedy(need: NeedId, now: number): boolean {
    let place: PlaceDef | undefined
    let description: string
    let emoji: string
    let complete: (() => void) | null = null
    switch (need) {
      case 'hunger': {
        const homePlace = world.getPlace(persona.homeId)
        place = homePlace?.servesFood === true ? homePlace : nearestServesFood() ?? undefined
        description = 'having a meal'
        emoji = '🍲'
        complete = () => needs.satisfy('hunger', MEAL_SATISFY)
        break
      }
      case 'energy': {
        place = world.getPlace(persona.homeId)
        description = 'taking a short rest'
        emoji = '😌'
        complete = () => needs.satisfy('energy', REST_SATISFY)
        break
      }
      case 'social': {
        place = world.getPlace('well')
        description = 'lingering for gossip'
        emoji = '💬'
        break
      }
      case 'spirit': {
        const options = ['grove', 'lake', 'market']
          .map((pid) => world.getPlace(pid))
          .filter((p): p is PlaceDef => p !== undefined)
        place = options.length > 0 ? world.rng.pick(options) : undefined
        description = 'wandering to clear the head'
        emoji = '🍃'
        break
      }
    }
    if (place === undefined) return false
    startInternal(
      'do', description, emoji, place.id, now + NEED_REMEDY_MIN,
      jitteredEntrance(place), 'need', complete,
    )
    return true
  }

  // ----------------------------------------------------------- plan following
  function currentPlanStep(minOfDay: number): PlanStep | null {
    for (const s of plan) {
      if (minOfDay >= s.startMin && minOfDay < s.startMin + s.durationMin) return s
    }
    // sleep steps wrap past midnight: active when minOfDay < (start+duration) - 1440
    for (const s of plan) {
      const end = s.startMin + s.durationMin
      if (end > DAY_MIN && minOfDay < end - DAY_MIN) return s
    }
    return null
  }

  function startPlanStep(step: PlanStep, minOfDay: number, now: number): void {
    const dayStart = now - minOfDay
    // wrapped steps (joined after midnight) ended relative to YESTERDAY's start
    const endAbs =
      minOfDay >= step.startMin
        ? dayStart + step.startMin + step.durationMin
        : dayStart + step.startMin + step.durationMin - DAY_MIN
    if (endAbs <= now) return
    const place = world.getPlace(step.placeId)
    const target = place !== undefined ? jitteredEntrance(place) : { x: pos.x, z: pos.z }
    const kind = isSleepActivity(step.activity) ? 'sleep' : 'do'
    startInternal(kind, step.activity, step.emoji, step.placeId, endAbs, target, 'arrive', null)
  }

  // ----------------------------------------------------------------- the api
  const api: AgentInternal = {
    persona,
    memory,
    needs,
    pos,

    get facing(): number {
      return facing
    },
    get moving(): boolean {
      return path.length > 0
    },
    get asleep(): boolean {
      return asleep
    },
    get action(): AgentAction | null {
      return action
    },
    get plan(): PlanStep[] {
      return plan
    },
    get dialogueId(): string | null {
      return dialogueId
    },

    thinking(): boolean {
      return world.ops.busy(id)
    },

    affection(otherId: string): number {
      return affectionMap.get(otherId) ?? DEFAULT_AFFECTION
    },

    adjustAffection(otherId: string, delta: number): void {
      affectionMap.set(otherId, clamp(api.affection(otherId) + delta, 0, 100))
    },

    status(): string {
      if (action === null) return '🌾 idling — the road'
      return `${action.emoji} ${action.description} — ${placeNameOf(action.placeId)}`
    },

    currentPlanStep,

    face(rad: number): void {
      facing = normalizeAngle(rad)
    },

    frame(dtSec: number, gameMinPerSec: number): void {
      if (path.length === 0) return
      let remaining = WALK_SPEED * gameMinPerSec * dtSec
      if (remaining <= 0) return
      let dirX = 0
      let dirZ = 0
      while (remaining > 0 && path.length > 0) {
        const wp = path[0]
        const dx = wp.x - pos.x
        const dz = wp.z - pos.z
        const dist = Math.hypot(dx, dz)
        if (dist <= ARRIVE_EPS) {
          path.shift()
          continue
        }
        dirX = dx / dist
        dirZ = dz / dist
        const step = Math.min(remaining, dist)
        pos.x += dirX * step
        pos.z += dirZ * step
        remaining -= step
        if (dist - step <= ARRIVE_EPS) path.shift()
      }
      if (dirX !== 0 || dirZ !== 0) {
        // shortest-arc lerp toward the travel direction
        const target = Math.atan2(dirX, dirZ)
        const diff = normalizeAngle(target - facing)
        facing = normalizeAngle(facing + diff * Math.min(1, dtSec * FACE_TURN_RATE))
      }
      if (path.length === 0) onPathDone()
    },

    minuteTick(): void {
      const t = world.clock.time
      const now = t.totalMin
      const minOfDay = t.hour * 60 + t.minute

      needs.tickMinute(asleep)
      perceive(now)

      // daily plan — once per day at PLAN_HOUR (or immediately when no plan yet),
      // even while asleep; catches up if the 6:00 tick was busy with another op
      const wantsPlan =
        plan.length === 0 ||
        (scheduledPlanDay !== t.day &&
          ((t.hour === PLAN_HOUR && t.minute === 0) || minOfDay > PLAN_HOUR * 60))
      if (wantsPlan && !world.ops.busy(id)) {
        schedulePlanOp(t.day)
      } else if (
        memory.unreflectedImportance() >= REFLECTION_THRESHOLD &&
        !world.ops.busy(id)
      ) {
        scheduleReflectOp()
      }

      if (dialogueId !== null) return // mid-conversation — the manager drives

      if (asleep) {
        if (action === null || now >= action.endMin) {
          // wake (a sleep action always exists; the null check is a failsafe)
          asleep = false
          action = null
          clearTransients()
        } else {
          return
        }
      }

      // current action still running?
      if (action !== null && now < action.endMin) return

      // action finished — completion effects only if it actually got past goto
      if (action !== null) {
        const finished = action
        const hook = onComplete
        action = null
        clearTransients()
        if (finished.kind !== 'goto' && hook !== null) hook()
      }

      // choose next: urgent needs preempt the plan — but not on the brink of
      // bedtime (or once the sleep step is already due — a coarse tick must
      // not skip past the exact bedtime minute into an all-night remedy loop),
      // and never while the festival is in full swing
      const step = currentPlanStep(minOfDay)
      const sleepDue = step !== null && isSleepActivity(step.activity)
      const untilSleep = minutesUntilSleep(minOfDay)
      const sleepSoon = sleepDue || (untilSleep !== null && untilSleep <= SLEEP_GUARD_MIN)
      if (!world.festivalActive && !sleepSoon) {
        const need = needs.urgent()
        if (need !== null && startRemedy(need, now)) return
      }

      if (step !== null) startPlanStep(step, minOfDay, now)
    },

    setAction(a: AgentAction, target?: Vec2): void {
      clearTransients()
      chronicleKind = 'arrive'
      if (target !== undefined) {
        const dest = world.grid.nearestWalkable(target)
        path = world.grid.findPath(pos, dest)
      }
      action = a
      asleep = a.kind === 'sleep' && path.length === 0
      world.bus.emit('agent:action', { agentId: id, action: a })
    },

    interruptible(): boolean {
      return !asleep && dialogueId === null && action?.kind !== 'chat' && action?.kind !== 'talk'
    },

    observe(text: string, importance?: number, subjects?: string[]): void {
      memory.add(
        'observation',
        text,
        importance ?? scoreImportance(text),
        world.clock.time.totalMin,
        subjects ?? [],
      )
    },

    applyPlan,

    setDialogue(dlgId: string | null): void {
      dialogueId = dlgId
      if (dlgId === null && action !== null && action.kind === 'talk') {
        // conversation over — drop the talk action so minuteTick re-plans
        action = null
        clearTransients()
      }
    },
  }

  return api
}
