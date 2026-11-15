import type { ReactNode } from 'react'

/** Labelled empty state. Every list that can be empty says so in plain words — never a bare dash. */
export function Empty({
  title,
  children,
  action,
  className = '',
}: {
  title: string
  children?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={`border border-dashed border-ink/25 p-6 text-center sm:p-10 ${className}`}>
      <div className="display text-2xl">{title}</div>
      {children ? <div className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">{children}</div> : null}
      {action ? <div className="mt-5 flex justify-center gap-3">{action}</div> : null}
    </div>
  )
}
