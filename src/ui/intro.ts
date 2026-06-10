/**
 * Everdawn Vale — cinematic title overlay shown after loading (DESIGN.md §5).
 * Gold title over the slowly orbiting vale, an ornate "Enter the Vale" button,
 * and a controls hint card that fades away ~12s after entering.
 */

const FLAVOR =
  'Castellan Seraphine keeps a happy secret, and secrets travel fast in a vale ' +
  'this small. Walk unseen among nine souls, read their minds, whisper in their ' +
  'ears — and watch a rumor become a festival.'

const CONTROLS: ReadonlyArray<[string, string]> = [
  ['🖱 drag', 'orbit'],
  ['⊕ scroll', 'zoom'],
  ['✋ right-drag', 'pan'],
  ['👤 click a villager', 'open their codex'],
  ['⏳ 1-4', 'speed of time'],
]

export function createIntro(root: HTMLElement, onEnter: () => void): void {
  const overlay = document.createElement('div')
  overlay.className = 'intro'

  const inner = document.createElement('div')
  inner.className = 'intro-inner'

  const ruleTop = document.createElement('div')
  ruleTop.className = 'intro-rule'
  ruleTop.textContent = '❖ ✦ ❖'

  const title = document.createElement('h1')
  title.textContent = 'Everdawn Vale'

  const sub = document.createElement('div')
  sub.className = 'intro-sub'
  sub.textContent = 'Nine souls. Three days. One secret festival.'

  const flavor = document.createElement('p')
  flavor.className = 'intro-flavor'
  flavor.textContent = FLAVOR

  const enter = document.createElement('button')
  enter.type = 'button'
  enter.className = 'enter-btn'
  enter.textContent = 'Enter the Vale'

  const ruleBottom = document.createElement('div')
  ruleBottom.className = 'intro-rule'
  ruleBottom.textContent = '❖ ✦ ❖'

  inner.appendChild(ruleTop)
  inner.appendChild(title)
  inner.appendChild(sub)
  inner.appendChild(flavor)
  inner.appendChild(enter)
  inner.appendChild(ruleBottom)
  overlay.appendChild(inner)
  root.appendChild(overlay)

  // controls hint card, revealed on enter, gone ~12s later
  const controls = document.createElement('div')
  controls.className = 'controls-card parchment'
  CONTROLS.forEach(([keys, what], i) => {
    const span = document.createElement('span')
    const b = document.createElement('b')
    b.textContent = keys
    span.appendChild(b)
    span.appendChild(document.createTextNode(` — ${what}`))
    controls.appendChild(span)
    if (i < CONTROLS.length - 1) {
      const dot = document.createElement('span')
      dot.textContent = '·'
      controls.appendChild(dot)
    }
  })
  root.appendChild(controls)

  let entered = false
  enter.addEventListener('click', () => {
    if (entered) return
    entered = true
    overlay.classList.add('fade')
    window.setTimeout(() => overlay.remove(), 1300)
    controls.classList.add('show')
    window.setTimeout(() => controls.classList.add('fading'), 12_000)
    window.setTimeout(() => controls.remove(), 14_200)
    onEnter()
  })
}
