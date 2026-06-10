/**
 * Everdawn Vale — ambient effects layer.
 *  - chimney smoke: recycled, fading sprite puffs rising from every chimney tip
 *  - fireflies: additive points wandering slow sine paths near the grove, the
 *    lake shore and the market fringes — visible only at dusk and night
 *  - pollen motes: faint golden drifters over the meadows by day
 */
import * as THREE from 'three'
import type { GamePhase } from '../types'
import { PLACES } from '../data/places'
import type { LayerApi, SceneCtx, Vector3Like } from './contracts'

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** soft radial blob texture used by smoke puffs and glow points */
function radialTexture(inner: string, outer: string, size = 64): THREE.CanvasTexture {
  const cv = document.createElement('canvas')
  cv.width = size
  cv.height = size
  const g = cv.getContext('2d')!
  const grad = g.createRadialGradient(size / 2, size / 2, 1, size / 2, size / 2, size / 2)
  grad.addColorStop(0, inner)
  grad.addColorStop(0.55, outer)
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

interface Puff {
  sprite: THREE.Sprite
  mat: THREE.SpriteMaterial
  base: Vector3Like
  age: number
  life: number
  rise: number
  driftX: number
  driftZ: number
  phase: number
  size: number
}

interface Wanderer {
  baseX: number
  baseY: number
  baseZ: number
  ampX: number
  ampY: number
  ampZ: number
  fx: number
  fy: number
  fz: number
  px: number
  py: number
  pz: number
  twinkle: number
}

export function createEffects(ctx: SceneCtx, chimneys: Vector3Like[]): LayerApi {
  const rnd = mulberry32(0xeffec75)
  const range = (a: number, b: number) => a + (b - a) * rnd()
  const root = new THREE.Group()
  root.name = 'effects'
  ctx.scene.add(root)

  // ------------------------------------------------------------ chimney smoke

  const smokeTex = radialTexture('rgba(255,255,255,0.85)', 'rgba(235,238,240,0.38)')
  const puffs: Puff[] = []
  chimneys.forEach((tip, ci) => {
    const n = 6 + ((ci * 3 + 1) % 5) // 6..10 puffs per chimney
    for (let i = 0; i < n; i++) {
      const mat = new THREE.SpriteMaterial({
        map: smokeTex,
        color: '#cdd2d6',
        transparent: true,
        opacity: 0,
        depthWrite: false,
        rotation: rnd() * Math.PI * 2,
      })
      const sprite = new THREE.Sprite(mat)
      sprite.position.set(tip.x, tip.y, tip.z)
      root.add(sprite)
      const life = range(4.2, 6.8)
      puffs.push({
        sprite, mat,
        base: tip,
        life,
        age: (i / n) * life, // staggered so the column is continuous
        rise: range(0.75, 1.1),
        driftX: range(0.1, 0.3),
        driftZ: range(-0.12, 0.12),
        phase: rnd() * Math.PI * 2,
        size: range(0.5, 0.75),
      })
    }
  })

  // ------------------------------------------------------------ fireflies

  const market = PLACES.find((p) => p.id === 'market')
  const grove = PLACES.find((p) => p.id === 'grove')
  const lake = PLACES.find((p) => p.id === 'lake')

  const FLY_N = 80
  const flies: Wanderer[] = []
  for (let i = 0; i < FLY_N; i++) {
    const roll = rnd()
    let x = 0
    let z = 0
    if (roll < 0.4 && grove) {
      const a = rnd() * Math.PI * 2
      const r = range(2, grove.w / 2 + 8)
      x = grove.x + Math.sin(a) * r
      z = grove.z + Math.cos(a) * r * 0.8
    } else if (roll < 0.75 && lake) {
      // shoreline ring just beyond the water
      const a = rnd() * Math.PI * 2
      const f = range(1.04, 1.35)
      x = lake.x + Math.sin(a) * (lake.w / 2) * f
      z = lake.z + Math.cos(a) * (lake.d / 2) * f
    } else if (market) {
      const a = rnd() * Math.PI * 2
      const r = range(market.w / 2, market.w / 2 + 7)
      x = market.x + Math.sin(a) * r
      z = market.z + Math.cos(a) * r * 0.85
    }
    x = Math.max(-104, Math.min(104, x))
    z = Math.max(-104, Math.min(104, z))
    flies.push({
      baseX: x,
      baseY: ctx.heightAt(x, z) + range(0.6, 2.4),
      baseZ: z,
      ampX: range(1.2, 3.2),
      ampY: range(0.3, 0.9),
      ampZ: range(1.2, 3.2),
      fx: range(0.16, 0.42),
      fy: range(0.5, 1.1),
      fz: range(0.16, 0.42),
      px: rnd() * Math.PI * 2,
      py: rnd() * Math.PI * 2,
      pz: rnd() * Math.PI * 2,
      twinkle: range(1.6, 3.4),
    })
  }
  const flyGeo = new THREE.BufferGeometry()
  const flyPos = new Float32Array(FLY_N * 3)
  const flyCol = new Float32Array(FLY_N * 3)
  flies.forEach((f, i) => {
    flyPos[i * 3] = f.baseX
    flyPos[i * 3 + 1] = f.baseY
    flyPos[i * 3 + 2] = f.baseZ
  })
  flyGeo.setAttribute('position', new THREE.BufferAttribute(flyPos, 3).setUsage(THREE.DynamicDrawUsage))
  flyGeo.setAttribute('color', new THREE.BufferAttribute(flyCol, 3).setUsage(THREE.DynamicDrawUsage))
  const flyMat = new THREE.PointsMaterial({
    size: 0.5,
    map: radialTexture('rgba(255,255,210,1)', 'rgba(200,255,120,0.5)', 32),
    vertexColors: true,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  const flyPoints = new THREE.Points(flyGeo, flyMat)
  flyPoints.frustumCulled = false
  root.add(flyPoints)
  const flyColor = new THREE.Color('#d9f57a')

  // ------------------------------------------------------------ pollen motes

  const POLLEN_N = 50
  const motes: Wanderer[] = []
  for (let i = 0; i < POLLEN_N; i++) {
    const a = rnd() * Math.PI * 2
    const r = Math.sqrt(rnd()) * 72
    const x = Math.sin(a) * r
    const z = 8 + Math.cos(a) * r * 0.85
    motes.push({
      baseX: x,
      baseY: ctx.heightAt(x, z) + range(0.5, 3.0),
      baseZ: z,
      ampX: range(2, 5),
      ampY: range(0.4, 1.2),
      ampZ: range(2, 5),
      fx: range(0.05, 0.16),
      fy: range(0.2, 0.5),
      fz: range(0.05, 0.16),
      px: rnd() * Math.PI * 2,
      py: rnd() * Math.PI * 2,
      pz: rnd() * Math.PI * 2,
      twinkle: range(0.5, 1.3),
    })
  }
  const moteGeo = new THREE.BufferGeometry()
  const motePos = new Float32Array(POLLEN_N * 3)
  motes.forEach((m, i) => {
    motePos[i * 3] = m.baseX
    motePos[i * 3 + 1] = m.baseY
    motePos[i * 3 + 2] = m.baseZ
  })
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3).setUsage(THREE.DynamicDrawUsage))
  const moteMat = new THREE.PointsMaterial({
    size: 0.24,
    color: '#ffe9b0',
    map: radialTexture('rgba(255,240,200,1)', 'rgba(255,225,160,0.4)', 32),
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  const motePoints = new THREE.Points(moteGeo, moteMat)
  motePoints.frustumCulled = false
  root.add(motePoints)

  // ------------------------------------------------------------ update

  let t = 0

  function update(dt: number, phase: GamePhase): void {
    t += dt

    // smoke — recycled puffs: rise, drift on the breeze, swell and fade
    for (const p of puffs) {
      p.age += dt
      if (p.age >= p.life) p.age -= p.life
      const a = p.age
      const k = a / p.life
      p.sprite.position.set(
        p.base.x + Math.sin(t * 0.7 + p.phase) * 0.22 + p.driftX * a * 1.4,
        p.base.y + 0.15 + p.rise * a,
        p.base.z + Math.cos(t * 0.55 + p.phase) * 0.18 + p.driftZ * a * 1.4,
      )
      const grow = p.size * (0.55 + k * 2.3)
      p.sprite.scale.set(grow, grow, 1)
      const fadeIn = Math.min(1, a / 0.6)
      p.mat.opacity = 0.42 * fadeIn * Math.pow(1 - k, 1.35)
    }

    // fireflies — only glow through dusk and night
    const flyTarget = phase === 'night' ? 0.95 : phase === 'dusk' ? 0.7 : 0
    flyMat.opacity += (flyTarget - flyMat.opacity) * Math.min(1, dt * 1.5)
    if (flyMat.opacity > 0.02) {
      const pos = flyGeo.attributes.position as THREE.BufferAttribute
      const col = flyGeo.attributes.color as THREE.BufferAttribute
      for (let i = 0; i < flies.length; i++) {
        const f = flies[i]!
        pos.setXYZ(
          i,
          f.baseX + Math.sin(t * f.fx + f.px) * f.ampX,
          f.baseY + Math.sin(t * f.fy + f.py) * f.ampY,
          f.baseZ + Math.sin(t * f.fz + f.pz) * f.ampZ,
        )
        const tw = Math.sin(t * f.twinkle + f.px)
        const b = 0.35 + 0.65 * tw * tw
        col.setXYZ(i, flyColor.r * b, flyColor.g * b, flyColor.b * b)
      }
      pos.needsUpdate = true
      col.needsUpdate = true
    }

    // pollen — faint golden motes adrift by day
    const moteTarget = phase === 'day' ? 0.34 : phase === 'dawn' ? 0.2 : phase === 'dusk' ? 0.08 : 0
    moteMat.opacity += (moteTarget - moteMat.opacity) * Math.min(1, dt * 1.2)
    if (moteMat.opacity > 0.02) {
      const pos = moteGeo.attributes.position as THREE.BufferAttribute
      for (let i = 0; i < motes.length; i++) {
        const m = motes[i]!
        pos.setXYZ(
          i,
          m.baseX + Math.sin(t * m.fx + m.px) * m.ampX + Math.sin(t * 0.045) * 3,
          m.baseY + Math.sin(t * m.fy + m.py) * m.ampY,
          m.baseZ + Math.sin(t * m.fz + m.pz) * m.ampZ,
        )
      }
      pos.needsUpdate = true
    }
  }

  return { update }
}
