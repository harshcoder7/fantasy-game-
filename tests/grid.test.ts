import { describe, expect, it } from 'vitest'
import { createGrid } from '../src/engine/grid'
import { CELL, WORLD_SIZE } from '../src/constants'
import { PLACES } from '../src/data/places'
import type { GridApi, Vec2 } from '../src/types'

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z)

/** point strictly inside a centered rect footprint */
const insideRect = (p: Vec2, cx: number, cz: number, w: number, d: number) =>
  Math.abs(p.x - cx) < w / 2 && Math.abs(p.z - cz) < d / 2

/** sample the polyline (start + waypoints) and assert no sample enters the rect */
function pathAvoidsRect(grid: GridApi, from: Vec2, path: Vec2[], rect: { x: number; z: number; w: number; d: number }) {
  let prev = from
  for (const wp of path) {
    const steps = Math.max(2, Math.ceil(dist(prev, wp) / (grid.cell / 2)))
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      const p = { x: prev.x + (wp.x - prev.x) * t, z: prev.z + (wp.z - prev.z) * t }
      expect(insideRect(p, rect.x, rect.z, rect.w, rect.d)).toBe(false)
    }
    prev = wp
  }
}

describe('createGrid', () => {
  it('derives n from worldSize/cell and exposes dimensions', () => {
    const grid = createGrid(WORLD_SIZE, CELL)
    expect(grid.n).toBe(110)
    expect(grid.cell).toBe(CELL)
    expect(grid.worldSize).toBe(WORLD_SIZE)
  })

  it('toWorld/toCell round-trip: cell → center → same cell', () => {
    const grid = createGrid(40, 2)
    for (const [cx, cz] of [[0, 0], [5, 7], [19, 19], [10, 3]] as const) {
      const w = grid.toWorld(cx, cz)
      expect(grid.toCell(w)).toEqual({ cx, cz })
    }
  })

  it('toCell of an arbitrary point maps to a center within half a cell diagonal', () => {
    const grid = createGrid(40, 2)
    const p = { x: 3.3, z: -7.9 }
    const c = grid.toCell(p)
    const center = grid.toWorld(c.cx, c.cz)
    expect(Math.abs(center.x - p.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(center.z - p.z)).toBeLessThanOrEqual(1)
  })

  it('starts fully walkable; inBounds rejects outside cells', () => {
    const grid = createGrid(40, 2)
    expect(grid.walkable(0, 0)).toBe(true)
    expect(grid.walkable(19, 19)).toBe(true)
    expect(grid.inBounds(-1, 5)).toBe(false)
    expect(grid.inBounds(5, 20)).toBe(false)
    expect(grid.walkable(-1, 5)).toBe(false)
    expect(grid.walkable(20, 0)).toBe(false)
  })

  it('setBlocked round-trips a single cell', () => {
    const grid = createGrid(40, 2)
    grid.setBlocked(4, 4, true)
    expect(grid.walkable(4, 4)).toBe(false)
    expect(grid.isWalkableAt(grid.toWorld(4, 4))).toBe(false)
    grid.setBlocked(4, 4, false)
    expect(grid.walkable(4, 4)).toBe(true)
  })

  it('blockRect blocks every cell its footprint overlaps, and only nearby ones', () => {
    const grid = createGrid(40, 2)
    grid.blockRect(0, 0, 6, 4) // x ∈ [-3,3], z ∈ [-2,2]
    expect(grid.isWalkableAt({ x: 0, z: 0 })).toBe(false)
    expect(grid.isWalkableAt({ x: -2.9, z: -1.9 })).toBe(false)
    expect(grid.isWalkableAt({ x: 2.9, z: 1.9 })).toBe(false)
    // comfortably outside (more than a cell away)
    expect(grid.isWalkableAt({ x: 0, z: 6 })).toBe(true)
    expect(grid.isWalkableAt({ x: -8, z: 0 })).toBe(true)
  })

  it('blockCircle blocks the disc but not far corners of its bounding box', () => {
    const grid = createGrid(40, 2)
    grid.blockCircle(0, 0, 5)
    expect(grid.isWalkableAt({ x: 0, z: 0 })).toBe(false)
    expect(grid.isWalkableAt({ x: 4, z: 0 })).toBe(false)
    // bounding-box corner at (~5,~5) is outside the disc (r=5 < √50)
    expect(grid.isWalkableAt({ x: 7, z: 7 })).toBe(true)
  })

  describe('nearestWalkable', () => {
    it('returns the point itself when already walkable', () => {
      const grid = createGrid(40, 2)
      const p = { x: 1.25, z: -3.5 }
      expect(grid.nearestWalkable(p)).toEqual(p)
    })

    it('escapes a blocked rect to a walkable point near the rect edge', () => {
      const grid = createGrid(40, 2)
      grid.blockRect(0, 0, 10, 10)
      const out = grid.nearestWalkable({ x: 0, z: 0 })
      expect(grid.isWalkableAt(out)).toBe(true)
      expect(insideRect(out, 0, 0, 10, 10)).toBe(false)
      // should be just outside the footprint, not across the map
      expect(dist(out, { x: 0, z: 0 })).toBeLessThan(10)
    })
  })

  describe('findPath', () => {
    it('on an open grid: non-empty, excludes start, ends at the goal', () => {
      const grid = createGrid(40, 2)
      const from = grid.toWorld(2, 2)
      const to = grid.toWorld(15, 12)
      const path = grid.findPath(from, to)
      expect(path.length).toBeGreaterThan(0)
      for (const wp of path) {
        expect(wp).not.toEqual(from)
        expect(grid.isWalkableAt(wp)).toBe(true)
      }
      expect(path[path.length - 1]).toEqual(to)
    })

    it('consecutive waypoints stay connected (each leg crosses only walkable cells)', () => {
      const grid = createGrid(40, 2)
      grid.blockRect(0, 0, 12, 4)
      const from = { x: -10, z: -8 }
      const to = { x: 10, z: 8 }
      const path = grid.findPath(from, to)
      expect(path.length).toBeGreaterThan(0)
      let prev = from
      for (const wp of path) {
        const steps = Math.max(2, Math.ceil(dist(prev, wp) / 0.5))
        for (let i = 0; i <= steps; i++) {
          const t = i / steps
          expect(
            grid.isWalkableAt({ x: prev.x + (wp.x - prev.x) * t, z: prev.z + (wp.z - prev.z) * t }),
          ).toBe(true)
        }
        prev = wp
      }
    })

    it('routes AROUND a blocked rect — no waypoint or segment sample inside it', () => {
      const grid = createGrid(40, 2)
      const rect = { x: 0, z: 0, w: 16, d: 6 }
      grid.blockRect(rect.x, rect.z, rect.w, rect.d)
      const from = { x: 0, z: -10 }
      const to = { x: 0, z: 10 }
      const path = grid.findPath(from, to)
      expect(path.length).toBeGreaterThan(0)
      expect(path[path.length - 1]).toEqual(to)
      for (const wp of path) expect(insideRect(wp, rect.x, rect.z, rect.w, rect.d)).toBe(false)
      pathAvoidsRect(grid, from, path, rect)
    })

    it('returns [] when the goal is unreachable (full-width wall)', () => {
      const grid = createGrid(40, 2)
      grid.blockRect(0, 0, 40, 4) // spans the whole world on x
      const path = grid.findPath({ x: 0, z: -12 }, { x: 0, z: 12 })
      expect(path).toEqual([])
    })

    it('snaps a blocked destination to the nearest walkable spot', () => {
      const grid = createGrid(40, 2)
      grid.blockRect(8, 8, 6, 6)
      const path = grid.findPath({ x: -10, z: -10 }, { x: 8, z: 8 })
      expect(path.length).toBeGreaterThan(0)
      const end = path[path.length - 1]
      expect(grid.isWalkableAt(end)).toBe(true)
      expect(insideRect(end, 8, 8, 6, 6)).toBe(false)
      expect(dist(end, { x: 8, z: 8 })).toBeLessThan(8)
    })

    it('same-cell from/to returns a single waypoint at the destination', () => {
      const grid = createGrid(40, 2)
      const path = grid.findPath({ x: 1.2, z: 1.2 }, { x: 1.6, z: 1.6 })
      expect(path).toEqual([{ x: 1.6, z: 1.6 }])
    })
  })

  describe('real vale layout', () => {
    const grid = createGrid(WORLD_SIZE, CELL)
    for (const place of PLACES) {
      if (place.solid) grid.blockRect(place.x, place.z, place.w, place.d)
    }

    it('every entrance stays walkable after blocking all solid footprints', () => {
      for (const place of PLACES) {
        expect(grid.isWalkableAt(place.entrance), `${place.id} entrance`).toBe(true)
      }
    })

    it('every entrance can reach the market entrance', () => {
      const market = PLACES.find((p) => p.id === 'market')!
      for (const place of PLACES) {
        if (place.id === 'market') continue
        const path = grid.findPath(place.entrance, market.entrance)
        expect(path.length, `${place.id} → market`).toBeGreaterThan(0)
        expect(path[path.length - 1]).toEqual(market.entrance)
      }
    })
  })
})
