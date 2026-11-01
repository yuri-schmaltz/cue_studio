import { useState } from 'react'
import { Layers, SlidersHorizontal } from 'lucide-react'
import { DirectorGenerationOptions } from '../Sidebar/DirectorBriefingColumn'
import { DirectorOutputColumn } from './DirectorOutputColumn'

/**
 * Right column of the Director stage — a two-tab switcher.
 *
 * History
 * --------
 * This column used to host only `<DirectorGenerationOptions />`
 * (LoRA picking / advanced params / audio speed / source strength /
 * negative prompt). Commit 20ec7e3 swapped that panel for
 * `<DirectorOutputColumn />` (preview monitor + video prompt), which
 * left the whole generation-options surface unreachable even though
 * the component and its state still existed.
 *
 * Both surfaces are useful at the same time — the user configures the
 * render (LoRAs, strength, negative prompt) and watches the render
 * (preview monitor, per-clip video prompt). Instead of splitting them
 * into two columns (which would break the 3-column grid) or hiding one
 * behind a modal, the column became a tabbed panel: "Generation
 * Options" keeps the full option set, "Outputs & Preview" keeps the
 * monitor.
 *
 * Each panel owns its own footer strip (model + VRAM), so switching
 * tabs doesn't move the bottom row.
 *
 * The tab strip mirrors the left column's pill tabs
 * (`DirectorAudioSourceTabs`) so both columns read as one system.
 */

type RightColumnTab = 'generation-options' | 'outputs'

const TAB_IDS: Record<RightColumnTab, string> = {
  'generation-options': 'director-right-tab-generation-options',
  outputs: 'director-right-tab-outputs',
}

const PANEL_IDS: Record<RightColumnTab, string> = {
  'generation-options': 'director-right-panel-generation-options',
  outputs: 'director-right-panel-outputs',
}

export function DirectorRightColumn() {
  // "Outputs & Preview" is the default landing view — it is what the
  // column showed before the tabbed layout, and it is where the user
  // watches a running pipeline. The Generation Options tab is one
  // click away.
  const [activeTab, setActiveTab] = useState<RightColumnTab>('outputs')

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3" data-testid="director-right-column">
      <div
        role="tablist"
        aria-label="Director right column panels"
        className="shrink-0 grid grid-cols-2 gap-1.5"
      >
        <button
          type="button"
          role="tab"
          id={TAB_IDS['generation-options']}
          aria-controls={PANEL_IDS['generation-options']}
          aria-selected={activeTab === 'generation-options'}
          aria-label="Generation options — LoRAs, advanced parameters, audio speed, reference strength and negative prompt"
          title="LoRAs, advanced parameters, audio speed, reference strength and negative prompt"
          onClick={() => setActiveTab('generation-options')}
          data-testid="director-right-tab-generation-options"
          className={`flex items-center justify-center gap-1 px-1.5 py-2 rounded-lg border text-xs font-medium transition-colors ${
            activeTab === 'generation-options'
              ? 'border-accent-blue bg-accent-blue text-white shadow-sm'
              : 'border-border bg-bg-tertiary text-text-secondary hover:text-text-primary hover:border-border-light'
          }`}
        >
          <SlidersHorizontal
            size={13}
            className={activeTab === 'generation-options' ? 'text-white' : 'text-text-muted'}
          />
          <span className="truncate">Generation Options</span>
        </button>

        <button
          type="button"
          role="tab"
          id={TAB_IDS.outputs}
          aria-controls={PANEL_IDS.outputs}
          aria-selected={activeTab === 'outputs'}
          aria-label="Outputs and preview — monitor and per-clip video prompt"
          title="Preview monitor and the video prompt of the selected clip"
          onClick={() => setActiveTab('outputs')}
          data-testid="director-right-tab-outputs"
          className={`flex items-center justify-center gap-1 px-1.5 py-2 rounded-lg border text-xs font-medium transition-colors ${
            activeTab === 'outputs'
              ? 'border-accent-blue bg-accent-blue text-white shadow-sm'
              : 'border-border bg-bg-tertiary text-text-secondary hover:text-text-primary hover:border-border-light'
          }`}
        >
          <Layers
            size={13}
            className={activeTab === 'outputs' ? 'text-white' : 'text-text-muted'}
          />
          <span className="truncate">Outputs &amp; Preview</span>
        </button>
      </div>

      <div
        role="tabpanel"
        id={PANEL_IDS[activeTab]}
        aria-labelledby={TAB_IDS[activeTab]}
        className="flex-1 min-h-0 flex flex-col"
      >
        {activeTab === 'generation-options' ? (
          <DirectorGenerationOptions />
        ) : (
          <DirectorOutputColumn />
        )}
      </div>
    </div>
  )
}
