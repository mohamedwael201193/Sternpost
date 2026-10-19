import { expect, test } from '@playwright/test'

test('landing renders hero, simulator and proof links', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Credit that')
  await page.locator('#floor').scrollIntoViewIfNeeded()
  await expect(page.locator('#floor')).toContainText('After draw')
  const links = page.locator('#proof a[href*="explorer.test.mezo.org/tx/"]')
  await expect(links.first()).toBeVisible()
  expect(await links.count()).toBeGreaterThanOrEqual(6)
})

test('landing loads no wallet code', async ({ page }) => {
  const scripts: string[] = []
  page.on('request', (r) => { if (r.resourceType() === 'script') scripts.push(r.url()) })
  await page.goto('/', { waitUntil: 'networkidle' })
  expect(scripts.some((s) => s.includes('Dashboard'))).toBe(false)
})
