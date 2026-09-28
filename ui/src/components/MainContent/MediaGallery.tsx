import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { Check, Film, Image as ImageIcon, Loader2, Music } from 'lucide-react'
import { useStore } from '../../stores/useStore'
import { requestThumbnail } from '../../lib/thumbnailCache'
import type { OutputFile } from '../../types'

interface Props {
  selectedIndex: number
  selectedNames: Set<string>
  onInspect: (index: number) => void
  onToggleSelected: (name: string) => void
  onToggleRange: (fromIndex: number, toIndex: number) => void
  onLoadMore: () => void
  hasMore: boolean
}

/** Lazy frame-capture for video thumbnails; caches via IndexedDB so a second
 *  render in the same session never re-decodes the video. */
function GalleryThumbnail({ file }: { file: OutputFile }) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setThumbUrl(null)
    if (file.type === 'video') {
      requestThumbnail(file.url, file.name).then((dataUrl) => {
        if (!cancelled) setThumbUrl(dataUrl)
      })
    }
    return () => { cancelled = true }
  }, [file.url, file.name, file.type])

  // Image: native <img> handles its own cache; no JS retry. Falls back to
  // an icon on error.
  if (file.type === 'image') {
    return (
      <img
        src={file.url}
        alt={file.name}
        loading="lazy"
        className="h-full w-full object-cover"
      />
    )
  }

  // Audio has no visual preview; show a static icon instead.
  if (file.type === 'audio') {
    return (
      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-accent-blue/20 to-bg-tertiary">
        <Music size={20} className="text-accent-blue" />
      </div>
    )
  }

  if (thumbUrl) {
    return (
      <img
        src={thumbUrl}
        alt={file.name}
        loading="lazy"
        className="h-full w-full object-cover"
      />
    )
  }

  return (
    <div className="flex h-full w-full items-center justify-center bg-bg-tertiary">
      <Loader2 size={14} className="animate-spin text-text-muted" />
    </div>
  )
}

function TypeBadge({ type }: { type: OutputFile['type'] }) {
  // A tiny corner marker so a video / image / audio can be told apart even
  // before the metadata has loaded.
  if (type === 'video') {
    return (
      <span className="pointer-events-none absolute bottom-1.5 left-1.5 rounded bg-black/60 px-1.5 py-0.5 text-2xs uppercase tracking-wide text-white/85">
        <Film size={9} className="mr-0.5 inline-block" /> Vid
      </span>
    )
  }
  if (type === 'audio') {
    return (
      <span className="pointer-events-none absolute bottom-1.5 left-1.5 rounded bg-black/60 px-1.5 py-0.5 text-2xs uppercase tracking-wide text-white/85">
        <Music size={9} className="mr-0.5 inline-block" /> Aud
      </span>
    )
  }
  return (
    <span className="pointer-events-none absolute bottom-1.5 left-1.5 rounded bg-black/60 px-1.5 py-0.5 text-2xs uppercase tracking-wide text-white/85">
      <ImageIcon size={9} className="mr-0.5 inline-block" /> Img
    </span>
  )
}

export function MediaGallery({
  selectedIndex,
  selectedNames,
  onInspect,
  onToggleSelected,
  onToggleRange,
  onLoadMore,
  hasMore,
}: Props) {
  const outputs = useStore(s => s.filteredOutputs())
  const lastClickedIndex = useRef<number | null>(null)

  // Infinite scroll: load the next page when the sentinel scrolls into view.
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !hasMore) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onLoadMore()
      },
      { rootMargin: '320px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, onLoadMore])

  const handleCardClick = useCallback((event: React.MouseEvent, index: number, name: string) => {
    if (event.shiftKey && lastClickedIndex.current !== null && lastClickedIndex.current !== index) {
      // Shift+click ranges across cards in display order, mirroring the
      // common Finder / Explorer selection behavior. Single click clears
      // the previous anchor.
      const from = Math.min(lastClickedIndex.current, index)
      const to = Math.max(lastClickedIndex.current, index)
      onToggleRange(from, to)
    } else {
      onToggleSelected(name)
    }
    onInspect(index)
    lastClickedIndex.current = index
  }, [onInspect, onToggleSelected, onToggleRange])

  const handleCheckboxClick = useCallback((event: React.MouseEvent, name: string) => {
    // Stop propagation so the card click handler doesn't also toggle the
    // checkbox and double-flip the selection state.
    event.stopPropagation()
    onToggleSelected(name)
  }, [onToggleSelected])

  const grid = useMemo(() => (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}
    >
      {outputs.map((file, index) => {
        const isSelected = selectedIndex === index
        const isChecked = selectedNames.has(file.name)
        return (
          <button
            key={file.name}
            type="button"
            // data-feed-index keeps the existing "scroll to card" hooks working
            // for any deep-link / keyboard flow we add later.
            data-feed-index={index}
            onClick={event => handleCardClick(event, index, file.name)}
            className={`group relative overflow-hidden rounded-lg border-2 text-left transition-colors ${
              isSelected
                // The active card uses the same frame ring as the existing
                // MediaFeedItem so themes (golden-hour conic, default blue)
                // stay visually consistent.
                ? 'border-transparent frame-active-gradient shadow-active-ring'
                : isChecked
                  ? 'border-accent-blue/70 bg-bg-tertiary'
                  : 'border-border bg-bg-tertiary hover:border-border-light'
            }`}
            title={file.name}
            aria-pressed={isSelected}
            aria-label={`Open ${file.name} in inspector`}
          >
            <div className="relative aspect-video w-full overflow-hidden bg-media-canvas">
              <GalleryThumbnail file={file} />
              <TypeBadge type={file.type} />
            </div>
            <div className="flex items-start gap-1.5 px-2 py-1.5">
              <span
                role="checkbox"
                aria-checked={isChecked}
                aria-label={`Select ${file.name} for bulk actions`}
                tabIndex={0}
                onClick={event => handleCheckboxClick(event, file.name)}
                onKeyDown={event => {
                  if (event.key === ' ' || event.key === 'Enter') {
                    event.preventDefault()
                    onToggleSelected(file.name)
                  }
                }}
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                  isChecked
                    ? 'border-accent-blue bg-accent-blue text-white'
                    : 'border-border bg-bg-secondary group-hover:border-border-light'
                }`}
              >
                {isChecked && <Check size={11} strokeWidth={3} />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-2xs text-text-secondary" title={file.name}>
                  {file.name}
                </div>
                <div className="text-2xs text-text-muted">
                  {(file.type === 'video' || file.type === 'image') ? file.type : 'audio'}
                </div>
              </div>
            </div>
          </button>
        )
      })}
    </div>
  ), [outputs, selectedIndex, selectedNames, handleCardClick, handleCheckboxClick, onToggleSelected])

  return (
    <div className="media-gallery-scroll h-full overflow-y-auto p-3 md:p-4">
      {grid}
      {hasMore && (
        <div ref={sentinelRef} className="flex justify-center py-6 text-text-muted">
          <Loader2 size={16} className="animate-spin" />
        </div>
      )}
      {!hasMore && outputs.length > 0 && (
        <div className="flex justify-center py-6 text-2xs text-text-muted">
          {outputs.length} item{outputs.length === 1 ? '' : 's'} loaded
        </div>
      )}
    </div>
  )
}
