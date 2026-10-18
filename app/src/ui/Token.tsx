export type TokenSym = 'BTC' | 'MUSD' | 'sMUSD' | 'MEZO' | 'tBTC'
export function Token({ sym, size = 28 }: { sym: TokenSym; size?: number }) {
  return <img src={`/tokens/${sym}.svg`} alt={sym} width={size} height={size} loading="lazy" className="rounded-full shrink-0" />
}
