# 🌕 Everdawn Vale

**A 3D fantasy life-simulation in the browser.** Nine villagers live fully autonomous lives —
they wake, work, eat, gossip, reflect, and sleep in a hand-built low-poly fantasy vale with a
full day/night cycle. Their minds run on the **Generative Agents** architecture (memory stream
→ scored retrieval → reflection → daily planning → emergent dialogue), and only one of them
knows a secret: *the Harvest Moon Festival happens on Day 3.* Watch the news spread,
conversation by conversation, until the whole village gathers under the lanterns.

Built from the research up:

- **Generative Agents** (Park et al., Stanford 2023, [arXiv:2304.03442](https://arxiv.org/abs/2304.03442)) —
  memory stream, recency·importance·relevance retrieval (decay 0.995), reflection with insights,
  hierarchical daily plans, and the seeded-intent emergent event (their Valentine's party → our festival).
- **Agentopia** (Wang et al. 2026, [arXiv:2606.07513](https://arxiv.org/abs/2606.07513)) — needs with
  decay that make villagers *want* things, affection-based relationships, rumor provenance,
  LLM-proposes / code-clamps state changes.
- **ai-town** (a16z-infra) — async LLM operations that never block the simulation tick,
  the conversation state machine (walk-over → talk → part), the playtested cooldown lattice.
- **philoagents** (neural-maze) — character-card prompts, summarize-when-long player chat,
  typewriter dialogue UX.

## Quick start

```bash
npm install
npm run dev        # vite (5173) + LLM proxy server (3001)
```

Open http://localhost:5173 and **Enter the Vale**.

Production build:

```bash
npm run build      # typecheck + bundle to dist/
npm start          # serves dist/ + /api on :3001
```

Tests (engine is pure TypeScript — the whole simulation runs headless, including a
3-game-day festival-emergence test):

```bash
npm test
```

## The mind of a villager

Every game-minute each villager: perceives nearby villagers (→ observation memories, deduped),
decays needs (energy/hunger/social/spirit — urgent needs preempt the plan), follows their daily
plan, and may start a conversation (proximity + affection-scaled acceptance + cooldowns). Heavy
cognition (planning at 6:00, reflection past an importance threshold, whole conversations,
player chat) runs as **async brain ops** that never stall the 60fps world — villagers show 💭
while thinking.

The brain is two-layered:

- **LLM brain** — your OpenRouter key, via the local proxy (`server/server.js`), with a model
  fallback chain (`OPENROUTER_MODELS` in `.env`). All outputs are JSON-validated and clamped;
  anything invalid falls through.
- **Local brain** — deterministic seeded templates for every faculty. Pull the network cable
  and the vale keeps living.

## Controls

| Input | Action |
|---|---|
| Drag / scroll / right-drag | Orbit · zoom · pan |
| Click a villager | Open their codex (soul, mind, day, **speak**) |
| `1` `2` `3` `4` | Pause / 1× / 3× / 10× time |
| `Space` | Pause toggle |
| `Esc` | Close codex / stop following |
| Minimap click | Fly there |

## Configuration (`.env`)

```
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODELS=moonshotai/kimi-k2.6:free,openai/gpt-oss-120b:free,...
PORT=3001
```

No key? Delete it — the vale dreams locally.

## Layout

```
src/engine/   pure simulation (node-testable): clock, grid/A*, memory, needs,
              rumors, planner, agent, dialogue, ops, world
src/llm/      transport, prompts, local brain, LLM brain
src/three/    scene/sky/lighting, terrain/water, village, nature, effects,
              festival, characters — 100% procedural, zero asset files
src/ui/       fantasy HUD: clock dial, chronicle, codex, minimap, intro
server/       express: static dist + /api/llm OpenRouter proxy (key stays server-side)
tests/        vitest suites incl. the 3-day emergence simulation
```
