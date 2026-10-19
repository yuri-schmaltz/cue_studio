import { useEffect, useRef, useState } from 'react'
import { BookOpen } from 'lucide-react'
import { Sidebar } from '../Sidebar/Sidebar'
import { MainContent } from '../MainContent/MainContent'
import { StyleBiblesModal } from '../StyleBibles/StyleBiblesModal'
import { useStore } from '../../stores/useStore'
import { useIsMobile } from '../../lib/useIsMobile'
import {
  findNewOutput,
  generationConcluded,
  shouldAutoSwitchToResults,
  type StudioTab,
} from '../../studio/types'
import { StudioTabs } from './StudioTabs'

/**
 * Studio page — manual generation workspace.
 *
 * Lifted out of DirectorPage (where it used to live behind a
 * Planning/Studio toggle) into its own top-level shell tab so the
 * Director workflow stays focused on AI-driven end-to-end runs and
 * Studio stays one click away for manual tweaks, single-clip rerolls,
 * and image/video editing without losing the planning context.
 *
 * Layout: original Studio (Sidebar + MainContent).
 * Style Bibles shortcut sits in the sub-header so the modal stays
 * reachable without polluting the main generation surface.
 *
 * A13 — responsive results access
 * -------------------------------
 * Below `md` the original layout dropped MainContent entirely
 * (`hidden md:flex`), hiding the generation results on mobile. The
 * page now renders a `Controls | Results` tab bar (≤767px) and toggles
 * which panel is visible — both stay mounted, so switching tabs
 * preserves the prompt, selected media and gallery scroll position.
 * On desktop (≥768px) both panels render side by side exactly as
 * before, regardless of the selected tab.
 *
 * When a generation concludes while the tab layout is active, the app
 * auto-switches to Results and focuses it — unless the user is typing
 * or interacted in the last 4s (spec A13 §4.4/§7); in that case the
 * Results tab keeps a "new result" dot until it's visited.
 */
export function StudioPage() {
  const [biblesOpen, setBiblesOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<StudioTab>('controls')
  const [pendingResult, setPendingResult] = useState<{ id: string; createdAt: string } | null>(null)
  // A13: tabs replace the 2-column split at ≤767px (spec breakpoint),
  // matching the `md:` utility breakpoint (768px) used by the panels.
  const isCompact = useIsMobile(768)
  const resultsRef = useRef<HTMLDivElement>(null)
  const prevOutputNamesRef = useRef<string[] | null>(null)
  const lastInteractionRef = useRef(0)

  // Spec A13 §7: the auto-switch must not interrupt an active user —
  // remember when they last clicked or pressed a key.
  useEffect(() => {
    const note = () => {
      lastInteractionRef.current = Date.now()
    }
    window.addEventListener('pointerdown', note, { passive: true })
    window.addEventListener('keydown', note)
    return () => {
      window.removeEventListener('pointerdown', note)
      window.removeEventListener('keydown', note)
    }
  }, [])

  // Auto-switch to Results when a generation concludes (spec A13
  // §2.1/§4.4). Implemented as a store subscription: state updates
  // happen in the subscription callback (react-hooks allows setState
  // for external-system subscriptions, unlike in an effect body) and
  // only `isGenerating` transitions trigger work — gallery refreshes
  // don't re-render the page.
  useEffect(() => {
    const unsubscribe = useStore.subscribe((state, previous) => {
      if (!generationConcluded(previous.isGenerating, state.isGenerating)) return

      const previousNames = prevOutputNamesRef.current ?? []
      prevOutputNamesRef.current = state.outputs.map((output) => output.name)
      const fresh = findNewOutput(previousNames, state.outputs)

      const shouldSwitch = shouldAutoSwitchToResults({
        concluded: true,
        compact: isCompact,
        activeTab,
        activeElement: document.activeElement,
        lastInteractionAt: lastInteractionRef.current,
        now: Date.now(),
      })

      if (shouldSwitch) {
        // Consumed: the user lands on Results right away, so no dot.
        setPendingResult(null)
        setActiveTab('results')
        // Wait for the panel to become visible before focusing it —
        // focus() also scrolls it into view (the spec's "rola até a
        // nova saída"). The desktop layout never reaches this branch.
        window.requestAnimationFrame(() => resultsRef.current?.focus())
      } else if (activeTab === 'controls' && fresh) {
        // Skipped (typing / recent interaction / desktop split): keep
        // the notification so the Results tab shows its "new" dot
        // until it's visited (cleared by handleTabChange).
        setPendingResult(fresh)
      }
    })
    return unsubscribe
  }, [isCompact, activeTab])

  const handleTabChange = (tab: StudioTab) => {
    setActiveTab(tab)
    if (tab === 'results') setPendingResult(null)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Sub-header mirrors the Director sub-header for visual
          consistency: a left-side context block + a right-side shortcut.
          No workflow toggle here — Studio is a single-purpose surface. */}
      <div className="flex items-center justify-between gap-3 px-4 py-2 bg-bg-secondary/90 backdrop-blur-sm z-10 select-none">
        <div className="flex items-center gap-2 text-xs text-text-secondary">
          <span className="font-medium text-text-primary">Manual generation</span>
          <span aria-hidden="true">·</span>
          <span>Single clips, image/video editing, audio tools</span>
        </div>
        <button
          type="button"
          onClick={() => setBiblesOpen(true)}
          className="text-xs px-2 py-1 rounded border border-border hover:bg-bg-tertiary flex items-center gap-1.5 text-text-secondary"
          aria-label="Manage Style Bibles"
          data-testid="studio-page-style-bibles"
        >
          <BookOpen size={12} className="text-accent-blue" aria-hidden="true" />
          Style Bibles
        </button>
      </div>

      <StudioTabs
        activeTab={activeTab}
        onTabChange={handleTabChange}
        hasPendingResult={Boolean(pendingResult && activeTab === 'controls')}
      />

      <div className="flex min-h-0 flex-1">
        <div
          id="studio-controls-panel"
          role={isCompact ? 'tabpanel' : undefined}
          aria-labelledby={isCompact ? 'studio-tab-controls' : undefined}
          className={`${activeTab === 'controls' ? 'flex' : 'hidden'} md:flex h-full min-w-0 w-full md:w-auto`}
        >
          <Sidebar />
        </div>
        <div
          id="studio-results-panel"
          ref={resultsRef}
          role={isCompact ? 'tabpanel' : undefined}
          aria-labelledby={isCompact ? 'studio-tab-results' : undefined}
          tabIndex={isCompact ? -1 : undefined}
          className={`${activeTab === 'results' ? 'flex' : 'hidden'} md:flex min-w-0 flex-1`}
        >
          <MainContent />
        </div>
      </div>

      {biblesOpen && <StyleBiblesModal onClose={() => setBiblesOpen(false)} />}
    </div>
  )
}
