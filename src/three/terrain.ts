/**
 * three/terrain.ts — vertex-colored terrain (deterministic value-noise hills,
 * flat building pads, dirt path ribbons, sandy lake bowl) plus the animated
 * water plane. Installs ctx.heightAt so every other layer can sit on the land.
 * See DESIGN.md §4 and three/contracts.ts.
 */
import * as THREE from 'three'
import { PATH_LINKS } from '../data/places'
import type { GamePhase, PlaceDef } from '../types'
import type { LayerApi, SceneCtx } from './contracts'

// ---------------------------------------------------------------- constants
const TERRAIN_SIZE = 220
const TERRAIN_SEGS = 110
const NOISE_AMP = 2.4
const NOISE_F1 = 1 / 26 // ~26-unit hills
const NOISE_F2 = 1 / 13 // second octave, half wavelength
const PLACE_MARGIN = 3 // flat to footprint + this
const PLACE_RAMP = 6 // hills return over this band beyond the margin
const PATH_HALF = 2.5 // flat corridor half-width around path segments
const PATH_RAMP = 3
const LAKE_DEPTH = -1.4
const BANK_HEIGHT = 0.3 // low grassy berm ringing the lake keeps the water edge buried
const WATER_Y = -0.55

// lake radial bands (in normalized ellipse distance, 1 = footprint edge)
const LAKE_BED_END = 0.7 // fully -1.4 inside this
const LAKE_RISE_BAND = 0.48 // bed → bank crest over this band
const LAKE_PLATEAU_END = 1.5 // bank crest held to here (covers the water plane corners)
const LAKE_BLEND_BAND = 0.5 // crest → open meadow over this band

// ---------------------------------------------------------------- deterministic noise
const smooth01 = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t))

/** integer-lattice hash → [0,1); Math.imul keeps it exact and portable */
function hash2(ix: number, iz: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/** bilinear value noise with smoothstep fade, range [0,1] */
function vnoise(x: number, z: number): number {
  const ix = Math.floor(x)
  const iz = Math.floor(z)
  const fx = x - ix
  const fz = z - iz
  const ux = fx * fx * (3 - 2 * fx)
  const uz = fz * fz * (3 - 2 * fz)
  const a = hash2(ix, iz)
  const b = hash2(ix + 1, iz)
  const c = hash2(ix, iz + 1)
  const d = hash2(ix + 1, iz + 1)
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz
}

/** two octaves, range [0,1] */
function fbm2(x: number, z: number): number {
  return (
    (vnoise(x * NOISE_F1 + 13.37, z * NOISE_F1 + 7.77) +
      0.5 * vnoise(x * NOISE_F2 + 101.31, z * NOISE_F2 + 47.93)) / 1.5
  )
}

/** distance from point to segment, 2D */
function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax
  const dz = bz - az
  const len2 = dx * dx + dz * dz
  let t = len2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  const qx = ax + dx * t - px
  const qz = az + dz * t - pz
  return Math.sqrt(qx * qx + qz * qz)
}

// ---------------------------------------------------------------- factory
export function buildTerrain(ctx: SceneCtx, places: PlaceDef[]): LayerApi {
  // -- flattening shapes -------------------------------------------------------
  interface FlatRect { cx: number; cz: number; hw: number; hd: number }
  const flatRects: FlatRect[] = places
    .filter((p) => p.kind !== 'lake') // the lake has its own bowl profile
    .map((p) => ({ cx: p.x, cz: p.z, hw: p.w / 2 + PLACE_MARGIN, hd: p.d / 2 + PLACE_MARGIN }))

  const byId = new Map(places.map((p) => [p.id, p]))
  const segs: Array<{ ax: number; az: number; bx: number; bz: number }> = []
  for (const [aId, bId] of PATH_LINKS) {
    const a = byId.get(aId)
    const b = byId.get(bId)
    if (a && b) segs.push({ ax: a.entrance.x, az: a.entrance.z, bx: b.entrance.x, bz: b.entrance.z })
  }

  const lake = places.find((p) => p.kind === 'lake')
  const lakeX = lake ? lake.x : 0
  const lakeZ = lake ? lake.z : 0
  const lakeA = lake ? lake.w / 2 : 1
  const lakeB = lake ? lake.d / 2 : 1

  /** normalized ellipse distance from the lake center (1 = footprint edge) */
  const lakeDist = (x: number, z: number): number => {
    const dx = (x - lakeX) / lakeA
    const dz = (z - lakeZ) / lakeB
    return Math.sqrt(dx * dx + dz * dz)
  }

  const pathDist = (x: number, z: number): number => {
    let d = Infinity
    for (const s of segs) {
      const v = segDist(x, z, s.ax, s.az, s.bx, s.bz)
      if (v < d) d = v
    }
    return d
  }

  /**
   * The single continuous height rule, used for the mesh AND exported via
   * ctx.heightAt: 2-octave value-noise hills (±2.4), flattened to 0 within any
   * place footprint +3 (smooth 6-unit skirt) and within 2.5 units of any path
   * segment (smooth 3-unit skirt); the lake is a -1.4 bowl with a smooth bank.
   */
  const heightAt = (x: number, z: number): number => {
    let flat = 1
    for (const r of flatRects) {
      const dx = Math.max(Math.abs(x - r.cx) - r.hw, 0)
      const dz = Math.max(Math.abs(z - r.cz) - r.hd, 0)
      flat = Math.min(flat, smooth01(Math.sqrt(dx * dx + dz * dz) / PLACE_RAMP))
      if (flat === 0) break
    }
    if (flat > 0) flat = Math.min(flat, smooth01((pathDist(x, z) - PATH_HALF) / PATH_RAMP))
    let h = (fbm2(x, z) - 0.5) * (NOISE_AMP * 2) * flat
    if (lake) {
      const d = lakeDist(x, z)
      if (d < LAKE_PLATEAU_END + LAKE_BLEND_BAND) {
        const bowl = LAKE_DEPTH + (BANK_HEIGHT - LAKE_DEPTH) * smooth01((d - LAKE_BED_END) / LAKE_RISE_BAND)
        h = d <= LAKE_PLATEAU_END
          ? bowl
          : BANK_HEIGHT + (h - BANK_HEIGHT) * smooth01((d - LAKE_PLATEAU_END) / LAKE_BLEND_BAND)
      }
    }
    return h
  }

  ctx.heightAt = heightAt

  // -- terrain mesh -------------------------------------------------------------
  const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGS, TERRAIN_SEGS)
  geo.rotateX(-Math.PI / 2)
  const pos = geo.attributes.position as THREE.BufferAttribute
  const colors = new Float32Array(pos.count * 3)

  const col = new THREE.Color()
  const grass = new THREE.Color(0x5d9e4f)
  const grassLight = new THREE.Color(0x79b85c)
  const grassDark = new THREE.Color(0x4f8f49)
  const dirt = new THREE.Color(0xa98a5b)
  const sand = new THREE.Color(0xc8b06a)
  const lakeBed = new THREE.Color(0x7c6a45)

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    pos.setY(i, heightAt(x, z))

    // meadow: base grass drifting into light/dark patches, with fine lightness grain
    col.copy(grass)
    const patch = vnoise(x * 0.045 + 71.3, z * 0.045 - 13.7)
    if (patch > 0.58) col.lerp(grassLight, smooth01((patch - 0.58) / 0.2))
    else if (patch < 0.42) col.lerp(grassDark, smooth01((0.42 - patch) / 0.2))
    col.multiplyScalar(0.88 + 0.24 * vnoise(x * 0.21 - 5.2, z * 0.21 + 9.4)) // ±12%

    // lake bed mud and the sandy shoreline ring
    if (lake) {
      const d = lakeDist(x, z)
      if (d < LAKE_PLATEAU_END) {
        const bed = 1 - smooth01((d - 0.5) / 0.38)
        if (bed > 0) col.lerp(lakeBed, bed)
        const ring = smooth01((d - 0.7) / 0.18) * (1 - smooth01((d - 1.22) / 0.25))
        if (ring > 0) col.lerp(sand, ring)
      }
    }

    // dirt corridors with noise-roughened edges
    const pd = pathDist(x, z) + (vnoise(x * 0.5 + 33.1, z * 0.5 - 71.7) - 0.5) * 1.6
    const dirtT = 1 - smooth01((pd - 2.1) / 1.9)
    if (dirtT > 0) col.lerp(dirt, dirtT)

    colors[i * 3] = col.r
    colors[i * 3 + 1] = col.g
    colors[i * 3 + 2] = col.b
  }
  pos.needsUpdate = true
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.computeVertexNormals()

  const terrain = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }),
  )
  terrain.name = 'terrain'
  terrain.receiveShadow = true
  ctx.scene.add(terrain)

  // -- water --------------------------------------------------------------------
  let waterGeo: THREE.PlaneGeometry | null = null
  let waterMat: THREE.MeshStandardMaterial | null = null
  let waterBase: Float32Array | null = null
  if (lake) {
    waterGeo = new THREE.PlaneGeometry(54, 40, 28, 20)
    waterGeo.rotateX(-Math.PI / 2)
    const wp = waterGeo.attributes.position as THREE.BufferAttribute
    waterBase = new Float32Array(wp.count * 2)
    for (let i = 0; i < wp.count; i++) {
      waterBase[i * 2] = wp.getX(i)
      waterBase[i * 2 + 1] = wp.getZ(i)
    }
    waterMat = new THREE.MeshStandardMaterial({
      color: 0x2f7d9e,
      transparent: true,
      opacity: 0.82,
      roughness: 0.15,
      metalness: 0.1,
      emissive: 0x1a3f55,
      emissiveIntensity: 0,
    })
    const water = new THREE.Mesh(waterGeo, waterMat)
    water.name = 'water'
    water.position.set(lake.x, WATER_Y, lake.z)
    water.receiveShadow = true
    ctx.scene.add(water)
  }

  // -- per-frame: two crossed traveling waves + dusk/night glow -------------------
  let waveT = 0
  return {
    update(dtSec: number, phase: GamePhase): void {
      if (!waterGeo || !waterMat || !waterBase) return
      waveT += dtSec
      const wp = waterGeo.attributes.position as THREE.BufferAttribute
      for (let i = 0; i < wp.count; i++) {
        const wx = waterBase[i * 2]
        const wz = waterBase[i * 2 + 1]
        wp.setY(
          i,
          Math.sin(wx * 0.42 + waveT * 1.25) * 0.065 +
            Math.sin(wz * 0.55 - wx * 0.21 + waveT * 0.85) * 0.048,
        )
      }
      wp.needsUpdate = true
      waterGeo.computeVertexNormals()
      const normal = waterGeo.attributes.normal as THREE.BufferAttribute
      normal.needsUpdate = true

      const glow = phase === 'dusk' || phase === 'night' ? 0.6 : 0
      waterMat.emissiveIntensity += (glow - waterMat.emissiveIntensity) * Math.min(1, dtSec * 2.5)
    },
  }
}
