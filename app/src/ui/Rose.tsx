/** Small eight-point compass rose used as a section divider, like the approved hero. */
export function Rose({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden>
      <g fill="#A3204F">
        <path d="M20 0 L23 17 L20 20 L17 17 Z" /><path d="M20 40 L17 23 L20 20 L23 23 Z" />
        <path d="M0 20 L17 17 L20 20 L17 23 Z" /><path d="M40 20 L23 23 L20 20 L23 17 Z" />
        <path d="M6 6 L19 18 L18 19 Z" opacity=".6" /><path d="M34 34 L21 22 L22 21 Z" opacity=".6" />
        <path d="M34 6 L22 19 L21 18 Z" opacity=".6" /><path d="M6 34 L18 21 L19 22 Z" opacity=".6" />
      </g>
    </svg>
  )
}
export function RoseRule({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 ${className}`} aria-hidden>
      <span className="h-px flex-1 bg-magenta/70" /><Rose className="h-7 w-7" /><span className="h-px flex-1 bg-magenta/70" />
    </div>
  )
}
