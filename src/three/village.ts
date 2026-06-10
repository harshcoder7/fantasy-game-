/**
 * Everdawn Vale — procedural low-poly village builder (DESIGN §4).
 * One distinct silhouette per PlaceKind, assembled purely from three.js primitives.
 * Exposes chimney tips for the smoke system and animates banners, windmill blades,
 * forge embers, the tower crystal and window glow via VillageApi.update().
 */
import * as THREE from 'three'
import type { GamePhase, PlaceDef } from '../types'
import type { SceneCtx, Vector3Like, VillageApi } from './contracts'

// ------------------------------------------------------------------ palette

function std(color: string, roughness = 0.9, metalness = 0): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness })
}

interface Palette {
  stone: THREE.MeshStandardMaterial
  stoneDark: THREE.MeshStandardMaterial
  stoneWarm: THREE.MeshStandardMaterial
  marble: THREE.MeshStandardMaterial
  plaster: THREE.MeshStandardMaterial
  plasterWarm: THREE.MeshStandardMaterial
  timber: THREE.MeshStandardMaterial
  wood: THREE.MeshStandardMaterial
  woodDark: THREE.MeshStandardMaterial
  woodPale: THREE.MeshStandardMaterial
  barnRed: THREE.MeshStandardMaterial
  roofRed: THREE.MeshStandardMaterial
  roofSlate: THREE.MeshStandardMaterial
  roofBlue: THREE.MeshStandardMaterial
  roofGreen: THREE.MeshStandardMaterial
  thatch: THREE.MeshStandardMaterial
  gold: THREE.MeshStandardMaterial
  metal: THREE.MeshStandardMaterial
  doorDark: THREE.MeshStandardMaterial
  hole: THREE.MeshStandardMaterial
  greenLeaf: THREE.MeshStandardMaterial
}

function makePalette(): Palette {
  return {
    stone: std('#9aa0a6'),
    stoneDark: std('#767c83'),
    stoneWarm: std('#b1a387'),
    marble: std('#e9e3d3', 0.75),
    plaster: std('#ece0c2'),
    plasterWarm: std('#e4cfa8'),
    timber: std('#4e3a26'),
    wood: std('#7d5a39'),
    woodDark: std('#5e4428'),
    woodPale: std('#a8835a'),
    barnRed: std('#8f4434'),
    roofRed: std('#a4503a'),
    roofSlate: std('#5c6678'),
    roofBlue: std('#46618a'),
    roofGreen: std('#5f7a44'),
    thatch: std('#c2a455'),
    gold: std('#c9a227', 0.45, 0.5),
    metal: std('#6b7077', 0.55, 0.6),
    doorDark: std('#3a2c1c'),
    hole: std('#14100c', 1),
    greenLeaf: std('#5b8a3c'),
  }
}

// ------------------------------------------------------------------ helpers

function shadowed<T extends THREE.Mesh>(m: T): T {
  m.castShadow = true
  m.receiveShadow = true
  return m
}

function bx(
  g: THREE.Object3D, w: number, h: number, d: number, mat: THREE.Material,
  x: number, y: number, z: number, ry = 0, rx = 0, rz = 0,
): THREE.Mesh {
  const m = shadowed(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat))
  m.position.set(x, y, z)
  m.rotation.set(rx, ry, rz)
  g.add(m)
  return m
}

function cyl(
  g: THREE.Object3D, rTop: number, rBot: number, h: number, mat: THREE.Material,
  x: number, y: number, z: number, seg = 10,
): THREE.Mesh {
  const m = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), mat))
  m.position.set(x, y, z)
  g.add(m)
  return m
}

function cone(
  g: THREE.Object3D, r: number, h: number, mat: THREE.Material,
  x: number, y: number, z: number, seg = 9,
): THREE.Mesh {
  const m = shadowed(new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), mat))
  m.position.set(x, y, z)
  g.add(m)
  return m
}

/** Triangular gable prism. span = slope footprint, len = ridge length. */
function gableGeo(span: number, h: number, len: number, ridgeAlongX = true): THREE.BufferGeometry {
  const s = new THREE.Shape()
  s.moveTo(-span / 2, 0)
  s.lineTo(span / 2, 0)
  s.lineTo(0, h)
  s.closePath()
  const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false })
  g.translate(0, 0, -len / 2)
  if (ridgeAlongX) g.rotateY(Math.PI / 2)
  return g
}

function gable(
  g: THREE.Object3D, span: number, h: number, len: number, mat: THREE.Material,
  x: number, y: number, z: number, ridgeAlongX = true,
): THREE.Mesh {
  const m = shadowed(new THREE.Mesh(gableGeo(span, h, len, ridgeAlongX), mat))
  m.position.set(x, y, z)
  g.add(m)
  return m
}

function snapYaw(yaw: number): number {
  return Math.round(yaw / (Math.PI / 2)) * (Math.PI / 2)
}

// ------------------------------------------------------------------ builder

export function buildVillage(ctx: SceneCtx, places: PlaceDef[]): VillageApi {
  const root = new THREE.Group()
  root.name = 'village'
  ctx.scene.add(root)

  const M = makePalette()
  const chimneys: Vector3Like[] = []
  /** per-frame animation callbacks (dt, elapsed, phase) */
  const anims: Array<(dt: number, t: number, phase: GamePhase) => void> = []

  // Shared glow materials -------------------------------------------------
  const winMat = new THREE.MeshStandardMaterial({
    color: '#39414e', emissive: '#ffb45e', emissiveIntensity: 0,
    roughness: 0.35, metalness: 0.15,
  })
  const emberMat = new THREE.MeshStandardMaterial({
    color: '#2b180c', emissive: '#ff7a26', emissiveIntensity: 1.5, roughness: 1,
  })
  const crystalMat = new THREE.MeshStandardMaterial({
    color: '#cdb8ff', emissive: '#8b5cf6', emissiveIntensity: 1.4,
    roughness: 0.25, metalness: 0.1,
  })
  const candleMat = new THREE.MeshStandardMaterial({
    color: '#f3e2b0', emissive: '#ffce6a', emissiveIntensity: 0.7, roughness: 0.9,
  })

  function addWindow(g: THREE.Object3D, x: number, y: number, z: number, ry = 0, w = 0.9, h = 1.1): void {
    const frame = bx(g, w + 0.24, h + 0.24, 0.1, M.timber, x, y, z, ry)
    frame.castShadow = false
    const pane = bx(g, w, h, 0.16, winMat, x, y, z, ry)
    pane.castShadow = false
    // nudge pane proud of the frame along its facing normal
    pane.position.x += Math.sin(ry) * 0.04
    pane.position.z += Math.cos(ry) * 0.04
  }

  function addDoor(g: THREE.Object3D, x: number, y0: number, z: number, ry = 0, w = 1.5, h = 2.4): void {
    bx(g, w + 0.3, h + 0.18, 0.12, M.timber, x, y0 + (h + 0.06) / 2, z, ry)
    const door = bx(g, w, h, 0.2, M.doorDark, x, y0 + h / 2, z, ry)
    door.position.x += Math.sin(ry) * 0.05
    door.position.z += Math.cos(ry) * 0.05
  }

  /** stone chimney stack; returns LOCAL tip position */
  function addChimneyStack(g: THREE.Object3D, x: number, z: number, baseY: number, topY: number): THREE.Vector3 {
    bx(g, 0.95, topY - baseY, 0.95, M.stoneDark, x, (baseY + topY) / 2, z)
    bx(g, 1.25, 0.45, 1.25, M.stone, x, topY + 0.22, z)
    const hm = bx(g, 0.55, 0.2, 0.55, M.hole, x, topY + 0.46, z)
    hm.castShadow = false
    return new THREE.Vector3(x, topY + 0.55, z)
  }

  function barrel(g: THREE.Object3D, x: number, y: number, z: number, s = 1): void {
    cyl(g, 0.42 * s, 0.36 * s, 1.0 * s, M.wood, x, y + 0.5 * s, z, 9)
    const b1 = cyl(g, 0.44 * s, 0.44 * s, 0.08 * s, M.metal, x, y + 0.26 * s, z, 9)
    const b2 = cyl(g, 0.44 * s, 0.44 * s, 0.08 * s, M.metal, x, y + 0.74 * s, z, 9)
    b1.castShadow = false
    b2.castShadow = false
  }

  function crate(g: THREE.Object3D, x: number, y: number, z: number, s = 1, ry = 0): void {
    bx(g, 0.85 * s, 0.85 * s, 0.85 * s, M.woodPale, x, y + 0.43 * s, z, ry)
  }

  // ------------------------------------------------------------ buildings

  function buildTavern(g: THREE.Group, w: number, d: number): void {
    const bw = w - 2.4
    const bd = d - 2.4
    // ground floor + jettied upper floor
    bx(g, bw, 3.1, bd, M.plaster, 0, 1.55, 0)
    bx(g, bw + 0.9, 2.6, bd + 0.9, M.plasterWarm, 0, 4.4, 0)
    // timber trims: corner posts + floor bands + diagonal braces on the front
    const hx = bw / 2 - 0.1
    const hz = bd / 2 - 0.1
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        bx(g, 0.3, 3.15, 0.3, M.timber, sx * hx, 1.55, sz * hz)
        bx(g, 0.3, 2.65, 0.3, M.timber, sx * (hx + 0.45), 4.4, sz * (hz + 0.45))
      }
    }
    bx(g, bw + 1.1, 0.34, bd + 1.1, M.timber, 0, 3.08, 0)
    bx(g, bw + 1.1, 0.3, bd + 1.1, M.timber, 0, 5.66, 0)
    bx(g, 0.22, 2.0, 0.22, M.timber, -3.4, 4.4, bd / 2 + 0.5, 0, 0, 0.6)
    bx(g, 0.22, 2.0, 0.22, M.timber, 3.4, 4.4, bd / 2 + 0.5, 0, 0, -0.6)
    // gable roof, ridge along x, generous overhang
    gable(g, bd + 2.4, 3.9, bw + 2.6, M.roofRed, 0, 5.8, 0)
    bx(g, bw + 3.0, 0.28, 0.5, M.woodDark, 0, 9.74, 0)
    // door + windows
    addDoor(g, -2.4, 0, bd / 2 + 0.02, 0, 1.6, 2.5)
    addWindow(g, 1.4, 1.7, bd / 2 + 0.02)
    addWindow(g, -3.2, 4.5, bd / 2 + 0.47)
    addWindow(g, 0, 4.5, bd / 2 + 0.47)
    addWindow(g, 3.2, 4.5, bd / 2 + 0.47)
    addWindow(g, -bw / 2 - 0.02, 1.7, -1.5, Math.PI / 2)
    addWindow(g, bw / 2 + 0.02, 1.7, 1.5, Math.PI / 2)
    addWindow(g, -bw / 2 - 0.47, 4.5, 0, Math.PI / 2)
    addWindow(g, bw / 2 + 0.47, 4.5, 0, Math.PI / 2)
    // hanging sign on a bracket — sways gently
    bx(g, 0.16, 0.16, 1.5, M.timber, 4.6, 3.7, bd / 2 + 0.7)
    const pivot = new THREE.Group()
    pivot.position.set(4.6, 3.62, bd / 2 + 1.25)
    g.add(pivot)
    bx(pivot, 0.06, 0.4, 0.06, M.metal, -0.5, -0.2, 0)
    bx(pivot, 0.06, 0.4, 0.06, M.metal, 0.5, -0.2, 0)
    bx(pivot, 1.7, 1.1, 0.12, M.woodPale, 0, -0.95, 0)
    bx(pivot, 1.4, 0.8, 0.14, M.gold, 0, -0.95, 0)
    anims.push((_dt, t) => { pivot.rotation.z = Math.sin(t * 1.6) * 0.07 })
    // chimney + barrels by the wall
    chimneys.push(toWorld(g, addChimneyStack(g, -4.6, -2.2, 8.0, 10.6)))
    barrel(g, bw / 2 + 1.3, 0, 2.6)
    barrel(g, bw / 2 + 1.3, 0, 1.4)
    crate(g, bw / 2 + 1.4, 0, 4.0, 0.9, 0.4)
  }

  function buildForge(g: THREE.Group, w: number, d: number): void {
    const bw = w - 2.0
    const bd = d - 2.0
    // open shed: back + left walls, posts on the open sides
    bx(g, bw, 3.5, 0.6, M.stoneWarm, 0, 1.75, -bd / 2 + 0.3)
    bx(g, 0.6, 3.5, bd - 1.2, M.stoneWarm, -bw / 2 + 0.3, 1.75, 0)
    bx(g, 0.45, 4.0, 0.45, M.woodDark, bw / 2 - 0.3, 2.0, bd / 2 - 0.3)
    bx(g, 0.45, 4.0, 0.45, M.woodDark, -bw / 2 + 0.3, 2.0, bd / 2 - 0.3)
    bx(g, 0.45, 4.0, 0.45, M.woodDark, bw / 2 - 0.3, 2.0, -bd / 2 + 0.3)
    // sloped plank roof
    const roof = bx(g, bw + 1.6, 0.32, bd + 1.8, M.woodDark, 0, 4.45, 0)
    roof.rotation.x = 0.12
    bx(g, bw + 1.6, 0.22, 0.4, M.timber, 0, 4.95, -bd / 2)
    // furnace with glowing mouth + flickering point light
    bx(g, 3.2, 2.7, 2.6, M.stoneDark, -3.2, 1.35, -3.0)
    bx(g, 2.6, 0.4, 2.2, M.stone, -3.2, 2.85, -3.0)
    const mouth = bx(g, 1.5, 1.15, 0.25, emberMat, -3.2, 1.0, -1.62)
    mouth.castShadow = false
    chimneys.push(toWorld(g, addChimneyStack(g, -3.2, -3.4, 3.0, 6.6)))
    const fire = new THREE.PointLight(0xff7a26, 9, 17, 2)
    fire.position.set(-3.2, 1.7, -0.9)
    g.add(fire)
    anims.push((_dt, t) => {
      const n = Math.sin(t * 11.3) * 0.5 + Math.sin(t * 23.7 + 1.7) * 0.3 + Math.sin(t * 5.1) * 0.2
      fire.intensity = 8.5 + n * 2.6
      emberMat.emissiveIntensity = 1.45 + n * 0.4
    })
    // anvil on a stump
    cyl(g, 0.52, 0.6, 0.85, M.woodDark, 0.9, 0.42, -0.4, 9)
    bx(g, 1.35, 0.42, 0.55, M.metal, 0.9, 1.06, -0.4)
    const horn = cone(g, 0.2, 0.62, M.metal, 1.75, 1.06, -0.4, 8)
    horn.rotation.z = -Math.PI / 2
    bx(g, 0.5, 0.3, 0.5, M.metal, 0.9, 0.7, -0.4)
    // quench trough + ingots + spare wheel
    bx(g, 2.2, 0.62, 0.95, M.woodDark, 3.4, 0.31, -2.8)
    const water = bx(g, 1.9, 0.1, 0.7, std('#27424e', 0.3), 3.4, 0.58, -2.8)
    water.castShadow = false
    bx(g, 0.9, 0.22, 0.34, M.metal, 3.6, 0.11, 0.9)
    bx(g, 0.9, 0.22, 0.34, M.metal, 3.3, 0.11, 1.4, 0.5)
    bx(g, 0.9, 0.22, 0.34, M.metal, 3.45, 0.33, 1.15, 0.2)
    barrel(g, -bw / 2 - 0.9, 0, 2.8, 0.9)
  }

  function buildCastle(g: THREE.Group, w: number, d: number): void {
    const tx = w / 2 - 3.7 // tower centers
    const tz = d / 2 - 3.7
    const wallH = 7.2
    const crenels: Array<[number, number, number]> = []
    // four corner towers with cone roofs
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        cyl(g, 3.1, 3.5, 16, M.stone, sx * tx, 8, sz * tz, 12)
        cyl(g, 3.7, 3.7, 1.1, M.stoneDark, sx * tx, 16.2, sz * tz, 12)
        cone(g, 4.1, 5.4, M.roofBlue, sx * tx, 19.4, sz * tz, 10)
        addWindow(g, sx * tx, 11.5, sz * tz + sz * 3.18, sz > 0 ? 0 : Math.PI, 0.55, 1.0)
        addWindow(g, sx * tx + sx * 3.18, 7.5, sz * tz, Math.PI / 2, 0.55, 1.0)
      }
    }
    // curtain walls (front wall split for the gatehouse)
    const wallLenX = tx * 2 - 5.6
    const wallLenZ = tz * 2 - 5.6
    bx(g, wallLenX, wallH, 2.0, M.stone, 0, wallH / 2, -tz)
    bx(g, 2.0, wallH, wallLenZ, M.stone, -tx, wallH / 2, 0)
    bx(g, 2.0, wallH, wallLenZ, M.stone, tx, wallH / 2, 0)
    const gateHalf = 3.2
    const segLen = (wallLenX / 2) - gateHalf
    bx(g, segLen, wallH, 2.0, M.stone, -(gateHalf + segLen / 2), wallH / 2, tz)
    bx(g, segLen, wallH, 2.0, M.stone, gateHalf + segLen / 2, wallH / 2, tz)
    // gatehouse + dark arch + portcullis bars + pennant poles
    bx(g, 7.4, 9.2, 3.4, M.stoneDark, 0, 4.6, tz)
    const arch = bx(g, 3.6, 5.4, 3.6, M.hole, 0, 2.7, tz)
    arch.castShadow = false
    for (let i = -1; i <= 1; i++) bx(g, 0.14, 5.2, 0.14, M.timber, i * 1.1, 2.6, tz + 1.86)
    for (const sx of [-1, 1]) {
      cyl(g, 0.07, 0.07, 3.4, M.woodDark, sx * 3.0, 10.8, tz, 6)
      const pen = cone(g, 0.32, 1.0, std('#c9a227', 0.6), sx * 3.0, 12.0, tz, 4)
      pen.rotation.z = Math.PI
    }
    // central keep
    const kw = 15
    const kd = 11.5
    const kh = 12.6
    bx(g, kw, kh, kd, M.stoneWarm, 0, kh / 2, -2.5)
    bx(g, kw + 0.8, 0.55, kd + 0.8, M.stoneDark, 0, kh + 0.27, -2.5)
    addWindow(g, -3.6, 9.2, -2.5 + kd / 2 + 0.02)
    addWindow(g, 0, 9.2, -2.5 + kd / 2 + 0.02)
    addWindow(g, 3.6, 9.2, -2.5 + kd / 2 + 0.02)
    addWindow(g, -3.6, 5.6, -2.5 + kd / 2 + 0.02)
    addWindow(g, 3.6, 5.6, -2.5 + kd / 2 + 0.02)
    addWindow(g, kw / 2 + 0.02, 8.4, -2.5, Math.PI / 2)
    addWindow(g, -kw / 2 - 0.02, 8.4, -2.5, Math.PI / 2)
    addDoor(g, 0, 0, -2.5 + kd / 2 + 0.04, 0, 2.2, 3.2)
    // crenellations: walls + keep roof + gatehouse top (instanced)
    const crenY = wallH + 0.45
    const addRun = (x0: number, z0: number, x1: number, z1: number, y: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0)
      const n = Math.max(2, Math.floor(len / 2.1))
      for (let i = 0; i <= n; i++) {
        const f = i / n
        crenels.push([x0 + (x1 - x0) * f, y, z0 + (z1 - z0) * f])
      }
    }
    addRun(-wallLenX / 2, -tz, wallLenX / 2, -tz, crenY)
    addRun(-tx, -wallLenZ / 2, -tx, wallLenZ / 2, crenY)
    addRun(tx, -wallLenZ / 2, tx, wallLenZ / 2, crenY)
    addRun(-(gateHalf + segLen) + 0.5, tz, -gateHalf - 0.4, tz, crenY)
    addRun(gateHalf + 0.4, tz, gateHalf + segLen - 0.5, tz, crenY)
    addRun(-3.4, tz, 3.4, tz, 9.2 + 0.45)
    const ky = kh + 0.55 + 0.45
    addRun(-kw / 2 + 0.4, -2.5 - kd / 2 + 0.4, kw / 2 - 0.4, -2.5 - kd / 2 + 0.4, ky)
    addRun(-kw / 2 + 0.4, -2.5 + kd / 2 - 0.4, kw / 2 - 0.4, -2.5 + kd / 2 - 0.4, ky)
    addRun(-kw / 2 + 0.4, -2.5 - kd / 2 + 2.3, -kw / 2 + 0.4, -2.5 + kd / 2 - 2.3, ky)
    addRun(kw / 2 - 0.4, -2.5 - kd / 2 + 2.3, kw / 2 - 0.4, -2.5 + kd / 2 - 2.3, ky)
    const crenMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.1, 0.95, 1.1), M.stone, crenels.length)
    const mtx = new THREE.Matrix4()
    crenels.forEach(([x, y, z], i) => crenMesh.setMatrixAt(i, mtx.makeTranslation(x, y, z)))
    crenMesh.castShadow = true
    crenMesh.receiveShadow = true
    g.add(crenMesh)
    // animated banner on the keep
    cyl(g, 0.09, 0.11, 5.2, M.woodDark, 0, kh + 3.1, -2.5, 6)
    const bar = cyl(g, 0.06, 0.06, 2.4, M.woodDark, 1.1, kh + 5.3, -2.5, 6)
    bar.rotation.z = Math.PI / 2
    const bannerGeo = new THREE.PlaneGeometry(2.0, 3.1, 1, 8)
    const colors = new Float32Array(bannerGeo.attributes.position.count * 3)
    const crimson = new THREE.Color('#a32638')
    const goldTip = new THREE.Color('#e6c84e')
    for (let i = 0; i < bannerGeo.attributes.position.count; i++) {
      const vy = bannerGeo.attributes.position.getY(i)
      const c = vy > 1.2 || vy < -1.25 ? goldTip : crimson
      colors[i * 3] = c.r
      colors[i * 3 + 1] = c.g
      colors[i * 3 + 2] = c.b
    }
    bannerGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    const banner = new THREE.Mesh(
      bannerGeo,
      new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85 }),
    )
    banner.castShadow = true
    banner.position.set(1.1, kh + 3.65, -2.5)
    g.add(banner)
    const base = (bannerGeo.attributes.position.array as Float32Array).slice()
    anims.push((_dt, t) => {
      const pos = bannerGeo.attributes.position
      for (let i = 0; i < pos.count; i++) {
        const vy = base[i * 3 + 1]
        const droop = (1.55 - vy) / 3.1 // 0 at the bar, 1 at the tip
        pos.setZ(i, Math.sin(t * 2.4 + vy * 2.2) * 0.34 * droop)
        pos.setX(i, base[i * 3] + Math.sin(t * 1.7 + vy * 1.4) * 0.1 * droop)
      }
      pos.needsUpdate = true
      bannerGeo.computeVertexNormals()
    })
    // courtyard dressing
    crate(g, -6, 0, 8.0, 1.0, 0.3)
    crate(g, -7.2, 0, 8.6, 0.8, 0.8)
    barrel(g, 6.4, 0, 8.2)
  }

  function buildTower(g: THREE.Group, _w: number, _d: number): void {
    cyl(g, 5.0, 5.5, 1.4, M.stoneDark, 0, 0.7, 0, 12)
    cyl(g, 3.7, 4.6, 21, M.stone, 0, 11.9, 0, 12)
    cyl(g, 4.5, 4.5, 0.9, M.stoneDark, 0, 21.4, 0, 12)
    cone(g, 4.9, 6.6, M.roofBlue, 0, 25.1, 0, 10)
    cyl(g, 0.08, 0.08, 1.6, M.metal, 0, 28.9, 0, 6)
    // door + spiral of slit windows
    addDoor(g, 0, 1.4, 4.32, 0, 1.7, 2.7)
    bx(g, 2.6, 0.4, 1.6, M.stoneDark, 0, 1.55, 4.9)
    const slits: Array<[number, number]> = [[7, 0.5], [11, -0.7], [15, 1.5], [18.5, -1.9]]
    for (const [y, ang] of slits) {
      const r = 4.6 + (3.7 - 4.6) * ((y - 1.4) / 21) + 0.1
      addWindow(g, Math.sin(ang) * r, y, Math.cos(ang) * r, ang, 0.55, 1.05)
    }
    // floating crystal octahedron above the spire, pulsing
    const crystal = shadowed(new THREE.Mesh(new THREE.OctahedronGeometry(1.15), crystalMat))
    crystal.position.set(0, 31.2, 0)
    g.add(crystal)
    const glow = new THREE.PointLight(0x9b6cff, 5, 26, 2)
    glow.position.copy(crystal.position)
    g.add(glow)
    anims.push((_dt, t, phase) => {
      const nightBoost = phase === 'night' ? 1.6 : phase === 'dusk' ? 1.25 : 1
      crystal.position.y = 31.2 + Math.sin(t * 1.25) * 0.55
      crystal.rotation.y += 0.012
      crystal.rotation.x = Math.sin(t * 0.6) * 0.18
      const pulse = 1.25 + Math.sin(t * 2.1) * 0.55
      crystalMat.emissiveIntensity = pulse * nightBoost
      glow.intensity = (3.6 + Math.sin(t * 2.1) * 1.6) * nightBoost
      glow.position.y = crystal.position.y
    })
    // arcane garden: standing stones with a faint glyph
    for (const [sx, sz] of [[-4.6, 3.4], [4.8, 2.6], [5.2, -3.0]] as Array<[number, number]>) {
      bx(g, 0.7, 1.7, 0.5, M.stoneDark, sx, 0.85, sz, sx * 0.3)
    }
  }

  function buildTemple(g: THREE.Group, w: number, d: number): void {
    // stepped marble platform
    bx(g, w - 4, 0.55, d - 4, M.marble, 0, 0.27, 0)
    bx(g, w - 6, 0.55, d - 6, M.marble, 0, 0.82, 0)
    bx(g, w - 8, 0.5, d - 8, M.marble, 0, 1.34, 0)
    const floorY = 1.6
    // approach steps toward the door (+z)
    bx(g, 5.4, 0.36, 1.2, M.marble, 0, 0.18, d / 2 - 1.4)
    bx(g, 4.6, 0.36, 1.0, M.marble, 0, 0.54, d / 2 - 2.3)
    // ring of columns with capitals
    const colN = 10
    const rx = (w - 10) / 2
    const rz = (d - 9) / 2
    for (let i = 0; i < colN; i++) {
      const a = (i / colN) * Math.PI * 2 + Math.PI / colN
      const cx = Math.sin(a) * rx
      const cz = Math.cos(a) * rz
      cyl(g, 0.42, 0.48, 4.7, M.marble, cx, floorY + 2.35, cz, 9)
      bx(g, 0.95, 0.28, 0.95, M.marble, cx, floorY + 4.82, cz)
    }
    // architrave ring + gilded half-sphere dome + finial
    cyl(g, rx + 1.1, rx + 1.1, 0.75, M.marble, 0, floorY + 5.32, 0, 18)
    const dome = shadowed(new THREE.Mesh(
      new THREE.SphereGeometry(rx + 0.7, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.gold,
    ))
    dome.position.set(0, floorY + 5.7, 0)
    g.add(dome)
    cyl(g, 0.12, 0.12, 1.5, M.gold, 0, floorY + 5.7 + rx + 1.3, 0, 6)
    const sun = shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), M.gold))
    sun.position.set(0, floorY + 5.7 + rx + 2.15, 0)
    g.add(sun)
    // altar with candles
    bx(g, 1.9, 1.05, 1.1, M.marble, 0, floorY + 0.52, -1.2)
    for (const [cx, cz] of [[-0.55, -1.2], [0, -1.4], [0.55, -1.2]] as Array<[number, number]>) {
      const c = cyl(g, 0.07, 0.07, 0.34, candleMat, cx, floorY + 1.25, cz, 6)
      c.castShadow = false
    }
    // brazier bowls flanking the steps, sharing the ember pulse
    for (const sx of [-1, 1]) {
      cyl(g, 0.34, 0.2, 0.85, M.stoneDark, sx * 3.4, 0.42, d / 2 - 1.2, 8)
      cyl(g, 0.55, 0.4, 0.4, M.stoneDark, sx * 3.4, 1.02, d / 2 - 1.2, 8)
      const em = cyl(g, 0.42, 0.42, 0.12, emberMat, sx * 3.4, 1.24, d / 2 - 1.2, 8)
      em.castShadow = false
    }
  }

  function buildFarmhouse(g: THREE.Group, w: number, d: number): void {
    const bw = w - 1.6
    const bd = d - 1.6
    bx(g, bw, 4.0, bd, M.barnRed, 0, 2.0, 0)
    gable(g, bd, 3.0, bw + 0.2, M.barnRed, 0, 4.0, 0)
    gable(g, bd + 1.8, 3.3, bw + 1.8, M.thatch, 0, 4.15, 0)
    bx(g, bw + 2.2, 0.26, 0.45, M.woodDark, 0, 7.5, 0)
    // white trim + big barn door with cross braces
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) bx(g, 0.26, 4.05, 0.26, M.plaster, sx * (bw / 2 - 0.1), 2.0, sz * (bd / 2 - 0.1))
    }
    bx(g, 2.9, 3.1, 0.18, M.woodPale, 0, 1.55, bd / 2 + 0.05)
    bx(g, 3.1, 0.24, 0.2, M.plaster, 0, 3.12, bd / 2 + 0.1)
    bx(g, 0.2, 3.3, 0.2, M.plaster, -1.5, 1.55, bd / 2 + 0.1)
    bx(g, 0.2, 3.3, 0.2, M.plaster, 1.5, 1.55, bd / 2 + 0.1)
    bx(g, 0.18, 3.6, 0.16, M.plaster, 0, 1.55, bd / 2 + 0.12, 0, 0, 0.72)
    bx(g, 0.18, 3.6, 0.16, M.plaster, 0, 1.55, bd / 2 + 0.12, 0, 0, -0.72)
    addWindow(g, -3.2, 2.2, bd / 2 + 0.02)
    addWindow(g, 3.2, 2.2, bd / 2 + 0.02)
    addWindow(g, 0, 5.1, bd / 2 + 0.12, 0, 0.8, 0.8) // loft window in the gable
    addWindow(g, -bw / 2 - 0.02, 2.2, 0, Math.PI / 2)
    chimneys.push(toWorld(g, addChimneyStack(g, bw / 2 - 1.3, -bd / 2 + 1.6, 5.4, 8.0)))
    // hay bales
    bx(g, 1.5, 0.9, 1.0, std('#d8b85a'), bw / 2 + 1.5, 0.45, -1.4, 0.3)
    bx(g, 1.5, 0.9, 1.0, std('#cfae4e'), bw / 2 + 1.7, 0.45, 0.2, -0.2)
  }

  function buildWindmill(g: THREE.Group, _w: number, _d: number): void {
    cyl(g, 3.0, 3.4, 1.2, M.stoneDark, 0, 0.6, 0, 12)
    cyl(g, 2.0, 2.9, 10.5, M.plaster, 0, 6.45, 0, 12)
    cone(g, 2.7, 3.0, M.roofRed, 0, 13.2, 0, 10)
    addDoor(g, 0, 1.1, 2.78, 0, 1.4, 2.2)
    addWindow(g, 0, 6.0, 2.5, 0, 0.7, 0.9)
    addWindow(g, 0, 9.2, 2.25, 0, 0.7, 0.9)
    // axle + 4-blade cross, spinning
    const orient = new THREE.Group()
    orient.position.set(0, 11.4, 2.1)
    g.add(orient)
    cyl(orient, 0.22, 0.22, 1.6, M.woodDark, 0, 0, 0.2, 8).rotation.x = Math.PI / 2
    const spin = new THREE.Group()
    spin.position.set(0, 0, 1.1)
    orient.add(spin)
    const nose = cone(spin, 0.35, 0.7, M.woodDark, 0, 0, 0.35, 8)
    nose.rotation.x = Math.PI / 2
    for (let i = 0; i < 4; i++) {
      const arm = new THREE.Group()
      arm.rotation.z = (i * Math.PI) / 2
      spin.add(arm)
      bx(arm, 0.18, 5.8, 0.18, M.woodDark, 0, 2.9, 0)
      bx(arm, 1.3, 4.6, 0.08, M.woodPale, 0.55, 3.2, 0)
      bx(arm, 1.5, 0.1, 0.12, M.woodDark, 0.45, 1.4, 0)
      bx(arm, 1.5, 0.1, 0.12, M.woodDark, 0.45, 3.2, 0)
      bx(arm, 1.5, 0.1, 0.12, M.woodDark, 0.45, 5.0, 0)
    }
    anims.push((dt) => { spin.rotation.z += dt * 0.55 })
    // grain sacks by the door
    for (const [sx, sz] of [[1.9, 2.6], [2.5, 2.0]] as Array<[number, number]>) {
      const sack = shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), std('#c9b07e')))
      sack.position.set(sx, 0.42, sz)
      sack.scale.y = 0.85
      g.add(sack)
    }
  }

  function buildHut(g: THREE.Group, _w: number, _d: number): void {
    cyl(g, 3.5, 3.7, 3.0, M.plasterWarm, 0, 1.5, 0, 14)
    // timber ribs around the round wall
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.22
      bx(g, 0.22, 3.0, 0.22, M.timber, Math.sin(a) * 3.55, 1.5, Math.cos(a) * 3.55, a)
    }
    // droopy oversized cone roof (lathe with a sagging profile)
    const profile = [
      new THREE.Vector2(5.3, 0.0), new THREE.Vector2(5.1, 0.5), new THREE.Vector2(4.3, 1.1),
      new THREE.Vector2(3.1, 1.9), new THREE.Vector2(1.8, 2.7), new THREE.Vector2(0.7, 3.4),
      new THREE.Vector2(0.02, 3.9),
    ]
    const roof = shadowed(new THREE.Mesh(
      new THREE.LatheGeometry(profile, 14),
      new THREE.MeshStandardMaterial({ color: '#b08d4f', roughness: 0.95, side: THREE.DoubleSide }),
    ))
    roof.position.y = 2.55
    g.add(roof)
    cyl(g, 0.16, 0.3, 0.7, M.woodDark, 0, 6.7, 0, 6)
    addDoor(g, 0, 0, 3.62, 0, 1.3, 2.1)
    addWindow(g, Math.sin(1.25) * 3.62, 1.8, Math.cos(1.25) * 3.62, 1.25, 0.7, 0.7)
    addWindow(g, Math.sin(-1.25) * 3.62, 1.8, Math.cos(-1.25) * 3.62, -1.25, 0.7, 0.7)
    // crooked little chimney through the roof
    bx(g, 0.7, 1.9, 0.7, M.stoneDark, -2.0, 4.4, -1.3, 0, 0, 0.1)
    bx(g, 0.95, 0.35, 0.95, M.stone, -2.1, 5.4, -1.3, 0, 0, 0.12)
    chimneys.push(toWorld(g, new THREE.Vector3(-2.12, 5.7, -1.3)))
    // herb boxes bursting with greens + drying rack
    for (const sx of [-1, 1]) {
      bx(g, 1.9, 0.5, 0.75, M.woodDark, sx * 2.0, 0.25, 3.6)
      for (let i = 0; i < 4; i++) {
        const leaf = shadowed(new THREE.Mesh(
          new THREE.IcosahedronGeometry(0.21, 0),
          i % 2 === 0 ? M.greenLeaf : std('#7aa24a'),
        ))
        leaf.position.set(sx * 2.0 - 0.6 + i * 0.42, 0.6, 3.6 + (i % 2) * 0.18 - 0.09)
        g.add(leaf)
      }
    }
    bx(g, 0.14, 1.7, 0.14, M.timber, 4.3, 0.85, 0.6)
    bx(g, 0.14, 1.7, 0.14, M.timber, 4.3, 0.85, -1.0)
    bx(g, 0.1, 0.1, 1.8, M.timber, 4.3, 1.6, -0.2)
    for (let i = 0; i < 3; i++) {
      const bundle = shadowed(new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 6), M.greenLeaf))
      bundle.position.set(4.3, 1.32, 0.35 - i * 0.5)
      bundle.rotation.z = Math.PI
      g.add(bundle)
    }
  }

  let houseVariant = 0
  function buildHouse(g: THREE.Group, w: number, d: number): void {
    const v = houseVariant++ % 2
    const bw = w - 1.5
    const bd = d - 1.8
    if (v === 0) {
      // timbered cottage, red roof
      bx(g, bw, 3.0, bd, M.plaster, 0, 1.5, 0)
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) bx(g, 0.26, 3.05, 0.26, M.timber, sx * (bw / 2 - 0.1), 1.5, sz * (bd / 2 - 0.1))
      }
      bx(g, bw + 0.2, 0.28, bd + 0.2, M.timber, 0, 3.0, 0)
      gable(g, bd, 2.4, bw, M.plaster, 0, 3.05, 0)
      gable(g, bd + 1.7, 2.7, bw + 1.7, M.roofRed, 0, 3.15, 0)
      bx(g, bw + 2.0, 0.24, 0.4, M.woodDark, 0, 5.9, 0)
      addDoor(g, -1.6, 0, bd / 2 + 0.02)
      gable(g, 1.6, 0.7, 2.3, M.roofRed, -1.6, 2.75, bd / 2 + 0.55)
      addWindow(g, 1.7, 1.65, bd / 2 + 0.02)
      addWindow(g, -bw / 2 - 0.02, 1.65, 0, Math.PI / 2)
      addWindow(g, bw / 2 + 0.02, 1.65, 0, Math.PI / 2)
      chimneys.push(toWorld(g, addChimneyStack(g, bw / 2 - 1.0, -0.6, 4.2, 6.6)))
      // woodpile
      for (let i = 0; i < 3; i++) {
        const log = cyl(g, 0.22, 0.22, 1.5, M.woodDark, bw / 2 + 0.9, 0.23 + (i === 2 ? 0.4 : 0), -1.6 + (i % 2) * 0.46 - (i === 2 ? 0.23 : 0), 7)
        log.rotation.x = Math.PI / 2
      }
    } else {
      // halfling burrow-house: warm stone, mossy roof, round green door
      bx(g, bw, 2.7, bd, M.stoneWarm, 0, 1.35, 0)
      gable(g, bd + 1.6, 2.5, bw + 1.6, M.roofGreen, 0, 2.7, 0)
      bx(g, bw + 1.9, 0.22, 0.4, M.woodDark, 0, 5.24, 0)
      const door = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.16, 16), std('#3f7a3f')))
      door.rotation.x = Math.PI / 2
      door.position.set(-1.2, 1.05, bd / 2 + 0.06)
      g.add(door)
      const ring = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(1.12, 1.12, 0.1, 16), M.timber))
      ring.rotation.x = Math.PI / 2
      ring.position.set(-1.2, 1.05, bd / 2 + 0.02)
      g.add(ring)
      const knob = shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), M.gold))
      knob.position.set(-0.55, 1.05, bd / 2 + 0.18)
      g.add(knob)
      for (const wx of [1.5]) {
        const rw = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.14, 12), winMat))
        rw.rotation.x = Math.PI / 2
        rw.position.set(wx, 1.7, bd / 2 + 0.04)
        rw.castShadow = false
        g.add(rw)
        const rr = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.1, 12), M.timber))
        rr.rotation.x = Math.PI / 2
        rr.position.set(wx, 1.7, bd / 2 + 0.0)
        g.add(rr)
      }
      addWindow(g, -bw / 2 - 0.02, 1.5, 0, Math.PI / 2, 0.8, 0.8)
      chimneys.push(toWorld(g, addChimneyStack(g, bw / 2 - 1.0, 0.4, 3.6, 5.6)))
      // pumpkins by the door
      for (const [px, pz, s] of [[0.4, bd / 2 + 0.9, 0.34], [0.95, bd / 2 + 0.7, 0.26]] as Array<[number, number, number]>) {
        const p = shadowed(new THREE.Mesh(new THREE.SphereGeometry(s, 9, 7), std('#c96a1e')))
        p.position.set(px, s * 0.8, pz)
        p.scale.y = 0.8
        g.add(p)
      }
    }
  }

  function buildWell(g: THREE.Group, _w: number, _d: number): void {
    cyl(g, 1.45, 1.6, 1.0, M.stone, 0, 0.5, 0, 12)
    cyl(g, 1.6, 1.6, 0.18, M.stoneDark, 0, 1.05, 0, 12)
    const hole = cyl(g, 1.05, 1.05, 0.1, M.hole, 0, 1.12, 0, 12)
    hole.castShadow = false
    bx(g, 0.2, 2.2, 0.2, M.wood, -1.25, 1.6, 0)
    bx(g, 0.2, 2.2, 0.2, M.wood, 1.25, 1.6, 0)
    const bar = cyl(g, 0.08, 0.08, 2.6, M.woodDark, 0, 2.45, 0, 7)
    bar.rotation.z = Math.PI / 2
    gable(g, 2.0, 0.85, 3.2, M.roofRed, 0, 2.75, 0)
    // bucket on a rope, with a faint sway
    const hang = new THREE.Group()
    hang.position.set(0.2, 2.45, 0)
    g.add(hang)
    cyl(hang, 0.03, 0.03, 0.7, std('#8a795a'), 0, -0.35, 0, 5).castShadow = false
    cyl(hang, 0.3, 0.24, 0.42, M.woodDark, 0, -0.85, 0, 9)
    anims.push((_dt, t) => { hang.rotation.x = Math.sin(t * 1.35 + 0.8) * 0.06 })
  }

  const AWNING_COLORS = ['#b33a3a', '#3a6fb3', '#3f8f5f', '#c2851f', '#7a4fa0', '#2f8f8a']
  const GOODS_COLORS = ['#c0392b', '#d68910', '#7d9f35', '#e7c95c', '#8e44ad', '#d35400']

  function buildStall(parent: THREE.Group, x: number, z: number, ry: number, idx: number): void {
    const s = new THREE.Group()
    s.position.set(x, 0, z)
    s.rotation.y = ry
    parent.add(s)
    // counter + posts
    bx(s, 3.2, 1.05, 1.5, M.wood, 0, 0.52, 0.55)
    bx(s, 3.2, 0.14, 1.7, M.woodPale, 0, 1.12, 0.55)
    bx(s, 0.16, 2.75, 0.16, M.woodDark, -1.65, 1.37, -0.85)
    bx(s, 0.16, 2.75, 0.16, M.woodDark, 1.65, 1.37, -0.85)
    bx(s, 0.16, 2.3, 0.16, M.woodDark, -1.65, 1.15, 1.35)
    bx(s, 0.16, 2.3, 0.16, M.woodDark, 1.65, 1.15, 1.35)
    // striped awning: alternating colored slats, tilted forward
    const stripe = std(AWNING_COLORS[idx % AWNING_COLORS.length]!, 0.85)
    const white = std('#f2ead6', 0.85)
    const awn = new THREE.Group()
    awn.position.set(0, 2.62, 0.18)
    awn.rotation.x = 0.22
    s.add(awn)
    for (let i = 0; i < 6; i++) {
      const slat = bx(awn, 0.64, 0.06, 2.9, i % 2 === 0 ? stripe : white, -1.6 + 0.32 + i * 0.64, 0, 0)
      slat.castShadow = true
    }
    // wares on the counter
    for (let i = 0; i < 4; i++) {
      const c = GOODS_COLORS[(idx * 2 + i) % GOODS_COLORS.length]!
      if ((idx + i) % 3 === 0) {
        bx(s, 0.3, 0.3, 0.3, std(c, 0.8), -1.0 + i * 0.7, 1.34, 0.45 + (i % 2) * 0.35)
      } else {
        const fruit = shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), std(c, 0.7)))
        fruit.position.set(-1.0 + i * 0.7, 1.36, 0.45 + (i % 2) * 0.35)
        s.add(fruit)
      }
    }
    // crates / barrels beside every other stall
    if (idx % 2 === 0) {
      crate(s, -2.3, 0, 0.5, 1, 0.4)
      crate(s, -2.25, 0.85, 0.55, 0.75, 0.9)
    } else {
      barrel(s, 2.3, 0, 0.4)
    }
  }

  function buildMarket(g: THREE.Group, w: number, d: number): void {
    const ex = w / 2 - 4.5
    const ez = d / 2 - 4.5
    buildStall(g, -ex, -3.5, Math.PI / 2, 0)
    buildStall(g, -ex, 5.5, Math.PI / 2, 1)
    buildStall(g, ex, -3.5, -Math.PI / 2, 2)
    buildStall(g, ex, 5.5, -Math.PI / 2, 3)
    buildStall(g, -6.5, -ez, 0, 4)
    buildStall(g, 6.5, ez, Math.PI, 5)
    // notice board near the entrance side
    bx(g, 0.18, 2.3, 0.18, M.woodDark, -3.2, 1.15, ez + 1.4)
    bx(g, 0.18, 2.3, 0.18, M.woodDark, -1.4, 1.15, ez + 1.4)
    bx(g, 2.3, 1.3, 0.12, M.woodPale, -2.3, 1.75, ez + 1.4)
    gable(g, 0.7, 0.4, 2.6, M.roofRed, -2.3, 2.45, ez + 1.4)
    // scattered cargo
    crate(g, -10, 0, 11, 1, 0.7)
    barrel(g, 10.5, 0, -8)
    barrel(g, 11.4, 0, -7.2, 0.85)
  }

  function buildFarmWheat(g: THREE.Group, p: PlaceDef, all: PlaceDef[]): void {
    // instanced yellow-green cross-quads in tidy rows, skipping building overlap
    const cross = new THREE.BufferGeometry()
    const verts: number[] = []
    const quad = (ax: number, az: number, bxx: number, bz: number) => {
      const h = 1.0
      verts.push(ax, 0, az, bxx, 0, bz, bxx, h, bz, ax, 0, az, bxx, h, bz, ax, h, az)
    }
    quad(-0.32, 0, 0.32, 0)
    quad(0, -0.32, 0, 0.32)
    cross.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
    cross.computeVertexNormals()
    const overlaps = all.filter((o) => o.id !== p.id && Math.abs(o.x - p.x) < (p.w + o.w) / 2 && Math.abs(o.z - p.z) < (p.d + o.d) / 2)
    const spots: Array<[number, number, number]> = []
    const x0 = p.x - p.w / 2 + 2.5
    const z0 = p.z - p.d / 2 + 2.5
    for (let ix = 0; ix * 2.1 <= p.w - 5; ix++) {
      for (let iz = 0; iz * 1.5 <= p.d - 5; iz++) {
        const wx = x0 + ix * 2.1 + ((iz % 2) * 0.4)
        const wz = z0 + iz * 1.5 + ((ix * 7 + iz * 3) % 5) * 0.08
        if (overlaps.some((o) => Math.abs(wx - o.x) < o.w / 2 + 2 && Math.abs(wz - o.z) < o.d / 2 + 2)) continue
        if (Math.abs(wx - p.entrance.x) < 4 && Math.abs(wz - p.entrance.z) < 4) continue
        spots.push([wx, ctx.heightAt(wx, wz), wz])
      }
    }
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, side: THREE.DoubleSide })
    const inst = new THREE.InstancedMesh(cross, mat, spots.length)
    const m4 = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const sc = new THREE.Vector3()
    const pos = new THREE.Vector3()
    const tint = new THREE.Color()
    spots.forEach(([wx, wy, wz], i) => {
      const wob = ((i * 37) % 17) / 17
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), wob * Math.PI)
      sc.setScalar(0.85 + wob * 0.45)
      pos.set(wx, wy, wz)
      inst.setMatrixAt(i, m4.compose(pos, q, sc))
      tint.setHSL(0.16 + wob * 0.035, 0.62, 0.5 + wob * 0.08)
      inst.setColorAt(i, tint)
    })
    inst.castShadow = true
    inst.receiveShadow = true
    g.add(inst)
  }

  /** local point on a (positioned, yawed) group → world coords */
  function toWorld(g: THREE.Group, local: THREE.Vector3): Vector3Like {
    const c = Math.cos(g.rotation.y)
    const s = Math.sin(g.rotation.y)
    return {
      x: g.position.x + local.x * c + local.z * s,
      y: g.position.y + local.y,
      z: g.position.z - local.x * s + local.z * c,
    }
  }

  // ------------------------------------------------------------ assemble

  for (const p of places) {
    if (p.kind === 'lake' || p.kind === 'grove') continue
    const g = new THREE.Group()
    g.name = `place:${p.id}`
    const yaw = p.rotY ?? snapYaw(Math.atan2(p.entrance.x - p.x, p.entrance.z - p.z))
    const quarter = Math.abs(Math.round(yaw / (Math.PI / 2))) % 2 === 1
    const w = quarter ? p.d : p.w
    const d = quarter ? p.w : p.d
    g.position.set(p.x, ctx.heightAt(p.x, p.z) - 0.12, p.z)
    g.rotation.y = yaw
    root.add(g)
    switch (p.kind) {
      case 'castle': buildCastle(g, w, d); break
      case 'tavern': buildTavern(g, w, d); break
      case 'forge': buildForge(g, w, d); break
      case 'tower': buildTower(g, w, d); break
      case 'temple': buildTemple(g, w, d); break
      case 'farmhouse': buildFarmhouse(g, w, d); break
      case 'windmill': buildWindmill(g, w, d); break
      case 'hut': buildHut(g, w, d); break
      case 'house': buildHouse(g, w, d); break
      case 'market': buildMarket(g, w, d); break
      case 'well': buildWell(g, w, d); break
      case 'farm': buildFarmWheat(g, p, places); g.rotation.y = 0; g.position.set(0, -0.12, 0); break
    }
  }

  // ------------------------------------------------------------ animation

  let elapsed = 0
  let winGlow = 0

  function update(dt: number, phase: GamePhase): void {
    elapsed += dt
    const target = phase === 'night' ? 1.8 : phase === 'dusk' ? 1.45 : phase === 'dawn' ? 0.45 : 0
    winGlow += (target - winGlow) * Math.min(1, dt * 2.2)
    winMat.emissiveIntensity = winGlow
    for (const fn of anims) fn(dt, elapsed, phase)
  }

  return { chimneys, update }
}
