import { useState } from 'react'
import { ChevronDown, SlidersHorizontal } from 'lucide-react'
import { DirectorGenerationOptions } from '../Sidebar/DirectorBriefingColumn'
import { DirectorOutputColumn } from './DirectorOutputColumn'

/**
 * Right column of the Director stage.
 *
 * History
 * --------
 * This column used to host only `<DirectorGenerationOptions />`
 * (LoRA picking / advanced params / audio speed / source strength /
 * negative prompt). Commit 20ec7e3 swapped that panel for
 * `<DirectorOutputColumn />` (preview monitor + per-clip video prompt),
 * which left the whole generation-options surface unreachable even though
 * the component and its state still existed.
 *
 * The fix at the time was a two-tab switcher. But both surfaces are
 * useful *at the same time*: the user configures the render (LoRAs,
 * strength, negative prompt) and watches the render (preview monitor,
 * per-clip video prompt). Tabs meant every tweak cost an extra click
 * and the preview vanished while the options were open.
 *
 * So the preview stays visible and the options became a collapsible
 * section above it. One surface, always visible, plus a drawer for
 * the settings — and the hardware strip (model + VRAM) lives once at
 * the bottom of the column.
 */
export function DirectorRightColumn() {
  // Collapsed by default: the preview is what the user watches, and
  // the options are a deliberate detour.
  const [optionsOpen, setOptionsOpen] = useState(false)

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3" data-testid="director-right-column">
      {/* Generation options — a drawer above the preview, not a tab
          that hides it. */}
      <section className="shrink-0 rounded-lg border border-border bg-bg-secondary/60" data-testid="director-right-options">
        <button
          type="button"
          onClick={() => setOptionsOpen(open => !open)}
          aria-expanded={optionsOpen}
          aria-controls="director-right-options-body"
          data-testid="director-right-tab-generation-options"
          className="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-text-secondary hover:text-text-primary transition-colors"
        >
          <SlidersHorizontal size={13} className={optionsOpen ? 'text-accent-blue' : 'text-text-muted'} />
          <span className="flex-1 text-left">Generation Options</span>
          <span className="text-2xs text-text-muted">LoRAs · advanced parameters · negative prompt</span>
          <ChevronDown
            size={13}
            className={`text-text-muted transition-transform ${optionsOpen ? 'rotate-180' : ''}`}
          />
        </button>
        {optionsOpen && (
          <div
            id="director-right-options-body"
            className="max-h-[42vh] overflow-y-auto border-t border-border/40 p-3"
          >
            <DirectorGenerationOptions embedded />
          </div>
        )}
      </section>

      {/* Outputs & preview — always on screen. */}
      <div className="flex-1 min-h-0 flex flex-col">
        <DirectorOutputColumn />
      </div>
    </div>
  )
}
