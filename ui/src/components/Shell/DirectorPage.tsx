import { useState } from 'react'
import { BookOpen, Clapperboard } from 'lucide-react'
import { DirectorStage } from '../Stages/DirectorStage'
import { StyleBiblesModal } from '../StyleBibles/StyleBiblesModal'

/**
 * Director page — single screen, full-height layout, planning only.
 *
 * The Director Stage renders three equal columns (chat / plan /
 * setup) so the user sees the creative conversation, the per-shot
 * artifacts, and the generation options without scrollbars stacking
 * vertically. The Manual Studio workflow (single-clip manual
 * generation, image/video editing) used to live behind a toggle in
 * this page; it was lifted to its own top-level shell tab
 * (StudioPage) so the Director workflow stays focused on AI-driven
 * end-to-end runs and manual tools are one click away without losing
 * the planning context.
 *
 *   ┌─────────────────────────────────────────────────────────┐
 *   │  DirectorStage: chat | plan | setup (1fr 1fr 1fr)        │
 *   └─────────────────────────────────────────────────────────┘
 *
 * Style Bibles shortcut sits in the sub-header so the modal stays
 * reachable without polluting the main generation surface.
 */
export function DirectorPage() {
  const [biblesOpen, setBiblesOpen] = useState(false)

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Sub-header de navegação proeminente de workflow. The Planning
          chip used to be a toggle against "Laboratório Manual (Studio)";
          it is now a single-purpose marker (the Studio workflow lives
          on its own shell tab), so we render it as a disabled button
          that just signals the current mode. */}
      <div className="flex items-center justify-between gap-3 px-4 py-2 bg-bg-secondary/90 backdrop-blur-sm z-10 select-none">
        <div className="flex items-center gap-2">
          <div className="inline-flex p-0.5 rounded-lg bg-bg-tertiary border border-border/60">
            <button
              type="button"
              disabled
              className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium bg-accent-blue text-white shadow-sm cursor-default"
              data-testid="subnav-director-planning"
              aria-label="Planning workflow (active)"
            >
              <Clapperboard size={14} />
              <span>Direção & Roteiro (Planning)</span>
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setBiblesOpen(true)}
          className="text-xs px-2 py-1 rounded border border-border hover:bg-bg-tertiary flex items-center gap-1.5 text-text-secondary"
          aria-label="Manage Style Bibles"
          data-testid="director-page-style-bibles"
        >
          <BookOpen size={12} className="text-accent-blue" aria-hidden="true" />
          Style Bibles
        </button>
      </div>

      <div className="director-layout flex-1 min-h-0">
        <div className="director-stage-pane h-full">
          <DirectorStage />
        </div>
      </div>

      {biblesOpen && <StyleBiblesModal onClose={() => setBiblesOpen(false)} />}
    </div>
  )
}
