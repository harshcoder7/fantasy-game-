/* Reproduce: say hi to a villager (possibly busy) and watch what happens. */
import { chromium } from 'playwright'

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

const state = await page.evaluate(() => {
  const v = window.__vale
  return v.world.agents.map((a) => ({
    id: a.persona.id,
    busy: v.world.ops.busy(a.persona.id),
    dialogue: a.dialogueId,
    action: a.action && a.action.kind,
  }))
})
console.log('agents:', JSON.stringify(state))

// pick bram regardless of his state (mimic the user)
await page.evaluate(() => window.__vale.codex.open('bram'))
await page.waitForTimeout(600)
await page.getByText(/^speak$/i).first().click()
await page.waitForTimeout(300)
const input = page.locator('#ui input[type=text], #ui textarea').last()
await input.fill('hi')
const send = page.getByText(/^send$/i).first()
if (await send.count()) await send.click()
else await input.press('Enter')

for (let t = 0; t <= 30; t += 5) {
  await page.waitForTimeout(5000)
  const snap = await page.evaluate(() => {
    const log = document.querySelector('[class*=chat-log], [class*=speak], [class*=chat]')
    const v = window.__vale
    return {
      busy: v.world.ops.busy('bram'),
      dialogue: v.world.getAgent('bram').dialogueId,
      text: (log ? log.textContent : '').replace(/\s+/g, ' ').slice(-260),
    }
  })
  console.log(`t+${t + 5}s busy=${snap.busy} dlg=${snap.dialogue} | ${snap.text}`)
}
console.log('errors:', errors.length)
errors.slice(0, 5).forEach((e) => console.log(' ', e.slice(0, 180)))
await browser.close()
