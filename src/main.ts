/**
 * Everdawn Vale — bootstrap & game loop.
 * Wires engine ↔ brain ↔ three.js layers ↔ UI per DESIGN.md.
 */
import { PLACES } from './data/places'
import { PERSONAS, RUMOR_SEEDS } from './data/agents'
import { BASE_RATE, SIM_SEED, SPEEDS, TURN_REVEAL_MIN } from './constants'
import { createRng } from './engine/rng'
import { createEventBus } from './engine/events'
import { createWorld } from './engine/world'
import { createTransport, checkHealth } from './llm/transport'
import { createBrain } from './llm/brain'
import { createScene } from './three/scene'
import { buildTerrain } from './three/terrain'
import { buildVillage } from './three/village'
import { buildNature } from './three/nature'
import { createEffects } from './three/effects'
import { createFestival } from './three/festival'
import { createCharacterLayer } from './three/characters'
import { createHud } from './ui/hud'
import { createChronicle } from './ui/chronicle'
import { createCodex } from './ui/codex'
import { createMinimap } from './ui/minimap'
import { createIntro } from './ui/intro'
import { Vector3 } from 'three'
import type { Dialogue, DialogueTurn } from './types'

const canvas = document.getElementById('game') as HTMLCanvasElement
const uiRoot = document.getElementById('ui') as HTMLElement
const loading = document.getElementById('loading') as HTMLElement
const loadingFill = loading?.querySelector('.loading-fill') as HTMLElement | null

function setProgress(p: number) {
  if (loadingFill) loadingFill.style.width = `${Math.round(p * 100)}%`
}

async function init() {
  setProgress(0.05)

  // -- the mind: LLM if the server answers, local templates otherwise --------
  const health = await checkHealth()
  const transport = health.ok && health.llm ? createTransport() : null
  const llmBus = createEventBus()
  const brain = createBrain(transport, createRng(SIM_SEED ^ 0x5eed), llmBus)
  setProgress(0.15)

  // -- the simulation ---------------------------------------------------------
  const world = createWorld({
    places: PLACES,
    personas: PERSONAS,
    rumorSeeds: RUMOR_SEEDS,
    brain,
    seed: SIM_SEED,
  })
  // bridge brain status events onto the world bus (hud listens there)
  llmBus.on('llm:status', (p) => world.bus.emit('llm:status', p))
  world.clock.speed = 0 // hold time until the player enters the vale
  setProgress(0.3)

  // -- the stage ---------------------------------------------------------------
  const scene = createScene(canvas)
  const terrain = buildTerrain(scene, PLACES)
  setProgress(0.5)
  const village = buildVillage(scene, PLACES)
  const nature = buildNature(scene, world.grid, PLACES, SIM_SEED + 1)
  const effects = createEffects(scene, village.chimneys)
  const market = PLACES.find((p) => p.id === 'market')!
  const festival = createFestival(scene, market)
  setProgress(0.7)

  const characters = createCharacterLayer(scene)
  for (const agent of world.agents) characters.add(agent)
  setProgress(0.8)

  // -- the interface ------------------------------------------------------------
  const hud = createHud(uiRoot, world)
  const chronicle = createChronicle(uiRoot, world)
  const codex = createCodex(uiRoot, world, {
    onFollow(agentId) {
      if (!agentId) {
        scene.follow(null)
        return
      }
      const a = world.getAgent(agentId)
      if (a) scene.follow(() => a.pos)
    },
    onFocus(p) {
      scene.focusOn(p)
    },
  })
  const minimap = createMinimap(uiRoot, world, (p) => scene.focusOn(p))
  setProgress(0.9)

  // -- event wiring ---------------------------------------------------------------
  world.bus.on<{ dialogue: Dialogue; turn: DialogueTurn }>('dialogue:turn', ({ turn }) => {
    const secs = Math.min(12, Math.max(3, TURN_REVEAL_MIN / Math.max(1, world.clock.minutesPerSecond())))
    characters.showBubble(turn.speakerId, turn.text, secs)
  })
  world.bus.on('festival:dress', () => festival.setDressed(true))
  world.bus.on('festival:start', () => festival.setActive(true))
  world.bus.on('festival:end', () => {
    festival.setActive(false)
    festival.setDressed(false)
  })

  // picking (click = select villager; drag = camera)
  let downAt: { x: number; y: number } | null = null
  canvas.addEventListener('pointerdown', (e) => {
    downAt = { x: e.clientX, y: e.clientY }
  })
  canvas.addEventListener('pointerup', (e) => {
    if (!downAt) return
    const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y)
    downAt = null
    if (moved > 6) return
    const id = characters.pick(e.clientX, e.clientY)
    if (id) {
      characters.setSelected(id)
      codex.open(id)
    }
  })

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
    const idx = ['1', '2', '3', '4'].indexOf(e.key)
    if (idx >= 0) world.clock.speed = SPEEDS[idx]
    if (e.key === ' ') {
      e.preventDefault()
      world.clock.speed = world.clock.speed === 0 ? 1 : 0
    }
    if (e.key === 'Escape') {
      codex.close()
      characters.setSelected(null)
      scene.follow(null)
    }
  })

  window.addEventListener('resize', () => scene.resize())
  setProgress(1)

  // debug/automation handle (used by scripts/smoke.mjs; harmless in production)
  const proj = new Vector3()
  ;(window as unknown as Record<string, unknown>).__vale = {
    world,
    codex,
    characters,
    scene,
    screenPosOf(id: string) {
      const a = world.getAgent(id)
      if (!a) return null
      proj.set(a.pos.x, 2, a.pos.z).project(scene.camera)
      return {
        x: (proj.x * 0.5 + 0.5) * window.innerWidth,
        y: (-proj.y * 0.5 + 0.5) * window.innerHeight,
        inFront: proj.z < 1,
      }
    },
  }

  // -- loading → intro → run -------------------------------------------------------
  loading.classList.add('done')
  window.setTimeout(() => loading.remove(), 900)
  createIntro(uiRoot, () => {
    world.clock.speed = 1
  })

  // -- main loop ----------------------------------------------------------------------
  let last = performance.now()
  let uiAccum = 0
  function frame(now: number) {
    const dt = Math.min(0.1, Math.max(0.0001, (now - last) / 1000))
    last = now

    world.update(dt)

    const frac = world.clock.dayFraction()
    const phase = world.clock.phase()
    scene.setTimeOfDay(frac, phase)
    terrain.update(dt, phase)
    village.update(dt, phase)
    nature.update(dt, phase)
    effects.update(dt, phase)
    festival.update(dt, phase)
    characters.update(world, dt)
    scene.update(dt)
    scene.renderer.render(scene.scene, scene.camera)

    hud.update()
    chronicle.update(dt)
    uiAccum += dt
    if (uiAccum > 0.15) {
      uiAccum = 0
      codex.update()
      minimap.update()
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

init().catch((err) => {
  console.error('Everdawn Vale failed to awaken:', err)
  const el = document.createElement('div')
  el.style.cssText =
    'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#10131f;color:#e8d9a8;font-family:serif;font-size:18px;z-index:99;text-align:center;padding:2rem'
  el.textContent = 'The vale failed to awaken — check the console. ' + String(err)
  document.body.appendChild(el)
})
