/* Deep smoke: click a villager at his real projected position, open the codex,
 * and have an actual chat through the live LLM. Run: node scripts/smoke2.mjs */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

mkdirSync('shots', { recursive: true })
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 810 } })
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()))

await page.goto('http://localhost:3001', { waitUntil: 'load' })
await page.waitForTimeout(6000)
const enter = page.getByText(/enter the vale/i).first()
if (await enter.count()) await enter.click()
await page.waitForTimeout(3000)

// fly to Bram and click his exact projected screen position
await page.evaluate(() => {
  const v = window.__vale
  const bram = v.world.getAgent('bram')
  v.scene.focusOn(bram.pos, 25)
})
await page.waitForTimeout(2500)
const pos = await page.evaluate(() => window.__vale.screenPosOf('bram'))
console.log('bram at screen', JSON.stringify(pos))
if (pos && pos.inFront) {
  await page.mouse.click(pos.x, pos.y - 14) // aim at the body, not the feet
  await page.waitForTimeout(1200)
}
let selected = await page.evaluate(() => window.__vale.codex.selected && window.__vale.codex.selected())
console.log('codex selected after click:', selected)
if (selected !== 'bram') {
  console.log('pick missed — opening codex directly to test the panel+chat path')
  await page.evaluate(() => window.__vale.codex.open('bram'))
  await page.waitForTimeout(800)
  selected = await page.evaluate(() => window.__vale.codex.selected())
}
await page.screenshot({ path: 'shots/6-bram-codex.png' })

// open the Speak tab and chat with Bram through the live LLM
const speakTab = page.getByText(/^speak$/i).first()
if (await speakTab.count()) await speakTab.click()
await page.waitForTimeout(500)
const input = page.locator('#ui input[type=text], #ui textarea').last()
await input.fill('Good evening barkeep! Any news in the vale? Heard anything about a festival?')
await input.press('Enter').catch(() => {})
const sendBtn = page.getByText(/^send$/i).first()
if (await sendBtn.count()) await sendBtn.click().catch(() => {})
console.log('chat sent, waiting for the reply…')
await page.waitForTimeout(20000)
await page.screenshot({ path: 'shots/7-bram-chat.png' })

const chatText = await page.evaluate(() => {
  const panels = document.querySelectorAll('#ui *')
  let best = ''
  for (const el of panels) {
    const t = el.textContent || ''
    if (t.length > best.length && /wanderer|festival|vale|ale|griffin/i.test(t)) best = t
  }
  return best.slice(0, 600)
})
console.log('--- chat area text:', chatText.replace(/\s+/g, ' ').slice(0, 500))
console.log('errors:', errors.length)
errors.slice(0, 8).forEach((e) => console.log('  ', e.slice(0, 200)))
await browser.close()
process.exit(errors.length ? 1 : 0)
