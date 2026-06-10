/**
 * Everdawn Vale — nature layer: ~120 instanced low-poly trees (pine + oak),
 * rocks, flower clusters and glowing mushrooms near the tower and the grove.
 * Deterministic via an inline mulberry32 (no engine imports). Trees block the
 * walk grid; everything else is decorative.
 */
import * as THREE from 'three'
import type { GamePhase, GridApi, PlaceDef, Vec2 } from '../types'
import { PATH_LINKS } from '../data/places'
import type { LayerApi, SceneCtx } from './contracts'

// ----------------------------------------------------------------- rng

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

// ----------------------------------------------------------------- geometry

/** concatenate transformed geometries into one non-indexed position+normal buffer */
function mergeGeoms(parts: Array<{ geo: THREE.BufferGeometry; m?: THREE.Matrix4 }>): THREE.BufferGeometry {
  const prepped = parts.map(({ geo, m }) => {
    const g = geo.index ? geo.toNonIndexed() : geo.clone()
    if (m) g.applyMatrix4(m)
    geo.dispose()
    return g
  })
  let total = 0
  for (const g of prepped) total += g.attributes.position.count
  const pos = new Float32Array(total * 3)
  const nor = new Float32Array(total * 3)
  let off = 0
  for (const g of prepped) {
    pos.set(g.attributes.position.array as ArrayLike<number>, off * 3)
    nor.set(g.attributes.normal.array as ArrayLike<number>, off * 3)
    off += g.attributes.position.count
    g.dispose()
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  return out
}

function translation(x: number, y: number, z: number): THREE.Matrix4 {
  return new THREE.Matrix4().makeTranslation(x, y, z)
}

interface Placement { x: number; y: number; z: number; rot: number; s: number; hue: number }

function fillInstances(
  mesh: THREE.InstancedMesh, placements: Placement[],
  tint: ((p: Placement, c: THREE.Color) => void) | null,
  squash = 1,
): void {
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const v = new THREE.Vector3()
  const sc = new THREE.Vector3()
  const c = new THREE.Color()
  const up = new THREE.Vector3(0, 1, 0)
  placements.forEach((p, i) => {
    q.setFromAxisAngle(up, p.rot)
    v.set(p.x, p.y, p.z)
    sc.set(p.s, p.s * squash, p.s)
    mesh.setMatrixAt(i, m4.compose(v, q, sc))
    if (tint) {
      tint(p, c)
      mesh.setColorAt(i, c)
    }
  })
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  mesh.castShadow = true
  mesh.receiveShadow = true
}

// ----------------------------------------------------------------- builder

export function buildNature(ctx: SceneCtx, grid: GridApi, places: PlaceDef[], seed: number): LayerApi {
  const rnd = mulberry32(seed ^ 0x5eed)
  const range = (a: number, b: number) => a + (b - a) * rnd()
  const root = new THREE.Group()
  root.name = 'nature'
  ctx.scene.add(root)

  const half = grid.worldSize / 2
  const byId = new Map(places.map((p) => [p.id, p]))
  const grove = byId.get('grove')
  const tower = byId.get('tower')
  const lake = byId.get('lake')

  // path segments (entrance → entrance) used for clearance tests
  const segments: Array<[Vec2, Vec2]> = []
  for (const [aId, bId] of PATH_LINKS) {
    const a = byId.get(aId)
    const b = byId.get(bId)
    if (a && b) segments.push([a.entrance, b.entrance])
  }

  function distToSegment(x: number, z: number, a: Vec2, b: Vec2): number {
    const dx = b.x - a.x
    const dz = b.z - a.z
    const len2 = dx * dx + dz * dz
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2))
    const px = a.x + dx * t
    const pz = a.z + dz * t
    return Math.hypot(x - px, z - pz)
  }

  function nearPath(x: number, z: number, clearance: number): boolean {
    for (const [a, b] of segments) if (distToSegment(x, z, a, b) < clearance) return true
    return false
  }

  /** generic placement rejection used by all scatter passes */
  function blockedAt(x: number, z: number, footMargin: number, doorMargin: number, pathMargin: number, allowGrove: boolean): boolean {
    if (Math.abs(x) > half - 4 || Math.abs(z) > half - 4) return true
    for (const p of places) {
      if (allowGrove && p.kind === 'grove') continue
      if (
        Math.abs(x - p.x) < p.w / 2 + footMargin &&
        Math.abs(z - p.z) < p.d / 2 + footMargin
      ) return true
      if (Math.hypot(x - p.entrance.x, z - p.entrance.z) < doorMargin) return true
    }
    if (lake) {
      const ex = (x - lake.x) / (lake.w / 2 + footMargin)
      const ez = (z - lake.z) / (lake.d / 2 + footMargin)
      if (ex * ex + ez * ez < 1) return true
    }
    return nearPath(x, z, pathMargin)
  }

  // -------------------------------------------------------------- trees

  // pine: trunk + three stacked cones. oak: trunk + leaf blobs.
  const pineTrunkGeo = new THREE.CylinderGeometry(0.18, 0.3, 1.7, 7)
  pineTrunkGeo.translate(0, 0.85, 0)
  const pineFoliageGeo = mergeGeoms([
    { geo: new THREE.ConeGeometry(1.55, 2.3, 8), m: translation(0, 2.25, 0) },
    { geo: new THREE.ConeGeometry(1.18, 2.0, 8), m: translation(0, 3.55, 0) },
    { geo: new THREE.ConeGeometry(0.8, 1.7, 8), m: translation(0, 4.7, 0) },
  ])
  const oakTrunkGeo = new THREE.CylinderGeometry(0.24, 0.38, 2.0, 7)
  oakTrunkGeo.translate(0, 1.0, 0)
  const oakFoliageGeo = mergeGeoms([
    { geo: new THREE.IcosahedronGeometry(1.45, 0), m: translation(0, 3.0, 0) },
    { geo: new THREE.IcosahedronGeometry(1.05, 0), m: translation(0.95, 2.4, 0.4) },
    { geo: new THREE.IcosahedronGeometry(0.92, 0), m: translation(-0.85, 2.55, -0.35) },
    { geo: new THREE.IcosahedronGeometry(0.8, 0), m: translation(0.1, 2.3, -0.95) },
  ])

  const pines: Placement[] = []
  const oaks: Placement[] = []
  const TREE_TARGET = 120
  let attempts = 0
  while (pines.length + oaks.length < TREE_TARGET && attempts < 9000) {
    attempts++
    let x: number
    let z: number
    const roll = rnd()
    if (roll < 0.52) {
      // edge band — forests crowd the rim of the vale
      const side = Math.floor(rnd() * 4)
      const along = range(-(half - 6), half - 6)
      const depth = half - 5 - Math.pow(rnd(), 2.1) * 30
      if (side === 0) { x = along; z = depth }
      else if (side === 1) { x = along; z = -depth }
      else if (side === 2) { x = depth; z = along }
      else { x = -depth; z = along }
    } else if (roll < 0.78 && grove) {
      // the Whisperwood — dense stand in and around the grove
      const a = rnd() * Math.PI * 2
      const r = Math.pow(rnd(), 0.7) * (grove.w / 2 + 7)
      x = grove.x + Math.sin(a) * r
      z = grove.z + Math.cos(a) * r * 0.85
    } else {
      x = range(-(half - 8), half - 8)
      z = range(-(half - 8), half - 8)
    }
    if (blockedAt(x, z, 4, 5, 3, true)) continue
    const inGrove = grove
      ? Math.abs(x - grove.x) < grove.w / 2 + 7 && Math.abs(z - grove.z) < grove.d / 2 + 7
      : false
    const p: Placement = {
      x, z,
      y: ctx.heightAt(x, z) - 0.06,
      rot: rnd() * Math.PI * 2,
      s: range(0.8, 1.5),
      hue: rnd(),
    }
    // oaks favour the grove, pines favour the wild rim
    if (rnd() < (inGrove ? 0.72 : 0.4)) oaks.push(p)
    else pines.push(p)
    grid.blockCircle(x, z, 0.9)
  }

  const barkMat = new THREE.MeshStandardMaterial({ color: '#6e4f2f', roughness: 1 })
  const leafMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95 })
  const pineLeafMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95 })

  const pineTrunks = new THREE.InstancedMesh(pineTrunkGeo, barkMat, pines.length)
  const pineTops = new THREE.InstancedMesh(pineFoliageGeo, pineLeafMat, pines.length)
  const oakTrunks = new THREE.InstancedMesh(oakTrunkGeo, barkMat, oaks.length)
  const oakTops = new THREE.InstancedMesh(oakFoliageGeo, leafMat, oaks.length)
  fillInstances(pineTrunks, pines, null)
  fillInstances(pineTops, pines, (p, c) => c.setHSL(0.36 + p.hue * 0.06, 0.42 + p.hue * 0.1, 0.26 + p.hue * 0.08))
  fillInstances(oakTrunks, oaks, null)
  fillInstances(oakTops, oaks, (p, c) => c.setHSL(0.24 + p.hue * 0.09, 0.5, 0.32 + p.hue * 0.1))
  root.add(pineTrunks, pineTops, oakTrunks, oakTops)

  // -------------------------------------------------------------- rocks

  const rocks: Placement[] = []
  attempts = 0
  while (rocks.length < 25 && attempts < 2500) {
    attempts++
    const nearEdge = rnd() < 0.45
    const x = nearEdge ? (rnd() < 0.5 ? -1 : 1) * range(half - 34, half - 6) : range(-(half - 8), half - 8)
    const z = range(-(half - 8), half - 8)
    if (blockedAt(x, z, 2, 4, 2.5, false)) continue
    rocks.push({ x, z, y: ctx.heightAt(x, z) - 0.15, rot: rnd() * Math.PI * 2, s: range(0.45, 1.5), hue: rnd() })
  }
  const rockGeo = new THREE.DodecahedronGeometry(0.9, 0)
  const rockMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 })
  const rockMesh = new THREE.InstancedMesh(rockGeo, rockMat, rocks.length)
  fillInstances(rockMesh, rocks, (p, c) => c.setHSL(0.08 + p.hue * 0.04, 0.05 + p.hue * 0.06, 0.42 + p.hue * 0.14), 0.62)
  root.add(rockMesh)

  // -------------------------------------------------------------- flowers

  const flowers: Placement[] = []
  attempts = 0
  while (flowers.length < 90 && attempts < 3000) {
    attempts++
    const cx = range(-(half - 12), half - 12)
    const cz = range(-(half - 12), half - 12)
    if (blockedAt(cx, cz, 1.5, 2.5, 2, false)) continue
    const clusterHue = rnd()
    const n = 4 + Math.floor(rnd() * 4)
    for (let i = 0; i < n && flowers.length < 90; i++) {
      const x = cx + range(-2.2, 2.2)
      const z = cz + range(-2.2, 2.2)
      if (blockedAt(x, z, 1, 2, 1.6, false)) continue
      flowers.push({
        x, z,
        y: ctx.heightAt(x, z),
        rot: rnd() * Math.PI * 2,
        s: range(0.75, 1.25),
        hue: clusterHue + rnd() * 0.12,
      })
    }
  }
  const stemGeo = new THREE.CylinderGeometry(0.03, 0.04, 0.4, 5)
  stemGeo.translate(0, 0.2, 0)
  const headGeo = new THREE.IcosahedronGeometry(0.15, 0)
  headGeo.scale(1, 0.75, 1)
  headGeo.translate(0, 0.46, 0)
  const stemMat = new THREE.MeshStandardMaterial({ color: '#4d7a35', roughness: 1 })
  const headMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8 })
  const stems = new THREE.InstancedMesh(stemGeo, stemMat, flowers.length)
  const heads = new THREE.InstancedMesh(headGeo, headMat, flowers.length)
  fillInstances(stems, flowers, null)
  fillInstances(heads, flowers, (p, c) => {
    const h = p.hue % 1
    if (h < 0.3) c.setHSL(0.95, 0.62, 0.68)        // pink
    else if (h < 0.55) c.setHSL(0.13, 0.85, 0.62)  // marigold
    else if (h < 0.8) c.setHSL(0.74, 0.45, 0.66)   // violet
    else c.setHSL(0.0, 0.0, 0.93)                  // white
  })
  stems.castShadow = false
  heads.castShadow = false
  root.add(stems, heads)

  // -------------------------------------------------------------- glowing mushrooms

  const shrooms: Placement[] = []
  const shroomSpots: Array<{ cx: number; cz: number; r: number }> = []
  if (tower) shroomSpots.push({ cx: tower.x, cz: tower.z, r: 13 })
  if (grove) shroomSpots.push({ cx: grove.x, cz: grove.z, r: 10 })
  attempts = 0
  while (shrooms.length < 15 && attempts < 1500) {
    attempts++
    const spot = shroomSpots[attempts % Math.max(1, shroomSpots.length)] ?? { cx: 0, cz: 0, r: 20 }
    const a = rnd() * Math.PI * 2
    const r = range(3, spot.r)
    const x = spot.cx + Math.sin(a) * r
    const z = spot.cz + Math.cos(a) * r
    if (blockedAt(x, z, 1.5, 3, 1.6, true)) continue
    shrooms.push({ x, z, y: ctx.heightAt(x, z), rot: rnd() * Math.PI * 2, s: range(0.7, 1.5), hue: rnd() })
  }
  const shroomStemGeo = new THREE.CylinderGeometry(0.09, 0.14, 0.42, 7)
  shroomStemGeo.translate(0, 0.21, 0)
  const shroomCapGeo = new THREE.ConeGeometry(0.32, 0.34, 9)
  shroomCapGeo.translate(0, 0.55, 0)
  const shroomStemMat = new THREE.MeshStandardMaterial({ color: '#e6dcc4', roughness: 0.9 })
  const shroomCapMat = new THREE.MeshStandardMaterial({
    color: '#9fe8de', emissive: '#4fd6c4', emissiveIntensity: 0.4, roughness: 0.6,
  })
  const shroomStems = new THREE.InstancedMesh(shroomStemGeo, shroomStemMat, shrooms.length)
  const shroomCaps = new THREE.InstancedMesh(shroomCapGeo, shroomCapMat, shrooms.length)
  fillInstances(shroomStems, shrooms, null)
  fillInstances(shroomCaps, shrooms, (p, c) => c.setHSL(0.46 + p.hue * 0.12, 0.6, 0.62))
  shroomStems.castShadow = false
  shroomCaps.castShadow = false
  root.add(shroomStems, shroomCaps)

  // -------------------------------------------------------------- update

  let elapsed = 0
  let glow = 0.4

  function update(dt: number, phase: GamePhase): void {
    elapsed += dt
    const target = phase === 'night' ? 1.5 : phase === 'dusk' ? 0.9 : phase === 'dawn' ? 0.45 : 0.12
    glow += (target - glow) * Math.min(1, dt * 1.6)
    shroomCapMat.emissiveIntensity = glow * (0.85 + 0.15 * Math.sin(elapsed * 1.7))
  }

  return { update }
}
