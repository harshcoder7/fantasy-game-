/**
 * three/characters.ts — the nine souls in the flesh. Procedural primitive rigs
 * (legs, tunic torso, swinging arms, head, hair, role hats), walk/idle/sleep
 * animation, overhead name+emoji sprites, 💭 thinking blink, "Z z" sleep
 * sprites, parchment speech bubbles, golden selection ring and click picking.
 * See DESIGN.md §4 and three/contracts.ts.
 */
import * as THREE from 'three'
import type { AgentApi, CharacterLook, HatKind, WorldApi } from '../types'
import type { CharacterLayerApi, SceneCtx } from './contracts'

// ---------------------------------------------------------------- tuning
const HALF_PI = Math.PI / 2
const SS = 2 // canvas supersampling for crisp text
const PX2W = 1 / 76 // speech-bubble pixels → world units
const NAME_H = 0.62 // name plate world height
const THINK_H = 0.54
const ZZZ_H = 0.56
const FONT_BODY = '"EB Garamond", Georgia, "Times New Roman", serif'
const NAME_FONT_PX = 30
const BUBBLE_FONT_PX = 26
const BUBBLE_WRAP_CHARS = 26
const BUBBLE_MAX_LINES = 3
const FADE_NEAR = 55 // name sprite fully visible inside this camera distance
const FADE_FAR = 130 // …and fully faded beyond this
const TURN_RATE = 8 // facing lerp per second (shortest arc)
const SLEEP_RATE = 2.4 // lie-down / get-up smoothing per second
const WALK_SWING_LEG = 0.62 // radians of hip swing at full stride
const WALK_SWING_ARM = 0.5
const ARM_SPLAY = 0.09 // resting outward arm angle
const HEAD_Y = 1.72 // head-group height inside the rig (scale 1)
const BOB_AMP = 0.05
const LIE_LIFT = 0.34 // torso radius — keeps a lying body on the grass

// ---------------------------------------------------------------- helpers
const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t)
const mix = (a: number, b: number, t: number): number => a + (b - a) * t
const smooth01 = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t))
const smoothRange = (e0: number, e1: number, x: number): number => smooth01((x - e0) / (e1 - e0))

/** wrap an angle difference into [-π, π) for shortest-arc turning */
function wrapPi(a: number): number {
  const t = (a + Math.PI) % (Math.PI * 2)
  return (t < 0 ? t + Math.PI * 2 : t) - Math.PI
}

function roundRectPath(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2)
  c.beginPath()
  c.moveTo(x + rr, y)
  c.lineTo(x + w - rr, y)
  c.arcTo(x + w, y, x + w, y + rr, rr)
  c.lineTo(x + w, y + h - rr)
  c.arcTo(x + w, y + h, x + w - rr, y + h, rr)
  c.lineTo(x + rr, y + h)
  c.arcTo(x, y + h, x, y + h - rr, rr)
  c.lineTo(x, y + rr)
  c.arcTo(x, y, x + rr, y, rr)
  c.closePath()
}

/** word-wrap to ~maxChars per line, at most maxLines (last line ellipsised) */
function wrapLines(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ')
  const lines: string[] = []
  let cur = ''
  for (const word of words) {
    let w = word
    if (!w) continue
    while (w.length > maxChars) {
      // hard-break monster words with a hyphen
      if (cur) {
        lines.push(cur)
        cur = ''
      }
      lines.push(w.slice(0, maxChars - 1) + '-')
      w = w.slice(maxChars - 1)
    }
    if (!cur) cur = w
    else if (cur.length + 1 + w.length <= maxChars) cur += ' ' + w
    else {
      lines.push(cur)
      cur = w
    }
  }
  if (cur) lines.push(cur)
  if (lines.length === 0) lines.push('…')
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines)
    const trimmed = kept[maxLines - 1].replace(/[\s.,;:!?'"-]+$/u, '')
    kept[maxLines - 1] = (trimmed.length >= maxChars ? trimmed.slice(0, maxChars - 1) : trimmed) + '…'
    return kept
  }
  return lines
}

// ---------------------------------------------------------------- shared geometry / materials
function buildGeos() {
  return {
    leg: new THREE.BoxGeometry(0.17, 0.52, 0.19),
    boot: new THREE.BoxGeometry(0.2, 0.095, 0.26),
    torso: new THREE.CapsuleGeometry(0.32, 0.46, 6, 14),
    belt: new THREE.CylinderGeometry(0.34, 0.34, 0.07, 16),
    arm: new THREE.CapsuleGeometry(0.078, 0.34, 5, 10),
    hand: new THREE.SphereGeometry(0.07, 10, 8),
    head: new THREE.SphereGeometry(0.27, 20, 14),
    eye: new THREE.SphereGeometry(0.027, 8, 6),
    hair: new THREE.SphereGeometry(0.292, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.58),
    hitbox: new THREE.CylinderGeometry(0.78, 0.78, 2.5, 10),
    // hats
    wizardCone: new THREE.ConeGeometry(0.27, 0.62, 14),
    wizardBrim: new THREE.CylinderGeometry(0.46, 0.46, 0.035, 20),
    wizardBand: new THREE.CylinderGeometry(0.276, 0.286, 0.07, 14),
    circlet: new THREE.TorusGeometry(0.252, 0.026, 8, 28).rotateX(HALF_PI),
    hoodDome: new THREE.SphereGeometry(0.315, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.62),
    cowl: new THREE.CylinderGeometry(0.3, 0.42, 0.36, 14),
    capDome: new THREE.SphereGeometry(0.29, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5),
    capBrim: new THREE.CylinderGeometry(0.16, 0.16, 0.028, 14).scale(1.45, 1, 1.15),
    flowerBand: new THREE.TorusGeometry(0.262, 0.022, 8, 24).rotateX(HALF_PI),
    blossom: new THREE.SphereGeometry(0.05, 8, 6),
    mitre: new THREE.ConeGeometry(0.27, 0.52, 4, 1).rotateY(Math.PI / 4).scale(1, 1, 0.62),
    mitreBand: new THREE.CylinderGeometry(0.275, 0.285, 0.085, 12).scale(1, 1, 0.66),
    orb: new THREE.SphereGeometry(0.045, 8, 6),
    // selection ring
    ringTorus: new THREE.TorusGeometry(0.68, 0.05, 10, 40).rotateX(HALF_PI),
    ringGlow: new THREE.CircleGeometry(0.64, 32).rotateX(-HALF_PI),
  }
}
type Geos = ReturnType<typeof buildGeos>

function buildSharedMats() {
  return {
    belt: new THREE.MeshStandardMaterial({ color: 0x3b2c1b, roughness: 0.9, metalness: 0.05 }),
    eye: new THREE.MeshStandardMaterial({ color: 0x22150e, roughness: 0.4, metalness: 0 }),
    gold: new THREE.MeshStandardMaterial({
      color: 0xd9b545, metalness: 0.85, roughness: 0.3, emissive: new THREE.Color(0x2c1f05),
    }),
    leafBand: new THREE.MeshStandardMaterial({ color: 0x3f6b3a, roughness: 0.9, metalness: 0 }),
    cream: new THREE.MeshStandardMaterial({ color: 0xf2e6c0, roughness: 0.8, metalness: 0 }),
    hitbox: new THREE.MeshBasicMaterial(),
  }
}
type SharedMats = ReturnType<typeof buildSharedMats>

/** extra clearance the name plate needs above the head, per hat */
function hatPad(kind: HatKind): number {
  switch (kind) {
    case 'wizard': return 0.5
    case 'mitre': return 0.42
    case 'cap': return 0.12
    case 'hood': return 0.1
    case 'flower': return 0.12
    case 'circlet': return 0.08
    case 'none': return 0
  }
  return 0
}

// ---------------------------------------------------------------- hats
function buildHat(look: CharacterLook, head: THREE.Group, G: Geos, shared: SharedMats): void {
  const kind = look.hat
  if (kind === 'none') return
  const base = new THREE.Color(look.hatColor)
  const hatMat = new THREE.MeshStandardMaterial({ color: base, roughness: 0.82, metalness: 0.04 })
  const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat)
    m.position.set(x, y, z)
    m.castShadow = true
    head.add(m)
    return m
  }
  switch (kind) {
    case 'wizard': {
      // wide brim + tall cone with a darker band, tilted a touch for charm
      mk(G.wizardBrim, hatMat, 0, 0.165, 0)
      const cone = mk(G.wizardCone, hatMat, 0, 0.475, 0)
      cone.rotation.z = 0.07
      const bandMat = new THREE.MeshStandardMaterial({
        color: base.clone().multiplyScalar(0.55), roughness: 0.85, metalness: 0.05,
      })
      mk(G.wizardBand, bandMat, 0, 0.215, 0)
      break
    }
    case 'circlet': {
      // thin metallic circle resting on the brow
      const mat = new THREE.MeshStandardMaterial({
        color: base, metalness: 0.88, roughness: 0.26, emissive: new THREE.Color(0x332405),
      })
      mk(G.circlet, mat, 0, 0.125, 0)
      break
    }
    case 'hood': {
      // dome over the crown + cowl draping to the shoulders
      mk(G.hoodDome, hatMat, 0, 0.015, 0)
      mk(G.cowl, hatMat, 0, -0.33, 0)
      break
    }
    case 'cap': {
      // soft dome with a short oval brim out front
      mk(G.capDome, hatMat, 0, 0.055, 0)
      mk(G.capBrim, hatMat, 0, 0.085, 0.255)
      break
    }
    case 'flower': {
      // leafy band ringed with alternating blossoms
      mk(G.flowerBand, shared.leafBand, 0, 0.145, 0)
      const altMat = new THREE.MeshStandardMaterial({
        color: base.clone().offsetHSL(0.05, 0.04, 0.14), roughness: 0.8, metalness: 0,
      })
      const mats = [hatMat, altMat, shared.cream]
      for (let i = 0; i < 7; i++) {
        const ang = (i / 7) * Math.PI * 2
        mk(G.blossom, mats[i % 3], Math.cos(ang) * 0.262, 0.148, Math.sin(ang) * 0.262)
      }
      break
    }
    case 'mitre': {
      // tall flattened wedge with a gold band and a dawn-orb at the peak
      mk(G.mitre, hatMat, 0, 0.46, 0)
      mk(G.mitreBand, shared.gold, 0, 0.235, 0)
      mk(G.orb, shared.gold, 0, 0.73, 0)
      break
    }
  }
}

// ---------------------------------------------------------------- rig assembly
interface RigParts {
  root: THREE.Group
  rig: THREE.Group
  legL: THREE.Group
  legR: THREE.Group
  armL: THREE.Group
  armR: THREE.Group
  torso: THREE.Mesh
  head: THREE.Group
  hitbox: THREE.Mesh
}

function buildRig(look: CharacterLook, G: Geos, shared: SharedMats): RigParts {
  const std = (color: THREE.ColorRepresentation, roughness = 0.85): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.04 })

  const root = new THREE.Group()
  const rig = new THREE.Group()
  rig.rotation.order = 'YXZ' // yaw first, then tip over to lie down in the facing frame
  rig.scale.setScalar(look.scale)
  root.add(rig)

  const tunicMat = std(look.tunic)
  const skinMat = std(look.skin, 0.72)
  const hairMat = std(look.hair, 0.92)
  const legMat = std(look.legs)
  const bootMat = std(new THREE.Color(look.legs).multiplyScalar(0.5), 0.95)

  const mk = (
    geo: THREE.BufferGeometry, mat: THREE.Material,
    x: number, y: number, z: number, parent: THREE.Object3D,
  ): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat)
    m.position.set(x, y, z)
    m.castShadow = true
    parent.add(m)
    return m
  }

  // legs — box shins with little boots, pivoted at the hip so they can swing
  const mkLeg = (side: 1 | -1): THREE.Group => {
    const pivot = new THREE.Group()
    pivot.position.set(side * 0.115, 0.52, 0)
    mk(G.leg, legMat, 0, -0.26, 0, pivot)
    mk(G.boot, bootMat, 0, -0.467, 0.035, pivot)
    rig.add(pivot)
    return pivot
  }
  const legL = mkLeg(1)
  const legR = mkLeg(-1)

  // torso — tunic capsule with a leather belt (belt rides the breathing scale)
  const torso = mk(G.torso, tunicMat, 0, 0.94, 0, rig)
  mk(G.belt, shared.belt, 0, -0.16, 0, torso)

  // arms — sleeve capsules pivoted at the shoulders, skin hands at the cuffs
  const mkArm = (side: 1 | -1): THREE.Group => {
    const pivot = new THREE.Group()
    pivot.position.set(side * 0.4, 1.36, 0)
    pivot.rotation.z = side * ARM_SPLAY
    mk(G.arm, tunicMat, 0, -0.21, 0, pivot)
    mk(G.hand, skinMat, 0, -0.45, 0, pivot)
    rig.add(pivot)
    return pivot
  }
  const armL = mkArm(1)
  const armR = mkArm(-1)

  // head — skin sphere, hair cap, eyes, and the role hat
  const head = new THREE.Group()
  head.position.set(0, HEAD_Y, 0)
  rig.add(head)
  mk(G.head, skinMat, 0, 0, 0, head)
  const hair = mk(G.hair, hairMat, 0, 0.02, -0.015, head)
  hair.rotation.x = 0.08
  const eyeL = mk(G.eye, shared.eye, 0.09, 0.03, 0.245, head)
  eyeL.castShadow = false
  const eyeR = mk(G.eye, shared.eye, -0.09, 0.03, 0.245, head)
  eyeR.castShadow = false
  buildHat(look, head, G, shared)

  // fat invisible cylinder for picking (raycaster ignores visibility)
  const hitbox = new THREE.Mesh(G.hitbox, shared.hitbox)
  hitbox.position.y = 1.2
  hitbox.visible = false
  rig.add(hitbox)

  return { root, rig, legL, legR, armL, armR, torso, head, hitbox }
}

// ---------------------------------------------------------------- canvas sprites
interface CanvasTex {
  canvas: HTMLCanvasElement
  c2d: CanvasRenderingContext2D
  tex: THREE.CanvasTexture
}

function configureTex(tex: THREE.CanvasTexture): THREE.CanvasTexture {
  tex.colorSpace = THREE.SRGBColorSpace
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = false
  return tex
}

function makeCanvasTex(): CanvasTex {
  const canvas = document.createElement('canvas')
  canvas.width = 2
  canvas.height = 2
  const c2d = canvas.getContext('2d')!
  const tex = configureTex(new THREE.CanvasTexture(canvas))
  return { canvas, c2d, tex }
}

function makeSpriteMat(map: THREE.Texture): THREE.SpriteMaterial {
  return new THREE.SpriteMaterial({
    map, transparent: true, depthWrite: false, toneMapped: false, fog: false, opacity: 1,
  })
}

/** shared 💭 texture */
function buildThinkTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 112
  canvas.height = 112
  const c = canvas.getContext('2d')!
  c.font = '88px "Segoe UI Emoji", "Noto Color Emoji", "Apple Color Emoji", serif'
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  c.fillText('💭', 56, 62)
  return configureTex(new THREE.CanvasTexture(canvas))
}

/** shared "Z z" sleep texture — three drowsy letters drifting up to the right */
function buildZzzTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const c = canvas.getContext('2d')!
  const draw = (s: string, px: number, x: number, y: number, alpha: number): void => {
    c.font = `italic 700 ${px}px Georgia, serif`
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.lineWidth = Math.max(3, px * 0.12)
    c.lineJoin = 'round'
    c.strokeStyle = `rgba(20, 26, 48, ${0.85 * alpha})`
    c.fillStyle = `rgba(233, 239, 255, ${alpha})`
    c.strokeText(s, x, y)
    c.fillText(s, x, y)
  }
  draw('Z', 56, 44, 88, 1)
  draw('z', 38, 84, 52, 0.85)
  draw('z', 26, 107, 26, 0.7)
  return configureTex(new THREE.CanvasTexture(canvas))
}

// ---------------------------------------------------------------- per-agent record
interface NameRec extends CanvasTex {
  sprite: THREE.Sprite
  mat: THREE.SpriteMaterial
  lastText: string
}

interface BubbleRec extends CanvasTex {
  sprite: THREE.Sprite
  mat: THREE.SpriteMaterial
  ttl: number
  total: number
}

interface SpriteRec {
  sprite: THREE.Sprite
  mat: THREE.SpriteMaterial
}

interface CharRecord {
  agent: AgentApi
  root: THREE.Group
  rig: THREE.Group
  legL: THREE.Group
  legR: THREE.Group
  armL: THREE.Group
  armR: THREE.Group
  torso: THREE.Mesh
  head: THREE.Group
  hitbox: THREE.Mesh
  hatLift: number
  name: NameRec
  think: SpriteRec
  zzz: SpriteRec
  bubble: BubbleRec
  prevX: number
  prevZ: number
  speed: number
  walkAmt: number
  phase: number
  sleepT: number
  yaw: number
  t0: number
}

// ---------------------------------------------------------------- drawing
function redrawName(n: NameRec, text: string): void {
  const { canvas, c2d, tex } = n
  const font = `600 ${NAME_FONT_PX}px ${FONT_BODY}`
  c2d.font = font
  const tw = Math.ceil(c2d.measureText(text).width)
  const w = Math.max(64, tw + 40)
  const h = 52
  canvas.width = w * SS
  canvas.height = h * SS
  c2d.setTransform(SS, 0, 0, SS, 0, 0)
  c2d.clearRect(0, 0, w, h)
  c2d.font = font
  // dark plaque with a gilded edge
  roundRectPath(c2d, 2.5, 2.5, w - 5, h - 5, 14)
  c2d.fillStyle = 'rgba(13, 17, 30, 0.68)'
  c2d.fill()
  c2d.lineWidth = 2
  c2d.strokeStyle = 'rgba(217, 181, 90, 0.75)'
  c2d.stroke()
  c2d.textAlign = 'center'
  c2d.textBaseline = 'middle'
  c2d.shadowColor = 'rgba(0, 0, 0, 0.6)'
  c2d.shadowBlur = 4
  c2d.fillStyle = '#f2e7cb'
  c2d.fillText(text, w / 2, h / 2 + 1)
  c2d.shadowBlur = 0
  tex.needsUpdate = true
  n.lastText = text
  n.sprite.scale.set(NAME_H * (w / h), NAME_H, 1)
}

function drawBubble(b: BubbleRec, text: string): void {
  const lines = wrapLines(text, BUBBLE_WRAP_CHARS, BUBBLE_MAX_LINES)
  const { canvas, c2d, tex } = b
  const font = `500 ${BUBBLE_FONT_PX}px ${FONT_BODY}`
  c2d.font = font
  let maxW = 90
  for (const ln of lines) maxW = Math.max(maxW, Math.ceil(c2d.measureText(ln).width))
  const pad = 18
  const lineH = 33
  const tail = 17
  const w = maxW + pad * 2
  const bodyH = lines.length * lineH + pad * 2 - 8
  const h = bodyH + tail
  canvas.width = w * SS
  canvas.height = h * SS
  c2d.setTransform(SS, 0, 0, SS, 0, 0)
  c2d.clearRect(0, 0, w, h)
  c2d.font = font

  // parchment body
  const grad = c2d.createLinearGradient(0, 0, 0, bodyH)
  grad.addColorStop(0, '#f8eed6')
  grad.addColorStop(1, '#e9d8b2')
  roundRectPath(c2d, 2, 2, w - 4, bodyH - 4, 13)
  c2d.fillStyle = grad
  c2d.fill()
  c2d.lineWidth = 2.5
  c2d.strokeStyle = '#7a5f33'
  c2d.stroke()
  // faint inner highlight, like a worn page edge
  roundRectPath(c2d, 5.5, 5.5, w - 11, bodyH - 11, 9)
  c2d.lineWidth = 1.2
  c2d.strokeStyle = 'rgba(255, 250, 232, 0.55)'
  c2d.stroke()

  // little tail pointing down at the speaker
  const cx = w / 2
  c2d.beginPath()
  c2d.moveTo(cx - 11, bodyH - 4)
  c2d.lineTo(cx, h - 2)
  c2d.lineTo(cx + 11, bodyH - 4)
  c2d.closePath()
  c2d.fillStyle = '#ead9b4'
  c2d.fill()
  c2d.beginPath()
  c2d.moveTo(cx - 11, bodyH - 3)
  c2d.lineTo(cx, h - 2)
  c2d.lineTo(cx + 11, bodyH - 3)
  c2d.lineWidth = 2.5
  c2d.strokeStyle = '#7a5f33'
  c2d.stroke()

  // ink
  c2d.fillStyle = '#2b2014'
  c2d.textAlign = 'center'
  c2d.textBaseline = 'middle'
  for (let i = 0; i < lines.length; i++) {
    c2d.fillText(lines[i], w / 2, pad - 4 + lineH * i + lineH / 2)
  }

  tex.needsUpdate = true
  b.sprite.scale.set(w * PX2W, h * PX2W, 1)
}

// ---------------------------------------------------------------- factory
export function createCharacterLayer(ctx: SceneCtx): CharacterLayerApi {
  const G = buildGeos()
  const shared = buildSharedMats()
  const thinkTex = buildThinkTexture()
  const zzzTex = buildZzzTexture()

  const records = new Map<string, CharRecord>()
  const hitboxes: THREE.Mesh[] = []
  let selectedId: string | null = null
  let elapsed = 0

  // soft golden selection ring — flat torus + additive glow disc
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xeec45e, transparent: true, opacity: 0.7, depthWrite: false, toneMapped: false,
  })
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0xffd76a, transparent: true, opacity: 0.18, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide,
  })
  const ringGroup = new THREE.Group()
  const ringTorus = new THREE.Mesh(G.ringTorus, ringMat)
  ringTorus.renderOrder = 4
  const ringGlow = new THREE.Mesh(G.ringGlow, glowMat)
  ringGlow.position.y = -0.005
  ringGlow.renderOrder = 3
  ringGroup.add(ringTorus, ringGlow)
  ringGroup.visible = false
  ctx.scene.add(ringGroup)

  // once the fantasy webfonts arrive, repaint every name plate with them
  if (typeof document !== 'undefined' && document.fonts) {
    void document.fonts.ready.then(() => {
      for (const rec of records.values()) rec.name.lastText = ' '
    })
  }

  function add(agent: AgentApi): void {
    const id = agent.persona.id
    if (records.has(id)) return
    const look = agent.persona.look
    const parts = buildRig(look, G, shared)
    parts.root.position.set(agent.pos.x, ctx.heightAt(agent.pos.x, agent.pos.z), agent.pos.z)
    parts.rig.rotation.y = agent.facing
    parts.hitbox.userData.agentId = id
    hitboxes.push(parts.hitbox)

    const lift = hatPad(look.hat)

    // name plaque
    const nameTex = makeCanvasTex()
    const nameMat = makeSpriteMat(nameTex.tex)
    const nameSprite = new THREE.Sprite(nameMat)
    nameSprite.renderOrder = 20
    nameSprite.position.set(0, (2.42 + lift) * look.scale, 0)
    nameSprite.scale.set(NAME_H * 3, NAME_H, 1)
    nameSprite.visible = false
    parts.root.add(nameSprite)

    // 💭 (visible only while a brain op is in flight)
    const thinkMat = makeSpriteMat(thinkTex)
    const thinkSprite = new THREE.Sprite(thinkMat)
    thinkSprite.renderOrder = 21
    thinkSprite.scale.set(THINK_H, THINK_H, 1)
    thinkSprite.visible = false
    parts.root.add(thinkSprite)

    // "Z z" (visible only while asleep)
    const zzzMat = makeSpriteMat(zzzTex)
    const zzzSprite = new THREE.Sprite(zzzMat)
    zzzSprite.renderOrder = 21
    zzzSprite.scale.set(ZZZ_H, ZZZ_H, 1)
    zzzSprite.visible = false
    parts.root.add(zzzSprite)

    // speech bubble — bottom-anchored so the tail points at the name plate
    const bubbleTex = makeCanvasTex()
    const bubbleMat = makeSpriteMat(bubbleTex.tex)
    const bubbleSprite = new THREE.Sprite(bubbleMat)
    bubbleSprite.center.set(0.5, 0)
    bubbleSprite.renderOrder = 22
    bubbleSprite.visible = false
    parts.root.add(bubbleSprite)

    records.set(id, {
      agent,
      root: parts.root,
      rig: parts.rig,
      legL: parts.legL,
      legR: parts.legR,
      armL: parts.armL,
      armR: parts.armR,
      torso: parts.torso,
      head: parts.head,
      hitbox: parts.hitbox,
      hatLift: lift,
      name: { ...nameTex, sprite: nameSprite, mat: nameMat, lastText: ' ' },
      think: { sprite: thinkSprite, mat: thinkMat },
      zzz: { sprite: zzzSprite, mat: zzzMat },
      bubble: { ...bubbleTex, sprite: bubbleSprite, mat: bubbleMat, ttl: 0, total: 0 },
      prevX: agent.pos.x,
      prevZ: agent.pos.z,
      speed: 0,
      walkAmt: 0,
      phase: records.size * 1.31,
      sleepT: agent.asleep ? 1 : 0,
      yaw: agent.facing,
      t0: records.size * 1.73,
    })
    ctx.scene.add(parts.root)
  }

  function update(_world: WorldApi, dtSec: number): void {
    const dt = Math.max(1e-4, Math.min(0.1, dtSec))
    elapsed += dt
    if (elapsed > 1e6) elapsed -= 1e6
    const camPos = ctx.camera.position

    for (const rec of records.values()) {
      const a = rec.agent
      const sc = a.persona.look.scale
      const px = a.pos.x
      const pz = a.pos.z
      const tt = elapsed + rec.t0

      // ---- measured speed → walk amount (covers every clock speed, incl. pause)
      const rawSpeed = Math.min(40, Math.hypot(px - rec.prevX, pz - rec.prevZ) / dt)
      rec.prevX = px
      rec.prevZ = pz
      rec.speed = mix(rec.speed, rawSpeed, Math.min(1, dt * 9))
      rec.walkAmt = mix(rec.walkAmt, clamp01(rec.speed / 8), Math.min(1, dt * 6))

      // ---- sleep pose blends in and out smoothly
      rec.sleepT = mix(rec.sleepT, a.asleep ? 1 : 0, Math.min(1, dt * SLEEP_RATE))
      const sleepE = smooth01(rec.sleepT)
      const drowsing = sleepE > 0.5

      // ---- facing: shortest-arc lerp, then tip over to lie face-up when asleep
      rec.yaw += wrapPi(a.facing - rec.yaw) * Math.min(1, dt * TURN_RATE)
      rec.rig.rotation.y = rec.yaw
      rec.rig.rotation.x = -HALF_PI * sleepE
      rec.rig.rotation.z = 0.05 * sleepE

      // ---- stride: phase scaled by real ground speed, swing fades while lying
      rec.phase += Math.min(rec.speed, 20) * 0.85 * dt
      if (rec.phase > 1e4) rec.phase %= Math.PI * 2
      const wa = rec.walkAmt * (1 - sleepE)
      const swing = Math.sin(rec.phase) * wa
      rec.legL.rotation.x = swing * WALK_SWING_LEG
      rec.legR.rotation.x = -swing * WALK_SWING_LEG
      rec.armL.rotation.x = -swing * WALK_SWING_ARM
      rec.armR.rotation.x = swing * WALK_SWING_ARM

      // ---- breathing: quick and shallow idle, slow and deep asleep
      const idleAmt = 1 - wa
      const br = Math.sin(tt * (drowsing ? 1.25 : 2.3))
      const breath = br * (drowsing ? 0.05 : 0.03) * idleAmt
      rec.torso.scale.set(1 - br * 0.012 * idleAmt, 1 + breath, 1 - br * 0.012 * idleAmt)
      rec.head.position.y = HEAD_Y + br * 0.013 * idleAmt
      const armSway = Math.sin(tt * 1.7) * 0.025 * idleAmt
      rec.armL.rotation.z = ARM_SPLAY + armSway
      rec.armR.rotation.z = -ARM_SPLAY - armSway

      // ---- grounding: terrain height + stride bob + lie-down lift
      const bob = wa * BOB_AMP * (0.5 + 0.5 * Math.cos(rec.phase * 2))
      rec.root.position.set(px, ctx.heightAt(px, pz), pz)
      rec.rig.position.y = (bob + LIE_LIFT * sleepE) * sc

      // ---- overhead sprites -------------------------------------------------
      const dist = camPos.distanceTo(rec.root.position)
      const fade = 1 - smoothRange(FADE_NEAR, FADE_FAR, dist)
      const seen = fade > 0.02

      const emoji = a.action ? a.action.emoji : ''
      const label = emoji ? `${emoji} ${a.persona.name}` : a.persona.name
      if (label !== rec.name.lastText) redrawName(rec.name, label)
      const nameY = mix((2.42 + rec.hatLift) * sc, 1.18 * sc, sleepE)
      rec.name.sprite.position.y = nameY
      rec.name.mat.opacity = 0.95 * fade
      rec.name.sprite.visible = seen

      if (a.thinking() && seen) {
        const blink = 0.5 + 0.5 * Math.sin(tt * 4.8)
        rec.think.sprite.visible = true
        rec.think.sprite.position.set(0.55 * sc, nameY + 0.62 + 0.05 * Math.sin(tt * 2.2), 0)
        rec.think.mat.opacity = (0.18 + 0.78 * blink * blink) * fade
        const ts = THINK_H * (0.92 + 0.1 * blink)
        rec.think.sprite.scale.set(ts, ts, 1)
      } else {
        rec.think.sprite.visible = false
      }

      if (sleepE > 0.35 && seen) {
        rec.zzz.sprite.visible = true
        rec.zzz.sprite.position.set(
          0.3 + 0.06 * Math.sin(tt * 1.05),
          nameY + 0.55 + 0.14 * Math.sin(tt * 1.5),
          0,
        )
        const pulse = 0.5 + 0.5 * Math.sin(tt * 2.1)
        rec.zzz.mat.opacity = (0.45 + 0.4 * pulse) * fade * smoothRange(0.35, 0.8, sleepE)
        const zs = ZZZ_H * (1 + 0.08 * Math.sin(tt * 2.1))
        rec.zzz.sprite.scale.set(zs, zs, 1)
      } else {
        rec.zzz.sprite.visible = false
      }

      // ---- speech bubble lifecycle (real seconds; fade in → hold → fade out)
      if (rec.bubble.ttl > 0) {
        rec.bubble.ttl -= dt
        if (rec.bubble.ttl <= 0) {
          rec.bubble.sprite.visible = false
        } else {
          const shown = rec.bubble.total - rec.bubble.ttl
          rec.bubble.mat.opacity = 0.97 * smoothRange(0, 0.28, shown) * smoothRange(0, 0.45, rec.bubble.ttl)
          rec.bubble.sprite.position.y = nameY + 0.46 + 0.05 * Math.sin(tt * 2.5)
          rec.bubble.sprite.visible = true
        }
      }
    }

    // ---- pulsing golden ring under the selected villager ----------------------
    const sel = selectedId ? records.get(selectedId) : undefined
    if (sel) {
      const a = sel.agent
      ringGroup.visible = true
      ringGroup.position.set(a.pos.x, ctx.heightAt(a.pos.x, a.pos.z) + 0.09, a.pos.z)
      const pulse = Math.sin(elapsed * 3.4)
      const rs = (1 + 0.06 * pulse) * a.persona.look.scale
      ringGroup.scale.set(rs, 1, rs)
      ringMat.opacity = 0.55 + 0.22 * pulse
      glowMat.opacity = 0.14 + 0.07 * pulse
    } else {
      ringGroup.visible = false
    }
  }

  function pick(clientX: number, clientY: number): string | null {
    if (hitboxes.length === 0) return null
    const hits = ctx.raycastFromScreen(clientX, clientY, hitboxes)
    for (const hit of hits) {
      let obj: THREE.Object3D | null = hit.object
      while (obj) {
        const id = obj.userData.agentId
        if (typeof id === 'string') return id
        obj = obj.parent
      }
    }
    return null
  }

  function setSelected(agentId: string | null): void {
    selectedId = agentId
  }

  function showBubble(agentId: string, text: string, seconds: number): void {
    const rec = records.get(agentId)
    if (!rec || !text.trim()) return
    drawBubble(rec.bubble, text)
    rec.bubble.total = Math.max(0.8, seconds)
    rec.bubble.ttl = rec.bubble.total
    rec.bubble.mat.opacity = 0
    rec.bubble.sprite.visible = true
  }

  return { add, update, pick, setSelected, showBubble }
}
