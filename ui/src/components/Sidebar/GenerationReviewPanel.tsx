import { useEffect, useState, useRef } from 'react'
import {
  AlertTriangle,
  Eye,
  ListPlus,
  Loader2,
  Play,
  X,
} from 'lucide-react'
import { getFileUrl, reviseGenerationReview } from '../../api/client'
import { useStore } from '../../stores/useStore'

/**
 * GenerationReviewPanel — the P0 "this is what will be generated" gate.
 *
 * Rendered whenever the store holds a pending review plan. It shows the
 * exact request the app is about to freeze (effective prompt after any
 * inline AI enhancement, model, route, real resolution, duration/windows/
 * frames, steps/CFG/seed, LoRAs, output count) and lets the user confirm,
 * queue, or cancel. The panel itself never submits — that only happens on
 * a deliberate Confirm click, which keeps the quick Generate path intact
 * while making the app's silent decisions visible.
 */
export function GenerationReviewPanel() {
  const dialogRef = useRef<HTMLDivElement>(null)
  const plan = useStore(s => s.reviewPlan)
  const [draft, setDraft] = useState<{ prompt: string; windows: string[] } | null>(null)
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState('')
  const action = useStore(s => s.reviewAction)
  const busy = useStore(s => s.reviewBusy)
  const error = useStore(s => s.promptEnhanceError)
  const reviewBeforeGenerate = useStore(s => s.reviewBeforeGenerate)
  const setReviewBeforeGenerate = useStore(s => s.setReviewBeforeGenerate)
  const confirmGenerationReview = useStore(s => s.confirmGenerationReview)
  const closeGenerationReview = useStore(s => s.closeGenerationReview)
  const setSidebarOpen = useStore(s => s.setSidebarOpen)

  const queueSupported = Boolean(plan?.reviewId) || (plan?.mode !== 'avatar' && plan?.workflowLabel !== 'Blend video')

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    dialogRef.current?.focus()
    return () => previousFocus?.focus()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving && !draft) closeGenerationReview()
      if (event.key === 'Tab') {
        const controls = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]')
        if (!controls?.length) return
        const first = controls[0]
        const last = controls[controls.length - 1]
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
          event.preventDefault(); last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closeGenerationReview, saving, draft])

  if (!plan) return null

  const saveDraft = async () => {
    if (!draft || !plan.reviewId) return
    setSaving(true)
    setEditError('')
    try {
      const result = await reviseGenerationReview(plan.reviewId, draft.prompt, draft.windows)
      if (!result.prepared) throw new Error('Missing prepared revision')
      const params = result.prepared.params
      useStore.setState({ reviewPlan: { ...plan, reviewId: result.id, resolvedParams: params, prompt: String(params.prompt), windowPrompts: draft.windows } })
      localStorage.setItem('cue-studio-pending-generation-review', result.id)
      setDraft(null)
    } catch (e) { setEditError(e instanceof Error ? e.message : 'Unable to save') }
    finally { setSaving(false) }
  }

  const confirm = (target: 'generate' | 'queue') => {
    if (busy || saving || draft) return
    if (target === 'generate') setSidebarOpen(false)
    void confirmGenerationReview(target)
  }

  const seedLabel = plan.seed < 0 ? 'Random' : String(plan.seed)
  const hasLoras = plan.loras.length > 0

  return (
    <div
      className="fixed inset-0 z-[125] flex items-center justify-center bg-black/60 p-4"
      onClick={() => { if (!busy && !saving && !draft) closeGenerationReview() }}
    >
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="generation-review-title" tabIndex={-1}
        className="bg-bg-secondary border border-border rounded-2xl shadow-2xl w-[620px] max-w-[95vw] max-h-[90vh] flex flex-col overflow-hidden"
        onClick={event => event.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-5 pb-4 flex items-start gap-3 shrink-0">
          <div className="w-10 h-10 rounded-xl bg-accent-blue/15 flex items-center justify-center shrink-0">
            {busy
              ? <Loader2 size={19} className="animate-spin text-accent-blue" />
              : <Eye size={19} className="text-accent-blue" />}
          </div>
          <div className="flex-1 min-w-0">
            <h2 id="generation-review-title" className="text-base font-semibold text-text-primary">
              Review before generating
            </h2>
            <p className="text-xs text-text-muted mt-0.5">
              Review the prepared plan. Rendering starts only after approval; automatic model geometry is identified below.
            </p>
          </div>
          <button
            onClick={() => closeGenerationReview()}
            disabled={busy || saving || Boolean(draft)}
            className="p-1 rounded text-text-muted hover:text-text-primary disabled:opacity-40"
            aria-label="Close review"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-6 pb-2 space-y-4 flex-1 overflow-y-auto">
          {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
          {plan.reviewId && <p className="text-2xs text-text-muted">Saved revision: {plan.reviewId.slice(0, 8)} · edits to Studio apply to your next plan</p>}
          {plan.originalPrompt && plan.originalPrompt !== plan.prompt && <details className="text-xs text-text-muted"><summary>Original idea — compare with prepared prompt</summary><p className="whitespace-pre-wrap p-2">{plan.originalPrompt}</p></details>}
          {editError && <p role="alert" className="text-xs text-red-400">{editError}</p>}
          {plan.reviewId && !draft && <button className="text-xs text-accent-blue underline" onClick={() => setDraft({ prompt: plan.prompt, windows: [...(plan.windowPrompts || [])] })}>Edit prepared prompts</button>}
          {draft && <div className="space-y-2">
            <label className="text-xs block">Main prompt<textarea rows={5} disabled={saving} className="w-full border border-border bg-bg-tertiary rounded p-2" value={draft.prompt} onChange={e => setDraft({ ...draft, prompt: e.target.value })} /></label>
            {draft.windows.map((prompt, index) => <label key={index} className="text-xs block">Window {index + 1}<textarea rows={4} disabled={saving} className="w-full border border-border bg-bg-tertiary rounded p-2" value={prompt} onChange={e => setDraft({ ...draft, windows: draft.windows.map((p, i) => i === index ? e.target.value : p) })} /></label>)}
            <button disabled={saving} className="text-xs text-accent-blue mr-4" onClick={() => void saveDraft()}>Save as new revision</button>
            <button disabled={saving} className="text-xs" onClick={() => setDraft(null)}>Discard edits</button>
          </div>}
          {/* Effective prompt */}
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <h3 className="text-xs font-medium text-text-primary">Prompt</h3>
              {plan.enhance.alreadyEnhanced ? (
                <span className="bg-accent-green/15 text-accent-green rounded-full px-1.5 py-0.5 text-2xs">
                  AI-enhanced
                </span>
              ) : plan.enhance.deferred ? (
                <span className="bg-indicator-warning/15 text-indicator-warning rounded-full px-1.5 py-0.5 text-2xs">
                  AI planning will run when the job starts
                </span>
              ) : plan.enhance.automatic ? (
                <span className="bg-accent-blue/15 text-accent-blue rounded-full px-1.5 py-0.5 text-2xs">
                  Step 1: plan prompt, then review
                </span>
              ) : null}
              {plan.promptWordCount > 0 && (
                <span className="text-2xs text-text-muted ml-auto">
                  {plan.promptWordCount} words
                </span>
              )}
            </div>
            {plan.prompt ? (
              <div className="bg-bg-tertiary/70 border border-border rounded-lg p-3 text-xs text-text-primary whitespace-pre-wrap leading-relaxed max-h-[10rem] overflow-y-auto">
                {plan.prompt}
              </div>
            ) : (
              <div className="bg-bg-tertiary/40 border border-dashed border-border rounded-lg p-3 text-xs text-text-muted">
                Empty prompt — generation will rely on the attached media/references.
              </div>
            )}
          </div>

          {!!plan.windowPrompts?.length && <div className="space-y-2">
            <h3 className="text-xs font-medium">Final window prompts</h3>
            {plan.windowPrompts.map((prompt, index) => <details key={index} className="text-xs border border-border rounded p-2"><summary>Window {index + 1}</summary><p className="whitespace-pre-wrap mt-2">{prompt}</p></details>)}
          </div>}
          {plan.resolvedParams && <References params={plan.resolvedParams} />}
          {/* Request params */}
          <div className="grid grid-cols-1 gap-px bg-border rounded-lg overflow-hidden text-xs">
            <Row label="Model" value={plan.modelLabel} emphasis />
            {plan.routeLabel && <Row label="Route" value={plan.routeLabel} />}
            <Row label="Workflow" value={plan.workflowLabel} />
            <Row
              label="Resolution"
              value={plan.resolutionApprox
                ? `${plan.resolutionLabel} · ${plan.aspectRatio}`
                : plan.aspectRatio === 'auto'
                  ? plan.resolutionLabel
                  : `${plan.resolutionLabel} · ${plan.aspectRatio}`}
            />
            {plan.mode !== 'image' && <Row
              label="Length"
              value={plan.mode === 'audio'
                ? `${String(plan.resolvedParams?.duration_seconds ?? plan.durationSeconds)}s duration budget`
                : `${plan.durationSeconds.toFixed(1)}s requested · ${plan.requestedFrames} submitted frames @ ${plan.fps}fps`}
            />}
            <Row
              label="Parameters"
              value={`${plan.steps} steps · CFG ${formatNumber(plan.cfg)} · seed ${seedLabel}`}
            />
            <Row label="LoRAs" value={hasLoras ? `${plan.loras.join(', ')} · weights: ${String(plan.resolvedParams?.loras_multipliers || 'model defaults')}` : 'None'} />
            <Row label="Outputs" value={`${plan.outputCount} ${plan.mode === 'image' ? 'image(s)' : plan.mode === 'audio' ? 'audio output(s)' : 'clip(s)'}`} />
          </div>

          {plan.resolvedParams && <details className="text-xs"><summary>All prepared settings (including negative prompt and finishing)</summary><pre className="mt-2 whitespace-pre-wrap break-all text-2xs max-h-72 overflow-auto">{JSON.stringify(plan.resolvedParams, null, 2)}</pre></details>}
          {/* Warnings */}
          {plan.warnings.length > 0 && (
            <div className="space-y-1.5">
              {plan.warnings.map((warning, index) => (
                <div
                  key={index}
                  className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 text-xs text-indicator-warning leading-relaxed"
                >
                  <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                  <span>{warning}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 shrink-0 flex flex-wrap items-center gap-3 border-t border-border/60">
          <label className="flex items-center gap-2 text-xs text-text-muted cursor-pointer select-none">
            <input
              type="checkbox"
              checked={reviewBeforeGenerate}
              onChange={event => setReviewBeforeGenerate(event.target.checked)}
              className="accent-accent-blue size-3.5"
            />
            Confirm every generation
          </label>
          <button
            onClick={() => closeGenerationReview()}
            disabled={busy || saving || Boolean(draft)}
            className="ml-auto px-4 py-2 text-xs text-text-secondary hover:text-text-primary disabled:opacity-40"
          >
            Cancel
          </button>
          {queueSupported && (
            <button
              onClick={() => confirm('queue')}
              disabled={busy || saving || Boolean(draft)}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg border border-border text-text-secondary hover:text-text-primary hover:border-border-light transition-colors disabled:opacity-40"
            >
              <ListPlus size={14} />
              Add to queue
            </button>
          )}
          <button
            onClick={() => confirm(action ?? 'generate')}
            disabled={busy || saving || Boolean(draft)}
            className="flex items-center gap-1.5 px-5 py-2 text-xs font-medium rounded-lg bg-cta text-white shadow-accent-glow hover:bg-white/10 transition-colors disabled:opacity-40"
          >
            {busy
              ? <Loader2 size={13} className="animate-spin" />
              : action === 'queue'
                ? <ListPlus size={13} />
                : <Play size={13} fill="currentColor" />}
            Confirm {action === 'queue' ? 'to queue' : 'generate'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className={`flex items-baseline gap-3 px-3 py-2 ${emphasis ? 'bg-bg-tertiary/60' : 'bg-bg-secondary/80'}`}>
      <span className="w-24 shrink-0 text-text-muted">{label}</span>
      <span className={`break-words ${emphasis ? 'font-medium text-text-primary' : 'text-text-secondary'}`}>
        {value}
      </span>
    </div>
  )
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100)
}
function References({ params }: { params: Record<string, unknown> }) {
  const references: { role: string; path: string }[] = []
  for (const key of ['image_start', 'image_end', 'image_refs', 'image_guide', 'image_mask', 'audio_guide', 'video_guide', 'video_source', 'voice_reference']) {
    const value = params[key]
    for (const path of Array.isArray(value) ? value : [value]) {
      if (typeof path === 'string' && path) references.push({ role: key.replaceAll('_', ' '), path })
    }
  }
  if (Array.isArray(params.minimax_h3_references)) {
    for (const reference of params.minimax_h3_references) {
      if (reference && typeof reference === 'object') {
        const r = reference as Record<string, unknown>
        if (typeof r.path === 'string') references.push({ role: String(r.name || r.type || 'Omni reference'), path: r.path })
      }
    }
  }
  if (!references.length) return null
  return <div className="space-y-2"><h3 className="text-xs font-medium">Source media and roles</h3><div className="grid grid-cols-2 gap-2">
    {references.map((ref, index) => <div key={index} className="text-2xs rounded border border-border p-2 break-all">
      {/\.(png|jpe?g|webp)$/i.test(ref.path) && <img className="w-full h-24 object-contain mb-1" src={getFileUrl(ref.path)} alt={ref.role} />}
      <strong>{ref.role}</strong><p>{ref.path.split(/[\\/]/).at(-1)}</p>
    </div>)}
  </div></div>
}
