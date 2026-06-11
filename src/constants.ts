/** Everdawn Vale — tuning constants. Cooldown lattice adapted from ai-town (game-minutes). */

// ---- world / grid ----
export const WORLD_SIZE = 220            // world units per side, centered on origin
export const CELL = 2                    // grid cell size → 110×110 cells
export const SIM_SEED = 20260610

// ---- time ----
export const BASE_RATE = 2               // game-minutes per real second at speed 1
export const SPEEDS = [0, 1, 3, 10] as const
export const START_TIME = { day: 1, hour: 6, minute: 55 }
export const PLAN_HOUR = 6               // daily plan generated at 6:00
export const DEFAULT_WAKE_MIN = 6 * 60
export const DEFAULT_SLEEP_MIN = 22 * 60

// ---- festival (the seeded emergent event) ----
export const FESTIVAL_DAY = 3
export const FESTIVAL_DRESS_MIN = 17 * 60
export const FESTIVAL_START_MIN = 19 * 60
export const FESTIVAL_END_MIN = 22 * 60
export const FESTIVAL_PLACE_ID = 'market'
export const FESTIVAL_RUMOR_ID = 'festival'

// ---- movement ----
export const WALK_SPEED = 6              // world units per game-minute
export const ARRIVE_EPS = 0.6            // waypoint reached when closer than this

// ---- perception / memory ----
export const PERCEIVE_RADIUS = 14
export const OBSERVE_DEDUP_MIN = 45      // same agent+activity not re-recorded within this
export const RECENCY_DECAY = 0.995       // per game-hour since last access
export const RETRIEVE_K = 6
export const REFLECTION_THRESHOLD = 80   // unreflected importance sum triggering reflection
export const REFLECT_WINDOW = 40         // memories considered when reflecting
export const REFLECT_COOLDOWN_MIN = 240  // min game-minutes between reflections (frees the
                                         // mind-slot so player chat isn't starved)
export const SEED_IMPORTANCE = 5

// ---- conversations (ai-town lattice, in game-minutes) ----
export const TALK_RADIUS = 7             // proximity that can trigger a conversation
export const CONVERSATION_DISTANCE = 2.2 // stop-and-talk distance
export const INVITE_ACCEPT_PROB = 0.55   // base, scaled by affection in dialogue.ts
export const PAIR_TALK_COOLDOWN_MIN = 240
export const AGENT_TALK_COOLDOWN_MIN = 60
export const MAX_TURNS = 8
export const MIN_TURNS = 4
export const TURN_REVEAL_MIN = 5         // one bubble per N game-minutes
export const MAX_DIALOGUE_MIN = 70
export const WALKOVER_TIMEOUT_MIN = 90  // generous: at 10× speed this is only 9 real seconds
export const TALK_SOCIAL_GAIN = 4        // social satisfaction per revealed turn

// ---- needs (satisfaction 0..100; decay per game-minute) ----
export const NEED_START = 70
export const ENERGY_DECAY = 0.085
export const ENERGY_RECOVER_ASLEEP = 0.28
export const HUNGER_DECAY = 0.20
export const SOCIAL_DECAY = 0.055
export const SPIRIT_DECAY = 0.04
export const MEAL_SATISFY = 65
export const NEED_URGENT = { energy: 22, hunger: 28, social: 22, spirit: 18 } as const
export const NEED_REMEDY_MIN = 45        // duration of an inserted remedial step

// ---- relationships / rumors ----
export const DEFAULT_AFFECTION = 35
export const FRIEND_THRESHOLD = 60
export const RUMOR_SPREAD_PROB = 0.65
export const AFFECTION_CLAMP: [number, number] = [-3, 5]  // per-conversation delta clamp

// ---- async ops / llm ----
export const OP_TIMEOUT_MS = 60_000      // real ms watchdog
export const LLM_MAX_CONCURRENT = 3      // client-side gate (server caps at 4)
export const LLM_TIMEOUT_MS = 30_000
export const CHAT_SUMMARIZE_AFTER = 12   // chat turns before rolling summary
export const CHAT_KEEP_TURNS = 6
export const CHAT_REPLY_WORDS = 80

// ---- planner ----
export const ROUTINE_JITTER_MIN = 20
export const PLAN_MAX_STEPS = 14
