import { Clapperboard, SlidersHorizontal } from 'lucide-react'
import { useStore } from '../../stores/useStore'
import { DirectorStage } from '../Stages/DirectorStage'
import { Sidebar } from '../Sidebar/Sidebar'
import { MainContent } from '../MainContent/MainContent'

/**
 * Standalone Planning / Studio toggle that lives in the bottom
 * HardwareStatusBar (leftSlot). Reading the stage from the store
 * keeps this component decoupled from DirectorPage — App.tsx
 * renders <HardwareStatusBar leftSlot={<DirectorStageToggle/>}/>
 * whenever the Director tab is active, and the toggle mutates the
 * same workspaceStage state as the in-page version used to.
 */
export function DirectorStageToggle() {
  const stage = useStore(s => s.workspaceStage)
  const openPlanning = useStore(s => s.openDirectorStage)
  const openStudio = useStore(s => s.closeDirectorStage)
  return (
    <div className="shell-segmented" role="group" aria-label="Director workflow">
      <button aria-pressed={stage === 'director'} onClick={openPlanning}>
        <Clapperboard size={12} />Planning
      </button>
      <button aria-pressed={stage === 'studio'} onClick={openStudio}>
        <SlidersHorizontal size={12} />Studio
      </button>
    </div>
  )
}

/**
 * Director page — single screen, full-height layout.
 *
 * The Director Stage renders three equal columns (chat / plan /
 * setup) so the user sees the creative conversation, the per-shot
 * artifacts, and the generation options without scrollbars stacking
 * vertically. The Studio toggle (Planning / Studio) used to live in a
 * section-toolbar above the workspace; it now sits in the bottom
 * HardwareStatusBar via the leftSlot prop so the workspace gets the
 * full vertical height back.
 *
 *   ┌─────────────────────────────────────────────────────────┐
 *   │  DirectorStage: chat | plan | setup (1fr 1fr 1fr)        │
 *   └─────────────────────────────────────────────────────────┘
 *
 * When `stage === 'studio'` we render the original Studio layout
 * (Sidebar + MainContent) without the dashboard — manual generation
 * doesn't need pipeline history.
 */
export function DirectorPage() {
  const stage = useStore(s => s.workspaceStage)
  const openPlanning = useStore(s => s.openDirectorStage)
  const openStudio = useStore(s => s.closeDirectorStage)

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Sub-header de navegação proeminente de workflow */}
      <div className="flex items-center justify-between px-4 py-2 bg-bg-secondary/90 backdrop-blur-sm z-10 select-none">
        <div className="flex items-center gap-2">
          <div className="inline-flex p-0.5 rounded-lg bg-bg-tertiary border border-border/60">
            <button
              type="button"
              onClick={openPlanning}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                stage === 'director'
                  ? 'bg-accent-blue text-white shadow-sm'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
              }`}
              data-testid="subnav-director-planning"
            >
              <Clapperboard size={14} />
              <span>Direção & Roteiro (Planning)</span>
            </button>
            <button
              type="button"
              onClick={openStudio}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                stage === 'studio'
                  ? 'bg-accent-blue text-white shadow-sm'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
              }`}
              data-testid="subnav-director-studio"
            >
              <SlidersHorizontal size={14} />
              <span>Laboratório Manual (Studio)</span>
            </button>
          </div>
        </div>
      </div>

      {stage === 'director' ? (
        <div className="director-layout flex-1 min-h-0">
          <div className="director-stage-pane h-full">
            <DirectorStage />
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="flex h-full min-w-0 w-full md:w-auto">
            <Sidebar />
          </div>
          <div className="hidden md:flex min-w-0 flex-1">
            <MainContent />
          </div>
        </div>
      )}
    </div>
  )
}

