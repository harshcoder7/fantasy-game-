/**
 * Everdawn Vale — right-side slide-in villager codex (DESIGN.md §5).
 * Procedural portrait medallion, live status, potion-vial need bars, and the
 * Soul / Mind / Day / Speak tabs (player chat runs through world.ops so the
 * simulation never blocks).
 */
import type {
  AgentApi, ChatTurn, CharacterLook, ChronicleEntry, MemoryKind, MemoryRecord,
  NeedId, PlanStep, Vec2, WorldApi,
} from '../types'
import {
  CHAT_KEEP_TURNS, CHAT_SUMMARIZE_AFTER, FRIEND_THRESHOLD, OP_TIMEOUT_MS,
} from '../constants'

type TabId = 'soul' | 'mind' | 'day' | 'speak'

interface ChatState { history: ChatTurn[]; summary: string; waiting: boolean }

const TYPEWRITER_MS_PER_CHAR = 18
const UPDATE_INTERVAL_MS = 250 // ≤4Hz live refresh

const MEMORY_ICON: Record<MemoryKind, string> = {
  seed: '🌱',
  observation: '👁',
  dialogue: '💬',
  reflection: '✨',
  plan: '📜',
  chat: '🗣',
}

const NEED_ROWS: ReadonlyArray<{ id: NeedId; icon: string; label: string }> = [
  { id: 'energy', icon: '⚡', label: 'Energy' },
  { id: 'hunger', icon: '🍞', label: 'Hunger' },
  { id: 'social', icon: '💞', label: 'Social' },
  { id: 'spirit', icon: '✨', label: 'Spirit' },
]

const pad2 = (n: number): string => String(n).padStart(2, '0')
const fmtMinOfDay = (m: number): string => `${pad2(Math.floor(m / 60) % 24)}:${pad2(((m % 60) + 60) % 60)}`
const fmtStamp = (totalMin: number): string =>
  `Day ${Math.floor(totalMin / 1440) + 1} · ${fmtMinOfDay(totalMin % 1440)}`
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

// ---------------------------------------------------------------------------
// shared selection (the minimap pulses the codex-selected villager)
let liveSelectedId: string | null = null
/** agent currently open in the codex, readable by sibling UI modules */
export function codexSelectedAgentId(): string | null {
  return liveSelectedId
}

// ---------------------------------------------------------------------------
// procedural portrait medallion
function drawPortrait(canvas: HTMLCanvasElement, look: CharacterLook): void {
  const S = 64
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = S * dpr
  canvas.height = S * dpr
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.scale(dpr, dpr)

  // backplate
  const bg = ctx.createRadialGradient(S * 0.38, S * 0.28, 4, S * 0.5, S * 0.5, S * 0.72)
  bg.addColorStop(0, '#2a3a66')
  bg.addColorStop(1, '#0b101f')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, S, S)

  // tunic shoulders
  ctx.fillStyle = look.tunic
  ctx.beginPath()
  ctx.ellipse(32, 63, 25, 19, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)'
  ctx.lineWidth = 1.5
  ctx.stroke()

  // neck + head
  ctx.fillStyle = look.skin
  ctx.fillRect(28.5, 39, 7, 7)
  ctx.beginPath()
  ctx.arc(32, 30, 13.5, 0, Math.PI * 2)
  ctx.fill()

  // hair: crown half-disc + side locks
  ctx.fillStyle = look.hair
  ctx.beginPath()
  ctx.arc(32, 28.5, 14, Math.PI, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(19.5, 31, 3.8, 0, Math.PI * 2)
  ctx.arc(44.5, 31, 3.8, 0, Math.PI * 2)
  ctx.fill()

  // face
  ctx.fillStyle = '#241a10'
  ctx.beginPath()
  ctx.arc(26.5, 31.5, 1.4, 0, Math.PI * 2)
  ctx.arc(37.5, 31.5, 1.4, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(36, 26, 16, 0.75)'
  ctx.lineWidth = 1.1
  ctx.beginPath()
  ctx.arc(32, 35, 4.2, Math.PI * 0.2, Math.PI * 0.8)
  ctx.stroke()

  // hat hint
  ctx.fillStyle = look.hatColor
  ctx.strokeStyle = look.hatColor
  switch (look.hat) {
    case 'wizard': {
      ctx.beginPath()
      ctx.ellipse(32, 19.5, 16.5, 3.4, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.moveTo(33.5, 2)
      ctx.lineTo(22, 19.5)
      ctx.lineTo(43, 19.5)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = 'rgba(230, 200, 78, 0.85)'
      ctx.lineWidth = 1.4
      ctx.beginPath()
      ctx.moveTo(24.5, 16)
      ctx.lineTo(41, 16)
      ctx.stroke()
      break
    }
    case 'circlet': {
      ctx.lineWidth = 2.6
      ctx.beginPath()
      ctx.arc(32, 28, 13.6, Math.PI * 1.15, Math.PI * 1.85)
      ctx.stroke()
      ctx.fillStyle = '#f6e7a8'
      ctx.beginPath()
      ctx.arc(32, 14.6, 1.9, 0, Math.PI * 2)
      ctx.fill()
      break
    }
    case 'hood': {
      ctx.lineWidth = 6.5
      ctx.beginPath()
      ctx.arc(32, 30, 15.6, Math.PI * 0.62, Math.PI * 2.38)
      ctx.stroke()
      break
    }
    case 'cap': {
      ctx.beginPath()
      ctx.arc(32, 23.5, 13.6, Math.PI, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.ellipse(40, 23.5, 9.5, 2.6, 0, 0, Math.PI * 2)
      ctx.fill()
      break
    }
    case 'flower': {
      for (let i = 0; i < 5; i++) {
        const a = Math.PI * (1.13 + 0.185 * i)
        const fx = 32 + Math.cos(a) * 13.6
        const fy = 28 + Math.sin(a) * 13.6
        ctx.fillStyle = look.hatColor
        for (let p = 0; p < 4; p++) {
          const pa = (Math.PI / 2) * p
          ctx.beginPath()
          ctx.arc(fx + Math.cos(pa) * 1.7, fy + Math.sin(pa) * 1.7, 1.6, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.fillStyle = '#e6c84e'
        ctx.beginPath()
        ctx.arc(fx, fy, 1.1, 0, Math.PI * 2)
        ctx.fill()
      }
      break
    }
    case 'mitre': {
      ctx.beginPath()
      ctx.moveTo(25.5, 21)
      ctx.lineTo(25.5, 9)
      ctx.quadraticCurveTo(32, 0.5, 38.5, 9)
      ctx.lineTo(38.5, 21)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = 'rgba(201, 162, 39, 0.9)'
      ctx.lineWidth = 1.6
      ctx.beginPath()
      ctx.moveTo(32, 3.5)
      ctx.lineTo(32, 21)
      ctx.stroke()
      break
    }
    case 'none':
      break
  }

  // inner medallion shading
  const rim = ctx.createRadialGradient(32, 32, 20, 32, 32, 33)
  rim.addColorStop(0, 'rgba(0, 0, 0, 0)')
  rim.addColorStop(1, 'rgba(0, 0, 0, 0.5)')
  ctx.fillStyle = rim
  ctx.fillRect(0, 0, S, S)
}

// ---------------------------------------------------------------------------
export function createCodex(
  root: HTMLElement,
  world: WorldApi,
  cb: { onFollow(agentId: string | null): void; onFocus(p: Vec2): void },
): { open(agentId: string): void; close(): void; selected(): string | null; update(): void } {
  const panel = el('div', 'codex parchment')

  // -- header ----------------------------------------------------------------
  const head = el('div', 'codex-head')
  const portraitWrap = el('div', 'portrait')
  const portrait = document.createElement('canvas')
  portraitWrap.appendChild(portrait)
  const title = el('div', 'codex-title')
  const nameEl = el('div', 'codex-name')
  const metaEl = el('div', 'codex-meta')
  title.appendChild(nameEl)
  title.appendChild(metaEl)
  const btns = el('div', 'codex-btns')
  const followBtn = document.createElement('button')
  followBtn.type = 'button'
  followBtn.className = 'icon-btn'
  followBtn.textContent = '👁'
  followBtn.title = 'Follow this soul'
  const closeBtn = document.createElement('button')
  closeBtn.type = 'button'
  closeBtn.className = 'icon-btn'
  closeBtn.textContent = '✕'
  closeBtn.title = 'Close the codex'
  btns.appendChild(followBtn)
  btns.appendChild(closeBtn)
  head.appendChild(portraitWrap)
  head.appendChild(title)
  head.appendChild(btns)
  panel.appendChild(head)

  const statusEl = el('div', 'codex-status')
  panel.appendChild(statusEl)

  // -- need vials --------------------------------------------------------------
  const vials = el('div', 'vials')
  const vialFills = new Map<NeedId, HTMLElement>()
  for (const row of NEED_ROWS) {
    const r = el('div', 'vial-row')
    const label = el('span', 'vial-label', row.icon)
    label.title = row.label
    const vial = el('div', 'vial')
    vial.title = row.label
    const fill = el('div', `vial-fill ${row.id}`)
    vial.appendChild(fill)
    r.appendChild(label)
    r.appendChild(vial)
    vials.appendChild(r)
    vialFills.set(row.id, fill)
  }
  panel.appendChild(vials)

  // -- tabs -------------------------------------------------------------------
  const tabBar = el('div', 'codex-tabs')
  const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
    { id: 'soul', label: 'Soul' },
    { id: 'mind', label: 'Mind' },
    { id: 'day', label: 'Day' },
    { id: 'speak', label: 'Speak' },
  ]
  const tabBtns = new Map<TabId, HTMLButtonElement>()
  for (const t of TABS) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'tab-btn'
    b.textContent = t.label
    b.addEventListener('click', () => {
      if (activeTab !== t.id) {
        activeTab = t.id
        renderActiveTab()
      }
    })
    tabBar.appendChild(b)
    tabBtns.set(t.id, b)
  }
  panel.appendChild(tabBar)

  const body = el('div', 'codex-body')
  panel.appendChild(body)
  root.appendChild(panel)

  // -- state ---------------------------------------------------------------------
  let selectedId: string | null = null
  let activeTab: TabId = 'soul'
  let following = false
  const chatStates = new Map<string, ChatState>()
  let speakUi: { agentId: string; log: HTMLElement; input: HTMLInputElement; sendBtn: HTMLButtonElement } | null = null

  // live-refresh caches
  let lastUpdateAt = 0
  let lastStatus = ''
  let lastNeeds = ''
  let lastAffectionSig = ''
  let lastMemoryCount = -1
  let lastPlanRef: readonly PlanStep[] | null = null
  let dayStepEls: Array<{ row: HTMLElement; bar: HTMLElement; step: PlanStep }> = []

  const agent = (): AgentApi | undefined => (selectedId ? world.getAgent(selectedId) : undefined)
  const chatState = (id: string): ChatState => {
    let st = chatStates.get(id)
    if (!st) {
      st = { history: [], summary: '', waiting: false }
      chatStates.set(id, st)
    }
    return st
  }

  // -- soul --------------------------------------------------------------------
  function renderSoul(a: AgentApi): void {
    body.replaceChildren()
    const p = a.persona

    const traits = el('div', 'codex-sec')
    traits.appendChild(el('h4', undefined, 'Nature'))
    const chips = el('div', 'chip-row')
    for (const t of p.traits) chips.appendChild(el('span', 'chip', t))
    traits.appendChild(chips)
    body.appendChild(traits)

    const goals = el('div', 'codex-sec')
    goals.appendChild(el('h4', undefined, 'Aspirations'))
    const ul = el('ul', 'goal-list')
    for (const g of p.goals) ul.appendChild(el('li', undefined, g))
    goals.appendChild(ul)
    body.appendChild(goals)

    const story = el('div', 'codex-sec')
    story.appendChild(el('h4', undefined, 'Story'))
    story.appendChild(el('p', 'backstory', p.backstory))
    body.appendChild(story)

    const bonds = el('div', 'codex-sec')
    bonds.appendChild(el('h4', undefined, 'Bonds'))
    const others = world.agents
      .filter((o) => o.persona.id !== p.id)
      .sort((x, y) => a.affection(y.persona.id) - a.affection(x.persona.id))
    for (const o of others) {
      const aff = a.affection(o.persona.id)
      const row = el('div', 'rel-row')
      row.title = `${p.name} feels ${Math.round(aff)}/100 toward ${o.persona.name} — open their codex`
      const name = el('span', 'rel-name', o.persona.name)
      if (aff >= FRIEND_THRESHOLD) name.classList.add('friend')
      const hearts = el('span', 'rel-hearts')
      const filled = clamp(Math.round(aff / 20), 0, 5)
      hearts.appendChild(document.createTextNode('❤'.repeat(filled)))
      const dim = el('span', 'dim', '❤'.repeat(5 - filled))
      hearts.appendChild(dim)
      row.appendChild(name)
      row.appendChild(hearts)
      row.addEventListener('click', () => open(o.persona.id))
      bonds.appendChild(row)
    }
    body.appendChild(bonds)

    lastAffectionSig = affectionSignature(a)
  }

  function affectionSignature(a: AgentApi): string {
    return world.agents
      .filter((o) => o.persona.id !== a.persona.id)
      .map((o) => `${o.persona.id}:${Math.round(a.affection(o.persona.id))}`)
      .join('|')
  }

  // -- mind --------------------------------------------------------------------
  function renderMind(a: AgentApi): void {
    body.replaceChildren()
    const records = a.memory.recent(40)
    if (records.length === 0) {
      body.appendChild(el('p', 'backstory', 'A mind as blank as fresh parchment.'))
      lastMemoryCount = a.memory.count()
      return
    }
    for (const m of records) body.appendChild(memoryRow(m))
    lastMemoryCount = a.memory.count()
  }

  function memoryRow(m: MemoryRecord): HTMLElement {
    const row = el('div', 'mem-entry')
    if (m.kind === 'reflection') row.classList.add('gilded')
    row.appendChild(el('span', 'mem-icon', MEMORY_ICON[m.kind]))
    const main = el('div', 'mem-main')
    main.appendChild(el('div', 'mem-text', m.text))
    const meta = el('div', 'mem-meta')
    meta.appendChild(el('span', undefined, fmtStamp(m.createdMin)))
    const dots = el('span', 'mem-dots')
    const filled = clamp(Math.round(m.importance / 2), 1, 5)
    dots.appendChild(document.createTextNode('●'.repeat(filled)))
    dots.appendChild(el('span', 'dim', '●'.repeat(5 - filled)))
    dots.title = `importance ${m.importance}/10`
    meta.appendChild(dots)
    main.appendChild(meta)
    row.appendChild(main)
    return row
  }

  // -- day ----------------------------------------------------------------------
  function renderDay(a: AgentApi): void {
    body.replaceChildren()
    dayStepEls = []
    lastPlanRef = a.plan
    const sec = el('div', 'codex-sec')
    sec.appendChild(el('h4', undefined, "Today's Path"))
    body.appendChild(sec)
    if (a.plan.length === 0) {
      sec.appendChild(el('p', 'backstory', 'No plan yet — the day is still unwritten.'))
      return
    }
    for (const step of a.plan) {
      const row = el('div', 'plan-step')
      const range = `${fmtMinOfDay(step.startMin)} – ${fmtMinOfDay(step.startMin + step.durationMin)}`
      row.appendChild(el('span', 'plan-time', range))
      row.appendChild(el('span', 'plan-emoji', step.emoji))
      const act = el('span', 'plan-act', step.activity)
      const place = world.getPlace(step.placeId)
      if (place) {
        act.appendChild(document.createTextNode(' '))
        act.appendChild(el('span', 'place', `— ${place.name}`))
      }
      row.appendChild(act)
      const bar = el('div', 'plan-progress')
      bar.style.width = '0%'
      row.appendChild(bar)
      body.appendChild(row)
      dayStepEls.push({ row, bar, step })
    }
    refreshDayHighlight(a)
  }

  function refreshDayHighlight(a: AgentApi): void {
    const t = world.clock.time
    const minOfDay = t.hour * 60 + t.minute
    const active = a.currentPlanStep(minOfDay)
    for (const d of dayStepEls) {
      const isActive = active !== null && d.step === active
      d.row.classList.toggle('active', isActive)
      d.row.classList.toggle('done', !isActive && d.step.startMin + d.step.durationMin <= minOfDay)
      if (isActive) {
        const pct = clamp(((minOfDay - d.step.startMin) / Math.max(1, d.step.durationMin)) * 100, 0, 100)
        d.bar.style.width = `${pct.toFixed(1)}%`
      } else if (d.bar.style.width !== '0%') {
        d.bar.style.width = '0%'
      }
    }
  }

  // -- speak ----------------------------------------------------------------------
  function appendBubble(log: HTMLElement, who: 'wanderer' | 'agent', text: string): HTMLElement {
    const b = el('div', `chat-msg ${who}`, text)
    log.appendChild(b)
    log.scrollTop = log.scrollHeight
    return b
  }

  function appendNote(log: HTMLElement, text: string): void {
    log.appendChild(el('div', 'chat-note', text))
    log.scrollTop = log.scrollHeight
  }

  function appendPonder(log: HTMLElement, name: string): void {
    log.appendChild(el('div', 'chat-ponder', `${name} ponders…`))
    log.scrollTop = log.scrollHeight
  }

  function typewrite(target: HTMLElement, text: string): void {
    target.classList.add('typing')
    let i = 0
    const timer = window.setInterval(() => {
      if (!target.isConnected) {
        window.clearInterval(timer)
        return
      }
      i++
      target.textContent = text.slice(0, i)
      const log = target.parentElement
      if (log) log.scrollTop = log.scrollHeight
      if (i >= text.length) {
        window.clearInterval(timer)
        target.classList.remove('typing')
      }
    }, TYPEWRITER_MS_PER_CHAR)
  }

  function setWaiting(agentId: string, waiting: boolean): void {
    chatState(agentId).waiting = waiting
    if (speakUi && speakUi.agentId === agentId) {
      speakUi.input.disabled = waiting
      speakUi.sendBtn.disabled = waiting
      if (!waiting) {
        speakUi.log.querySelector('.chat-ponder')?.remove()
        speakUi.input.focus()
      }
    }
  }

  function maybeSummarize(a: AgentApi, st: ChatState): void {
    if (st.history.length <= CHAT_SUMMARIZE_AFTER) return
    const older = st.history.slice(0, st.history.length - CHAT_KEEP_TURNS)
    st.history = st.history.slice(-CHAT_KEEP_TURNS)
    const prev = st.summary
    void world.brain.summarizeChat(a.persona, older, prev).then((s) => {
      st.summary = s
    })
  }

  function sendMessage(a: AgentApi, msg: string): void {
    const agentId = a.persona.id
    const st = chatState(agentId)
    st.history.push({ from: 'wanderer', text: msg })
    const historySnapshot = st.history.slice(0, -1)
    const summarySnapshot = st.summary
    if (speakUi && speakUi.agentId === agentId) {
      appendBubble(speakUi.log, 'wanderer', msg)
      appendPonder(speakUi.log, a.persona.name)
    }
    setWaiting(agentId, true)

    let guard = 0
    const armGuard = (): void => {
      guard = window.setTimeout(() => {
        if (!chatState(agentId).waiting) return
        setWaiting(agentId, false)
        if (speakUi && speakUi.agentId === agentId) {
          appendNote(speakUi.log, 'The thread of thought frays into silence…')
        }
      }, OP_TIMEOUT_MS)
    }
    const trySchedule = (): boolean => world.ops.schedule(agentId, 'chat', async () => {
      const nowMin = world.clock.time.totalMin
      const context = a.memory.retrieve(msg, nowMin)
      const reply = await world.brain.chatReply(
        a.persona, a.status(), context, historySnapshot, summarySnapshot, msg, world.clock.time,
      )
      return () => {
        // applied on the sim thread via ops.drain()
        window.clearTimeout(guard)
        st.history.push({ from: 'agent', text: reply })
        maybeSummarize(a, st)
        const t = world.clock.time.totalMin
        const gist = msg.length > 64 ? `${msg.slice(0, 61).trimEnd()}…` : msg
        a.memory.add('chat', `A mysterious wanderer spoke with me about "${gist}"`, 6, t, [])
        const entry: ChronicleEntry = {
          icon: '🗣',
          text: `${a.persona.name} murmured with an unseen wanderer`,
          kind: 'chat',
          agentIds: [agentId],
        }
        world.bus.emit('chronicle', entry)
        setWaiting(agentId, false)
        if (speakUi && speakUi.agentId === agentId) {
          typewrite(appendBubble(speakUi.log, 'agent', ''), reply)
        }
      }
    })

    if (!trySchedule()) {
      // their mind is occupied (planning/reflecting/talking) — queue and keep
      // retrying instead of dropping the player's words
      if (speakUi && speakUi.agentId === agentId) {
        appendNote(speakUi.log, `${a.persona.name} is occupied — they will answer as soon as they can…`)
      }
      let attempts = 0
      const retry = window.setInterval(() => {
        attempts++
        if (trySchedule()) {
          window.clearInterval(retry)
          armGuard()
          return
        }
        if (attempts >= 40) {
          window.clearInterval(retry)
          st.history.pop()
          setWaiting(agentId, false)
          if (speakUi && speakUi.agentId === agentId) {
            appendNote(speakUi.log, `${a.persona.name} cannot break away right now — try again in a moment.`)
          }
        }
      }, 1200)
      return
    }

    armGuard()
  }

  function renderSpeak(a: AgentApi): void {
    body.replaceChildren()
    const st = chatState(a.persona.id)

    const wrap = el('div', 'chat-wrap')
    const log = el('div', 'chat-log')
    appendNote(log, `✦ You are the Wanderer — unseen by all of the vale save ${a.persona.name}.`)
    for (const turn of st.history) appendBubble(log, turn.from, turn.text)
    if (st.waiting) appendPonder(log, a.persona.name)

    const form = document.createElement('form')
    form.className = 'chat-form'
    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'chat-input'
    input.maxLength = 280
    input.autocomplete = 'off'
    input.placeholder = `Speak to ${a.persona.name.split(' ')[0]}…`
    const sendBtn = document.createElement('button')
    sendBtn.type = 'submit'
    sendBtn.className = 'chat-send'
    sendBtn.textContent = 'Send'
    input.disabled = st.waiting
    sendBtn.disabled = st.waiting
    form.appendChild(input)
    form.appendChild(sendBtn)
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      const msg = input.value.trim()
      if (!msg || chatState(a.persona.id).waiting) return
      input.value = ''
      sendMessage(a, msg)
    })

    wrap.appendChild(log)
    wrap.appendChild(form)
    body.appendChild(wrap)
    log.scrollTop = log.scrollHeight
    speakUi = { agentId: a.persona.id, log, input, sendBtn }
  }

  // -- render plumbing ---------------------------------------------------------------
  function renderActiveTab(): void {
    const a = agent()
    if (!a) return
    speakUi = null
    for (const [id, b] of tabBtns) b.classList.toggle('active', id === activeTab)
    body.classList.toggle('chat-mode', activeTab === 'speak')
    body.scrollTop = 0
    switch (activeTab) {
      case 'soul': renderSoul(a); break
      case 'mind': renderMind(a); break
      case 'day': renderDay(a); break
      case 'speak': renderSpeak(a); break
    }
  }

  function refreshHeader(a: AgentApi): void {
    const status = a.status() + (a.thinking() ? '  💭' : '')
    if (status !== lastStatus) {
      lastStatus = status
      statusEl.textContent = status
    }
    const v = a.needs.values
    const sig = `${Math.round(v.energy)}|${Math.round(v.hunger)}|${Math.round(v.social)}|${Math.round(v.spirit)}`
    if (sig !== lastNeeds) {
      lastNeeds = sig
      for (const row of NEED_ROWS) {
        const fill = vialFills.get(row.id)
        if (!fill) continue
        const pct = clamp(Math.round(v[row.id]), 0, 100)
        fill.style.width = `${pct}%`
        const parent = fill.parentElement
        if (parent) parent.title = `${row.label} — ${pct}/100`
      }
    }
  }

  // -- public api ------------------------------------------------------------------
  function open(agentId: string): void {
    const a = world.getAgent(agentId)
    if (!a) return
    if (selectedId !== agentId && following) {
      following = false
      followBtn.classList.remove('active')
      cb.onFollow(null)
    }
    selectedId = agentId
    liveSelectedId = agentId
    drawPortrait(portrait, a.persona.look)
    nameEl.textContent = a.persona.name
    metaEl.textContent = `${a.persona.role} · ${a.persona.age} winters`
    lastStatus = ''
    lastNeeds = ''
    lastMemoryCount = -1
    lastPlanRef = null
    refreshHeader(a)
    renderActiveTab()
    panel.classList.add('open')
    cb.onFocus({ x: a.pos.x, z: a.pos.z })
  }

  function close(): void {
    if (following) {
      following = false
      followBtn.classList.remove('active')
      cb.onFollow(null)
    }
    selectedId = null
    liveSelectedId = null
    speakUi = null
    panel.classList.remove('open')
  }

  function selected(): string | null {
    return selectedId
  }

  function update(): void {
    const now = performance.now()
    if (now - lastUpdateAt < UPDATE_INTERVAL_MS) return
    lastUpdateAt = now
    const a = agent()
    if (!a || !panel.classList.contains('open')) return

    refreshHeader(a)

    switch (activeTab) {
      case 'soul': {
        const sig = affectionSignature(a)
        if (sig !== lastAffectionSig) renderSoul(a)
        break
      }
      case 'mind': {
        if (a.memory.count() !== lastMemoryCount) renderMind(a)
        break
      }
      case 'day': {
        if (a.plan !== lastPlanRef) renderDay(a)
        else refreshDayHighlight(a)
        break
      }
      case 'speak':
        break
    }
  }

  followBtn.addEventListener('click', () => {
    if (!selectedId) return
    following = !following
    followBtn.classList.toggle('active', following)
    cb.onFollow(following ? selectedId : null)
  })
  closeBtn.addEventListener('click', () => close())

  return { open, close, selected, update }
}
