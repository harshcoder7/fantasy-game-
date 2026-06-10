/**
 * Everdawn Vale — left-side parchment chronicle feed (DESIGN.md §5).
 * Newest entries on top, fading away after ~30 real seconds (hover pauses the
 * fade), plus the persistent festival-knowledge tracker line.
 */
import type { ChronicleEntry, WorldApi } from '../types'
import { FESTIVAL_RUMOR_ID } from '../constants'

const MAX_ENTRIES = 60
/** must track the CSS animation: chron-fade 4.5s ease 30s forwards */
const ENTRY_LIFETIME_S = 35.5

const pad2 = (n: number): string => String(n).padStart(2, '0')

interface LiveEntry {
  el: HTMLElement
  /** real seconds alive, frozen while the feed is hovered (matching the CSS pause) */
  age: number
}

export function createChronicle(root: HTMLElement, world: WorldApi): { update(dtSec: number): void } {
  const panel = document.createElement('div')
  panel.className = 'chronicle'

  const header = document.createElement('div')
  header.className = 'chronicle-header parchment'
  header.textContent = '📜 Chronicle of the Vale'
  panel.appendChild(header)

  const tracker = document.createElement('div')
  tracker.className = 'chronicle-tracker parchment'
  panel.appendChild(tracker)

  const feed = document.createElement('div')
  feed.className = 'chronicle-feed'
  panel.appendChild(feed)
  root.appendChild(panel)

  let hovered = false
  feed.addEventListener('mouseenter', () => {
    hovered = true
  })
  feed.addEventListener('mouseleave', () => {
    hovered = false
  })

  const entries: LiveEntry[] = []

  function addEntry(e: ChronicleEntry): void {
    const t = world.clock.time
    const row = document.createElement('div')
    row.className = 'chron-entry parchment'

    const icon = document.createElement('span')
    icon.className = 'chron-icon'
    icon.textContent = e.icon

    const body = document.createElement('div')
    const text = document.createElement('span')
    text.className = 'chron-text'
    text.textContent = e.text
    const stamp = document.createElement('span')
    stamp.className = 'chron-stamp'
    stamp.textContent = `Day ${t.day} · ${pad2(t.hour)}:${pad2(t.minute)}`
    body.appendChild(text)
    body.appendChild(stamp)

    row.appendChild(icon)
    row.appendChild(body)
    feed.prepend(row)
    entries.unshift({ el: row, age: 0 })

    while (entries.length > MAX_ENTRIES) {
      const old = entries.pop()
      old?.el.remove()
    }
  }

  // ---- festival-knowledge tracker ----
  let trackerText = ''
  function refreshTracker(): void {
    const rumor = world.rumors.get(FESTIVAL_RUMOR_ID)
    const known = rumor ? rumor.knownBy.size : 0
    const souls = world.agents.length
    const text = `🌕 The festival is known to ${known} of ${souls} souls`
    if (text !== trackerText) {
      trackerText = text
      tracker.textContent = text
    }
  }
  refreshTracker()

  world.bus.on<ChronicleEntry>('chronicle', (e) => addEntry(e))
  world.bus.on<{ rumorId: string }>('rumor:spread', (p) => {
    if (p.rumorId === FESTIVAL_RUMOR_ID) refreshTracker()
  })

  function update(dtSec: number): void {
    if (hovered || entries.length === 0) return
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i]
      entry.age += dtSec
      if (entry.age > ENTRY_LIFETIME_S) {
        entry.el.remove()
        entries.splice(i, 1)
      }
    }
  }

  return { update }
}
