/* Verify the full in-browser chat loop: pause world, chat with an idle villager,
 * await the LLM reply through codex → ops → brain → typewriter. */
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

await page.evaluate(() => {
  window.__vale.world.clock.speed = 0 // freeze time: nobody starts new conversations
  window.__vale.codex.open('maeve')
})
await page.waitForTimeout(800)
const speakTab = page.getByText(/^speak$/i).first()
if (await speakTab.count()) await speakTab.click()
await page.waitForTimeout(400)

const input = page.locator('#ui input[type=text], #ui textarea').last()
await input.fill('Greetings, wise one. What herb would you brew for an aching knee?')
const sendBtn = page.getByText(/^send$/i).first()
if (await sendBtn.count()) await sendBtn.click()
else await input.press('Enter')
console.log('sent; waiting for Maeve…')

// poll for a reply bubble for up to 45s
let reply = ''
for (let i = 0; i < 45; i++) {
  await page.waitForTimeout(1000)
  reply = await page.evaluate(() => {
    const els = [...document.querySelectorAll('#ui *')]
    const texts = els.map((e) => e.textContent || '')
    const mine = texts.filter((t) => /willowbark|herb|knee|salve|tea|brew|poultice/i.test(t) && !/Greetings, wise one/.test(t))
    return mine.sort((a, b) => a.length - b.length)[0] || ''
  })
  if (reply.length > 30) break
}
await page.screenshot({ path: 'shots/8-maeve-chat.png' })
console.log('reply:', reply.replace(/\s+/g, ' ').slice(0, 400) || '(none detected)')
console.log('errors:', errors.length)
errors.slice(0, 6).forEach((e) => console.log('  ', e.slice(0, 200)))
await browser.close()
