import { useEffect, useState } from 'react'

interface SkeletonProps {
  isLoading?: boolean
  width?: string | number
  height?: string | number
  rounded?: boolean
  className?: string
}

/**
 * Skeleton — placeholder block that animates a soft shimmer while
 * the underlying data is loading.
 *
 * Designed to be dropped into a layout where the real component
 * will eventually render. Pass `isLoading={false}` to swap to the
 * real children without remounting the parent (smooth fade via
 * `aria-busy` and an opacity transition).
 */
export function Skeleton({
  isLoading = true,
  width = '100%',
  height = 12,
  rounded = false,
  className = '',
  children,
}: SkeletonProps & { children?: React.ReactNode }) {
  const style: React.CSSProperties = {
    width: typeof width === 'number' ? `${width}px` : width,
    height: typeof height === 'number' ? `${height}px` : height,
    borderRadius: rounded ? '9999px' : '4px',
  }
  return (
    <div
      aria-busy={isLoading}
      className={`skeleton-root ${className}`}
      style={style}
      data-loading={isLoading ? 'true' : 'false'}
    >
      {isLoading ? <span className="skeleton-shimmer" /> : children}
    </div>
  )
}

/**
 * SkeletonCard — composite placeholder used by Projects / Medias.
 * Mirrors the card layout so the user sees the eventual structure.
 */
export function SkeletonCard() {
  return (
    <div className="skeleton-card" aria-busy="true">
      <Skeleton width={40} height={40} rounded className="skeleton-card-cover" />
      <div className="skeleton-card-body">
        <Skeleton width="60%" height={12} />
        <Skeleton width="40%" height={10} />
      </div>
    </div>
  )
}

/**
 * SkeletonGrid — N placeholder cards.
 */
export function SkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="skeleton-grid" aria-busy="true">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  )
}

/**
 * useDelayedLoading — returns a `isLoading` flag that stays `true`
 * for at least `minDurationMs` so the skeleton doesn't flash in
 * for sub-100ms fetches. Helps avoid janky transitions.
 */
export function useDelayedLoading(loading: boolean, minDurationMs = 200): boolean {
  const [delayed, setDelayed] = useState(loading)
  useEffect(() => {
    if (!loading) {
      const handle = window.setTimeout(() => setDelayed(false), minDurationMs)
      return () => window.clearTimeout(handle)
    }
    setDelayed(true)
  }, [loading, minDurationMs])
  return delayed
}
