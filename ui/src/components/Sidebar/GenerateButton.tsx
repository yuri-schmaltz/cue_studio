import { useEffect, useState } from 'react'
import { AlertTriangle, Eye, ListPlus, Loader2, Play } from 'lucide-react'
import { useStore } from '../../stores/useStore'
import { GenerationReviewPanel } from './GenerationReviewPanel'
import { useGenerateBlock } from './useGenerateBlock'

export function GenerateButton() {
  useEffect(() => { void useStore.getState().restoreGenerationReview() }, [])
  const startGeneration = useStore(s => s.startGeneration)
  const setSidebarOpen = useStore(s => s.setSidebarOpen)
  const reviewPlan = useStore(s => s.reviewPlan)
  const reviewBeforeGenerate = useStore(s => s.reviewBeforeGenerate)
  const reviewBusy = useStore(s => s.reviewBusy)
  const openGenerationReview = useStore(s => s.openGenerationReview)
  // Strategy B: Director is no longer a top-level mode. The legacy
  // sidebarMode === 'director' value may still exist for the pre-rollout
  // branch; in the new world the equivalent signal is `workspaceStage ===
  // 'director'`. We check both so the Generate button's disabled state
  // stays accurate after the migration.
  const isDirectorMode = useStore(s =>
    s.sidebarMode === 'director'
    || (s.sidebarMode === 'workspace' && s.workspaceStage === 'director'),
  )
  const [pendingAction, setPendingAction] = useState<'generate' | 'queue' | null>(null)

  const generationMode = useStore(s => s.generationMode)
  const imageMode = useStore(s => Number(s.params.image_mode || 0))
  const queueSupported = generationMode !== 'avatar'
    && !(generationMode === 'video' && imageMode === 4)

  // Why Generate is currently disabled, if it is. The reason is rendered
  // inline in the control column instead of living only in a hover tooltip.
  const block = useGenerateBlock()
  const blocked = block !== null

  const perform = async (action: 'generate' | 'queue') => {
    setPendingAction(action)
    if (action === 'generate') setSidebarOpen(false)
    try {
      await startGeneration(action === 'queue' ? 'queue' : 'now')
    } finally {
      setPendingAction(null)
    }
  }

  const submit = (action: 'generate' | 'queue') => {
    if (blocked || pendingAction || reviewBusy || (action === 'queue' && !queueSupported)) return
    // With "Confirm every generation" on, Generate/Queue open the review
    // panel instead of submitting — the panel never submits by itself.
    // Director mode owns its own pipeline, so its Generate stays untouched.
    if (!isDirectorMode && reviewBeforeGenerate) {
      void openGenerationReview(action)
      return
    }
    void perform(action)
  }

  const openReview = () => {
    if (isDirectorMode || blocked || pendingAction || reviewBusy) return
    void openGenerationReview('generate')
  }

  if (blocked && block) {
    const label = block.label
    const title = block.title
    return (
      <>
        <div className="flex flex-col items-end gap-1">
          <div className="grid w-[158px] shrink-0 grid-cols-[2fr_auto_1fr] overflow-hidden rounded-lg bg-amber-500/20 text-indicator-warning">
            <button
              type="button"
              disabled
              title={title}
              className="flex cursor-not-allowed items-center justify-center gap-1.5 whitespace-nowrap px-2 py-2 text-xs font-medium"
            >
              <AlertTriangle size={13} />
              {label}
            </button>
            <button
              type="button"
              disabled
              title={title || 'Review the exact generation plan before it runs.'}
              aria-label="Review unavailable"
              className="flex cursor-not-allowed items-center justify-center border-l border-current/15"
            >
              <Eye size={14} />
            </button>
            <button
              type="button"
              disabled
              title={title || `${label} before adding this generation to the queue.`}
              aria-label="Add to queue unavailable"
              className="flex cursor-not-allowed items-center justify-center border-l border-current/15"
            >
              <ListPlus size={14} />
            </button>
          </div>
          {/* Inline reason: the block cause used to live only in the button's
              hover tooltip, so users had to guess what was missing. */}
          <p className="w-[158px] text-right text-[10px] leading-tight text-amber-500/90">
            {block.reason}
          </p>
        </div>
        {reviewBusy && !reviewPlan && <button className="text-xs text-text-muted underline" onClick={() => useStore.getState().closeGenerationReview()}>Cancel review preparation</button>}
      {reviewPlan && <GenerationReviewPanel />}
      </>
    )
  }

  const pending = pendingAction !== null || reviewBusy

  return (
    <>
      <div className={`grid w-[158px] shrink-0 grid-cols-[2fr_auto_1fr] overflow-hidden rounded-lg font-medium text-white shadow-accent-glow transition-all ${
        pending ? 'bg-bg-active text-text-muted' : 'bg-cta'
      }`}>
        <button
          type="button"
          onClick={() => submit('generate')}
          disabled={pending}
          title="Generate now"
          className="flex items-center justify-center gap-1.5 whitespace-nowrap px-2 py-2 text-xs transition-colors hover:bg-white/10 disabled:cursor-wait disabled:hover:bg-transparent"
        >
          {pendingAction === 'generate'
            ? <Loader2 size={13} className="animate-spin" />
            : <Play size={13} fill="currentColor" />}
          Generate
        </button>
        <button
          type="button"
          onClick={openReview}
          disabled={pending || isDirectorMode}
          title={isDirectorMode
            ? 'Review is part of the Director steps — this Generate keeps Studio submission behavior'
            : 'Review before generating — inspect the exact plan (prompt, model, resolution, duration) without submitting'}
          aria-label="Review before generating"
          className="flex items-center justify-center border-l border-white/20 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:border-text-muted/20 disabled:opacity-40 disabled:hover:bg-transparent"
        >
          {reviewBusy
            ? <Loader2 size={14} className="animate-spin" />
            : <Eye size={14} />}
        </button>
        <button
          type="button"
          onClick={() => submit('queue')}
          disabled={pending || !queueSupported}
          title={queueSupported
            ? 'Hold current Studio settings in the queue without starting generation'
            : 'Add to Queue is not available for specialized Transform and Blend workflows yet'}
          aria-label="Add current Studio settings to the queue"
          className="flex items-center justify-center border-l border-white/20 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:border-text-muted/20 disabled:opacity-40 disabled:hover:bg-transparent"
        >
          {pendingAction === 'queue'
            ? <Loader2 size={14} className="animate-spin" />
            : <ListPlus size={14} />}
        </button>
      </div>
      {reviewBusy && !reviewPlan && <button className="text-xs text-text-muted underline" onClick={() => useStore.getState().closeGenerationReview()}>Cancel review preparation</button>}
      {reviewPlan && <GenerationReviewPanel />}
    </>
  )
}