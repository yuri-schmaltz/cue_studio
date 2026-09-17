import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useStore } from '../../stores/useStore'

/* First-run guided tour for the Director tab.
 *
 * The tour walks the user through the three columns (chat / plan /
 * options) and explains what each one does. State persists in
 * localStorage under `maestro:director-tour` so the overlay only fires
 * on the first visit. Each step is a full-screen highlight (dashed
 * border around the target column) with a small floating tooltip
 * pointing at it. The overlay is keyboard-navigable (Arrow keys /
 * Escape) and accessible (role=dialog, aria-modal, aria-label). */

type Step = {
  id: 'chat' | 'plan' | 'options'
  title: string
  body: string
}

const STEPS: Step[] = [
  {
    id: 'chat',
    title: '1 / 3 — Chat & decisions',
    body: 'Drop your audio (or generate a song), upload a reference photo, and add character/location refs. The composer at the bottom accepts the brief you send to the LLM.',
  },
  {
    id: 'plan',
    title: '2 / 3 — Plan & shots',
    body: 'Live status, clip structure, generated image prompts, and rendered start images appear here as the pipeline runs. Edit any prompt before approving generation.',
  },
  {
    id: 'options',
    title: '3 / 3 — Generation options',
    body: 'Aspect ratio, resolution, LoRAs, audio speed, and identity guidance live on the right. Change them any time — the planner re-reads them when you re-send.',
  },
]

const STORAGE_KEY = 'maestro:director-tour'

function readTourDone(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'done'
  } catch {
    return false
  }
}

function writeTourDone() {
  try {
    localStorage.setItem(STORAGE_KEY, 'done')
  } catch {
    /* ignore — Safari private mode etc. */
  }
}

export function DirectorTourOverlay() {
  const [open, setOpen] = useState(false)
  const [stepIdx, setStepIdx] = useState(0)
  const directorStep = useStore(s => s.directorStep)

  // Only surface the tour on the very first launch AND while the user
  // is still in the upload step (so it doesn't compete with a running
  // pipeline). After the user dismisses or finishes the tour, the
  // flag persists in localStorage and never fires again.
  useEffect(() => {
    if (!readTourDone() && directorStep === 'upload') {
      // Small delay so the columns finish animating into view before
      // we draw the overlay on top.
      const timer = window.setTimeout(() => setOpen(true), 600)
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [directorStep])

  // Keyboard nav: ArrowRight advances, ArrowLeft goes back, Escape
  // closes. Keep the listener scoped to the overlay lifetime so the
  // global Director shortcuts don't fight for the same key.
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault()
        next()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        prev()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        close()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, stepIdx])

  // Target selector + rect tracking. MUST live BEFORE the early-return
  // so the hook count stays stable across renders (`open` toggling
  // between true/false shouldn't change how many hooks React sees —
  // otherwise React 18 throws "Rendered fewer hooks than expected"
  // and unmounts the whole subtree, which is what was blacking out
  // the Director tab after the user clicked Open Director).
  const targetSelector = STEPS[stepIdx].id === 'chat'
    ? '.director-stage-chat'
    : STEPS[stepIdx].id === 'plan'
      ? '.director-stage-plan'
      : '.director-stage-options'
  const [rect, setRect] = useState<DOMRect | null>(null)
  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const target = document.querySelector(targetSelector)
    const update = () => {
      if (target) setRect(target.getBoundingClientRect())
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, { passive: true })
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update)
    }
  }, [targetSelector, open])

  if (!open) return null

  const step = STEPS[stepIdx]
  const isLast = stepIdx === STEPS.length - 1
  const isFirst = stepIdx === 0

  function next() {
    if (isLast) {
      close()
      return
    }
    setStepIdx(stepIdx + 1)
  }

  function prev() {
    if (!isFirst) setStepIdx(stepIdx - 1)
  }

  function close() {
    setOpen(false)
    writeTourDone()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Director tour"
      className="fixed inset-0 z-50 pointer-events-none"
      data-testid="director-tour"
    >
      {/* Soft scrim — keeps focus on the columns without hiding them
          entirely (pointer-events-none lets the user click through
          to dismiss, the dialog itself catches pointer events). */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[1px]" />

      {/* Highlight box around the active column */}
      {rect && (
        <div
          className="absolute rounded-xl border-2 border-accent-blue shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] transition-all duration-300 ease-out pointer-events-none"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
          }}
          aria-hidden="true"
        />
      )}

      {/* Tooltip card — placement is computed from the highlighted
          column's rect:
          1. Preferred: directly below the column (rect.bottom + 16).
          2. Fallback: above the column (rect.top - cardHeight - 16) if
             the column ends within 200px of the viewport bottom.
          3. Last resort: centered in the viewport when neither side
             fits (small screens / tall columns).
          Horizontal placement clamps the card to the viewport with a
          16px gutter so it never bleeds off-screen on narrow windows. */}
      <div
        className="absolute pointer-events-auto
                   max-w-sm w-[360px] rounded-xl border border-border bg-bg-secondary
                   shadow-2xl px-4 py-3 text-text-primary"
        style={(() => {
          if (!rect) return { left: '50%', top: 80, transform: 'translateX(-50%)' }
          const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1280
          const viewportH = typeof window !== 'undefined' ? window.innerHeight : 720
          // Card height is unknown up-front; assume ~140px worst case
          // (title + 3 lines body + footer buttons). The math still
          // keeps the card in view even if it grows up to ~200px.
          const cardH = 160
          const gap = 16
          const gutter = 16
          const roomBelow = viewportH - rect.bottom - gap
          const roomAbove = rect.top - gap
          let top: number
          if (roomBelow >= cardH || roomBelow >= roomAbove) {
            top = Math.min(rect.bottom + gap, viewportH - cardH - gutter)
          } else if (roomAbove >= cardH) {
            top = Math.max(rect.top - cardH - gap, gutter)
          } else {
            // Neither side fits — center vertically in the viewport.
            top = Math.max((viewportH - cardH) / 2, gutter)
          }
          // Horizontal clamp: align card center on the column center,
          // then translate back into the viewport.
          const columnCenter = rect.left + rect.width / 2
          const cardWidth = 360
          const halfCard = cardWidth / 2
          let left = columnCenter - halfCard
          if (left < gutter) left = gutter
          if (left + cardWidth > viewportW - gutter) left = viewportW - cardWidth - gutter
          return { top, left }
        })()}
      >
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <h3 className="text-sm font-medium">{step.title}</h3>
          <button
            type="button"
            onClick={close}
            className="rounded p-0.5 text-text-muted hover:bg-bg-hover hover:text-text-primary transition-colors"
            aria-label="Close tour"
            title="Close (Esc)"
          >
            <X size={12} />
          </button>
        </div>
        <p className="text-xs text-text-secondary leading-relaxed">{step.body}</p>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-2xs text-text-muted">
            {stepIdx + 1} of {STEPS.length} · ←/→ to navigate
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={prev}
              disabled={isFirst}
              className="px-2 py-1 rounded text-2xs text-text-secondary hover:bg-bg-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-0.5"
              aria-label="Previous step"
            >
              <ChevronLeft size={10} /> Back
            </button>
            <button
              type="button"
              onClick={next}
              className="px-3 py-1 rounded text-2xs font-medium bg-accent-blue text-white hover:bg-accent-blue-hover transition-colors inline-flex items-center gap-0.5"
              aria-label={isLast ? 'Finish tour' : 'Next step'}
            >
              {isLast ? 'Got it' : 'Next'} <ChevronRight size={10} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
