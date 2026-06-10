/**
 * Everdawn Vale — Harvest Moon Festival dressing for the Market Square.
 * Hidden until the world emits festival:dress (setDressed), then poles, sagging
 * lantern strings, bunting, long tables and an unlit bonfire appear. On
 * festival:start (setActive) the bonfire roars to life, the lanterns brighten
 * and looping music-note sprites rise over the square.
 */
import * as THREE from 'three'
import type { GamePhase, PlaceDef } from '../types'
import type { FestivalVisualApi, SceneCtx } from './contracts'

const FLAG_COLORS = ['#c0392b', '#e6b23a', '#3f8f5f', '#3a6fb3', '#8e44ad', '#d35400', '#2f8f8a']

function noteTexture(glyph: string): THREE.CanvasTexture {
  const cv = document.createElement('canvas')
  cv.width = 64
  cv.height = 64
  const g = cv.getContext('2d')!
  g.clearRect(0, 0, 64, 64)
  g.font = '46px Georgia, serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.shadowColor = 'rgba(255, 196, 90, 0.95)'
  g.shadowBlur = 14
  g.fillStyle = '#ffeab0'
  g.fillText(glyph, 32, 34)
  g.fillText(glyph, 32, 34)
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

interface NoteSprite {
  sprite: THREE.Sprite
  mat: THREE.SpriteMaterial
  x: number
  z: number
  age: number
  life: number
  rise: number
  sway: number
  phase: number
}

export function createFestival(ctx: SceneCtx, market: PlaceDef): FestivalVisualApi {
  const root = new THREE.Group()
  root.name = 'festival'
  root.position.set(market.x, ctx.heightAt(market.x, market.z) - 0.04, market.z)
  root.rotation.y = market.rotY ?? 0
  root.visible = false
  ctx.scene.add(root)

  const wood = new THREE.MeshStandardMaterial({ color: '#6e4f2f', roughness: 0.95 })
  const woodDark = new THREE.MeshStandardMaterial({ color: '#52391f', roughness: 0.95 })
  const lanternMat = new THREE.MeshStandardMaterial({
    color: '#ffd9a0', emissive: '#ffb45e', emissiveIntensity: 0.85, roughness: 0.6,
  })

  const sh = (m: THREE.Mesh): THREE.Mesh => {
    m.castShadow = true
    m.receiveShadow = true
    return m
  }
  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = root, ry = 0): THREE.Mesh => {
    const m = sh(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat))
    m.position.set(x, y, z)
    m.rotation.y = ry
    parent.add(m)
    return m
  }

  // ------------------------------------------------------------ pole ring + strings

  const hx = market.w / 2 - 2
  const hz = market.d / 2 - 2
  const ring: Array<[number, number]> = [
    [-hx, -hz], [-hx, 0], [-hx, hz], [-5, hz], [5, hz],
    [hx, hz], [hx, 0], [hx, -hz], [5, -hz], [-5, -hz],
  ]
  const POLE_TOP = 4.5
  for (const [px, pz] of ring) {
    const pole = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, POLE_TOP, 7), wood))
    pole.position.set(px, POLE_TOP / 2, pz)
    root.add(pole)
    const cap = sh(new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), woodDark))
    cap.position.set(px, POLE_TOP + 0.08, pz)
    root.add(cap)
  }

  const cordMat = new THREE.LineBasicMaterial({ color: '#3a2c1c' })
  const lanternBases: THREE.Vector3[] = []
  const flagBases: Array<{ p: THREE.Vector3; color: THREE.Color }> = []
  const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

  ring.forEach(([ax, az], si) => {
    const [bxp, bzp] = ring[(si + 1) % ring.length]!
    // lantern cord (sagging quadratic curve) + a lower bunting cord
    const mid = v3((ax + bxp) / 2, POLE_TOP - 1.25, (az + bzp) / 2)
    const curve = new THREE.QuadraticBezierCurve3(v3(ax, POLE_TOP, az), mid, v3(bxp, POLE_TOP, bzp))
    const cord = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(16)), cordMat)
    root.add(cord)
    const bMid = v3((ax + bxp) / 2, POLE_TOP - 2.15, (az + bzp) / 2)
    const bCurve = new THREE.QuadraticBezierCurve3(v3(ax, POLE_TOP - 0.9, az), bMid, v3(bxp, POLE_TOP - 0.9, bzp))
    const bCord = new THREE.Line(new THREE.BufferGeometry().setFromPoints(bCurve.getPoints(16)), cordMat)
    root.add(bCord)
    for (let i = 0; i < 8; i++) lanternBases.push(curve.getPoint((i + 1) / 9).add(v3(0, -0.22, 0)))
    for (let i = 0; i < 7; i++) {
      flagBases.push({
        p: bCurve.getPoint((i + 1) / 8),
        color: new THREE.Color(FLAG_COLORS[(si * 3 + i) % FLAG_COLORS.length]!),
      })
    }
  })

  // instanced warm lantern spheres, swaying on their strings
  const lanterns = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 8, 7), lanternMat, lanternBases.length)
  lanterns.castShadow = false
  root.add(lanterns)

  // instanced triangular bunting flags in festive colors
  const flagGeo = new THREE.BufferGeometry()
  flagGeo.setAttribute('position', new THREE.Float32BufferAttribute(
    [-0.3, 0, 0, 0.3, 0, 0, 0, -0.58, 0], 3,
  ))
  flagGeo.computeVertexNormals()
  const flagMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, side: THREE.DoubleSide })
  const flags = new THREE.InstancedMesh(flagGeo, flagMat, flagBases.length)
  flags.castShadow = false
  flagBases.forEach((f, i) => flags.setColorAt(i, f.color))
  if (flags.instanceColor) flags.instanceColor.needsUpdate = true
  root.add(flags)

  // ------------------------------------------------------------ long tables

  function table(x: number, z: number, ry: number): void {
    const t = new THREE.Group()
    t.position.set(x, 0, z)
    t.rotation.y = ry
    root.add(t)
    box(6.4, 0.22, 1.5, wood, 0, 1.02, 0, t)
    box(0.24, 0.95, 1.3, woodDark, -2.6, 0.48, 0, t)
    box(0.24, 0.95, 1.3, woodDark, 2.6, 0.48, 0, t)
    box(6.0, 0.14, 0.42, wood, 0, 0.55, 1.05, t)
    box(6.0, 0.14, 0.42, wood, 0, 0.55, -1.05, t)
    box(0.2, 0.5, 0.38, woodDark, -2.4, 0.25, 1.05, t)
    box(0.2, 0.5, 0.38, woodDark, 2.4, 0.25, 1.05, t)
    box(0.2, 0.5, 0.38, woodDark, -2.4, 0.25, -1.05, t)
    box(0.2, 0.5, 0.38, woodDark, 2.4, 0.25, -1.05, t)
    // feast dressing: mugs, bowls, loaves
    for (let i = 0; i < 4; i++) {
      const mug = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.24, 7), woodDark))
      mug.position.set(-2.1 + i * 1.4, 1.25, i % 2 === 0 ? 0.4 : -0.38)
      t.add(mug)
    }
    for (let i = 0; i < 2; i++) {
      const bowl = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.14, 0.13, 8), wood))
      bowl.position.set(-0.9 + i * 1.8, 1.2, 0)
      t.add(bowl)
    }
    const loaf = sh(new THREE.Mesh(new THREE.SphereGeometry(0.26, 8, 6), new THREE.MeshStandardMaterial({ color: '#c98e4e', roughness: 0.9 })))
    loaf.position.set(0, 1.24, -0.45)
    loaf.scale.set(1.5, 0.7, 0.9)
    t.add(loaf)
  }
  table(-10.5, 2, Math.PI / 2 + 0.12)
  table(10.5, 2, Math.PI / 2 - 0.12)
  table(0, -8, 0.06)

  // ------------------------------------------------------------ bonfire

  const fire = new THREE.Group()
  fire.position.set(0, 0, 5)
  root.add(fire)
  // stone ring + coal bed + leaning log teepee
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    const stone = sh(new THREE.Mesh(new THREE.DodecahedronGeometry(0.32, 0), new THREE.MeshStandardMaterial({ color: '#8a8d92', roughness: 1 })))
    stone.position.set(Math.sin(a) * 2.0, 0.18, Math.cos(a) * 2.0)
    stone.rotation.y = a * 2.3
    stone.scale.y = 0.7
    fire.add(stone)
  }
  const coals = sh(new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.45, 0.2, 12), new THREE.MeshStandardMaterial({ color: '#241a12', roughness: 1 })))
  coals.position.y = 0.1
  fire.add(coals)
  for (let i = 0; i < 6; i++) {
    const lean = new THREE.Group()
    lean.rotation.y = (i / 6) * Math.PI * 2
    fire.add(lean)
    const log = sh(new THREE.Mesh(new THREE.ConeGeometry(0.17, 2.4, 6), woodDark))
    log.position.set(0.78, 1.05, 0)
    log.rotation.z = 0.62
    lean.add(log)
  }

  // layered flame cones (unlit additive — visible only while active)
  const flameGroup = new THREE.Group()
  flameGroup.visible = false
  fire.add(flameGroup)
  const flameSpecs: Array<[number, number, string, number]> = [
    [1.12, 2.7, '#ff7a26', 0.8],
    [0.72, 2.0, '#ffae3a', 0.85],
    [0.4, 1.35, '#ffe27a', 0.95],
  ]
  const flameCones: THREE.Mesh[] = []
  for (const [r, h, color, opacity] of flameSpecs) {
    const m = new THREE.Mesh(
      new THREE.ConeGeometry(r, h, 9),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }),
    )
    m.position.y = h / 2 + 0.28
    flameGroup.add(m)
    flameCones.push(m)
  }
  const emberDisc = new THREE.Mesh(
    new THREE.CylinderGeometry(1.28, 1.28, 0.07, 12),
    new THREE.MeshBasicMaterial({ color: '#ff6a1f', transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }),
  )
  emberDisc.position.y = 0.24
  flameGroup.add(emberDisc)
  const fireLight = new THREE.PointLight(0xff8a3a, 0, 42, 2)
  fireLight.position.set(0, 2.4, 5)
  root.add(fireLight)

  // ------------------------------------------------------------ music notes

  const noteTexA = noteTexture('♪') // ♪
  const noteTexB = noteTexture('♫') // ♫
  const notesGroup = new THREE.Group()
  notesGroup.visible = false
  root.add(notesGroup)
  const notes: NoteSprite[] = []
  const NOTE_N = 12
  for (let i = 0; i < NOTE_N; i++) {
    const mat = new THREE.SpriteMaterial({
      map: i % 2 === 0 ? noteTexA : noteTexB,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    })
    const sprite = new THREE.Sprite(mat)
    sprite.scale.set(1.05, 1.05, 1)
    notesGroup.add(sprite)
    const a = (i / NOTE_N) * Math.PI * 2 + 0.35
    const r = 2.8 + (i % 4) * 1.6
    const life = 3.4 + (i % 3) * 0.5
    notes.push({
      sprite, mat,
      x: Math.sin(a) * r,
      z: 5 + Math.cos(a) * r * 0.9,
      age: (i / NOTE_N) * life,
      life,
      rise: 1.35 + (i % 3) * 0.2,
      sway: 0.35 + (i % 4) * 0.12,
      phase: i * 1.7,
    })
  }

  // ------------------------------------------------------------ state + anim

  let dressed = false
  let active = false
  let t = 0
  let lanternGlow = 0.85
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const e = new THREE.Euler()
  const p = new THREE.Vector3()
  const s = new THREE.Vector3(1, 1, 1)

  function layoutStrings(): void {
    lanternBases.forEach((b, i) => {
      p.set(
        b.x + Math.sin(t * 1.15 + i * 0.62) * 0.13,
        b.y + Math.sin(t * 1.6 + i * 0.9) * 0.035,
        b.z + Math.cos(t * 0.95 + i * 0.47) * 0.1,
      )
      q.identity()
      lanterns.setMatrixAt(i, m4.compose(p, q, s))
    })
    lanterns.instanceMatrix.needsUpdate = true
    flagBases.forEach((f, i) => {
      e.set(Math.sin(t * 2.1 + i * 0.8) * 0.3, Math.sin(t * 1.4 + i * 0.5) * 0.38, 0)
      q.setFromEuler(e)
      flags.setMatrixAt(i, m4.compose(f.p, q, s))
    })
    flags.instanceMatrix.needsUpdate = true
  }
  layoutStrings()

  function setDressed(b: boolean): void {
    dressed = b
    root.visible = b
    if (!b && active) setActive(false)
  }

  function setActive(b: boolean): void {
    active = b
    if (b && !dressed) setDressed(true)
    flameGroup.visible = b
    notesGroup.visible = b
    if (!b) {
      fireLight.intensity = 0
      for (const n of notes) n.mat.opacity = 0
    }
  }

  function update(dt: number, _phase: GamePhase): void {
    t += dt
    const glowTarget = active ? 2.1 : 0.85
    lanternGlow += (glowTarget - lanternGlow) * Math.min(1, dt * 2)
    lanternMat.emissiveIntensity = lanternGlow
    if (!root.visible) return

    layoutStrings()

    if (active) {
      // bonfire: scale + light jitter
      flameCones.forEach((cone, i) => {
        const sy = 1 + 0.17 * Math.sin(t * 12.3 + i * 2.1) + 0.07 * Math.sin(t * 23.7 + i * 0.8)
        const sxz = 1 + 0.1 * Math.sin(t * 9.1 + i * 1.6)
        cone.scale.set(sxz, sy, sxz)
        cone.rotation.y += dt * (0.6 + i * 0.35)
      })
      emberDisc.scale.setScalar(1 + 0.06 * Math.sin(t * 7.3))
      fireLight.intensity = 52 + Math.sin(t * 11.7) * 9 + Math.sin(t * 27.1 + 1.3) * 5
      fireLight.position.y = 2.4 + Math.sin(t * 8.3) * 0.12

      // rising, fading music notes — recycled loop
      for (const n of notes) {
        n.age += dt
        if (n.age >= n.life) n.age -= n.life
        const k = n.age / n.life
        n.sprite.position.set(
          n.x + Math.sin(t * 1.2 + n.phase) * n.sway,
          1.6 + n.rise * n.age,
          n.z + Math.cos(t * 0.9 + n.phase) * n.sway * 0.7,
        )
        n.mat.opacity = Math.sin(Math.min(1, k) * Math.PI) * 0.95
        n.mat.rotation = Math.sin(t * 1.6 + n.phase) * 0.22
      }
    }
  }

  return { setDressed, setActive, update }
}
