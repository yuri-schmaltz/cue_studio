import { useState } from 'react'
import { BookOpen } from 'lucide-react'
import { Sidebar } from '../Sidebar/Sidebar'
import { MainContent } from '../MainContent/MainContent'
import { StyleBiblesModal } from '../StyleBibles/StyleBiblesModal'

/**
 * Studio page — manual generation workspace.
 *
 * Lifted out of DirectorPage (where it used to live behind a
 * Planning/Studio toggle) into its own top-level shell tab so the
 * Director workflow stays focused on AI-driven end-to-end runs and
 * Studio stays one click away for manual tweaks, single-clip rerolls,
 * and image/video editing without losing the planning context.
 *
 * Layout: original Studio (Sidebar + MainContent, no dashboard column).
 * Style Bibles shortcut sits in the sub-header so the modal stays
 * reachable without polluting the main generation surface.
 */
export function StudioPage() {
  const [biblesOpen, setBiblesOpen] = useState(false)

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

      <div className="flex min-h-0 flex-1">
        <div className="flex h-full min-w-0 w-full md:w-auto">
          <Sidebar />
        </div>
        <div className="hidden md:flex min-w-0 flex-1">
          <MainContent />
        </div>
      </div>

      {biblesOpen && <StyleBiblesModal onClose={() => setBiblesOpen(false)} />}
    </div>
  )
}
