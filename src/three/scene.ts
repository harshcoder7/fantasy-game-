/**
 * three/scene.ts — renderer, camera, orbit controls, sky dome (gradient + sun/moon/
 * stars), lights and fog, all driven by the day cycle. Implements SceneCtx.
 * See DESIGN.md §4 and three/contracts.ts.
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { GamePhase, Vec2 } from '../types'
import type { SceneCtx } from './contracts'

// ---------------------------------------------------------------- constants
const WORLD_BOUND = 105
const DOME_RADIUS = 420
const STAR_RADIUS = 405
const ORBIT_RADIUS = 365
const STAR_COUNT = 700
/** tilt of the sun/moon orbit plane toward +z, so discs arc across the southern sky */
const ORBIT_TILT = 0.42
const SUN_RISE_F = 6 / 24 // sun is up 6:00 → 20:00
const SUN_SET_F = 20 / 24
const GLIDE_SEC = 0.8
const FOLLOW_LERP = 0.12

const smooth01 = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t))
const mix = (a: number, b: number, t: number): number => a + (b - a) * t

// ---------------------------------------------------------------- sky palette
interface SkyKey {
  f: number
  top: THREE.Color
  horizon: THREE.Color
  sun: THREE.Color
  sunI: number
  hemiSky: THREE.Color
  hemiGround: THREE.Color
  hemiI: number
  amb: THREE.Color
  ambI: number
  fogNear: number
  fogFar: number
  stars: number
}

function key(
  f: number, top: number, horizon: number, sun: number, sunI: number,
  hemiSky: number, hemiGround: number, hemiI: number, amb: number, ambI: number,
  fogNear: number, fogFar: number, stars: number,
): SkyKey {
  return {
    f,
    top: new THREE.Color(top),
    horizon: new THREE.Color(horizon),
    sun: new THREE.Color(sun),
    sunI,
    hemiSky: new THREE.Color(hemiSky),
    hemiGround: new THREE.Color(hemiGround),
    hemiI,
    amb: new THREE.Color(amb),
    ambI,
    fogNear,
    fogFar,
    stars,
  }
}

/**
 * Day-cycle keyframes over dayFraction (0 = midnight). Night → pre-dawn purple →
 * dawn gold → azure day → warm late afternoon → dusk orange → navy night.
 * First and last entries are identical so the cycle wraps without popping.
 */
const SKY_KEYS: SkyKey[] = [
  key(0.000, 0x070d24, 0x18233f, 0x93a7e0, 0.12, 0x27325c, 0x10141f, 0.16, 0x1b2342, 0.22, 80, 380, 1.0),
  key(0.180, 0x070d24, 0x18233f, 0x93a7e0, 0.12, 0x27325c, 0x10141f, 0.16, 0x1b2342, 0.22, 80, 380, 1.0),
  key(0.235, 0x251f4d, 0x5c4470, 0xb48ab0, 0.22, 0x4a3c6a, 0x1c1828, 0.22, 0x2c2450, 0.24, 92, 400, 0.55),
  key(0.272, 0x5d77b8, 0xf2a45e, 0xffc183, 1.35, 0x8d9cc8, 0x6a5a40, 0.40, 0x6f6a8a, 0.30, 112, 432, 0.05),
  key(0.335, 0x4f8ed6, 0xc4e0f0, 0xffeec8, 2.25, 0xb8d2e8, 0x7d9560, 0.52, 0x9fb4cc, 0.32, 132, 470, 0.0),
  key(0.520, 0x3f86dc, 0xd8ecf7, 0xfff6e0, 2.70, 0xcfe4f4, 0x8aa468, 0.58, 0xb6c8da, 0.34, 150, 505, 0.0),
  key(0.700, 0x4a83cc, 0xe8d8ae, 0xffe2a8, 2.05, 0xc2d2e0, 0x84985e, 0.50, 0xb0b4be, 0.30, 134, 470, 0.0),
  key(0.785, 0x41447e, 0xf0884e, 0xff9550, 1.05, 0x79719e, 0x58503e, 0.36, 0x6e6080, 0.26, 110, 430, 0.08),
  key(0.832, 0x1c1d49, 0x74507c, 0xb08bb0, 0.34, 0x443e6e, 0x201c2c, 0.24, 0x2e2752, 0.24, 92, 400, 0.50),
  key(0.875, 0x070d24, 0x18233f, 0x93a7e0, 0.12, 0x27325c, 0x10141f, 0.16, 0x1b2342, 0.22, 80, 380, 1.0),
  key(1.000, 0x070d24, 0x18233f, 0x93a7e0, 0.12, 0x27325c, 0x10141f, 0.16, 0x1b2342, 0.22, 80, 380, 1.0),
]

interface SkyState {
  top: THREE.Color
  horizon: THREE.Color
  sun: THREE.Color
  sunI: number
  hemiSky: THREE.Color
  hemiGround: THREE.Color
  hemiI: number
  amb: THREE.Color
  ambI: number
  fogNear: number
  fogFar: number
  stars: number
}

/** smoothstep-eased interpolation between adjacent keyframes (wraps at 1). */
function sampleSky(dayFrac: number, out: SkyState): void {
  const f = ((dayFrac % 1) + 1) % 1
  let i = 0
  while (i < SKY_KEYS.length - 2 && SKY_KEYS[i + 1].f <= f) i++
  const a = SKY_KEYS[i]
  const b = SKY_KEYS[i + 1]
  const span = b.f - a.f
  const t = span > 1e-6 ? smooth01((f - a.f) / span) : 0
  out.top.lerpColors(a.top, b.top, t)
  out.horizon.lerpColors(a.horizon, b.horizon, t)
  out.sun.lerpColors(a.sun, b.sun, t)
  out.hemiSky.lerpColors(a.hemiSky, b.hemiSky, t)
  out.hemiGround.lerpColors(a.hemiGround, b.hemiGround, t)
  out.amb.lerpColors(a.amb, b.amb, t)
  out.sunI = mix(a.sunI, b.sunI, t)
  out.hemiI = mix(a.hemiI, b.hemiI, t)
  out.ambI = mix(a.ambI, b.ambI, t)
  out.fogNear = mix(a.fogNear, b.fogNear, t)
  out.fogFar = mix(a.fogFar, b.fogFar, t)
  out.stars = mix(a.stars, b.stars, t)
}

// ---------------------------------------------------------------- sky shader
const SKY_VERT = /* glsl */ `
varying float vY;
void main() {
  vY = normalize(position).y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const SKY_FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
varying float vY;
void main() {
  float up = pow(clamp(vY, 0.0, 1.0), 0.58);
  vec3 col = mix(uHorizon, uTop, up);
  col = mix(col, uHorizon * 0.45, clamp(-vY * 4.0, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

// ---------------------------------------------------------------- stars
function buildStarGeometry(): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry()
  const pos = new Float32Array(STAR_COUNT * 3)
  const col = new Float32Array(STAR_COUNT * 3)
  // tiny deterministic LCG so the firmament is identical every visit
  let s = 0x2f6e1d35
  const rnd = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
  for (let i = 0; i < STAR_COUNT; i++) {
    const y = rnd() * 1.04 - 0.04 // mostly above the horizon
    const a = rnd() * Math.PI * 2
    const r = Math.sqrt(Math.max(0, 1 - y * y))
    pos[i * 3] = Math.cos(a) * r * STAR_RADIUS
    pos[i * 3 + 1] = y * STAR_RADIUS
    pos[i * 3 + 2] = Math.sin(a) * r * STAR_RADIUS
    const m = 0.55 + rnd() * 0.45
    const warm = rnd() < 0.16 // a few amber stars among the blue-white
    col[i * 3] = m * (warm ? 1.0 : 0.82)
    col[i * 3 + 1] = m * (warm ? 0.86 : 0.88)
    col[i * 3 + 2] = m * (warm ? 0.66 : 1.0)
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
  return geo
}

// ---------------------------------------------------------------- factory
export function createScene(canvas: HTMLCanvasElement): SceneCtx {
  // -- renderer ---------------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.1
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setClearColor(0x070d24, 1)

  // -- scene / camera / controls ----------------------------------------------
  const scene = new THREE.Scene()
  const fog = new THREE.Fog(0x18233f, 130, 470)
  scene.fog = fog

  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.5, 1200)
  camera.position.set(60, 55, 95)
  camera.lookAt(0, 0, 0)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.set(0, 0, 0)
  controls.enableDamping = true
  controls.dampingFactor = 0.07
  controls.minDistance = 12
  controls.maxDistance = 170
  controls.maxPolarAngle = 1.42
  controls.screenSpacePanning = false // pan slides along the ground plane

  // -- lights -------------------------------------------------------------------
  const hemi = new THREE.HemisphereLight(0xcfe4f4, 0x8aa468, 0.5)
  hemi.position.set(0, 90, 0)
  scene.add(hemi)

  const sun = new THREE.DirectionalLight(0xfff6e0, 2.2)
  sun.position.set(80, 120, 40)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.left = -130
  sun.shadow.camera.right = 130
  sun.shadow.camera.top = 130
  sun.shadow.camera.bottom = -130
  sun.shadow.camera.near = 10
  sun.shadow.camera.far = 420
  sun.shadow.bias = -0.0006
  sun.shadow.normalBias = 0.015
  sun.shadow.camera.updateProjectionMatrix()
  scene.add(sun)
  scene.add(sun.target)

  const ambient = new THREE.AmbientLight(0xb6c8da, 0.3)
  scene.add(ambient)

  // -- sky dome + celestial bodies (group follows the camera each frame) ---------
  const skyGroup = new THREE.Group()
  skyGroup.name = 'sky'
  scene.add(skyGroup)

  const skyUniforms = {
    uTop: { value: new THREE.Color(0x070d24) },
    uHorizon: { value: new THREE.Color(0x18233f) },
  }
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(DOME_RADIUS, 32, 20),
    new THREE.ShaderMaterial({
      uniforms: skyUniforms,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
    }),
  )
  dome.renderOrder = -3
  dome.frustumCulled = false
  skyGroup.add(dome)

  const starMat = new THREE.PointsMaterial({
    size: 2.2,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    toneMapped: false,
  })
  const stars = new THREE.Points(buildStarGeometry(), starMat)
  stars.renderOrder = -2
  stars.frustumCulled = false
  stars.visible = false
  skyGroup.add(stars)

  const sunDiscMat = new THREE.MeshBasicMaterial({ color: 0xffd98a, fog: false, toneMapped: false })
  const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(20, 40), sunDiscMat)
  sunDisc.renderOrder = -1
  sunDisc.frustumCulled = false
  const sunHaloMat = new THREE.MeshBasicMaterial({
    color: 0xffd98a, fog: false, toneMapped: false,
    transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false,
  })
  const sunHalo = new THREE.Mesh(new THREE.CircleGeometry(37, 40), sunHaloMat)
  sunHalo.position.z = 1 // a touch toward the camera so the glow overlaps the disc
  sunHalo.frustumCulled = false
  sunDisc.add(sunHalo)
  skyGroup.add(sunDisc)

  const moonDisc = new THREE.Mesh(
    new THREE.CircleGeometry(12, 40),
    new THREE.MeshBasicMaterial({ color: 0xe6ecf8, fog: false, toneMapped: false }),
  )
  moonDisc.renderOrder = -1
  moonDisc.frustumCulled = false
  const moonHalo = new THREE.Mesh(
    new THREE.CircleGeometry(19, 40),
    new THREE.MeshBasicMaterial({
      color: 0xdce4f2, fog: false, toneMapped: false,
      transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  )
  moonHalo.position.z = 1
  moonHalo.frustumCulled = false
  moonDisc.add(moonHalo)
  skyGroup.add(moonDisc)

  // -- scratch state --------------------------------------------------------------
  const S: SkyState = {
    top: new THREE.Color(), horizon: new THREE.Color(), sun: new THREE.Color(), sunI: 0,
    hemiSky: new THREE.Color(), hemiGround: new THREE.Color(), hemiI: 0,
    amb: new THREE.Color(), ambI: 0, fogNear: 130, fogFar: 470, stars: 0,
  }
  const Z_AXIS = new THREE.Vector3(0, 0, 1)
  const _sunDir = new THREE.Vector3()
  const _moonDir = new THREE.Vector3()
  const _lightDir = new THREE.Vector3()
  const _v = new THREE.Vector3()
  const _prevT = new THREE.Vector3()
  const _delta = new THREE.Vector3()
  const _ndc = new THREE.Vector2()
  const raycaster = new THREE.Raycaster()

  interface Glide {
    t: number
    fromT: THREE.Vector3
    toT: THREE.Vector3
    fromC: THREE.Vector3
    toC: THREE.Vector3
  }
  let glide: Glide | null = null
  let followFn: (() => Vec2) | null = null

  /** unit direction along the great circle: u=0 rises east, u=0.5 zenith, u=1 sets west */
  function celestialDir(u: number, out: THREE.Vector3): THREE.Vector3 {
    const theta = u * Math.PI
    const s = Math.sin(theta)
    out.set(Math.cos(theta), s * Math.cos(ORBIT_TILT), s * Math.sin(ORBIT_TILT))
    return out
  }

  /** place a disc on the orbit and face it toward the dome center (= camera) */
  function orientDisc(mesh: THREE.Mesh, dir: THREE.Vector3): void {
    mesh.position.copy(dir).multiplyScalar(ORBIT_RADIUS)
    mesh.quaternion.setFromUnitVectors(Z_AXIS, _v.copy(dir).multiplyScalar(-1).normalize())
  }

  // -- SceneCtx methods -------------------------------------------------------------
  function setTimeOfDay(dayFrac: number, _phase: GamePhase): void {
    sampleSky(dayFrac, S)

    skyUniforms.uTop.value.copy(S.top)
    skyUniforms.uHorizon.value.copy(S.horizon)

    sun.color.copy(S.sun)
    sun.intensity = S.sunI
    hemi.color.copy(S.hemiSky)
    hemi.groundColor.copy(S.hemiGround)
    hemi.intensity = S.hemiI
    ambient.color.copy(S.amb)
    ambient.intensity = S.ambI

    fog.color.copy(S.horizon)
    fog.near = S.fogNear
    fog.far = S.fogFar

    starMat.opacity = S.stars
    stars.visible = S.stars > 0.012

    const f = ((dayFrac % 1) + 1) % 1
    const su = (f - SUN_RISE_F) / (SUN_SET_F - SUN_RISE_F)
    celestialDir(su, _sunDir)
    const mu = (f >= SUN_SET_F ? f - SUN_SET_F : f + 1 - SUN_SET_F) / (1 - (SUN_SET_F - SUN_RISE_F))
    celestialDir(mu, _moonDir)

    orientDisc(sunDisc, _sunDir)
    sunDisc.visible = _sunDir.y > -0.07
    sunDiscMat.color.copy(S.sun)
    sunHaloMat.color.copy(S.sun)
    orientDisc(moonDisc, _moonDir)
    moonDisc.visible = _moonDir.y > -0.07

    // by day the directional light is the sun; by night it is bluish moonlight
    _lightDir.copy(_sunDir.y > 0.015 ? _sunDir : _moonDir)
    _lightDir.y = Math.max(_lightDir.y, 0.08)
    _lightDir.normalize()
    sun.position.copy(_lightDir).multiplyScalar(175)
  }

  function focusOn(p: Vec2, distance?: number): void {
    const toT = new THREE.Vector3(p.x, api.heightAt(p.x, p.z) + 1.4, p.z)
    const offset = new THREE.Vector3().subVectors(camera.position, controls.target)
    if (distance !== undefined) offset.setLength(Math.max(5, distance))
    glide = {
      t: 0,
      fromT: controls.target.clone(),
      toT,
      fromC: camera.position.clone(),
      toC: toT.clone().add(offset),
    }
  }

  function follow(getPos: (() => Vec2) | null): void {
    followFn = getPos
  }

  function raycastFromScreen(clientX: number, clientY: number, objects: THREE.Object3D[]): THREE.Intersection[] {
    const rect = renderer.domElement.getBoundingClientRect()
    _ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    raycaster.setFromCamera(_ndc, camera)
    return raycaster.intersectObjects(objects, true)
  }

  function update(dtSec: number): void {
    if (glide) {
      glide.t += dtSec
      const k = Math.min(glide.t / GLIDE_SEC, 1)
      const e = k * k * (3 - 2 * k)
      controls.target.lerpVectors(glide.fromT, glide.toT, e)
      camera.position.lerpVectors(glide.fromC, glide.toC, e)
      if (k >= 1) glide = null
    } else if (followFn) {
      const p = followFn()
      _v.set(p.x, api.heightAt(p.x, p.z) + 1.6, p.z)
      _prevT.copy(controls.target)
      controls.target.lerp(_v, FOLLOW_LERP)
      camera.position.add(_delta.subVectors(controls.target, _prevT))
    }

    controls.update()

    // clamp pan to world bounds, shifting the camera by the same correction so
    // the view direction is preserved (panning simply stops at the edge)
    const tx = THREE.MathUtils.clamp(controls.target.x, -WORLD_BOUND, WORLD_BOUND)
    const tz = THREE.MathUtils.clamp(controls.target.z, -WORLD_BOUND, WORLD_BOUND)
    camera.position.x += tx - controls.target.x
    camera.position.z += tz - controls.target.z
    controls.target.x = tx
    controls.target.z = tz

    // the sky is camera-centric: dome, discs and stars travel with the viewer
    skyGroup.position.copy(camera.position)
    stars.rotation.y += dtSec * 0.004 // slow drift of the firmament
  }

  function resize(): void {
    const w = window.innerWidth
    const h = window.innerHeight
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setSize(w, h)
  }

  const api: SceneCtx = {
    scene,
    camera,
    renderer,
    controls,
    sun,
    setTimeOfDay,
    focusOn,
    follow,
    heightAt: () => 0, // terrain.ts installs the real lookup
    raycastFromScreen,
    update,
    resize,
  }

  resize()
  setTimeOfDay(0.29, 'dawn') // sane first frame; main drives it from the clock
  controls.update()
  return api
}
