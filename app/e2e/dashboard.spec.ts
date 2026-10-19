import { expect, test } from '@playwright/test'
import { injectWallet } from './wallet'

// A fresh address with no trove: exercises connect + live chain reads + empty states.
const EMPTY = '0x000000000000000000000000000000000000dEaD'

test('shows connect gate without a wallet', async ({ page }) => {
  await page.goto('/app')
  await expect(page.getByText('Not connected')).toBeVisible()
})

test('connects the injected wallet and reads Mezo testnet', async ({ page }) => {
  await injectWallet(page, EMPTY)
  await page.goto('/app')
  await page.getByRole('button', { name: 'Connect wallet' }).first().click()
  await expect(page.getByTestId('account').first()).toContainText('0x0000')
  await expect(page.getByText('No trove on this wallet')).toBeVisible({ timeout: 20_000 })
  await page.getByRole('link', { name: 'Draw' }).click()
  await expect(page.getByRole('heading', { name: 'Draw' })).toBeVisible()
  await page.getByRole('link', { name: 'Revoke' }).click()
  await expect(page.getByText('Nothing to revoke.')).toBeVisible()
})
