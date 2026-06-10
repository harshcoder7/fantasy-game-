/**
 * Contracts for the three.js layer. scene.ts implements SceneCtx; every other
 * three/* builder receives it. See DESIGN.md §4 for the art direction.
 */
import type * as THREE from 'three'
import type { AgentApi, GamePhase, PlaceDef, Vec2, WorldApi } from '../types'

export interface Vector3Like { x: number; y: number; z: number }

export interface SceneCtx {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  /** OrbitControls (typed as any to avoid example-module type coupling) */
  controls: any
  sun: THREE.DirectionalLight
  /** drive sky gradient, sun/moon position, light colors, fog, stars */
  setTimeOfDay(dayFrac: number, phase: GamePhase): void
  /** glide camera target to a world point */
  focusOn(p: Vec2, distance?: number): void
  /** while set, camera tracks the position every frame (null to release) */
  follow(getPos: (() => Vec2) | null): void
  /** terrain height lookup other layers may use for placement (set by terrain.ts) */
  heightAt: (x: number, z: number) => number
  raycastFromScreen(clientX: number, clientY: number, objects: THREE.Object3D[]): THREE.Intersection[]
  /** damped controls + follow + sky animation */
  update(dtSec: number): void
  resize(): void
}

export interface LayerApi { update(dtSec: number, phase: GamePhase): void }

export interface VillageApi extends LayerApi {
  /** chimney tips (world coords) for the smoke system */
  chimneys: Vector3Like[]
}

export interface FestivalVisualApi extends LayerApi {
  setDressed(b: boolean): void
  setActive(b: boolean): void
}

export interface CharacterLayerApi {
  add(agent: AgentApi): void
  /** positions, walk anim, sleep pose, name/status sprites, thinking 💭, zzz */
  update(world: WorldApi, dtSec: number): void
  /** agentId under the cursor, else null */
  pick(clientX: number, clientY: number): string | null
  setSelected(agentId: string | null): void
  /** floating speech bubble above an agent (canvas sprite), auto-hides */
  showBubble(agentId: string, text: string, seconds: number): void
}
