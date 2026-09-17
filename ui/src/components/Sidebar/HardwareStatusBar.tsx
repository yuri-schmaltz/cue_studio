import { useEffect, useRef, useState } from 'react'
import { Power } from 'lucide-react'
import { useStore } from '../../stores/useStore'
import { releaseModels } from '../../api/client'

// Color a "fullness" bar (VRAM / RAM) by how close to full it is —
// green well below, amber as it tightens, red near the ceiling. This is
// the at-a-glance OOM-risk read that matters most in this app.
function fullnessColor(pct: number): string {
  if (pct >= 90) return 'bg-red-500'
  if (pct >= 75) return 'bg-indicator-warning'
  return 'bg-emerald-500'
}

interface MiniGaugeProps {
  label: string
  percent: number
  value: string
  fill: string
  title?: string
}

/**
 * Compact gauge: label · thin colored bar · value, all on a single line.
 * Used in the bottom status bar — four of these sit side-by-side,
 * centered horizontally, occupying the central area between the
 * project info on the left and the model indicator on the right.
 */
function MiniGauge({ label, percent, value, fill, title }: MiniGaugeProps) {
  const w = Math.max(0, Math.min(100, percent))
  return (
    <div className="mini-gauge" title={title}>
      <span className="mini-gauge-label">{label}</span>
      <div className="mini-gauge-bar"><div className={`mini-gauge-fill ${fill}`} style={{ width: `${w}%` }} /></div>
      <span className="mini-gauge-value">{value}</span>
    </div>
  )
}

/**
 * Bottom-of-screen status bar. Single-row layout: project info on the
 * left, four centered mini-gauges (GPU/VRAM/CPU/RAM) in the middle,
 * resident model + unload control on the right. Polls
 * GET /api/v1/system-stats every ~2s while mounted (pauses when the
 * tab is hidden).
 */
export function HardwareStatusBar({ leftSlot }: { leftSlot?: React.ReactNode } = {}) {
  const stats = useStore(s => s.systemStats)
  const loadSystemStats = useStore(s => s.loadSystemStats)
  const llmStatus = useStore(s => s.llmStatus)

  // Manual model unload (issue #12). Models stay resident between
  // generations by design (instant retry with the same model); this is
  // the explicit opt-out for users who want their VRAM/RAM back now.
  // Two-step: the Power button arms an inline "are you sure" confirm.
  const [confirmUnload, setConfirmUnload] = useState(false)
  const [unloading, setUnloading] = useState(false)
  const [unloadNote, setUnloadNote] = useState<string | null>(null)
  const noteTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(noteTimer.current), [])

  const doUnload = async () => {
    setConfirmUnload(false)
    setUnloading(true)
    try {
      const r = await releaseModels()
      setUnloadNote(r.released.length ? 'Unloaded — memory freed' : 'Nothing to unload')
      loadSystemStats()
    } catch (e) {
      setUnloadNote(e instanceof Error ? e.message : 'Unload failed')
    } finally {
      setUnloading(false)
      window.clearTimeout(noteTimer.current)
      noteTimer.current = window.setTimeout(() => setUnloadNote(null), 5000)
    }
  }

  useEffect(() => {
    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) return
      loadSystemStats()
    }
    tick() // populate immediately, don't wait for the first interval
    const id = setInterval(tick, 2000)
    const onVis = () => { if (!document.hidden) loadSystemStats() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [loadSystemStats])

  const gpu = stats?.gpu
  const ram = stats?.ram
  const cpu = stats?.cpu
  const model = stats?.model
  // Only treat a model as "current" when it is actually resident in VRAM.
  // On a fresh restart `transformer_type` is seeded from the config's
  // last_model_type (the model from the previous session), so without
  // this gate the bar would show a stale name that isn't loaded.
  const modelLoaded = !!model?.loaded

  const fmtGb = (used?: number, total?: number) =>
    used == null || total == null ? '—' : `${used.toFixed(1)} / ${total.toFixed(0)} GB`

  return (
    <footer className="global-status-bar" aria-label="System status">
      <div className="global-status-summary">
        {/* leftSlot renders in the grid's "auto" column when a parent
            (e.g. DirectorPage) wants to inject a workflow toggle that
            belongs at the bottom of the workspace. The middle column
            stays empty so the right-hand cluster (gauges + model)
            hugs the extreme-right edge. The gauges were previously
            centred in a 1fr column; now they sit right next to the
            "No model" pill in the rightmost auto column. */}
        {leftSlot ? (
          <div className="status-project" aria-label="Workspace actions">
            {leftSlot}
          </div>
        ) : (
          <div className="status-project" aria-hidden="true" />
        )}

        {/* Spacer — pushes the right-hand cluster to the edge. */}
        <div />

        <div className="status-right-cluster">
          <div className="status-gauges status-gauges-compact" role="group" aria-label="Hardware telemetry">
            {gpu?.available ? (
              <>
                <MiniGauge label="GPU" percent={gpu.percent} value={`${gpu.percent.toFixed(0)}%`} fill="bg-accent-blue"
                  title={gpu.compute_percent != null ? `3D engine (matches Task Manager) · compute (nvidia-smi): ${gpu.compute_percent.toFixed(0)}%` : undefined} />
                <MiniGauge label="VRAM" percent={gpu.vram_percent} value={fmtGb(gpu.vram_used_gb, gpu.vram_total_gb)}
                  fill={fullnessColor(gpu.vram_percent)} title={`VRAM ${fmtGb(gpu.vram_used_gb, gpu.vram_total_gb)}`} />
              </>
            ) : (
              <div className="mini-gauge"><span className="mini-gauge-label">GPU</span><span className="mini-gauge-value">No GPU</span></div>
            )}
            <MiniGauge label="CPU" percent={cpu?.percent ?? 0} value={`${(cpu?.percent ?? 0).toFixed(0)}%`} fill="bg-accent-blue" />
            <MiniGauge label="RAM" percent={ram?.percent ?? 0} value={fmtGb(ram?.used_gb, ram?.total_gb)}
              fill={fullnessColor(ram?.percent ?? 0)} />
          </div>

          <div className="status-model" title={modelLoaded ? (model?.name || 'Unknown model') : 'No model loaded'}>
            <span className={`status-model-dot ${modelLoaded ? 'is-loaded' : ''}`} aria-hidden="true" />
            <span className="status-model-name truncate">{modelLoaded ? model?.name : 'No model'}</span>
            {(modelLoaded || llmStatus?.loaded) && !confirmUnload && !unloading && (
              <button onClick={() => setConfirmUnload(true)}
                title="Unload model — frees VRAM/RAM now; the next generation reloads it"
                className="status-unload" aria-label="Unload model">
                <Power size={11} />
              </button>
            )}
            {confirmUnload && (
              <span className="status-unload-confirm">
                <span className="text-text-secondary">Unload?</span>
                <button onClick={doUnload} className="status-unload-confirm-yes">Yes</button>
                <button onClick={() => setConfirmUnload(false)} className="status-unload-confirm-no">No</button>
              </span>
            )}
            {unloading && <span className="status-loading">Unloading…</span>}
            {unloadNote && !unloading && <span className="status-loading">{unloadNote}</span>}
          </div>
        </div>
      </div>
    </footer>
  )
}
