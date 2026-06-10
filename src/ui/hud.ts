/**
 * Everdawn Vale — top-center carved banner HUD (DESIGN.md §5):
 * day counter, clock, sun/moon arc dial, phase glyph, speed runes,
 * festival countdown chip, and the bottom-left LLM status rune.
 */
import type { GamePhase, WorldApi } from '../types'
import { FESTIVAL_DAY, FESTIVAL_START_MIN, SPEEDS } from '../constants'

const pad2 = (n: number): string => String(n).padStart(2, '0')

const PHASE_GLYPH: Record<GamePhase, string> = {
  dawn: '🌅',
  day: '☀️',
  dusk: '🌇',
  night: '🌙',
}

const SPEED_RUNES = ['⏸', '▶', '▶▶', '▶▶▶'] as const
const SPEED_TITLES = [
  'Hold the hourglass (pause)',
  'Let time flow (1×)',
  'Hasten the hours (3×)',
  'Race the sun (10×)',
] as const

const DIAL_W = 84
const DIAL_H = 42

function el(tag: string, cls: string, text?: string): HTMLElement {
  const e = document.createElement(tag)
  e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

/** Sun rises at dayFraction 0.25 (06:00) and sets at 0.75 (18:00); the moon mirrors it. */
function drawDial(ctx: CanvasRenderingContext2D, frac: number): void {
  ctx.clearRect(0, 0, DIAL_W, DIAL_H)
  const cx = DIAL_W / 2
  const cy = DIAL_H - 8
  const r = 26

  // horizon line
  ctx.strokeStyle = 'rgba(201, 162, 39, 0.45)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(4, cy + 0.5)
  ctx.lineTo(DIAL_W - 4, cy + 0.5)
  ctx.stroke()

  // arc track with zenith tick
  ctx.strokeStyle = 'rgba(201, 162, 39, 0.3)'
  ctx.beginPath()
  ctx.arc(cx, cy, r, Math.PI, 0)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(cx, cy - r - 2)
  ctx.lineTo(cx, cy - r + 2)
  ctx.stroke()

  const place = (t: number): { x: number; y: number } => {
    const a = Math.PI * (1 - t)
    return { x: cx + Math.cos(a) * r, y: cy - Math.sin(a) * r }
  }

  // sun above the horizon 0.25..0.75
  if (frac >= 0.25 && frac <= 0.75) {
    const p = place((frac - 0.25) / 0.5)
    const glow = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, 11)
    glow.addColorStop(0, 'rgba(255, 219, 102, 0.95)')
    glow.addColorStop(1, 'rgba(255, 219, 102, 0)')
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(p.x, p.y, 11, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#ffd95e'
    ctx.beginPath()
    ctx.arc(p.x, p.y, 4.4, 0, Math.PI * 2)
    ctx.fill()
  }

  // moon above the horizon 0.75..1.25 (wrapping midnight)
  const nightT = ((frac - 0.75 + 1) % 1) / 0.5
  if (nightT >= 0 && nightT <= 1) {
    const p = place(nightT)
    const glow = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, 9)
    glow.addColorStop(0, 'rgba(214, 224, 240, 0.7)')
    glow.addColorStop(1, 'rgba(214, 224, 240, 0)')
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(p.x, p.y, 9, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#dde5f2'
    ctx.beginPath()
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2)
    ctx.fill()
    // crescent bite
    ctx.save()
    ctx.globalCompositeOperation = 'destination-out'
    ctx.beginPath()
    ctx.arc(p.x + 2, p.y - 1.4, 3.1, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
}

export function createHud(root: HTMLElement, world: WorldApi): { update(): void } {
  const top = el('div', 'hud-top')
  const banner = el('div', 'hud-banner carved')

  banner.appendChild(el('span', 'hud-ornament', '❖'))
  const dayEl = el('div', 'hud-day')
  banner.appendChild(dayEl)

  const dialWrap = el('div', 'hud-dial')
  const dial = document.createElement('canvas')
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  dial.width = DIAL_W * dpr
  dial.height = DIAL_H * dpr
  dial.style.width = `${DIAL_W}px`
  dial.style.height = `${DIAL_H}px`
  dial.title = 'The wheel of the heavens'
  const dctx = dial.getContext('2d')
  if (dctx) dctx.scale(dpr, dpr)
  dialWrap.appendChild(dial)
  banner.appendChild(dialWrap)

  const clockEl = el('div', 'hud-clock')
  banner.appendChild(clockEl)
  const phaseEl = el('span', 'hud-phase')
  banner.appendChild(phaseEl)

  const speeds = el('div', 'hud-speeds')
  const speedBtns: HTMLButtonElement[] = SPEEDS.map((s, i) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'rune-btn'
    b.textContent = SPEED_RUNES[i]
    b.title = SPEED_TITLES[i]
    b.addEventListener('click', () => {
      world.clock.speed = s
    })
    speeds.appendChild(b)
    return b
  })
  banner.appendChild(speeds)
  banner.appendChild(el('span', 'hud-ornament', '❖'))

  const chip = el('div', 'festival-chip')
  top.appendChild(banner)
  top.appendChild(chip)
  root.appendChild(top)

  // ---- LLM status rune (bottom-left) ----
  const rune = el('div', 'llm-rune')
  root.appendChild(rune)
  const setLive = (live: boolean): void => {
    rune.classList.toggle('live', live)
    rune.textContent = live ? '✦ the vale dreams deeply' : '✦ the vale dreams locally'
  }
  setLive(world.brain.live())
  world.bus.on<{ live: boolean }>('llm:status', (p) => setLive(p.live))

  // ---- change-detection caches ----
  let lastDayText = ''
  let lastClockText = ''
  let lastPhase: GamePhase | '' = ''
  let lastSpeed = Number.NaN
  let lastChipText = ''
  let lastChipLive = false
  let lastDialMin = -1

  function festivalChipText(): { text: string; live: boolean } {
    if (world.festivalActive) return { text: '🎉 The Harvest Moon Festival!', live: true }
    const t = world.clock.time
    if (t.day < FESTIVAL_DAY) {
      const n = FESTIVAL_DAY - t.day
      return { text: `🌕 Festival in ${n} ${n === 1 ? 'day' : 'days'}`, live: false }
    }
    const minOfDay = t.hour * 60 + t.minute
    if (t.day === FESTIVAL_DAY && minOfDay < FESTIVAL_START_MIN) {
      const hh = pad2(Math.floor(FESTIVAL_START_MIN / 60))
      const mm = pad2(FESTIVAL_START_MIN % 60)
      return { text: `🌕 Festival tonight at ${hh}:${mm}!`, live: false }
    }
    return { text: '🌙 The festival lives on in song', live: false }
  }

  function update(): void {
    const t = world.clock.time

    const dayText = `Day ${t.day} of the Harvest Moon`
    if (dayText !== lastDayText) {
      lastDayText = dayText
      dayEl.textContent = dayText
    }

    const clockText = `${pad2(t.hour)}:${pad2(t.minute)}`
    if (clockText !== lastClockText) {
      lastClockText = clockText
      clockEl.textContent = clockText
    }

    const phase = world.clock.phase()
    if (phase !== lastPhase) {
      lastPhase = phase
      phaseEl.textContent = PHASE_GLYPH[phase]
      phaseEl.title = `It is ${phase} in the vale`
    }

    if (dctx && t.totalMin !== lastDialMin) {
      lastDialMin = t.totalMin
      drawDial(dctx, world.clock.dayFraction())
    }

    if (world.clock.speed !== lastSpeed) {
      lastSpeed = world.clock.speed
      for (let i = 0; i < speedBtns.length; i++) {
        speedBtns[i].classList.toggle('active', SPEEDS[i] === lastSpeed)
      }
    }

    const fc = festivalChipText()
    if (fc.text !== lastChipText || fc.live !== lastChipLive) {
      lastChipText = fc.text
      lastChipLive = fc.live
      chip.textContent = fc.text
      chip.classList.toggle('live', fc.live)
    }
  }

  update()
  return { update }
}
