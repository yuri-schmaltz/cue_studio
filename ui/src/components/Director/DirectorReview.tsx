import { useEffect, useState } from 'react'
import { Check, X, LockKeyhole, Unlock, Loader2 } from 'lucide-react'
import { useStore } from '../../stores/useStore'
import * as api from '../../api/client'
import { CinemaWarningsPanel } from './CinemaWarningsPanel'
import { AutoResizeTextarea } from '../Sidebar/DirectorChat'

/** One card per scene; approval belongs to the displayed server revision. */
export function DirectorReview() {
  const status = useStore(s => s.pipelineStatus)
  const pid = useStore(s => s.pipelineId)
  if (!pid || status?.status !== 'paused') return null
  return <Review key={`${pid}-${status.pause_reason}-${status.review_digest || ''}`} pid={pid} status={status} />
}

function Review({ pid, status }: { pid: string; status: api.PipelineStatus }) {
  const [plans, setPlans] = useState(() => structuredClone(status.clip_plans))
  const [locks, setLocks] = useState<Record<string, string[]>>(status.creative_locks || {})
  const [approved, setApproved] = useState<number[]>([])
  const rejectionKey = `cue-studio-scene-rejections:${pid}:${status.pause_reason}:${status.review_digest || ''}`
  const [rejected, setRejected] = useState<Record<number, string>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(rejectionKey) || '{}')
      return saved && typeof saved === 'object' && !Array.isArray(saved)
        ? Object.fromEntries(Object.entries(saved).filter((entry): entry is [string, string] => /^\d+$/.test(entry[0]) && typeof entry[1] === 'string')) : {}
    } catch { return {} }
  })
  useEffect(() => {
    try { localStorage.setItem(rejectionKey, JSON.stringify(rejected)) } catch { /* Storage may be unavailable. */ }
  }, [rejected, rejectionKey])
  const rejectedCount = plans.filter((_, index) => index in rejected).length
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const finalReview = status.pause_reason === 'review_render'
  const imageReview = status.pause_reason === 'review_images'
  const fields = ['image_prompt', 'video_prompt'] as const
  const change = (index: number, field: string, value: string | string[]) => {
    setPlans(current => current.map((plan, i) => i === index ? { ...plan, [field]: value } : plan))
    setApproved(current => current.filter(i => i !== index))
  }
  const submit = async () => {
    if (rejectedCount || approved.length !== plans.length) return
    setBusy(true)
    setError('')
    try {
      await api.continuePipeline(pid, { clip_plans: plans, creative_locks: locks, review_digest: status.review_digest })
      useStore.setState({ directorLoading: true, pipelineStatus: { ...status, status: 'running', pause_reason: null } })
      useStore.getState().pollPipelineStatus()
      void useStore.getState().loadDirectorQueue()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to approve')
    } finally { setBusy(false) }
  }
  return (
    <section className="rounded-xl border border-accent-blue/40 bg-bg-secondary p-4 space-y-4">
      <div>
        <h2 className="text-base font-semibold">{finalReview ? 'Approve final render request' : imageReview ? 'Approve storyboard' : 'Review scene plan'}</h2>
        <p className="text-xs text-text-muted mt-1">{finalReview ? 'The renderer has prepared the final prompts, reference bindings and settings. This saved request will be used for generation.' : imageReview
          ? 'Check the images and final video prompts. Approve every scene before rendering video.'
          : 'Edit the prompts, lock the fields you want to preserve, and approve each scene before generating images.'}</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {plans.map((plan, index) => (
          <article key={index} className={`rounded-lg border p-3 space-y-3 ${index in rejected ? 'border-red-400' : approved.includes(index) ? 'border-green-500' : 'border-border'}`}>
            <div className="flex justify-between text-sm font-medium">
              <span>Scene {index + 1}</span>
              {status.planned_clips?.[index] && <span className="text-text-muted text-xs">{status.planned_clips[index].start.toFixed(1)}–{status.planned_clips[index].end.toFixed(1)}s</span>}
            </div>
            {status.clip_images?.[index] && <img className="w-full aspect-video object-contain rounded bg-black" src={api.getFileUrl(status.clip_images[index])} alt={`Scene ${index + 1} storyboard`} />}
            {imageReview && <button disabled={busy} className="text-xs text-accent-blue underline" onClick={async () => {
              setBusy(true)
              setError('')
              try {
                await api.regenerateReviewImage(pid, index, plan.image_prompt)
                useStore.getState().pollPipelineStatus()
                setApproved([])
              } catch (e) { setError(e instanceof Error ? e.message : 'Unable to regenerate image') }
              finally { setBusy(false) }
            }}>Generate another image for this scene</button>}
            {fields.map(field => (
              <label key={field} className="block space-y-1 text-xs">
                <span className="flex items-center justify-between">
                  {field === 'image_prompt' ? 'Image prompt' : 'Video prompt'}
                  <button type="button" disabled={busy} aria-label={`${locks[index]?.includes(field) ? 'Unlock' : 'Lock'} scene ${index + 1} ${field}`}
                    onClick={() => setLocks(current => ({ ...current, [index]: current[index]?.includes(field) ? current[index].filter(f => f !== field) : [...(current[index] || []), field] }))}>
                    {locks[index]?.includes(field) ? <LockKeyhole size={13} /> : <Unlock size={13} />}
                  </button>
                </span>
                <AutoResizeTextarea className="w-full rounded border border-border bg-bg-tertiary p-2 disabled:opacity-60" rows={4} minHeight={96}
                  disabled={busy || finalReview || locks[index]?.includes(field) || (imageReview && field === 'image_prompt')}
                  value={plan[field] || ''} onChange={event => change(index, field, event.target.value)} />
                {finalReview && <p className="text-2xs text-text-muted">Final render — every field is locked as submitted.</p>}
                {!finalReview && locks[index]?.includes(field) && <p className="text-2xs text-accent-blue">Locked — this field will be preserved exactly as written.</p>}
                {plan[field] !== status.clip_plans[index][field] && <details className="text-text-muted"><summary>Original prompt</summary><p className="whitespace-pre-wrap">{status.clip_plans[index][field]}</p></details>}
              </label>
            ))}
            {plan.window_prompts?.map((prompt, wi) => (
              <label key={wi} className="block text-xs">Window {wi + 1}
                <AutoResizeTextarea rows={3} minHeight={72} className="w-full rounded border border-border bg-bg-tertiary p-2" value={prompt}
                  disabled={busy || finalReview || locks[index]?.includes('window_prompts')}
                  onChange={event => change(index, 'window_prompts', plan.window_prompts!.map((p, j) => j === wi ? event.target.value : p))} />
              </label>
            ))}
            {/*
              Cinema rules advisor: surfaces era / anachronism / lighting
              issues against the video prompt so the operator can fix them
              before the GPU runs. Collapsed by default; we send the
              current prompts on demand when the operator opens it.
              Backed by the /api/v1/director/cinema/evaluate endpoint,
              which calls the same advisor used by validate_shot_plan
              internally.
            */}
            <CinemaWarningsPanel
              label={`Scene ${index + 1}`}
              fields={{ scene_goal: plan.video_prompt ?? '' }}
            />
            <div className="flex flex-wrap items-center gap-4">
            <button type="button" disabled={busy} className="flex items-center gap-2 text-xs text-accent-blue"
              onClick={() => {
                setRejected(current => Object.fromEntries(Object.entries(current).filter(([key]) => Number(key) !== index)))
                setApproved(current => current.includes(index) ? current.filter(i => i !== index) : [...current, index])
              }}>
              <Check size={14} /> {approved.includes(index) ? 'Approved — click to reopen' : 'Approve scene'}
            </button>
            <button type="button" disabled={busy} aria-pressed={index in rejected}
              className="flex items-center gap-2 text-xs text-red-400"
              onClick={() => {
                setApproved(current => current.filter(i => i !== index))
                setRejected(current => ({ ...current, [index]: current[index] || '' }))
              }}><X size={14} /> {index in rejected ? 'Scene rejected' : 'Reject scene'}</button>
            </div>
            {index in rejected && <div className="space-y-2 text-xs text-red-400" role="status">
              <p>This scene needs changes. Edit its prompt or generate another image, then approve it individually. Rejection notes are saved in this browser for this revision.</p>
              <label className="block">Reason for rejection (optional)
                <textarea rows={2} disabled={busy} className="mt-1 w-full rounded border border-red-400/50 bg-bg-tertiary p-2 text-text-primary"
                  value={rejected[index]} placeholder="What should change in this scene?"
                  onChange={event => setRejected(current => ({ ...current, [index]: event.target.value }))} />
              </label>
            </div>}
          </article>
        ))}
      </div>
      {finalReview && <details className="text-xs"><summary>Prepared render settings and effective prompts</summary><pre className="whitespace-pre-wrap break-all max-h-96 overflow-auto p-2">{JSON.stringify(status.review_render_params, null, 2)}</pre></details>}
      {error && <p role="alert" className="text-red-400 text-sm">{error}</p>}
      <div className="flex flex-wrap gap-3 items-center text-xs">
        <span>{approved.length}/{plans.length} scenes approved{rejectedCount > 0 && ` · ${rejectedCount} rejected`}</span>
        <button disabled={busy} className="underline" onClick={() => setApproved(plans.map((_, i) => i).filter(i => !(i in rejected)))}>Approve all scenes</button>
        <button disabled={busy || !plans.length || rejectedCount > 0 || approved.length !== plans.length} onClick={() => void submit()}
          className="ml-auto rounded-lg bg-accent-blue text-white px-4 py-2 disabled:opacity-40 flex gap-2 items-center">
          {busy && <Loader2 className="animate-spin" size={14} />} {finalReview ? 'Generate approved video' : imageReview ? 'Prepare final render plan' : 'Continue with approved plan'}
        </button>
      </div>
    </section>
  )
}
