import { expect, test } from '@playwright/test'
import { injectSigningWallet } from './signer'

// Live testnet: real signatures, real draw tx. Runs only when MEZO_TESTNET_PK is set.
test.skip(!process.env.MEZO_TESTNET_PK, 'needs MEZO_TESTNET_PK')
test.describe.configure({ mode: 'serial', timeout: 300_000 })

async function open(page: any) {
  await page.goto('/app/draw')
  await page.getByRole('button', { name: 'Connect wallet' }).first().click()
  await expect(page.getByLabel(/Amount/)).toBeVisible({ timeout: 60_000 })
}

test('unsafe amount is refused before any signature', async ({ page }) => {
  const log: string[] = []
  await injectSigningWallet(page, { log })
  await open(page)
  await page.getByLabel(/Amount/).fill('1000000')
  await expect(page.getByText('Unsafe.', { exact: true })).toBeVisible({ timeout: 60_000 })
  await expect(page.getByRole('button', { name: 'Sign & send' })).toBeDisabled()
  expect(log).toEqual([])
})

for (const [name, delay] of [['1 MUSD draw succeeds with Sign & send', 0], ['slow withdraw signature triggers auto re-sign, then succeeds', 80_000]] as const) {
  test(name, async ({ page }) => {
    const log: string[] = []
    await injectSigningWallet(page, { log, delayWithdrawMs: delay })
    await open(page)
    await page.getByLabel(/Amount/).fill('1')
    await expect(page.getByText('Safe.', { exact: true })).toBeVisible({ timeout: 60_000 })
    await page.getByRole('button', { name: 'Sign & send' }).click()
    await expect(page.getByText('Confirmed on Mezo testnet.')).toBeVisible({ timeout: 240_000 })
    console.log(`[${name}]`, log.join(' | '))
    if (delay) expect(log.filter((l) => l.startsWith('sign WithdrawMUSD')).length).toBeGreaterThan(1)
    await page.screenshot({ path: `/workspace/sternpost-shots/e2e-draw-${delay ? 'resign' : 'ok'}.png`, fullPage: true })
  })
}
