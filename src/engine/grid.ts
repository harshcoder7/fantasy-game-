import type { GridApi, Vec2 } from '../types'

/**
 * Walkability grid + pathfinding for Everdawn Vale.
 *
 * The world is a square of `worldSize` units centered on the origin, split
 * into n×n cells of `cell` units (cells are half-open: a point exactly on a
 * boundary belongs to the higher cell). Everything starts walkable; buildings,
 * trees and the lake punch holes with blockRect/blockCircle, which mark every
 * cell their footprint overlaps (conservative — agents never clip walls).
 *
 * findPath = A* (4-connected, unit step cost, Manhattan heuristic, binary
 * min-heap) followed by string-pulling over Bresenham cell line-of-sight.
 * All world-coordinate entry points clamp out-of-bounds input — nothing here
 * ever throws on a bad point.
 */
export function createGrid(worldSize: number, cell: number): GridApi {
  const n = Math.max(1, Math.round(worldSize / cell))
  const half = worldSize / 2
  const total = n * n

  /** walk[cz * n + cx] — true means walkable */
  const walk: boolean[] = new Array<boolean>(total).fill(true)

  // ---------------------------------------------------------------- helpers

  const clampCell = (c: number): number => (c < 0 ? 0 : c >= n ? n - 1 : c)
  const clampNum = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

  const inBounds = (cx: number, cz: number): boolean => cx >= 0 && cz >= 0 && cx < n && cz < n

  const walkable = (cx: number, cz: number): boolean => {
    const x = Math.floor(cx)
    const z = Math.floor(cz)
    return x >= 0 && z >= 0 && x < n && z < n && walk[z * n + x]
  }

  const toCell = (p: Vec2): { cx: number; cz: number } => ({
    cx: Math.floor((p.x + half) / cell),
    cz: Math.floor((p.z + half) / cell),
  })

  const toWorld = (cx: number, cz: number): Vec2 => ({
    x: (cx + 0.5) * cell - half,
    z: (cz + 0.5) * cell - half,
  })

  const isWalkableAt = (p: Vec2): boolean => {
    const c = toCell(p)
    return walkable(c.cx, c.cz)
  }

  const setBlocked = (cx: number, cz: number, blocked: boolean): void => {
    const x = Math.floor(cx)
    const z = Math.floor(cz)
    if (x < 0 || z < 0 || x >= n || z >= n) return
    walk[z * n + x] = !blocked
  }

  // ---------------------------------------------------------------- blocking

  const blockRect = (centerX: number, centerZ: number, w: number, d: number): void => {
    const hw = Math.abs(w) / 2
    const hd = Math.abs(d) / 2
    const lo = toCell({ x: centerX - hw, z: centerZ - hd })
    const hi = toCell({ x: centerX + hw, z: centerZ + hd })
    if (hi.cx < 0 || hi.cz < 0 || lo.cx >= n || lo.cz >= n) return // entirely outside
    const x0 = clampCell(lo.cx)
    const x1 = clampCell(hi.cx)
    const z0 = clampCell(lo.cz)
    const z1 = clampCell(hi.cz)
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) walk[cz * n + cx] = false
    }
  }

  const blockCircle = (centerX: number, centerZ: number, radius: number): void => {
    const r = Math.abs(radius)
    const lo = toCell({ x: centerX - r, z: centerZ - r })
    const hi = toCell({ x: centerX + r, z: centerZ + r })
    if (hi.cx < 0 || hi.cz < 0 || lo.cx >= n || lo.cz >= n) return // entirely outside
    const x0 = clampCell(lo.cx)
    const x1 = clampCell(hi.cx)
    const z0 = clampCell(lo.cz)
    const z1 = clampCell(hi.cz)
    const r2 = r * r
    for (let cz = z0; cz <= z1; cz++) {
      const zMin = cz * cell - half
      const nearZ = clampNum(centerZ, zMin, zMin + cell)
      const dz = centerZ - nearZ
      for (let cx = x0; cx <= x1; cx++) {
        const xMin = cx * cell - half
        const nearX = clampNum(centerX, xMin, xMin + cell)
        const dx = centerX - nearX
        // block any cell the disc overlaps (circle vs cell-rect intersection)
        if (dx * dx + dz * dz <= r2) walk[cz * n + cx] = false
      }
    }
  }

  // ---------------------------------------------------------------- queries

  const nearestWalkable = (p: Vec2, maxRadiusCells: number = n): Vec2 => {
    if (isWalkableAt(p)) return p
    const c = toCell(p)
    const scx = clampCell(c.cx)
    const scz = clampCell(c.cz)
    // p itself may be out of bounds; its clamped border cell might already do
    if (walkable(scx, scz)) return toWorld(scx, scz)

    let best: Vec2 | null = null
    let bestD = Infinity
    const consider = (cx: number, cz: number): void => {
      if (!walkable(cx, cz)) return
      const w = toWorld(cx, cz)
      const dx = w.x - p.x
      const dz = w.z - p.z
      const d = dx * dx + dz * dz
      if (d < bestD) {
        bestD = d
        best = w
      }
    }

    // expanding square rings (spiral); within the first ring containing any
    // walkable cell, return the one closest to p in world distance
    const reach = Math.max(scx, n - 1 - scx, scz, n - 1 - scz)
    const maxR = Math.min(Math.max(0, Math.floor(maxRadiusCells)), reach)
    for (let r = 1; r <= maxR; r++) {
      for (let dx = -r; dx <= r; dx++) {
        consider(scx + dx, scz - r)
        consider(scx + dx, scz + r)
      }
      for (let dz = -r + 1; dz <= r - 1; dz++) {
        consider(scx - r, scz + dz)
        consider(scx + r, scz + dz)
      }
      if (best) return best
    }
    return p // nothing walkable within reach — give the point back unchanged
  }

  // ---------------------------------------------------------------- A* state
  // Buffers are reused across queries and validated by a generation stamp, so
  // findPath allocates almost nothing per call.

  const gScore = new Float64Array(total)
  const fScore = new Float64Array(total)
  const parent = new Int32Array(total)
  const seenAt = new Int32Array(total)
  const closedAt = new Int32Array(total)
  let generation = 0

  /** binary min-heap over node indices ordered by fScore (ties → larger g) */
  const heapLess = (a: number, b: number): boolean =>
    fScore[a] < fScore[b] || (fScore[a] === fScore[b] && gScore[a] > gScore[b])

  const heapPush = (heap: number[], v: number): void => {
    heap.push(v)
    let i = heap.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (!heapLess(heap[i], heap[p])) break
      const tmp = heap[i]
      heap[i] = heap[p]
      heap[p] = tmp
      i = p
    }
  }

  const heapPop = (heap: number[]): number => {
    const top = heap[0]
    const last = heap.pop()
    if (heap.length > 0 && last !== undefined) {
      heap[0] = last
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let m = i
        if (l < heap.length && heapLess(heap[l], heap[m])) m = l
        if (r < heap.length && heapLess(heap[r], heap[m])) m = r
        if (m === i) break
        const tmp = heap[i]
        heap[i] = heap[m]
        heap[m] = tmp
        i = m
      }
    }
    return top
  }

  /**
   * Bresenham line-of-sight between two in-bounds cells: every rasterized cell
   * must be walkable, and a diagonal step may not squeeze between two blocked
   * orthogonal neighbours (prevents paths clipping building corners).
   */
  const los = (x0: number, z0: number, x1: number, z1: number): boolean => {
    const dx = Math.abs(x1 - x0)
    const dz = Math.abs(z1 - z0)
    const sx = x0 < x1 ? 1 : -1
    const sz = z0 < z1 ? 1 : -1
    let err = dx - dz
    let cx = x0
    let cz = z0
    for (;;) {
      if (!walk[cz * n + cx]) return false
      if (cx === x1 && cz === z1) return true
      const e2 = 2 * err
      const stepX = e2 > -dz
      const stepZ = e2 < dx
      if (stepX && stepZ && (!walk[cz * n + (cx + sx)] || !walk[(cz + sz) * n + cx])) {
        return false // corner squeeze
      }
      if (stepX) {
        err -= dz
        cx += sx
      }
      if (stepZ) {
        err += dx
        cz += sz
      }
    }
  }

  // ---------------------------------------------------------------- findPath

  const findPath = (from: Vec2, to: Vec2): Vec2[] => {
    // Destination snapped onto the nearest walkable spot (clamps out-of-bounds).
    const dest = nearestWalkable(to)
    if (!isWalkableAt(dest)) return [] // nothing walkable anywhere near `to`
    const goal = toCell(dest)
    const goalIdx = goal.cz * n + goal.cx

    // Start cell: clamp into bounds; if standing inside something freshly
    // blocked, path out from the nearest walkable cell instead of failing.
    const fc = toCell(from)
    let scx = clampCell(fc.cx)
    let scz = clampCell(fc.cz)
    if (!walkable(scx, scz)) {
      const s = nearestWalkable(from)
      if (!isWalkableAt(s)) return []
      const sc = toCell(s)
      scx = sc.cx
      scz = sc.cz
    }
    const startIdx = scz * n + scx

    if (startIdx === goalIdx) return [{ x: dest.x, z: dest.z }]

    // ---- A* ----
    generation++
    const gen = generation
    const heap: number[] = []

    const hCost = (cx: number, cz: number): number =>
      Math.abs(cx - goal.cx) + Math.abs(cz - goal.cz)

    const openNode = (i: number, cx: number, cz: number, g: number, par: number): void => {
      seenAt[i] = gen
      gScore[i] = g
      fScore[i] = g + hCost(cx, cz)
      parent[i] = par
      heapPush(heap, i)
    }

    const relax = (i: number, cx: number, cz: number, g: number, par: number): void => {
      if (!walk[i] || closedAt[i] === gen) return
      if (seenAt[i] === gen && gScore[i] <= g) return
      openNode(i, cx, cz, g, par)
    }

    openNode(startIdx, scx, scz, 0, -1)
    let found = false
    while (heap.length > 0) {
      const cur = heapPop(heap)
      if (closedAt[cur] === gen) continue // stale duplicate left in the heap
      closedAt[cur] = gen
      if (cur === goalIdx) {
        found = true
        break
      }
      const cx = cur % n
      const cz = (cur - cx) / n
      const g = gScore[cur] + 1
      if (cx + 1 < n) relax(cur + 1, cx + 1, cz, g, cur)
      if (cx > 0) relax(cur - 1, cx - 1, cz, g, cur)
      if (cz + 1 < n) relax(cur + n, cx, cz + 1, g, cur)
      if (cz > 0) relax(cur - n, cx, cz - 1, g, cur)
    }
    if (!found) return [] // separate walkable components

    // Reconstruct the start→goal cell chain.
    const chain: number[] = []
    for (let i = goalIdx; i !== -1; i = parent[i]) chain.push(i)
    chain.reverse()

    // ---- string-pulling: from each anchor keep the farthest visible cell ----
    const waypoints: Vec2[] = []
    let anchor = 0
    while (anchor < chain.length - 1) {
      const a = chain[anchor]
      const ax = a % n
      const az = (a - ax) / n
      let next = anchor + 1
      for (let j = chain.length - 1; j > anchor + 1; j--) {
        const b = chain[j]
        const bx = b % n
        if (los(ax, az, bx, (b - bx) / n)) {
          next = j
          break
        }
      }
      const c = chain[next]
      const cx = c % n
      waypoints.push(toWorld(cx, (c - cx) / n))
      anchor = next
    }

    // End exactly at the snapped destination (it lies inside the goal cell,
    // which the last waypoint's cell center already reached).
    waypoints[waypoints.length - 1] = { x: dest.x, z: dest.z }
    return waypoints
  }

  return {
    n,
    cell,
    worldSize,
    inBounds,
    walkable,
    setBlocked,
    blockRect,
    blockCircle,
    toCell,
    toWorld,
    isWalkableAt,
    nearestWalkable,
    findPath,
  }
}
