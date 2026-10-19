import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, AlertTriangle, Film, X } from 'lucide-react'

/** A single cinema rule violation surfaced by the backend advisor. */
export interface CinemaHit {
  rule_id: string
  severity: 'info' | 'warning' | 'error'
  message: string
  field: string
  suggestion: string
}

/** Response from /api/v1/director/cinema/evaluate. */
export interface CinemaEvaluation {
  warnings: string[]
  hits: CinemaHit[]
  era: string
}

export interface CinemaShotFields {
  scene_goal?: string
  environment?: string
  lighting?: string
  wardrobe?: string
  props?: string[]
}

/**
 * Collapsible panel that surfaces cinema-rule warnings on a single shot.
 * Used inside DirectorReview so the operator can see
 * which shots have anachronism, lighting, or era issues BEFORE the
 * pipeline burns GPU on rendering them.
 *
 * The backend runs the same advisor (services/director/cinema/) that
 * validate_shot_plan uses internally — we just expose it through a
 * /api/v1/director/cinema/evaluate endpoint so the UI can call it on
 * demand without re-running the full planner.
 *
 * The panel is collapsed by default to keep the review surface
 * uncluttered. When `error` is set (network failure, etc.) we show
 * a small inline error rather than blocking the surrounding review UI.
 */
export function CinemaWarningsPanel({ fields, label }: { fields: CinemaShotFields; label?: string }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [evaluation, setEvaluation] = useState<CinemaEvaluation | null>(null)
  const [dismissed, setDismissed] = useState(false)
  // Stable string fingerprint of the props bag — used as a
  // useEffect dependency instead of JSON.stringify(fields) inline.
  // exhaustive-deps can't reason about the stability of the inline
  // stringify; lifting it to a named binding silences the warning
  // AND makes the dependency cheap to compare (string equality).
  const propsFingerprint = useMemo(() => JSON.stringify(fields.props ?? {}), [fields.props])

  useEffect(() => {
    // Reset state when the inputs change — a new shot, an edited
    // prompt, etc. Otherwise we'd show stale warnings against new
    // content. We do NOT auto-refetch on every keystroke; the
    // operator opens the panel manually.
    setEvaluation(null)
    setError(null)
    setDismissed(false)
  }, [fields.scene_goal, fields.environment, fields.lighting, fields.wardrobe, propsFingerprint])

  const query = async () => {
    setLoading(true)
    setError(null)
    try {
      const resp = await fetch('/api/v1/director/cinema/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scene_goal: fields.scene_goal ?? '',
          environment: fields.environment ?? '',
          lighting: fields.lighting ?? '',
          wardrobe: fields.wardrobe ?? '',
          props: fields.props ?? [],
        }),
      })
      if (!resp.ok) {
        const text = await resp.text().catch(() => '')
        throw new Error(`HTTP ${resp.status}${text ? `: ${text.slice(0, 200)}` : ''}`)
      }
      const data = (await resp.json()) as CinemaEvaluation
      setEvaluation(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to evaluate cinema rules')
    } finally {
      setLoading(false)
    }
  }

  if (dismissed) return null

  // Empty / clean state: render nothing at all. The advisor only
  // matters when there's something to flag, and we don't want to
  // draw operator attention to a panel that says "everything is fine".
  const hasHits = (evaluation?.hits.length ?? 0) > 0

  return (
    <div className="text-xs space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={async () => {
            const next = !open
            setOpen(next)
            if (next && !evaluation && !loading) {
              await query()
            }
          }}
          className="flex items-center gap-1 text-2xs text-text-secondary hover:text-text-primary"
          aria-expanded={open}
          aria-label={label ? `Cinema rules for ${label}` : 'Cinema rules'}
        >
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          <Film size={10} />
          Cinema rules
          {hasHits && (
            <span
              className="ml-1 inline-flex items-center gap-0.5 rounded bg-amber-500/20 px-1.5 py-0.5 text-2xs text-amber-300"
              aria-label={`${evaluation!.hits.length} cinema warning${evaluation!.hits.length === 1 ? '' : 's'}`}
            >
              <AlertTriangle size={9} />
              {evaluation!.hits.length}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="text-text-muted hover:text-text-secondary"
          aria-label="Dismiss cinema panel"
          title="Dismiss"
        >
          <X size={11} />
        </button>
      </div>
      {error && <p role="alert" className="text-red-400">cinema advisor: {error}</p>}
      {open && (
        <div className="rounded border border-border bg-bg-tertiary/60 p-2 space-y-1">
          {loading && <p className="text-text-muted text-2xs">evaluating…</p>}
          {!loading && evaluation && hasHits && (
            <>
              <p className="text-2xs text-text-muted">
                Era detected: <span className="font-mono">{evaluation.era}</span>
              </p>
              <ul className="space-y-1.5">
                {evaluation.hits.map((hit, i) => (
                  <li key={i} className="border-l-2 border-amber-500/60 pl-2 py-0.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-2xs text-amber-300">{hit.rule_id}</span>
                      <span className="text-2xs text-text-muted">field: {hit.field}</span>
                    </div>
                    <p className="text-text-primary">{hit.message}</p>
                    <p className="text-text-muted text-2xs">suggestion: {hit.suggestion}</p>
                  </li>
                ))}
              </ul>
            </>
          )}
          {!loading && evaluation && !hasHits && (
            <p className="text-green-400 text-2xs flex items-center gap-1">
              <Film size={10} /> No cinema rule violations on this shot.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
