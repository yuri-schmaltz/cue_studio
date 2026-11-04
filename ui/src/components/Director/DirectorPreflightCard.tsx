// ui/src/components/Director/DirectorPreflightCard.tsx
//
// DirectorPreflightCard — what the project will cost, before it does.
//
// This card sits directly above the Director action controls, so the
// last thing the user reads before pressing "Generate Videos" is the
// bill: how many shots the plan becomes, how long the render will take
// on *this* machine, and whether the longest shot fits in this GPU.
//
// Everything it shows comes from `POST /api/v1/director/preflight`. The
// card never computes anything itself — the frames per shot, the ETA and
// the VRAM check all belong to the backend, where the model registry and
// the machine's timing history live. Showing a second, divergent copy
// of that arithmetic in the UI is exactly the bug the shared
// `clip_schedule` module exists to prevent.

import { AlertTriangle, Gauge, Info, RefreshCw, Timer } from 'lucide-react'
import { useStore } from '../../stores/useStore'
import type { DirectorPreflightReport, DirectorPreflightRisk } from '../../types'

/** "4:15" / "1:02:30" — a clock, for footage. */
function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`
}

/** "3h 12m" / "12m 04s" — a duration, for render time. */
function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`
  if (minutes > 0) return `${minutes}m ${String(secs).padStart(2, '0')}s`
  return `${secs}s`
}

const RISK_LABEL: Record<DirectorPreflightRisk, string> = {
  low: 'Fits',
  medium: 'Tight',
  high: 'Won’t fit',
  unknown: 'Unknown',
}

const RISK_CLASS: Record<DirectorPreflightRisk, string> = {
  low: 'text-accent-green',
  medium: 'text-amber-400',
  high: 'text-red-400',
  unknown: 'text-text-muted',
}

const CONFIDENCE_LABEL: Record<string, string> = {
  high: 'high confidence',
  medium: 'fair confidence',
  low: 'rough estimate',
  calibrating: 'calibrating',
}

function Stat({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode
  label: string
  value: string
  hint?: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-2 min-w-0">
      <span className="text-text-muted shrink-0 mt-0.5">{icon}</span>
      <div className="min-w-0">
        <div className="text-2xs uppercase tracking-wider text-text-muted">{label}</div>
        <div className="text-xs text-text-primary font-medium truncate">{value}</div>
        {hint ? <div className="text-2xs text-text-muted truncate">{hint}</div> : null}
      </div>
    </div>
  )
}

function WarningRow({
  severity,
  message,
}: {
  severity: string
  message: string
}) {
  const tone =
    severity === 'error'
      ? 'text-red-400'
      : severity === 'warning'
        ? 'text-amber-400'
        : 'text-text-muted'
  return (
    <li className={`flex items-start gap-1.5 text-2xs ${tone}`}>
      {severity === 'info' ? (
        <Info size={11} className="shrink-0 mt-0.5" />
      ) : (
        <AlertTriangle size={11} className="shrink-0 mt-0.5" />
      )}
      <span className="leading-relaxed">{message}</span>
    </li>
  )
}

/**
 * The pre-flight summary. Renders nothing until a plan exists, and
 * degrades to an explanatory line (never a spinner that never ends)
 * when the estimate is unavailable.
 */
export function DirectorPreflightCard() {
  const report = useStore(s => s.directorPreflight)
  const loading = useStore(s => s.directorPreflightLoading)
  const error = useStore(s => s.directorPreflightError)
  const refresh = useStore(s => s.refreshDirectorPreflight)

  if (!report && !loading && !error) return null

  return (
    <section
      className="rounded-lg border border-border bg-bg-secondary/60 px-3 py-2.5 space-y-2"
      data-testid="director-preflight-card"
      aria-label="Pre-flight estimate"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs text-text-muted uppercase tracking-wider font-semibold">
          Pre-flight
        </h3>
        <button
          type="button"
          onClick={() => { void refresh() }}
          disabled={loading}
          aria-label="Refresh the pre-flight estimate"
          title="Refresh the pre-flight estimate"
          className="text-text-muted hover:text-text-primary transition-colors disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && (
        <p className="text-2xs text-red-400 leading-relaxed">{error}</p>
      )}

      {report && (
        <>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <Stat
              icon={<Gauge size={12} />}
              label="Shots"
              value={`${report.clip_count}`}
              hint={`${report.total_frames.toLocaleString()} frames`}
            />
            <Stat
              icon={<Timer size={12} />}
              label="Footage"
              value={formatClock(report.total_duration_seconds)}
              hint={`${report.resolution} · ${report.fps} fps`}
            />
            <Stat
              icon={<Timer size={12} />}
              label="Estimated render"
              value={
                report.estimated_seconds === null
                  ? 'Not available yet'
                  : formatDuration(report.estimated_seconds)
              }
              hint={
                report.estimated_seconds === null
                  ? 'No local timing history for this model'
                  : `${CONFIDENCE_LABEL[report.eta_confidence] || report.eta_confidence} · ${report.eta_samples} sample${report.eta_samples === 1 ? '' : 's'}`
              }
            />
            <Stat
              icon={<AlertTriangle size={12} />}
              label="Memory"
              value={
                report.gpu_vram_gb
                  ? `${report.gpu_vram_gb.toFixed(0)} GB VRAM`
                  : 'No GPU detected'
              }
              hint={
                <span className={RISK_CLASS[report.oom_risk]}>
                  {RISK_LABEL[report.oom_risk] || report.oom_risk}
                  {report.peak_frames ? ` · ${report.peak_frames} frames per pass` : ''}
                </span>
              }
            />
          </div>

          {report.warnings.length > 0 && (
            <ul className="space-y-1 pt-1 border-t border-border/40">
              {report.warnings.map(warning => (
                <WarningRow
                  key={warning.code + warning.message}
                  severity={warning.severity}
                  message={warning.message}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

export type { DirectorPreflightReport }
