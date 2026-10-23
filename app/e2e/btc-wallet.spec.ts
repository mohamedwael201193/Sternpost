import { expect, test } from '@playwright/test'
test.setTimeout(90_000)

// A stand-in Unisat extension (BIP173 test vector key) drives Mezo Passport's real OrangeKit connector.
// The connected EVM address is the smart account OrangeKit predicts on Mezo testnet.
const BTC = { address: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx', pubkey: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798' }

test('Unisat signs in through Passport and is told why it cannot draw', async ({ page }) => {
  await page.addInitScript((b) => {
    const calls: string[] = []
    ;(window as any).__unisatCalls = calls
    ;(window as any).unisat = {
      requestAccounts: async () => (calls.push('requestAccounts'), [b.address]),
      getAccounts: async () => [b.address],
      getPublicKey: async () => b.pubkey,
      getNetwork: async () => 'testnet',
      on() {}, removeListener() {},
    }
  }, BTC)
  await page.goto('/app')
  await page.getByRole('button', { name: 'Connect wallet' }).first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  await expect(dialog.getByText('More wallets')).toBeVisible()
  await dialog.getByRole('button', { name: /Unisat/ }).click()
  await expect(page.getByTestId('account').first()).toContainText('0x', { timeout: 60_000 })
  expect(await page.evaluate(() => (window as any).__unisatCalls)).toContain('requestAccounts')
  await page.getByRole('link', { name: 'Draw', exact: true }).click()
  await expect(page.getByRole('note').first()).toContainText('Bitcoin wallet connected')
})

test('search filters the wallet list', async ({ page }) => {
  await page.goto('/app')
  await page.getByRole('button', { name: 'Connect wallet' }).first().click()
  await page.getByLabel('Search wallets').fill('meta')
  const d = page.getByRole('dialog')
  await expect(d.getByText('MetaMask')).toBeVisible()
  await expect(d.getByText('Xverse')).toHaveCount(0)
})
