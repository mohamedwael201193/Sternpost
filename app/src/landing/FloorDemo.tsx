import { useMemo, useState } from 'react'
import { Gauge } from '../ui/Gauge'
import { REASONS, WAD, judgeDraw } from '../lib/icr'
import { Plate } from './Plate'

// Simulator only: an illustrative trove, clearly labelled. Live numbers are in the dashboard.
const COLL = WAD / 10n            // 0.1 BTC
const PRICE = 100_000n * WAD      // $100,000
const DEBT = 2_500n * WAD         // 2,500 MUSD

export function FloorDemo() {
  const [amount, setAmount] = useState(300)
  const [floor, setFloor] = useState(300)
  const v = useMemo(() => judgeDraw({ coll: COLL, price: PRICE, debt: DEBT, amount: BigInt(amount) * WAD, fee: (BigInt(amount) * WAD) / 1000n, floor: (BigInt(floor) * WAD) / 100n }), [amount, floor])
  const now = Number((COLL * PRICE * 100n) / DEBT / WAD)
  const after = Number((v.icrAfter * 100n) / WAD)
  return (
    <Plate id="floor" n="V" kicker="Safety floor" title={<>Try to sink it. <em>The floor holds.</em></>} className="bg-paper2/60">
      <div className="grid items-center gap-12 lg:grid-cols-[1fr_1fr]">
        <div className="flex justify-center"><Gauge value={now} floor={floor} projected={after} size={380} /></div>
        <div className="plate p-8">
          <p className="caps text-muted">Simulator · illustrative trove (0.1 BTC at $100k, 2,500 MUSD debt, 0.1% fee assumed)</p>
          <label className="mt-8 block">
            <span className="flex justify-between"><span className="caps">Draw</span><span className="mono">{amount.toLocaleString()} MUSD</span></span>
            <input aria-label="Draw amount" type="range" min={0} max={1500} step={25} value={amount} onChange={(e) => setAmount(+e.target.value)} className="mt-3 w-full accent-[#A3204F]" />
          </label>
          <label className="mt-6 block">
            <span className="flex justify-between"><span className="caps">Your floor</span><span className="mono">{floor}%</span></span>
            <input aria-label="Floor" type="range" min={150} max={380} step={10} value={floor} onChange={(e) => setFloor(+e.target.value)} className="mt-3 w-full accent-[#17130F]" />
          </label>
          <dl className="mt-8 grid grid-cols-2 gap-4 border-t border-ink/20 pt-6">
            <div><dt className="caps text-muted">Now</dt><dd className="display text-4xl">{now}%</dd></div>
            <div><dt className="caps text-muted">After draw + fee</dt><dd className={`display text-4xl ${v.ok ? 'text-safe' : 'text-signal'}`}>{after}%</dd></div>
          </dl>
          <p role="status" className={`mt-6 border-l-2 pl-4 ${v.ok ? 'border-safe' : 'border-signal'}`}>
            {v.ok ? <><strong>Lands.</strong> Above your floor, inside the app budget.</> : <><strong>Reverts on-chain.</strong> {REASONS[v.reason]}</>}
          </p>
        </div>
      </div>
    </Plate>
  )
}
