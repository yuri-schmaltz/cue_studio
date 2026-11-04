import { useMemo } from 'react'
import { AlertTriangle, Scissors, Check } from 'lucide-react'
import { useStore } from '../../stores/useStore'

/** Format a source-time offset as `m:ss` — the same shape the briefing
 *  uses in its `CENA N (0:11 - 0:28)` headers. */
function formatTimecode(sec: number): string {
  const safe = Number.isFinite(sec) && sec > 0 ? sec : 0
  const minutes = Math.floor(safe / 60)
  return `${minutes}:${String(Math.floor(safe - minutes * 60)).padStart(2, '0')}`
}

/**
 * Reconciliation banner for a time-anchored briefing.
 *
 * A Director script may describe only a slice of the uploaded track —
 * three scenes over 45 seconds of a 4:15 song. Without this banner the
 * Director silently planned the whole track, inventing shots for audio
 * the user never wrote about. Here the user sees exactly how much of the
 * audio the script covers and chooses the scope of the plan:
 *
 * - "Only the scripted part" restricts the clip plan to the covered
 *   window, so the resulting video is the audioclipe they asked for.
 * - "Faixa inteira" keeps the historic behaviour of covering everything.
 */
export function DirectorScriptReconciliationBanner() {
  const reconciliation = useStore(s => s.directorScriptReconciliation)
  const scriptWindow = useStore(s => s.directorScriptWindow)
  const setScriptWindow = useStore(s => s.directorSetScriptWindow)
  const analysis = useStore(s => s.directorAnalysis)
  const loading = useStore(s => s.directorLoading)

  const report = reconciliation?.report
  const covered = useMemo(() => {
    if (!report || report.covered_start == null || report.covered_end == null) return null
    return { start: report.covered_start, end: report.covered_end }
  }, [report])

  // Nothing to say: the briefing has no timecodes, or it already
  // describes the whole track.
  if (!report || report.status === 'no_timecodes' || !covered) return null
  if (report.status === 'full_track') return null

  const audioDuration = report.audio_duration ?? analysis?.duration ?? 0
  const uncovered = report.uncovered_seconds ?? Math.max(0, audioDuration - (covered.end - covered.start))
  const isWindowed = scriptWindow != null
    && Math.abs(scriptWindow.start - covered.start) < 0.5
    && Math.abs(scriptWindow.end - covered.end) < 0.5

  return (
    <section
      className="shrink-0 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 flex flex-col gap-2"
      data-testid="director-script-reconciliation"
      aria-label="Script × audio"
    >
      <header className="flex items-start gap-2">
        <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <h4 className="text-xs font-semibold text-amber-200">
            Your script covers {formatTimecode(covered.start)}–{formatTimecode(covered.end)}
            {' '}of a {formatTimecode(audioDuration)} track
          </h4>
          <p className="text-2xs text-text-secondary mt-0.5 leading-relaxed">
            {report.anchored_scene_count} {report.anchored_scene_count === 1 ? 'scene' : 'scenes'}
            {report.scene_count > report.anchored_scene_count
              ? ` (${report.scene_count} in total, ${report.scene_count - report.anchored_scene_count} without a timecode)`
              : ''}
            {' · '}
            {formatTimecode(uncovered)} of the audio were not scripted.
          </p>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={loading || isWindowed}
          onClick={() => void setScriptWindow({ start: covered.start, end: covered.end })}
          className={`px-2 py-1 rounded text-2xs font-medium transition-colors shrink-0 flex items-center gap-1 ${
            isWindowed
              ? 'bg-amber-500/25 text-amber-200 border border-amber-500/50'
              : 'bg-accent-blue text-white hover:bg-accent-blue-hover'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
          title="Plans only the stretch your script describes"
          data-testid="director-script-window-only"
        >
          {isWindowed ? <Check size={11} /> : <Scissors size={11} />}
          Only the scripted part
        </button>
        <button
          type="button"
          disabled={loading || !isWindowed}
          onClick={() => void setScriptWindow(null)}
          className="px-2 py-1 rounded bg-bg-tertiary border border-border text-text-secondary hover:text-text-primary text-2xs font-medium transition-colors shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Plans the whole track, using the script only as a style reference"
          data-testid="director-script-window-full"
        >
          Faixa inteira
        </button>
      </div>

      {isWindowed && (
        <p className="text-2xs text-text-muted">
          O plano foi recalculado para {formatTimecode(covered.start)}–{formatTimecode(covered.end)}.
        </p>
      )}
    </section>
  )
}
