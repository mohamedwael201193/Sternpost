/** Glowing magenta Bitcoin compass rose that sits on the stern. Rose turns slowly; static under reduced motion. */
export function Compass() {
  const pts = Array.from({ length: 16 }, (_, i) => i * 22.5)
  return (
    <svg viewBox="0 0 200 200" className="compass-glow overflow-visible w-full h-auto" aria-hidden>
      <defs>
        <radialGradient id="cg" cx="50%" cy="50%" r="50%"><stop offset="0" stopColor="#FF4D86" stopOpacity=".35" /><stop offset="1" stopColor="#FF004D" stopOpacity="0" /></radialGradient>
      </defs>
      <circle cx="100" cy="100" r="98" fill="url(#cg)" />
      <g className="rose-spin">
        {pts.map((a) => {
          const long = a % 90 === 0, mid = a % 45 === 0
          const r = long ? 96 : mid ? 78 : 64
          return <path key={a} transform={`rotate(${a} 100 100)`} d={`M100 ${100 - r} L${long ? 106 : 104} 86 L100 100 L${long ? 94 : 96} 86 Z`} fill={long ? '#E5195E' : '#FF4D86'} fillOpacity={long ? .95 : mid ? .7 : .45} stroke="#A3204F" strokeWidth=".6" />
        })}
        <circle cx="100" cy="100" r="62" fill="none" stroke="#E5195E" strokeWidth=".8" strokeDasharray="1 3" />
      </g>
      <circle cx="100" cy="100" r="48" fill="#F6EFE3" stroke="#E5195E" strokeWidth="2.4" />
      <circle cx="100" cy="100" r="42" fill="#E5195E" />
      <text x="100" y="117" textAnchor="middle" fontFamily="Georgia, serif" fontWeight="700" fontSize="50" fill="#F6EFE3">₿</text>
    </svg>
  )
}
