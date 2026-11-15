/**
 * Skeleton loading blocks. Rendered while data loads so no page ever shows
 * "Loading", "—", or "Floor not set" to a disconnected user (plan §6.3).
 */
export function Skeleton({ className = '', label = 'Loading' }: { className?: string; label?: string }) {
  return (
    <div role="status" aria-label={label} className={`animate-pulse bg-ink/10 ${className}`} />
  )
}

export function SkeletonCard({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return (
    <div role="status" aria-label="Loading" className={`plate bg-paper/80 p-6 ${className}`}>
      <Skeleton className="h-5 w-32" />
      <div className="mt-4 space-y-3">
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} className={`h-4 ${i % 2 === 0 ? 'w-full' : 'w-2/3'}`} />
        ))}
      </div>
    </div>
  )
}
