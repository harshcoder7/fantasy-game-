/**
 * Everdawn Vale — bottom-right canvas minimap (DESIGN.md §5).
 * Terrain tint, lake blob, place glyphs, villager dots in tunic colors
 * (the codex-selected villager pulses); clicking flies the camera.
 */
import type { PlaceDef, PlaceKind, Vec2, WorldApi } from '../types'
import { WORLD_SIZE } from '../constants'
import { codexSelectedAgentId } from './codex'

const SIZE = 200

const GLYPH: Record<PlaceKind, string> = {
  castle: '▲',
  tavern: '◆',
  forge: '⚒',
  market: '▣',
  tower: '◍',
  temple: '✚',
  farm: '▦',
  farmhouse: '⌂',
  windmill: '✳',
  house: '⌂',
  hut: '⌂',
  well: '◌',
  lake: '',
  grove: '♣',
}

const toMap = (x: number, z: number): { mx: number; my: number } => ({
  mx: ((x + WORLD_SIZE / 2) / WORLD_SIZE) * SIZE,
  my: ((z + WORLD_SIZE / 2) / WORLD_SIZE) * SIZE,
})

const scale = (worldUnits: number): number => (worldUnits / WORLD_SIZE) * SIZE

/** tiny deterministic LCG so the meadow mottling is identical every load */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

function paintBackground(ctx: CanvasRenderingContext2D, places: PlaceDef[]): void {
  // meadow base
  const base = ctx.createLinearGradient(0, 0, SIZE, SIZE)
  base.addColorStop(0, '#8fae66')
  base.addColorStop(0.55, '#7fa05c')
  base.addColorStop(1, '#6e9152')
  ctx.fillStyle = base
  ctx.fillRect(0, 0, SIZE, SIZE)

  // soft sunlit center
  const light = ctx.createRadialGradient(SIZE / 2, SIZE / 2, 14, SIZE / 2, SIZE / 2, SIZE * 0.72)
  light.addColorStop(0, 'rgba(240, 226, 196, 0.20)')
  light.addColorStop(1, 'rgba(30, 40, 22, 0.22)')
  ctx.fillStyle = light
  ctx.fillRect(0, 0, SIZE, SIZE)

  // deterministic meadow mottling
  const rnd = lcg(0xeda57)
  for (let i = 0; i < 46; i++) {
    const x = rnd() * SIZE
    const y = rnd() * SIZE
    const r = 4 + rnd() * 11
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(104, 134, 74, 0.30)' : 'rgba(158, 182, 112, 0.26)'
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }

  // soft footprints for the open grounds, then the lake blob
  for (const p of places) {
    const { mx, my } = toMap(p.x, p.z)
    const rw = scale(p.w) / 2
    const rd = scale(p.d) / 2
    if (p.kind === 'lake') {
      ctx.fillStyle = 'rgba(38, 74, 104, 0.55)'
      ctx.beginPath()
      ctx.ellipse(mx - rw * 0.18, my + rd * 0.12, rw * 0.8, rd * 0.78, 0.35, 0, Math.PI * 2)
      ctx.fill()
      const water = ctx.createRadialGradient(mx - 3, my - 3, 2, mx, my, Math.max(rw, rd))
      water.addColorStop(0, '#6fa3c8')
      water.addColorStop(0.6, '#4a7da6')
      water.addColorStop(1, '#2e5b84')
      ctx.fillStyle = water
      ctx.beginPath()
      ctx.ellipse(mx, my, rw, rd, -0.2, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = 'rgba(22, 46, 68, 0.7)'
      ctx.lineWidth = 1
      ctx.stroke()
    } else if (p.kind === 'grove') {
      ctx.fillStyle = 'rgba(52, 88, 44, 0.5)'
      ctx.beginPath()
      ctx.ellipse(mx, my, rw, rd, 0, 0, Math.PI * 2)
      ctx.fill()
    } else if (p.kind === 'farm') {
      ctx.fillStyle = 'rgba(190, 158, 76, 0.42)'
      ctx.beginPath()
      ctx.ellipse(mx, my, rw, rd, 0, 0, Math.PI * 2)
      ctx.fill()
    } else if (p.kind === 'market') {
      ctx.fillStyle = 'rgba(205, 180, 134, 0.5)'
      ctx.beginPath()
      ctx.ellipse(mx, my, rw, rd, 0, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // place glyphs with a parchment halo for readability
  for (const p of places) {
    const glyph = GLYPH[p.kind]
    if (!glyph) continue
    const { mx, my } = toMap(p.x, p.z)
    const major = p.kind === 'castle' || p.kind === 'market'
    ctx.font = `${major ? 'bold 11px' : '9px'} Georgia, serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineWidth = 2.4
    ctx.strokeStyle = 'rgba(240, 226, 196, 0.75)'
    ctx.strokeText(glyph, mx, my)
    ctx.fillStyle = p.kind === 'castle' ? '#8a6f1d' : '#2a2018'
    ctx.fillText(glyph, mx, my)
  }

  // inner parchment vignette on the map itself
  const edge = ctx.createRadialGradient(SIZE / 2, SIZE / 2, SIZE * 0.42, SIZE / 2, SIZE / 2, SIZE * 0.74)
  edge.addColorStop(0, 'rgba(60, 44, 18, 0)')
  edge.addColorStop(1, 'rgba(60, 44, 18, 0.35)')
  ctx.fillStyle = edge
  ctx.fillRect(0, 0, SIZE, SIZE)
}

export function createMinimap(
  root: HTMLElement,
  world: WorldApi,
  onClickWorld: (p: Vec2) => void,
): { update(): void } {
  const frame = document.createElement('div')
  frame.className = 'minimap parchment'
  const label = document.createElement('div')
  label.className = 'minimap-label'
  label.textContent = 'Everdawn Vale'
  frame.appendChild(label)

  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const canvas = document.createElement('canvas')
  canvas.width = SIZE * dpr
  canvas.height = SIZE * dpr
  canvas.title = 'Click to fly there'
  frame.appendChild(canvas)
  root.appendChild(frame)

  const ctx = canvas.getContext('2d')

  // static background painted once to an offscreen canvas
  const bg = document.createElement('canvas')
  bg.width = SIZE * dpr
  bg.height = SIZE * dpr
  const bctx = bg.getContext('2d')
  if (bctx) {
    bctx.scale(dpr, dpr)
    paintBackground(bctx, world.places)
  }

  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect()
    const mx = ((e.clientX - rect.left) / rect.width) * SIZE
    const my = ((e.clientY - rect.top) / rect.height) * SIZE
    const half = WORLD_SIZE / 2
    const p: Vec2 = {
      x: Math.max(-half + 2, Math.min(half - 2, (mx / SIZE) * WORLD_SIZE - half)),
      z: Math.max(-half + 2, Math.min(half - 2, (my / SIZE) * WORLD_SIZE - half)),
    }
    onClickWorld(p)
  })

  function update(): void {
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, SIZE, SIZE)
    ctx.drawImage(bg, 0, 0, SIZE, SIZE)

    const selectedId = codexSelectedAgentId()
    const pulse = 4.5 + Math.sin(performance.now() / 170) * 1.6

    for (const a of world.agents) {
      const { mx, my } = toMap(a.pos.x, a.pos.z)
      const isSelected = a.persona.id === selectedId

      if (isSelected) {
        ctx.strokeStyle = 'rgba(230, 200, 78, 0.9)'
        ctx.lineWidth = 1.6
        ctx.beginPath()
        ctx.arc(mx, my, pulse, 0, Math.PI * 2)
        ctx.stroke()
        ctx.fillStyle = 'rgba(230, 200, 78, 0.22)'
        ctx.beginPath()
        ctx.arc(mx, my, pulse, 0, Math.PI * 2)
        ctx.fill()
      }

      ctx.fillStyle = a.persona.look.tunic
      ctx.strokeStyle = 'rgba(18, 13, 6, 0.85)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(mx, my, isSelected ? 3.4 : 2.8, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
  }

  update()
  return { update }
}
