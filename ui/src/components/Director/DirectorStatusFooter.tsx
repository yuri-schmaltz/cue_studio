/**
 * DirectorStatusFooter — the single hardware strip of the Director.
 *
 * Why
 * ---
 * The selected video model and the GPU's VRAM usage used to be
 * rendered in three places: the footer of the Outputs column, the
 * footer of the Generation Options column, and a VRAM bar inside the
 * briefing column. The two footers showed the exact same pair of
 * values, so switching tabs made the numbers jump without changing
 * anything.
 *
 * The Director now has one hardware strip, docked at the bottom of
 * the right column, and one pipeline strip (DirectorStatusBar) under
 * the three columns.
 */

import { useStore } from '../../stores/useStore'

export function DirectorStatusFooter({ testId = 'director-status-rodape' }: { testId?: string }) {
  const modelName = useStore(s => {
    const selected = s.selectedModelPerMode.video || 'ltx2_22B_distilled_1_1'
    const def = s.models.find(item => item.model_type === selected)
    return def?.name || selected
  })
  const architecture = useStore(s => {
    const selected = s.selectedModelPerMode.video || 'ltx2_22B_distilled_1_1'
    return s.models.find(item => item.model_type === selected)?.architecture
  })
  const vramUsedGb = useStore(s => (s.systemStats?.gpu.available ? s.systemStats?.gpu.vram_used_gb : null))
  const vramTotalGb = useStore(s => s.systemStats?.gpu.vram_total_gb ?? 0)
  const gpuAvailable = useStore(s => s.systemStats?.gpu.available ?? false)
  const vram = gpuAvailable && vramUsedGb != null
    ? { usedGb: vramUsedGb, totalGb: vramTotalGb }
    : null

  return (
    <div
      className="mt-auto shrink-0 border-t border-border/40 bg-bg-secondary/70 backdrop-blur-sm px-3 h-[54px] min-h-[54px] flex flex-col justify-center gap-1.5 text-2xs text-text-muted/80 select-none"
      data-testid={testId}
      aria-label="Selected model and VRAM usage"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 min-w-0 truncate">
          <span aria-hidden="true" className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-accent-blue/70" />
          <span className="truncate">
            {modelName}
            {architecture && (
              <span className="text-text-muted/50 ml-1">· {architecture}</span>
            )}
          </span>
        </span>
        <span className="shrink-0 font-mono text-3xs text-text-muted/70">
          {vram ? `${vram.usedGb.toFixed(1)} / ${vram.totalGb.toFixed(0)} GB` : 'VRAM unavailable'}
        </span>
      </div>
      {/* The bar makes the pressure visible at a glance: a run that is
          close to the VRAM limit turns amber before it fails. */}
      <div className="h-1.5 w-full bg-bg-tertiary rounded-full overflow-hidden border border-border/40">
        <div
          className={`h-full transition-all duration-300 rounded-full ${
            vram
              ? (vram.usedGb / (vram.totalGb || 1)) > 0.9
                ? 'bg-amber-500'
                : 'bg-accent-blue/70'
              : 'bg-border/40'
          }`}
          style={{ width: vram ? `${Math.min(100, Math.max(4, Math.round((vram.usedGb / (vram.totalGb || 1)) * 100)))}%` : '0%' }}
        />
      </div>
    </div>
  )
}
