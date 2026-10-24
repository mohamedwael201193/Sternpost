import { expect, test, type Page } from '@playwright/test'
import { injectWallet } from './wallet'
import { readFileSync } from 'node:fs'
const deployments = JSON.parse(readFileSync(new URL('../../shared/deployments/testnet.json', import.meta.url), 'utf8'))

// The live demo borrower: has a trove, a Governor, authorized apps and real draw history on Mezo testnet.
const LIVE = deployments.liveFlow.borrower
const SHOTS = process.env.SHOTS_DIR ?? '/workspace/sternpost-shots/v2/responsive'
test.setTimeout(90_000)

async function connect(page: Page, path = '/app') {
  await injectWallet(page, LIVE)
  await page.goto(path)
  await page.getByRole('button', { name: 'Connect wallet' }).first().click()
  await page.getByRole('dialog').getByRole('button', { name: /MetaMask|Browser wallet/ }).first().click()
  await expect(page.getByTestId('account')).toBeVisible()
}

test('top-level paths redirect into the dashboard; unknown paths 404', async ({ page }) => {
  for (const p of ['pay', 'apps', 'activity', 'revoke', 'draw']) {
    await page.goto(`/${p}`)
    await expect(page).toHaveURL(new RegExp(`/app/${p}$`))
    await expect(page.getByRole('heading', { level: 1, name: new RegExp(p, 'i') })).toBeVisible()
  }
  await page.goto('/no-such-page')
  await expect(page.getByRole('heading', { name: /No page at \/no-such-page/ })).toBeVisible()
  await page.goto('/app/nope')
  await expect(page.getByRole('heading', { name: 'No such dashboard page' })).toBeVisible()
})

test('draw starts from a safe amount the Governor accepts', async ({ page }) => {
  await connect(page)
  const limits = page.getByTestId('limits')
  await expect(limits).toContainText('Max safe:', { timeout: 30_000 })
  await expect(limits).toContainText('Per-draw cap')
  const max = Number((await limits.getByRole('button').innerText()).replace(/[^0-9.]/g, ''))
  const amt = Number(await page.locator('#hero-amount').inputValue())
  if (max > 0) {
    expect(amt).toBeGreaterThan(0)
    expect(amt).toBeLessThanOrEqual(max)
    await expect(page.getByRole('button', { name: /Sign & send/ })).toBeEnabled({ timeout: 30_000 })
  } else {
    // Budget or cap used up on chain: no bogus default, and the reason is spelled out.
    expect(amt).toBe(0)
    await expect(limits).toContainText(/limited by/)
  }
  // A huge amount is flagged clearly, with debt after the draw shown.
  await page.locator('#hero-amount').fill('1000000')
  await expect(page.getByTestId('hero-over')).toContainText('over max safe')
  await expect(page.getByTestId('hero-after')).toContainText('below floor', { timeout: 20_000 })
  await expect(page.getByTestId('hero-debt-after')).toContainText('MUSD')
  await expect(page.getByRole('button', { name: /Sign & send/ })).toBeDisabled()
})

test('activity shows one row per transaction, each with an explorer link', async ({ page }) => {
  await connect(page, '/app/activity')
  const rows = page.getByTestId('activity').locator('li')
  await expect(rows.first()).toBeVisible({ timeout: 40_000 })
  const hrefs = await rows.locator('a[href*="/tx/"]').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href))
  expect(hrefs.length).toBe(await rows.count())
  expect(new Set(hrefs).size).toBe(hrefs.length)
  expect(hrefs[0]).toMatch(/^https:\/\/explorer\.test\.mezo\.org\/tx\/0x[0-9a-f]{64}$/i)
})

test('account pill opens a menu and disconnect needs a confirm', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await connect(page)
  await page.getByTestId('account').click()
  const menu = page.getByRole('menu', { name: 'Account' })
  await expect(menu).toContainText(LIVE)
  await expect(menu.getByRole('menuitem', { name: /View on Mezo explorer/ })).toHaveAttribute('href', new RegExp(`/address/${LIVE}`, 'i'))
  await menu.getByRole('menuitem', { name: 'Copy address' }).click()
  await expect(menu).toContainText('Copied')
  await menu.getByRole('menuitem', { name: 'Disconnect' }).click()
  await menu.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByTestId('account')).toBeVisible()
  await menu.getByRole('menuitem', { name: 'Disconnect' }).click()
  await menu.getByRole('button', { name: 'Disconnect' }).click()
  await expect(page.getByRole('button', { name: 'Connect wallet' }).first()).toBeVisible()
})

for (const width of [1280, 1024, 768, 390]) {
  test(`dashboard fits ${width}px with no horizontal scroll`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 900 })
    await connect(page)
    await expect(page.getByTestId('limits')).toBeVisible({ timeout: 30_000 })
    for (const path of ['/app', '/app/draw', '/app/apps', '/app/activity']) {
      if (path !== '/app') await page.goto(path)
      await page.waitForTimeout(1500)
      const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth])
      expect(sw, `${path} scrollWidth`).toBeLessThanOrEqual(cw)
      const pill = await page.getByTestId('account').boundingBox()
      expect(pill!.x + pill!.width).toBeLessThanOrEqual(width)
      await expect(page.getByTestId('bottom-nav')).toBeVisible({ visible: width < 1024 })
      await page.screenshot({ path: `${SHOTS}/${width}${path.replace(/\//g, '-')}.png`, fullPage: true })
    }
  })
}
