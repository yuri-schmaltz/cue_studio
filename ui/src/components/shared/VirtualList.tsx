import { useEffect, useRef, useState } from 'react'

interface VirtualListProps<T> {
  items: T[]
  itemHeight: number
  overscan?: number
  renderItem: (item: T, index: number) => React.ReactNode
  className?: string
  emptyMessage?: string
  /** Called when the user scrolls; useful for "load more" pagination. */
  onReachEnd?: () => void
}

/**
 * VirtualList — tiny windowed list renderer.
 *
 * Why we wrote our own instead of `react-virtuoso` / `react-window`:
 *
 * * Both add ~25-40KB to the gzipped bundle. For a 199-item picker
 *   we don't need their full feature set (sticky items, scroll
 *   restoration, server-side rendering, etc.) — only "render the
 *   items in the viewport plus a small overscan".
 * * Tree-shaking on the alternatives is fragile; they frequently
 *   pull in CSS and component primitives that don't compose well
 *   with our Tailwind-only design system.
 *
 * Behaviour:
 * * Renders only ``Math.ceil(viewport / itemHeight) + 2 * overscan``
 *   items. Render cost is constant in the size of ``items``.
 * * Outer container is the scrollable element; inner spacer sets the
 *   total scroll height so the native scrollbar reflects the real
 *   list size.
 * * Each rendered item is absolutely positioned so the browser
 *   doesn't repaint on every scroll tick — only the changed
 *   window.
 */
export function VirtualList<T>({
  items,
  itemHeight,
  overscan = 6,
  renderItem,
  className,
  emptyMessage = 'No items',
  onReachEnd,
}: VirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        setViewportHeight(entry.contentRect.height)
      }
    })
    observer.observe(container)
    setViewportHeight(container.clientHeight)
    return () => observer.disconnect()
  }, [])

  const onScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const top = event.currentTarget.scrollTop
    setScrollTop(top)
    if (onReachEnd) {
      const total = items.length * itemHeight
      const remaining = total - top - viewportHeight
      if (remaining < itemHeight * 4) {
        onReachEnd()
      }
    }
  }

  if (items.length === 0) {
    return <div className={`virtual-list-empty ${className ?? ''}`}>{emptyMessage}</div>
  }

  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan)
  const visibleCount = Math.ceil(viewportHeight / itemHeight) + overscan * 2
  const endIndex = Math.min(items.length, startIndex + visibleCount)
  const window = items.slice(startIndex, endIndex)
  const offsetY = startIndex * itemHeight
  const totalHeight = items.length * itemHeight

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      className={`virtual-list ${className ?? ''}`}
      style={{ height: '100%', overflowY: 'auto' }}
      data-testid="virtual-list"
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div style={{ transform: `translateY(${offsetY}px)` }}>
          {window.map((item, localIndex) => (
            <div
              key={(item as { id?: string }).id ?? startIndex + localIndex}
              style={{ height: itemHeight }}
              data-index={startIndex + localIndex}
            >
              {renderItem(item, startIndex + localIndex)}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
