/**
 * Everdawn Vale — shared contracts. Read DESIGN.md first.
 *
 * Layering rules:
 *  - engine/* files import ONLY: this file, constants.ts, data/*, sibling engine/* files.
 *    Engine is pure TypeScript: no three.js, no DOM, no fetch. Runs in node for tests.
 *  - llm/* may import engine modules (e.g. validatePlanSteps, scoreImportance) and this file.
 *    The Brain implementation is injected INTO the engine via createWorld (interface below).
 *  - three/* imports three.js + this file + three/contracts.ts. ui/* imports this file + DOM.
 *
 * Factory signatures each module must export are documented at the end of this file.
 */

// ---------------------------------------------------------------- math / rng
export interface Vec2 { x: number; z: number }

export interface Rng {
  /** uniform [0,1) */
  next(): number
  range(min: number, max: number): number
  /** integer, inclusive both ends */
  int(min: number, max: number): number
  pick<T>(arr: readonly T[]): T
  chance(p: number): boolean
  /** Fisher-Yates in place, returns arr */
  shuffle<T>(arr: T[]): T[]
}

// ---------------------------------------------------------------- events
export type Unsubscribe = () => void

export interface EventBus {
  on<T = unknown>(topic: string, fn: (payload: T) => void): Unsubscribe
  emit(topic: string, payload?: unknown): void
}

/**
 * Event topics emitted on world.bus (payload types):
 *  'chronicle'        ChronicleEntry                          — UI feed line
 *  'dialogue:start'   { dialogue: Dialogue }
 *  'dialogue:turn'    { dialogue: Dialogue; turn: DialogueTurn }
 *  'dialogue:end'     { dialogue: Dialogue }
 *  'agent:action'     { agentId: string; action: AgentAction }
 *  'agent:reflection' { agentId: string; insights: string[] }
 *  'agent:plan'       { agentId: string; day: number }
 *  'rumor:spread'     { rumorId: string; fromId: string; toId: string; knownCount: number }
 *  'festival:dress'   {}                                      — decorations appear
 *  'festival:start'   {}
 *  'festival:end'     {}
 *  'llm:status'       { live: boolean }                       — emitted by Brain
 */
export interface ChronicleEntry {
  icon: string
  text: string
  kind: 'talk' | 'reflect' | 'plan' | 'event' | 'arrive' | 'need' | 'chat' | 'rumor'
  agentIds: string[]
}

// ---------------------------------------------------------------- time
export type GamePhase = 'dawn' | 'day' | 'dusk' | 'night'

export interface GameTime { day: number; hour: number; minute: number; totalMin: number }

export interface ClockApi {
  /** live object, mutated in place — safe to hold a reference */
  readonly time: GameTime
  /** 0 | 1 | 3 | 10 (multiplies BASE_RATE) */
  speed: number
  /** advance by dtSec real seconds; fires minute/hour/day listeners; returns whole game-minutes crossed */
  update(dtSec: number): number
  /** game minutes that pass per real second right now (BASE_RATE * speed) */
  minutesPerSecond(): number
  /** 0..1 through the 24h day, 0 = midnight */
  dayFraction(): number
  /** dawn 5:00-7:00, day 7:00-18:00, dusk 18:00-20:00, night 20:00-5:00 */
  phase(): GamePhase
  onMinute(fn: (t: GameTime) => void): Unsubscribe
  onHour(fn: (t: GameTime) => void): Unsubscribe
  onNewDay(fn: (t: GameTime) => void): Unsubscribe
}

// ---------------------------------------------------------------- grid / pathfinding
export interface GridApi {
  /** cells per side */
  readonly n: number
  /** world units per cell */
  readonly cell: number
  /** world units per side; world coords span [-worldSize/2, +worldSize/2], centered on origin */
  readonly worldSize: number
  inBounds(cx: number, cz: number): boolean
  walkable(cx: number, cz: number): boolean
  setBlocked(cx: number, cz: number, blocked: boolean): void
  /** rect given by CENTER world coords + extents */
  blockRect(centerX: number, centerZ: number, w: number, d: number): void
  blockCircle(centerX: number, centerZ: number, radius: number): void
  toCell(p: Vec2): { cx: number; cz: number }
  /** cell center in world coords */
  toWorld(cx: number, cz: number): Vec2
  isWalkableAt(p: Vec2): boolean
  /** spiral-search outward; returns p itself if already walkable */
  nearestWalkable(p: Vec2, maxRadiusCells?: number): Vec2
  /**
   * A* (4-connected, Manhattan heuristic, min-heap), then line-of-sight smoothed.
   * Returns world-coord waypoints EXCLUDING start, ending at the destination
   * (snapped to nearestWalkable). Empty array if unreachable.
   */
  findPath(from: Vec2, to: Vec2): Vec2[]
}

// ---------------------------------------------------------------- places
export type PlaceKind =
  | 'castle' | 'tavern' | 'forge' | 'market' | 'tower' | 'temple'
  | 'farm' | 'farmhouse' | 'windmill' | 'house' | 'hut' | 'well' | 'lake' | 'grove'

export interface PlaceDef {
  id: string
  name: string
  kind: PlaceKind
  /** footprint center, world coords */
  x: number
  z: number
  /** footprint extents, world units */
  w: number
  d: number
  /** building yaw (radians), visual only */
  rotY?: number
  /** walkable approach point near the door — agents stand here when "at" the place */
  entrance: Vec2
  /** planner vocabulary — short verb phrases */
  activities: string[]
  /** true → footprint blocks the walk grid */
  solid: boolean
  /** eating here satisfies hunger */
  servesFood?: boolean
}

// ---------------------------------------------------------------- memory
export type MemoryKind = 'observation' | 'dialogue' | 'reflection' | 'plan' | 'chat' | 'seed'

export interface MemoryRecord {
  id: number
  kind: MemoryKind
  text: string
  createdMin: number
  lastAccessMin: number
  /** 1..10 */
  importance: number
  /** related agent/place/rumor ids */
  subjects: string[]
}

export interface MemoryStreamApi {
  add(kind: MemoryKind, text: string, importance: number, nowMin: number, subjects?: string[]): MemoryRecord
  /**
   * Park et al. retrieval: score = norm(recency) + norm(importance) + norm(relevance),
   * recency = RECENCY_DECAY ^ gameHoursSince(lastAccessMin), min-max normalized over
   * candidates. Returns top k (default RETRIEVE_K) sorted best-first; bumps lastAccessMin.
   */
  retrieve(query: string, nowMin: number, k?: number): MemoryRecord[]
  /** newest first */
  recent(n: number): MemoryRecord[]
  byKind(kind: MemoryKind): MemoryRecord[]
  /** sum of importance of records added since markReflected() */
  unreflectedImportance(): number
  markReflected(): void
  count(): number
  all(): readonly MemoryRecord[]
}

// ---------------------------------------------------------------- long-term memory (lore)
/**
 * The lore codex — Everdawn Vale's shared long-term memory. Distinct from a
 * villager's per-agent memory stream (episodic, lexical): this is a single
 * world-wide vector index, built once offline (ingest) and queried live
 * (retrieve) the way a RAG pipeline grounds an LLM call in a knowledge base.
 */
export interface LoreDoc { id: string; text: string }

export interface LoreChunk { id: string; docId: string; text: string; embedding: number[] }

export interface LoreHit { id: string; docId: string; text: string; score: number }

export interface LongTermMemoryApi {
  /** offline phase: chunk each document and embed+index every chunk */
  ingest(docs: LoreDoc[]): void
  /** live phase: embed the query, cosine-rank indexed chunks, return top k best-first */
  retrieve(query: string, k?: number): LoreHit[]
  count(): number
  all(): readonly LoreChunk[]
}

/**
 * The four-layer agent memory model: internal knowledge (static, handed in
 * at creation — stands in for facts baked into the weights), long-term
 * memory (LongTermMemoryApi above), short-term memory (the rolling turn
 * buffer here), and the context window (assembled fresh per call by
 * buildContextWindow, drawing on the other three).
 */
export interface ConversationTurn { speaker: string; text: string }

export interface ContextWindow {
  query: string
  internalKnowledge: readonly string[]
  longTermHits: readonly LoreHit[]
  shortTermTurns: readonly ConversationTurn[]
}

export interface AgentMemoryApi {
  internalKnowledge(): readonly string[]
  pushTurn(speaker: string, text: string): void
  /** newest-last, most recent n (default: a small conversational window) */
  recentTurns(n?: number): ConversationTurn[]
  longTermRetrieve(query: string, k?: number): LoreHit[]
  buildContextWindow(query: string, opts?: { longTermK?: number; recentTurns?: number }): ContextWindow
}

// ---------------------------------------------------------------- needs
export type NeedId = 'energy' | 'hunger' | 'social' | 'spirit'

/** all values are SATISFACTION 0..100 (100 = fully rested / fed / socialized / fulfilled) */
export interface Needs { energy: number; hunger: number; social: number; spirit: number }

export interface NeedsApi {
  readonly values: Needs
  /** apply one game-minute of decay (energy RECOVERS while asleep) */
  tickMinute(asleep: boolean): void
  satisfy(id: NeedId, amount: number): void
  /** most urgent need currently below its threshold (lowest ratio first), else null */
  urgent(): NeedId | null
}

// ---------------------------------------------------------------- rumors
export interface Rumor {
  id: string
  text: string
  /** 1..10, juicier spreads more */
  spice: number
  sourceId: string
  knownBy: Set<string>
  /** set on event-rumors (the festival) */
  eventDay?: number
  eventStartMin?: number
  eventPlaceId?: string
}

export interface RumorSeed {
  id: string
  text: string
  spice: number
  sourceId: string
  knownBy: string[]
  eventDay?: number
  eventStartMin?: number
  eventPlaceId?: string
}

export interface RumorBoardApi {
  seed(r: RumorSeed): Rumor
  get(id: string): Rumor | undefined
  all(): Rumor[]
  knows(agentId: string, rumorId: string): boolean
  /** returns true if newly learned; emits 'rumor:spread' when fromId given */
  learn(agentId: string, rumorId: string, fromId?: string): boolean
  knownByAgent(agentId: string): Rumor[]
  /** spiciest rumor speaker knows and listener doesn't (not about the listener), else null */
  pickToSpread(speakerId: string, listenerId: string): Rumor | null
}

// ---------------------------------------------------------------- personas
export type HatKind = 'wizard' | 'circlet' | 'hood' | 'cap' | 'flower' | 'mitre' | 'none'

export interface CharacterLook {
  /** hex colors */
  tunic: string
  skin: string
  hair: string
  legs: string
  hat: HatKind
  hatColor: string
  /** 0.85..1.15 */
  scale: number
}

export interface RoutineStep {
  /** 'HH:MM' 24h */
  start: string
  durationMin: number
  placeId: string
  activity: string
  emoji: string
}

export interface Persona {
  id: string
  name: string
  role: string
  age: number
  /** 3-5 adjectives */
  traits: string[]
  /** 2-3 sentences, used in prompts */
  backstory: string
  goals: string[]
  /** how they talk — fed to the LLM */
  speechStyle: string
  homeId: string
  workId: string
  /** each becomes one 'seed' memory at importance 5 (festival intent gets 9) */
  seedMemories: string[]
  /** agentId -> 0..100 starting affection (missing pairs default DEFAULT_AFFECTION) */
  seedAffection: Record<string, number>
  /** fallback daily schedule, chronological, first step at wake, last step is sleep at home */
  routine: RoutineStep[]
  look: CharacterLook
}

// ---------------------------------------------------------------- plans & actions
export interface PlanStep {
  /** minutes since midnight */
  startMin: number
  durationMin: number
  placeId: string
  activity: string
  emoji: string
}

export type ActionKind = 'goto' | 'do' | 'talk' | 'sleep' | 'chat'

export interface AgentAction {
  kind: ActionKind
  /** present-progressive, e.g. "forging horseshoes" */
  description: string
  emoji: string
  placeId?: string
  withAgentId?: string
  /** absolute clock totalMin when it ends; Infinity for talk/chat (ended externally) */
  endMin: number
}

// ---------------------------------------------------------------- dialogue
export interface DialogueTurn { speakerId: string; text: string }

export interface DialogueSummary { aSummary: string; bSummary: string; affectionDelta: number }

export interface Dialogue {
  id: string
  aId: string
  bId: string
  state: 'walking' | 'talking' | 'done'
  /** revealed turns */
  turns: DialogueTurn[]
  /** generated but not yet revealed */
  pending: DialogueTurn[]
  startedMin: number
  lastTurnMin: number
  summary: DialogueSummary | null
  /** rumor passed in this conversation, chosen before generation */
  rumorId: string | null
}

export interface DialogueManagerApi {
  /** advance walking/reveal/end logic; called once per crossed game-minute by world */
  minuteTick(nowMin: number): void
  /** proximity trigger — cooldowns, interruptibility, acceptance roll; true if started */
  maybeStart(a: AgentApi, b: AgentApi, nowMin: number): boolean
  active(): Dialogue[]
  get(id: string): Dialogue | undefined
  endNow(id: string): void
}

// ---------------------------------------------------------------- async brain ops
export type OpKind = 'plan' | 'reflect' | 'converse' | 'chat'

/**
 * ai-town pattern: agent logic never awaits. Work runs async; its resolved value is an
 * APPLY callback executed on a later world.update via drain(). One op per agent. Ops
 * older than OP_TIMEOUT_MS real-ms are dropped (watchdog).
 */
export interface OpRunnerApi {
  /** false if agent already has an op in flight */
  schedule(agentId: string, kind: OpKind, work: () => Promise<() => void>): boolean
  busy(agentId: string): boolean
  /** execute queued apply-callbacks on the sim thread */
  drain(): void
  inFlight(): number
}

// ---------------------------------------------------------------- brain (LLM or local)
export interface ChatTurn { from: 'wanderer' | 'agent'; text: string }

export interface ConverseResult {
  /** 4-8 alternating turns, first speaker = a */
  turns: DialogueTurn[]
  /** first-person summary for each participant's memory */
  aSummary: string
  bSummary: string
  /** -3..+5, applied symmetrically, clamped by caller */
  affectionDelta: number
}

export interface Brain {
  /** did the last transport attempt succeed (UI rune) */
  live(): boolean
  dailyPlan(
    p: Persona, day: number, yesterdaySummary: string, context: MemoryRecord[],
    places: PlaceDef[], knowsFestival: boolean,
  ): Promise<PlanStep[]>
  /** 2-3 first-person insights */
  reflect(p: Persona, memories: MemoryRecord[]): Promise<string[]>
  converse(
    a: Persona, b: Persona, ctxA: MemoryRecord[], ctxB: MemoryRecord[],
    affectionAtoB: number, rumorText: string | null, time: GameTime,
  ): Promise<ConverseResult>
  chatReply(
    p: Persona, status: string, context: MemoryRecord[], history: ChatTurn[],
    summary: string, playerMsg: string, time: GameTime,
  ): Promise<string>
  /** roll old chat turns into a running summary */
  summarizeChat(p: Persona, history: ChatTurn[], prevSummary: string): Promise<string>
}

export interface LlmTransport {
  /** resolves null on ANY failure (timeout/429/parse) — never rejects */
  complete(system: string, user: string, opts?: { maxTokens?: number; temperature?: number }): Promise<string | null>
}

// ---------------------------------------------------------------- agent
export interface AgentApi {
  readonly persona: Persona
  readonly memory: MemoryStreamApi
  readonly needs: NeedsApi
  readonly pos: Vec2
  /** radians; matches three.js rotation.y — model faces +Z at 0, facing = atan2(dx, dz) */
  readonly facing: number
  readonly moving: boolean
  readonly asleep: boolean
  readonly action: AgentAction | null
  readonly plan: PlanStep[]
  readonly dialogueId: string | null
  /** async brain op in flight → 💭 */
  thinking(): boolean
  /** 0..100, defaults DEFAULT_AFFECTION for unknown pairs */
  affection(otherId: string): number
  adjustAffection(otherId: string, delta: number): void
  /** "🔥 forging horseshoes — at the Emberhand Smithy" */
  status(): string
  currentPlanStep(minOfDay: number): PlanStep | null
  /** per-frame: path following, interpolation. gameMinPerSec = clock.minutesPerSecond() */
  frame(dtSec: number, gameMinPerSec: number): void
  /** once per crossed game-minute: needs, perception, plan-following, sleep, reflection trigger */
  minuteTick(): void
  /** dialogue/festival/world force an action; optional walk target first */
  setAction(a: AgentAction, target?: Vec2): void
  /** not asleep, not in dialogue, not chatting */
  interruptible(): boolean
  /** record an observation memory (importance auto-scored when omitted) */
  observe(text: string, importance?: number, subjects?: string[]): void
  applyPlan(steps: PlanStep[], summaryText: string): void
  /** dialogue manager bookkeeping */
  setDialogue(id: string | null): void
}

// ---------------------------------------------------------------- world
export interface WorldApi {
  readonly clock: ClockApi
  readonly bus: EventBus
  readonly grid: GridApi
  readonly rng: Rng
  readonly places: PlaceDef[]
  readonly agents: AgentApi[]
  readonly rumors: RumorBoardApi
  readonly dialogues: DialogueManagerApi
  readonly ops: OpRunnerApi
  readonly brain: Brain
  /** the vale's shared lore codex — long-term memory, ingested once at world creation */
  readonly loreMemory: LongTermMemoryApi
  /** true between festival:start and festival:end */
  readonly festivalActive: boolean
  getAgent(id: string): AgentApi | undefined
  getPlace(id: string): PlaceDef | undefined
  agentsNear(p: Vec2, radius: number, excludeId?: string): AgentApi[]
  /** advance clock; per crossed minute run agent.minuteTick + dialogues.minuteTick +
   *  festival orchestration; every frame run agent.frame + ops.drain() */
  update(dtSec: number): void
}

export interface WorldOptions {
  places: PlaceDef[]
  personas: Persona[]
  rumorSeeds: RumorSeed[]
  brain: Brain
  seed: number
  start?: { day: number; hour: number; minute: number }
}

/* ----------------------------------------------------------------------------
 * FACTORY SIGNATURES each module must export (exact names):
 *
 *  engine/rng.ts      createRng(seed: number): Rng                        (mulberry32)
 *  engine/events.ts   createEventBus(): EventBus
 *  engine/time.ts     createClock(start: {day;hour;minute}, baseRate: number): ClockApi
 *  engine/grid.ts     createGrid(worldSize: number, cell: number): GridApi
 *  engine/world.ts    createWorld(opts: WorldOptions): WorldApi
 *                       - builds grid, blocks solid places (and lake), creates everything,
 *                       - seeds rumors + seed memories, spawns agents at home entrances,
 *                       - owns festival orchestration (dress 17:00, start 19:00 day FESTIVAL_DAY,
 *                         end 22:00; at start, every agent knowing the festival rumor gets a
 *                         festival 'do' action at the market; emits festival events + chronicle)
 *  engine/memory.ts   createMemoryStream(): MemoryStreamApi
 *                     tokenize(text: string): string[]            (lowercase, no stopwords)
 *                     relevanceScore(query: string, text: string): number   (0..1 lexical cosine)
 *                     scoreImportance(text: string): number       (1..10 heuristic)
 *  engine/needs.ts    createNeeds(rng: Rng): NeedsApi
 *  engine/rumors.ts   createRumorBoard(bus: EventBus): RumorBoardApi
 *  engine/planner.ts  validatePlanSteps(raw: unknown, places: PlaceDef[]): PlanStep[] | null
 *                       (sorted, clamped, gaps ok; null if hopeless — used by llm/brain.ts)
 *                     routineToPlan(p: Persona, rng: Rng, knowsFestival: boolean, day: number): PlanStep[]
 *                       (parse routine, ±RUTINE_JITTER_MIN jitter, inject festival step on day)
 *  engine/embeddings.ts     embed(text: string, dim?: number): number[]       (feature-hashing, L2-normalized)
 *                           cosineSimilarity(a: number[], b: number[]): number (dot product of unit vectors)
 *  engine/longTermMemory.ts createLongTermMemory(): LongTermMemoryApi
 *                           chunkText(text: string, maxWords?: number, overlap?: number): string[]
 *  engine/agentMemory.ts    createAgentMemory(internalKnowledge: string[], longTerm: LongTermMemoryApi): AgentMemoryApi
 *  engine/agent.ts    createAgent(world: WorldApi, persona: Persona): AgentApi
 *  engine/dialogue.ts createDialogueManager(world: WorldApi): DialogueManagerApi
 *  engine/ops.ts      createOpRunner(): OpRunnerApi
 *
 *  llm/transport.ts   createTransport(): LlmTransport              (fetch POST /api/llm)
 *                     checkHealth(): Promise<{ok: boolean; llm: boolean}>
 *  llm/localBrain.ts  localPlan / localReflect / localConverse / localChatReply
 *                       (deterministic given rng; see Brain method shapes)
 *  llm/brain.ts       createBrain(t: LlmTransport | null, rng: Rng, bus?: EventBus): Brain
 *  llm/prompts.ts     prompt builders (character cards etc.) used by brain.ts
 *
 *  three/scene.ts     createScene(canvas: HTMLCanvasElement): SceneCtx   (see three/contracts.ts)
 *  three/terrain.ts   buildTerrain(ctx: SceneCtx, places: PlaceDef[]): LayerApi
 *  three/village.ts   buildVillage(ctx: SceneCtx, places: PlaceDef[]): VillageApi
 *  three/nature.ts    buildNature(ctx: SceneCtx, grid: GridApi, places: PlaceDef[], seed: number): LayerApi
 *  three/effects.ts   createEffects(ctx: SceneCtx, chimneys: Vector3Like[]): LayerApi
 *  three/festival.ts  createFestival(ctx: SceneCtx, market: PlaceDef): FestivalVisualApi
 *  three/characters.ts createCharacterLayer(ctx: SceneCtx): CharacterLayerApi
 *
 *  ui/hud.ts          createHud(root: HTMLElement, world: WorldApi): { update(): void }
 *  ui/chronicle.ts    createChronicle(root: HTMLElement, world: WorldApi): { update(dtSec: number): void }
 *  ui/codex.ts        createCodex(root: HTMLElement, world: WorldApi, cb: {
 *                       onFollow(agentId: string | null): void
 *                       onFocus(p: Vec2): void
 *                     }): { open(agentId: string): void; close(): void; selected(): string | null; update(): void }
 *  ui/minimap.ts      createMinimap(root: HTMLElement, world: WorldApi, onClickWorld: (p: Vec2) => void): { update(): void }
 *  ui/intro.ts        createIntro(root: HTMLElement, onEnter: () => void): void
 * -------------------------------------------------------------------------- */
