# Everdawn Vale — Design & Architecture

A 3D fantasy village life-simulation in the browser. Nine villagers live autonomous lives
driven by a Generative-Agents cognition stack (memory → retrieval → reflection → planning →
dialogue), an Agentopia-style needs/relationship layer, and an ai-town-style non-blocking
simulation engine. The player is **the Wanderer** — an invisible presence who can fly through
the vale, follow villagers, read their minds (codex panel), and speak with them directly.

This document is the single source of truth for all builder agents, together with
`src/types.ts` (the precise code contract), `src/constants.ts`, and `src/data/*`.

---

## 1. The Game

- **World**: Everdawn Vale — a low-poly fantasy village: castle, tavern, smithy, arcane tower,
  temple, farm with windmill, herbalist hut, market square with a well, houses, a lake, forests.
  Full day/night cycle, torch light at night, chimney smoke, fireflies.
- **Villagers (9)**: each with persona, backstory, traits, goals, relationships, home, job,
  daily routine. They wake, work, eat, gossip, reflect, and sleep — visibly, in 3D.
- **Cognition (Stanford Generative Agents)**: every villager has a memory stream
  (observations, dialogues, reflections, plans), scored retrieval, periodic reflection with
  cited insights, and a daily plan generated each morning.
- **Society (Agentopia)**: four needs that decay (energy, hunger, social, spirit) and can
  preempt the plan (hungry → tavern); directional affection scores (friendships ≥ 60);
  rumors with provenance that hop between villagers during conversations.
- **The seeded emergent event**: only Castellan Seraphine starts knowing that the
  **Harvest Moon Festival** happens on Day 3 at 19:00 in the Market Square. She is seeded
  with the intent to invite everyone. The rumor spreads conversation-by-conversation
  (the chronicle panel tracks who knows). On Day 3 evening, everyone who knows shows up:
  lanterns, music notes, dancing. Information diffusion as visible gameplay.
- **Player verbs**: fly camera (orbit + WASD), click villager → codex panel
  (status, needs, today's plan, memory timeline, relationships, chat tab), follow a villager,
  control time (pause/1×/3×/10×), watch the chronicle feed, read the minimap.
- **Embodied mode (phase 2, after core build)**: the Wanderer as a playable hooded-traveler
  rig — Tab toggles embodied/spectator; WASD walk on the grid (blocked by buildings/trees),
  third-person chase camera, "Press E to speak" proximity prompt opening the codex Speak tab,
  and villagers perceive the Wanderer (observation memories: "a hooded wanderer passed
  through the market"), so reputation accrues as you talk to people.

## 2. Cognition stack (engine-side; see types.ts for exact signatures)

**Memory stream** — `MemoryRecord { id, kind, text, createdMin, lastAccessMin, importance 1-10, subjects[] }`.
Sources: perception (nearby villagers' actions, deduped — same agent+action not re-recorded
within `OBSERVE_DEDUP_MIN`), conversation summaries, reflections, plan summaries, seeded
backstory facts (each persona seed fact = one initial memory).

**Retrieval** (Park et al., exactly): `score = recency + importance + relevance`, each
min-max normalized over candidates. `recency = RECENCY_DECAY ^ gameHoursSinceLastAccess`
(decay 0.995/hr). `importance/10`. `relevance` = lexical cosine over stopword-filtered word
sets (no embeddings — deterministic, offline, testable). Top-k (default 6) bumps lastAccess.

**Importance**: local heuristic (`localImportance`), 1-10: base 3; routine verbs low (walked,
saw, idle ≤ 2); social/emotional/event keywords boost (festival, secret, love, quarrel,
dragon, gift...); dialogue summaries 4-6; reflections 6-8. No LLM call (cost).

**Reflection** (threshold from paper, scaled to our scores): when unreflected importance sum
≥ `REFLECTION_THRESHOLD` (50), take last 40 memories → brain.reflect → 2-3 first-person
insights stored as reflections (importance 6-8). LLM path uses the paper's two-step style in
ONE call (questions + insights). Local fallback: template insights from most-frequent
subjects ("I have spent much of my time with X; they matter to me").

**Planning**: at `PLAN_HOUR` (6:00) each villager gets a daily plan: `PlanStep { startMin
(minutes-since-midnight), durationMin, placeId, activity, emoji }` covering wake → sleep.
LLM path: prompt with persona card + yesterday summary + retrieved memories (incl. festival
rumor if known!) → strict JSON; validated (place ids exist, times ordered) else fallback.
Fallback: persona.routine + seeded jitter ±20min + needs adjustments. Plan stored as a memory.
Festival rule (code-level): if agent knows the festival rumor and day === FESTIVAL_DAY, a
festival step is injected 19:00-22:00 at the market.

**Needs** (0-100, start 70): energy decays waking, restored by sleep; hunger grows, meals at
tavern/home restore; social decays, conversations restore; spirit decays, leisure/work-success
restore. If a need crosses its urgency threshold and the current plan step doesn't address it,
the agent inserts a remedial step (eat/rest/socialize) — LLM not consulted (cost, paper's
"react" loop simplified to deterministic preemption).

**Conversations** (ai-town state machine + batched generation):
- Trigger: two agents within `TALK_RADIUS`, both interruptible, pair cooldown
  `PAIR_TALK_COOLDOWN_MIN` passed, acceptance prob (`INVITE_ACCEPT_PROB` scaled by affection).
- States: `walkingOver` (approach to within `CONVERSATION_DISTANCE`) → `talking` (face each
  other, speech bubbles) → end.
- Generation: ONE brain.converse call returns the whole 4-8 turn transcript + per-participant
  one-line summary + affection delta (-3..+5) (clamped in code — Agentopia pattern). Turns are
  revealed one per `TURN_REVEAL_MIN` game-minutes. Local fallback: template exchange from
  personas, relationship, active rumors.
- Rumor hop (code-level, deterministic): speaker knowing rumors may pass the spiciest with
  prob `RUMOR_SPREAD_PROB`; listener marked as knowing; both get a dialogue memory; the LLM
  prompt is told to mention it (flavor follows mechanics, so diffusion is testable).
- End: both store summary memory; affection updated both directions; chronicle entry emitted.

**Player chat** (philoagents): character card (name, role, traits, current action, retrieved
memories, conversation summary-so-far) + last K turns; ≤80-word replies; after
`CHAT_SUMMARIZE_AFTER` turns the older turns are summarized into the card. The villager
afterwards remembers: "A mysterious wanderer spoke with me about …" (importance 6).

**Lore codex — long-term memory** (Iusztin/Decoding AI's 4-layer agent memory model):
distinct from a villager's own memory stream above (episodic, per-agent, lexical), the vale
keeps one shared, semantic long-term memory: `engine/longTermMemory.ts` chunks and embeds
`data/lore.ts`'s world lore *offline*, once, at world creation (`world.loreMemory`), then
`retrieve(query, k)` embeds the incoming message and cosine-ranks the index *live*. Player
chat (`ui/codex.ts`) merges its top hits into the same `MemoryRecord[]` context already sent
to `brain.chatReply`, so a villager's answer is grounded in the codex, not improvised.
`engine/embeddings.ts` is a dependency-free feature-hashing embedding (no network, no model
weights — same "pull the cable, it still works" rule as LocalBrain), swappable later for a
real embedding model without touching the retrieval or chunking contracts.
`engine/agentMemory.ts` composes the full four layers explicitly for anyone who wants the
whole model at once: internal knowledge (static facts, never mutated) + long-term memory
(above) + short-term memory (rolling turn buffer) → `buildContextWindow(query)`, the exact
slice a caller would hand to an LLM.

**LLM ops never block the tick** (ai-town): `agent.tick()` may schedule at most one async
brain op; while in flight the agent shows 💭 and keeps acting on current plan; results apply
at a later tick via a completion queue; watchdog `OP_TIMEOUT_MS` real-ms clears stuck ops.
Plans/reflections/conversations all flow through this. The game runs perfectly with zero
network (LocalBrain) — the LLM is seasoning, not load-bearing.

## 3. Simulation engine

- Fixed-timestep accumulator inside `requestAnimationFrame`; `world.update(dtSec)` advances
  the clock (`BASE_RATE` game-min per real-sec × speed 0/1/3/10), fires per-game-minute agent
  logic, and per-frame movement interpolation.
- Movement: A* over a `GRID_N×GRID_N` walkability grid (4-connected, min-heap, Manhattan),
  buildings/trees/water block; paths smoothed (string-pulling over line-of-sight); positions
  float world-units; speed `WALK_SPEED` units per game-minute; collision between agents
  ignored (paths repick if destination blocked) — keep it simple, no deadlocks.
- Determinism: seeded RNG (`SIM_SEED`) for all engine randomness; LocalBrain is fully
  deterministic given the rng — tests rely on this.

## 4. The 3D world (art direction)

Low-poly stylized fantasy, rich color, **zero external 3D assets** — everything procedural
from three.js primitives + BufferGeometry. Quality bar: a screenshot should look like a real
indie game, not a tech demo.

- Renderer: ACESFilmic tone mapping, sRGB, PCFSoft shadows (2048 shadow map on the sun),
  fog matched to sky color. No stencil buffer (nothing in the scene uses it). MSAA
  (`antialias`) is only requested below devicePixelRatio 2 — at 2x the supersampling from
  pixel density already smooths edges, so native MSAA on top would double GPU/memory cost
  for negligible extra sharpness.
- Trees/rocks/flowers/mushrooms (nature.ts) are `THREE.InstancedMesh`, not one draw call per
  object — hundreds of props, a handful of draw calls. Decorative props that never cast a
  readable shadow (flower heads, mushroom caps) skip `castShadow` entirely.
- The whole render/UI loop reuses scratch `Vector3`/`Quaternion`/`Color` objects instead of
  allocating per frame (scene.ts, characters.ts, effects.ts) — no GC pressure from the hot path.
  HUD/chronicle text only touches the DOM when the underlying value actually changed
  (change-detection caches in hud.ts); codex/minimap redraw at ~7Hz, not every frame — plenty
  for a human to read, a fraction of the DOM/canvas work.
- Build: `vite.config.ts` splits three.js into its own chunk (it barely changes between
  releases and is ~80% of the bundle) so browsers cache it across deploys instead of
  re-fetching it whenever app code changes. `server.js` gzips responses and marks vite's
  content-hashed `assets/*` immutable for a year, while `index.html` stays `no-cache` so a new
  deploy is always picked up. Fonts are linked from `index.html` (with `preconnect`), not
  `@import`-ed from CSS, so the font fetch starts immediately instead of being discovered only
  after the stylesheet itself downloads and parses.
- Sky: big inverted sphere with vertex-colored gradient updated by time of day (night
  navy→pre-dawn purple→day azure→dusk orange); sun disc + moon disc orbiting; ~600 star
  points fading in at night; ambient + hemisphere + directional sun light all lerping color
  and intensity along the day cycle.
- Terrain: 220×220 plane, gentle simplex-noise hills (flat under buildings/paths), vertex-
  colored grass with meadow variation; dirt paths (flat ribbons) connecting place entrances
  via the market square; a lake (animated water plane: scrolling sine vertex waves, semi-
  transparent, slight emissive at dusk).
- Buildings, distinct silhouettes: castle (towers + crenellations + banner), tavern
  (timber-framed, hanging sign), smithy (open forge with glowing ember light), arcane tower
  (tall cylinder + glowing crystal), temple (columns + dome), farmhouse + windmill (rotating
  blades), herbalist hut (mushroom-ish roof), houses, market stalls with striped awnings,
  stone well. Windows = emissive planes that turn warm-yellow at night. Chimneys emit smoke
  particle puffs.
- Nature: ~120 trees (cone-pine and blob-oak variants), rocks, flower patches, glowing
  mushrooms near the tower; fireflies (drifting points, night only); pollen/dust motes by day.
- Characters: assembled from primitives — body capsule/cone (role-colored tunic), head sphere
  (skin tones), arms/legs that swing while walking, role hats (wizard cone, crown circlet,
  hood, smith's apron, flower crown, mitre); name + emoji status sprite above head (canvas
  texture); speech bubble sprite during conversations; zzz particles when asleep; lying pose
  at home at night. Selected villager gets a soft golden ring under their feet.
- Festival dressing (day 3, 17:00+): lantern strings + bunting around the market, a bonfire,
  music-note particles during the event.

## 5. UI (diegetic fantasy HUD — DOM overlay, not in-canvas)

Fonts: 'Cinzel' (headers) + 'EB Garamond' (body) via Google Fonts. Palette: parchment
(#f0e2c4), ink (#2a2018), gold (#c9a227), deep navy backplate. Ornate borders via CSS
(layered box-shadows / gradient borders) — no image assets.

- **Top center**: carved banner — day counter ("Day 2 of the Harvest Moon"), clock, a sun/moon
  arc dial that tracks dayFraction; speed runes ⏸ ▶ ▶▶ ▶▶▶ (active glows).
- **Left**: chronicle feed — parchment scroll of events ("🗣 Thorin and Bram spoke of the
  festival", "✨ Elara reflected: …"), newest on top, fade after ~30s, hover pauses fade;
  festival-knowledge tracker ("The festival is known to 4 of 9 souls").
- **Right**: codex panel (slides in on villager click) — portrait medallion (procedural canvas
  portrait from their look colors), name + role, current action line, four need bars styled as
  potion vials, tabs: **Soul** (traits, goals, relationships with affection hearts), **Mind**
  (memory timeline, reflections gilded), **Day** (plan steps, current highlighted), **Speak**
  (chat with typewriter reveal, parchment input). Follow 👁 and close buttons.
- **Bottom right**: canvas minimap — terrain blob, place icons, villager dots (look colors),
  selected pulses; click to fly camera.
- **Intro**: cinematic title card ("EVERDAWN VALE — nine souls, one secret festival") over a
  slow camera orbit, "Enter the Vale" button, controls hint card that fades.
- LLM indicator: small rune bottom-left — gold "the vale dreams deeply" when LLM live, silver
  "the vale dreams locally" on fallback.

## 5b. Roadmap (after the core build ships)

1. **v1.1 — Embodied Wanderer**: playable hooded-traveler rig, WASD + collision, third-person
   camera (Tab toggle), "Press E to speak" proximity chat, villagers perceive the player.
2. **v1.2 — Visual upgrade**: replace procedural rigs with rigged GLB models — sourced from
   CC0 packs (Quaternius/KayKit fantasy villagers) and/or built via the **Blender headless
   asset pipeline**: scripted `blender --background --python` jobs (run on the /data VM, no
   GUI needed) that model/refine/rig the nine villagers and export GLBs with skeletal
   walk/idle/sit/sleep/dance clips mapped to sim states, material swaps + hat props per
   villager. Plus post-processing stack (bloom, SSAO, dawn god-rays, color grading).
   Target: reads as a polished Steam indie.
3. **v1.3 — Realism & UI polish**: PBR textures (stone/wood/thatch + normal maps), blended
   terrain, wind-blown instanced grass, reflective water, falling leaves; richer codex UI,
   animated transitions, settings menu, quality presets (low/med/high). Blender pipeline
   extends to buildings/props (hero assets for castle, tavern, tower).
4. **v2.x — Engine port (only if/when a GPU machine exists)**: the browser stays the primary
   target; but the simulation/mind design is engine-agnostic, so a Godot (code-first, web
   export) or Unreal (max fidelity, needs GPU workstation + editor) port of the rendering
   layer is possible later. Decision then, not now — Unreal is a non-starter on the current
   headless 4-core VM.

## 6. LLM integration

- `server/server.js` (express): serves `dist/`, `POST /api/llm {system,user,maxTokens,temperature}`
  → OpenRouter chat completions (key from env, never reaches the browser), 25s timeout,
  ≤4 concurrent (429 otherwise), `GET /api/health → {ok, llm}`. Vite dev proxies `/api`→3001.
- `LlmTransport.complete()` resolves `null` on ANY failure; `createBrain(transport, rng)`
  falls back per-call to LocalBrain. All LLM JSON outputs are validated and clamped; invalid
  → fallback. Model: `OPENROUTER_MODEL` env (default free Llama 3.3 70B).

## 7. File ownership (builder agents write ONLY their files)

| Module | Files |
|---|---|
| engine-core | `src/engine/rng.ts`, `src/engine/events.ts`, `src/engine/time.ts`, `src/engine/grid.ts`, `src/engine/world.ts` |
| cognition | `src/engine/memory.ts`, `src/engine/needs.ts`, `src/engine/planner.ts`, `src/engine/agent.ts`, `src/engine/dialogue.ts`, `src/engine/rumors.ts`, `src/engine/ops.ts` |
| llm | `src/llm/transport.ts`, `src/llm/prompts.ts`, `src/llm/localBrain.ts`, `src/llm/brain.ts`, `server/server.js` |
| scene | `src/three/scene.ts`, `src/three/terrain.ts` |
| village | `src/three/village.ts`, `src/three/nature.ts`, `src/three/effects.ts`, `src/three/festival.ts` |
| characters | `src/three/characters.ts` |
| ui | `src/ui/styles.css`, `src/ui/hud.ts`, `src/ui/chronicle.ts`, `src/ui/codex.ts`, `src/ui/minimap.ts`, `src/ui/intro.ts` |
| tests | `tests/*.test.ts` |
| integrator (main session) | `src/main.ts`, contracts, data |

Conventions: ES modules, TypeScript strict; engine files import NOTHING from three/ui/llm
(only `types.ts`, `constants.ts`, `data/*`, sibling engine files); three/* import three +
types; implement EXACTLY the factory signatures in `types.ts` header comments; no TODOs, no
placeholder stubs; no external asset URLs (Google Fonts CSS in styles.css is the one
exception); every file complete and compiling under `tsc --strict`.
