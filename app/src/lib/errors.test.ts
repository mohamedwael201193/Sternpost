import { expect, test } from 'vitest'
import { BaseError, encodeErrorResult } from 'viem'
import governorJson from '../../../shared/abis/SternpostGovernor.json'
import { humanRevert } from './errors'

test('maps Mezo revert strings', () => {
  expect(humanRevert(new Error('execution reverted: Signature expired'))).toMatch(/^Signature expired/)
  expect(humanRevert(new Error('reverted: BorrowerOps: An operation that would result in ICR < MCR is not permitted'))).toMatch(/110%/)
  expect(humanRevert(new Error('Sending BTC failed'))).toMatch(/Sending BTC failed/)
})

test('decodes Governor custom errors from raw revert data', () => {
  const data = encodeErrorResult({ abi: governorJson as any, errorName: 'Unsafe', args: [2n * 10n ** 18n, 25n * 10n ** 17n] })
  const e = new BaseError('reverted', { cause: Object.assign(new Error('x'), { data }) as any })
  expect(humanRevert(e)).toBe('Unsafe: this draw would leave your trove at 200.0%, below your 250.0% floor.')
})
