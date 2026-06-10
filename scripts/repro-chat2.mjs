/* Watch up to 2 minutes for the queued chat to land. */
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
await page.waitForTimeout(2000)

await page.evaluate(() => window.__vale.codex.open('bram'))
await page.waitForTimeout(500)
await page.getByText(/^speak$/i).first().click()
await page.waitForTimeout(300)
const input = page.locator('#ui input[type=text], #ui textarea').last()
await input.fill('hi')
const send = page.getByText(/^send$/i).first()
if (await send.count()) await send.click()
else await input.press('Enter')
console.log('said "hi" to Bram right at startup (worst case: his mind-queue is longest now)')

let replied = false
for (let t = 0; t < 120; t += 6) {
  await page.waitForTimeout(6000)
  const snap = await page.evaluate(() => {
    const msgs = [...document.querySelectorAll('.chat-msg.agent')]
    const v = window.__vale
    return {
      busy: v.world.ops.busy('bram'),
      dlg: v.world.getAgent('bram').dialogueId,
      reply: msgs.length ? (msgs[msgs.length - 1].textContent || '') : '',
    }
  })
  console.log(`t+${t + 6}s busy=${snap.busy} dlg=${snap.dlg} reply="${snap.reply.slice(0, 120)}"`)
  if (snap.reply.length > 5) {
    replied = true
    break
  }
}
await page.screenshot({ path: 'shots/9-bram-hi.png' })
console.log(replied ? 'SUCCESS — Bram answered' : 'FAIL — no reply within 2 min')
console.log('errors:', errors.length)
errors.slice(0, 5).forEach((e) => console.log(' ', e.slice(0, 180)))
await browser.close()
process.exit(replied && errors.length === 0 ? 0 : 1)
