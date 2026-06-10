/* Headless browser smoke test: load the built game, enter the vale, run the sim,
 * capture console errors + screenshots. Run: node scripts/smoke.mjs [url] */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const url = process.argv[2] ?? 'http://localhost:3001'
mkdirSync('shots', { recursive: true })

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 810 } })

const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text())
})

console.log('loading', url)
await page.goto(url, { waitUntil: 'load', timeout: 30000 })
await page.waitForTimeout(6000) // init: health check, world build, first render
await page.screenshot({ path: 'shots/1-intro.png' })

// enter the vale
const enter = page.getByText(/enter the vale/i).first()
if (await enter.count()) {
  await enter.click()
  console.log('entered the vale')
} else {
  console.log('WARN: no Enter button found')
}
await page.waitForTimeout(4000)
await page.screenshot({ path: 'shots/2-day.png' })

// speed up to 10x and let life happen (≈ 2 game hours)
await page.keyboard.press('4')
await page.waitForTimeout(12000)
await page.screenshot({ path: 'shots/3-living.png' })

// click a villager via canvas center sweep (best-effort): try clicking around the market
const canvas = page.locator('#game')
const box = await canvas.boundingBox()
if (box) {
  for (const [fx, fy] of [[0.5, 0.62], [0.45, 0.55], [0.55, 0.58], [0.5, 0.5], [0.6, 0.65]]) {
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy)
    await page.waitForTimeout(400)
    if (await page.locator('.codex, [class*=codex]').count()) break
  }
}
await page.waitForTimeout(1500)
await page.screenshot({ path: 'shots/4-codex.png' })

// push to night
await page.waitForTimeout(15000)
await page.screenshot({ path: 'shots/5-night.png' })

const sim = await page.evaluate(() => {
  const c = document.querySelector('#game')
  return { canvas: !!c, w: c?.width, h: c?.height }
})
console.log('canvas:', JSON.stringify(sim))
console.log('console/page errors:', errors.length)
for (const e of errors.slice(0, 12)) console.log('  ', e.slice(0, 220))
await browser.close()
process.exit(errors.length ? 1 : 0)
