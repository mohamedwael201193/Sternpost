// Captures desktop screenshots of every landing section and dashboard page.
// Usage: node scripts/shots.mjs <baseUrl> <outDir>
import { chromium } from '@playwright/test'
const [base = 'http://localhost:4173', out = '/workspace/sternpost-shots'] = process.argv.slice(2)
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
await p.goto(base + '/', { waitUntil: 'networkidle' })
await p.waitForTimeout(3200)
await p.screenshot({ path: `${out}/landing-01-hero.png` })
for (const [i, id] of ['problem', 'how', 'floor', 'proof', 'integrations', 'faq'].entries()) {
  await p.locator('#' + id).scrollIntoViewIfNeeded()
  await p.evaluate((id) => document.getElementById(id).scrollIntoView(), id)
  await p.waitForTimeout(1400)
  await p.screenshot({ path: `${out}/landing-0${i + 2}-${id}.png` })
}
await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
await p.waitForTimeout(1000)
await p.screenshot({ path: `${out}/landing-08-footer.png` })
for (const r of (process.env.ROUTES ?? '').split(',').filter((x, i, a) => a.length > 1 || x)) {
  await p.goto(base + '/app/' + r, { waitUntil: 'networkidle' })
  await p.waitForTimeout(2000)
  await p.screenshot({ path: `${out}/app-${r || 'home'}.png` })
}
await b.close()
