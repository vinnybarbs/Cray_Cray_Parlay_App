import React from 'react'

// Loading placeholders shaped like the cards they stand in for (UI plan
// item 3). A grey card outline reads as "on its way" where a line of text
// like "Loading today" reads as empty.

export function SkeletonBar({ className = '' }) {
  return <span className={`block rounded bg-ink-800 motion-safe:animate-pulse ${className}`} />
}

export function SkeletonCard() {
  return (
    <div className="bg-ink-900 rounded-2xl border border-ink-700 px-4 py-4 flex flex-col gap-3" aria-hidden="true">
      <div className="flex justify-between">
        <SkeletonBar className="h-2.5 w-16" />
        <SkeletonBar className="h-2.5 w-10" />
      </div>
      <div className="flex justify-between gap-6">
        <SkeletonBar className="h-4 w-3/5" />
        <SkeletonBar className="h-4 w-12" />
      </div>
      <SkeletonBar className="h-3 w-2/5" />
      <SkeletonBar className="h-3 w-4/5" />
    </div>
  )
}

export function SkeletonList({ count = 3, label = 'Loading' }) {
  return (
    <div className="flex flex-col gap-3" role="status" aria-label={label}>
      {Array.from({ length: count }, (_, i) => <SkeletonCard key={i} />)}
    </div>
  )
}
