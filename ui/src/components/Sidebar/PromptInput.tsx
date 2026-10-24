import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { Sparkles, Loader2, ChevronDown, ChevronUp, Brain, PenLine, RefreshCw, X, History, Trash2 } from 'lucide-react'
import { useStore } from '../../stores/useStore'
import { getPromptHistory, removePromptFromHistory, clearPromptHistory } from '../../lib/promptHistory'
import {
  effectiveH3OmniSequenceFrames,
  h3OmniSequenceWindowCount,
  h3TimelineFrames,
} from '../../lib/h3Memory'
import {
  continuationFirstWindowFrames,
  durationWindowPlan,
} from '../../lib/durationPlanning'

const placeholders: Record<string, string> = {
  image: 'Describe your image...',
  video: 'Describe your video...',
  audio: 'Enter text to speak or describe audio...',
  avatar: 'Describe the finished video...',
}

/** Lightweight display-only estimate for reviewed AI window prompts. */
function estimateH3TextTokens(value: string): number {
  const lexical = value.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*|[^\w\s]/g)?.length ?? 0
  return Math.ceil(lexical * 1.25) + (value.trim() ? 8 : 0)
}

function useAutoGrowingTextarea(value: string) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const fitToContent = () => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    // scrollHeight includes padding but not the two one-pixel borders used
    // by these border-box textareas. Include them so the final line is visible.
    textarea.style.height = `${textarea.scrollHeight + 2}px`
  }

  useLayoutEffect(fitToContent, [value])
  useEffect(() => {
    window.addEventListener('resize', fitToContent)
    return () => window.removeEventListener('resize', fitToContent)
  }, [])

  return textareaRef
}

function H3WindowPromptTextarea({
  value,
  onChange,
  readOnly,
  title,
  active,
}: {
  value: string
  onChange: (value: string) => void
  readOnly: boolean
  title: string
  active: boolean
}) {
  const textareaRef = useAutoGrowingTextarea(value)

  return (
    <textarea
      ref={textareaRef}
      rows={1}
      value={value}
      onChange={event => onChange(event.target.value)}
      readOnly={readOnly}
      title={title}
      className={`w-full min-h-[92px] resize-none overflow-hidden bg-bg-secondary border rounded px-2 py-1.5 text-2xs leading-relaxed text-text-secondary focus:outline-none focus:border-accent-blue ${
        active ? 'border-accent-blue/70 bg-accent-blue/5' : 'border-border'
      }`}
    />
  )
}

function useEnhanceStatus(isEnhancing: boolean) {
  const [status, setStatus] = useState<{ phase: 'loading' | 'thinking' | 'writing' | 'idle'; chars: number }>({ phase: 'idle', chars: 0 })

  useEffect(() => {
    if (!isEnhancing) return
    let active = true
    queueMicrotask(() => {
      if (active) setStatus({ phase: 'loading', chars: 0 })
    })
    const poll = async () => {
      let streamStarted = false
      while (active) {
        try {
          // Check if LLM is still loading
          if (!streamStarted) {
            const llmRes = await fetch('/api/v1/llm/status')
            if (llmRes.ok && active) {
              const llmData = await llmRes.json()
              if (!llmData.loaded) {
                setStatus({ phase: 'loading', chars: 0 })
                await new Promise(r => setTimeout(r, 800))
                continue
              }
            }
          }
          const res = await fetch('/api/v1/llm/stream-status')
          if (res.ok && active) {
            const data = await res.json()
            const text = (data.text || '') as string
            if (text.length > 0) streamStarted = true
            const hasThinking = text.includes('<think>') || text.includes('<thinking>')
            const thinkingClosed = text.includes('</think>') || text.includes('</thinking>')
            if (hasThinking && !thinkingClosed) {
              setStatus({ phase: 'thinking', chars: text.length })
            } else if (text.length > 0) {
              setStatus({ phase: 'writing', chars: text.length })
            } else if (!streamStarted) {
              setStatus({ phase: 'loading', chars: 0 })
            }
            if (data.done) break
          }
        } catch { /* ignore */ }
        await new Promise(r => setTimeout(r, 800))
      }
    }
    poll()
    return () => { active = false }
  }, [isEnhancing])

  return isEnhancing ? status : { phase: 'idle' as const, chars: 0 }
}

export function PromptInput() {
  const prompt = useStore(s => s.params.prompt)
  const promptTextareaRef = useAutoGrowingTextarea(prompt)
  const setParam = useStore(s => s.setParam)
  const generationMode = useStore(s => s.generationMode)
  const editSubMode = useStore(s => s.editSubMode)
  const enhancePrompt = useStore(s => s.enhancePrompt)
  const isEnhancing = useStore(s => s.isEnhancing)
  const promptEnhanceError = useStore(s => s.promptEnhanceError)
  const durationSeconds = useStore(s => s.durationSeconds)
  const slidingWindowSeconds = useStore(s => s.slidingWindowSeconds)
  const slidingWindowOverlap = useStore(s => s.slidingWindowOverlap)
  const slidingWindowLocked = useStore(s => s.slidingWindowLocked)
  const modelOptions = useStore(s => s.modelOptions)
  const resolution = useStore(s => s.params.resolution)
  const totalVramGb = useStore(s => s.systemStats?.gpu.vram_total_gb ?? 0)
  const imageMode = useStore(s => s.params.image_mode)
  const studioVideoWorkflow = useStore(s => s.studioVideoWorkflow)
  const h3CameraCoverage = useStore(s => s.params.minimax_h3_camera_coverage || 'auto')
  const h3FirstLastMultiWindow = useStore(s => s.params.minimax_h3_multi_window === true)
  const h3WindowPlanningEnabled = useStore(s => s.params.minimax_h3_window_storyboard !== false)
  const h3ReferenceSequenceEnabled = useStore(s => s.params.minimax_h3_reference_sequence === true)
  const h3ManualSequencePrompts = useStore(s => s.params.minimax_h3_sequence_prompt_mode === 'manual')
  const h3NativeSequence = useStore(s => s.params.minimax_h3_sequence_continuity !== false)
  const ltxMultiWindow = useStore(s => s.params.ltx_multi_window === true)
  const ltxManualWindowPrompts = useStore(s => s.params.ltx_window_prompt_mode === 'manual')
  const h3WindowPlan = useStore(s => s.h3WindowPlan)
  const updateH3WindowPrompt = useStore(s => s.updateH3WindowPrompt)
  const moveH3Window = useStore(s => s.moveH3Window)
  const activeH3JobPhase = useStore(s => {
    const job = s.jobs.find(item => (
      (item.status === 'queued' || item.status === 'running')
      && !!item.h3WindowPlan
    ))
    return job ? (job.phase || job.message || '') : ''
  })
  const activeH3JobPlanSignature = useStore(s => s.jobs.find(item => (
    (item.status === 'queued' || item.status === 'running')
    && !!item.h3WindowPlan
  ))?.h3WindowPlan?.signature || '')
  const [ttsMenuOpen, setTtsMenuOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [closedWindowPlanSignature, setClosedWindowPlanSignature] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const historyMenuRef = useRef<HTMLDivElement>(null)

  const isAudioOnly = modelOptions?.audio_only
  const voiceCount = useStore(s => s.ttsVoiceCount)
  const isMultiVoice = voiceCount >= 2
  // Does the active TTS model support multi-speaker output? Scenema, Kugel,
  // Qwen3-TTS, Index-TTS2 all do (max_voice_count >= 2 in their handlers).
  // Single-speaker-only engines leave it undefined; default 6 is the legacy
  // "any multi-speaker engine" assumption. Falling back to >1 keeps both
  // dialogue and monologue enhance available unless a model declares itself
  // single-speaker.
  const maxVoiceCount = ((modelOptions as { max_voice_count?: number } | null)?.max_voice_count) ?? 6
  const supportsDialogue = maxVoiceCount > 1
  // Main Sparkles button default: dialogue when the user has actually added
  // 2+ voice slots, monologue otherwise. The dropdown lets the user override
  // either way regardless of voice slot count.
  const defaultMode: 'dialogue' | 'monologue' = isMultiVoice ? 'dialogue' : 'monologue'
  const enhanceStatus = useEnhanceStatus(isEnhancing)
  const fps = modelOptions?.fps ?? 16
  const swDefaults = (modelOptions as Record<string, unknown> | null)?.sliding_window_defaults as Record<string, number> | undefined
  const discardFrames = swDefaults?.discard_last_frames ?? 0
  const overlapSec = slidingWindowOverlap / fps
  const discardSec = discardFrames / fps
  const supportsSlidingWindows = modelOptions?.sliding_window === true
  const firstWindowSeconds = (
    studioVideoWorkflow === 'extend'
    && supportsSlidingWindows
  )
    ? continuationFirstWindowFrames(
        Math.round(slidingWindowSeconds * fps),
        slidingWindowOverlap,
      ) / fps
    : slidingWindowSeconds
  const plannedDuration = durationWindowPlan(
    durationSeconds,
    slidingWindowSeconds,
    overlapSec,
    discardSec,
    firstWindowSeconds,
  )
  const isH3FirstLast = (
    String(modelOptions?.architecture || '').startsWith('minimax_h3')
    && modelOptions?.omni_reference !== true
  )
  const isLtxSequence = modelOptions?.multi_window_sequence_controls === true
  const windowCount = supportsSlidingWindows
    && (!isH3FirstLast || h3FirstLastMultiWindow)
    && (!isLtxSequence || ltxMultiWindow)
    ? plannedDuration.windowCount
    : 1
  const usesWindows = generationMode === 'video' && supportsSlidingWindows && windowCount > 1 && imageMode !== 2
  const usesH3WindowPlanner = (
    usesWindows
    && modelOptions?.sliding_window_auto_prompt_pacing === true
    && h3WindowPlanningEnabled
  )
  const nativeMaximumFrames = modelOptions?.frames_maximum ?? null
  const sequenceClipFrames = nativeMaximumFrames != null
    ? effectiveH3OmniSequenceFrames({
        policy: modelOptions?.omni_sequence_memory_policy,
        resolution,
        totalVramGb,
        minimumFrames: modelOptions?.frames_minimum ?? 124,
        maximumFrames: nativeMaximumFrames,
        frameStep: modelOptions?.frames_steps ?? 17,
        selectedFrames: Math.round(slidingWindowSeconds * fps),
        manualOverride: slidingWindowLocked,
      }).frames
    : null
  const h3SequenceEnabled = (
    generationMode === 'video'
    && modelOptions?.omni_reference === true
    && h3ReferenceSequenceEnabled
    && sequenceClipFrames != null
  )
  const h3SequenceTotalFrames = h3TimelineFrames(
    durationSeconds,
    fps,
    modelOptions?.frames_maximum,
  )
  const h3SequenceNeedsMultiplePasses = (
    h3SequenceEnabled
    && sequenceClipFrames != null
    && h3SequenceTotalFrames > sequenceClipFrames
  )
  const usesH3ManualSequence = h3SequenceEnabled && h3ManualSequencePrompts
  const usesH3ManualFirstLast = (
    usesWindows
    && isH3FirstLast
    && h3FirstLastMultiWindow
    && !h3WindowPlanningEnabled
  )
  const usesH3ManualPrompts = usesH3ManualSequence || usesH3ManualFirstLast
  const usesLtxManualPrompts = (
    usesWindows
    && isLtxSequence
    && ltxMultiWindow
    && ltxManualWindowPrompts
  )
  const usesManualWindowPrompts = usesH3ManualPrompts || usesLtxManualPrompts
  const usesH3SequencePlanner = h3SequenceNeedsMultiplePasses && !h3ManualSequencePrompts
  const sequenceClipCount = h3SequenceEnabled && sequenceClipFrames
    ? h3OmniSequenceWindowCount({
        totalFrames: h3SequenceTotalFrames,
        windowFrames: sequenceClipFrames,
        overlapFrames: slidingWindowOverlap,
        nativeContinuation: h3NativeSequence,
    })
    : 1
  const manualPromptLineCount = prompt.split('\n').filter(line => line.trim()).length
  const manualPromptCount = (usesH3ManualFirstLast || usesLtxManualPrompts)
    ? windowCount
    : sequenceClipCount
  const manualPromptUnit = (usesH3ManualFirstLast || usesLtxManualPrompts)
    ? 'window'
    : (h3NativeSequence ? 'window' : 'clip')
  const usesH3Plan = usesH3WindowPlanner || usesH3SequencePlanner
  const expectedPlanCount = usesH3SequencePlanner ? sequenceClipCount : windowCount
  const expectedWindowFrames = usesH3SequencePlanner
    ? Math.max(1, Number(sequenceClipFrames || 1))
    : Math.max(1, Math.round(slidingWindowSeconds * fps))
  const h3PlanIsStale = !!h3WindowPlan && (
    h3WindowPlan.source_prompt.trim() !== prompt.trim()
    || h3WindowPlan.window_count !== expectedPlanCount
    || h3WindowPlan.total_frames !== Math.max(1, Math.round(durationSeconds * fps))
    || h3WindowPlan.window_frames !== expectedWindowFrames
    || (h3WindowPlan.camera_coverage || 'auto') !== h3CameraCoverage
    || (usesH3SequencePlanner
      ? h3WindowPlan.plan_kind !== 'reference_sequence'
      : h3WindowPlan.plan_kind === 'reference_sequence')
    || (usesH3SequencePlanner
      && !!h3WindowPlan.native_continuation !== h3NativeSequence)
    || (usesH3SequencePlanner
      && h3NativeSequence
      && Number(h3WindowPlan.overlap_frames || 0) !== slidingWindowOverlap)
  )
  const matchingActiveH3Phase = (
    h3WindowPlan?.signature === activeH3JobPlanSignature
      ? activeH3JobPhase
      : ''
  )
  const activeWindowMatch = matchingActiveH3Phase.match(/(?:Sliding Window|Clip)\s+(\d+)\/(\d+)/i)
  const activeH3Window = activeWindowMatch ? Number(activeWindowMatch[1]) : null
  const modePlaceholder = generationMode === 'avatar' && editSubMode === 'recast'
    ? 'Describe the finished video and replacement characters...'
    : generationMode === 'avatar' && editSubMode === 'restyle'
      ? 'Describe the finished video...'
      : generationMode === 'avatar' && editSubMode === 'outpaint'
        ? 'Describe the expanded scene...'
        : generationMode === 'avatar' && editSubMode === 'retake'
          ? 'Describe the replacement performance...'
          : generationMode === 'avatar' && editSubMode === 'edit_anything'
            ? 'Describe the change you want...'
      : (placeholders[generationMode] || 'Describe your content...')

  // Close TTS menu on outside click
  useEffect(() => {
    if (!ttsMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setTtsMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [ttsMenuOpen])

  // Close prompt history menu on outside click
  useEffect(() => {
    if (!historyOpen) return
    const handler = (e: MouseEvent) => {
      if (historyMenuRef.current && !historyMenuRef.current.contains(e.target as Node)) setHistoryOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [historyOpen])

  // A newly planned storyboard opens automatically. Store only the signature
  // the user explicitly closed so a replacement plan opens without a state-
  // synchronization effect or an extra render.
  const windowPlanOpen = Boolean(
    usesH3Plan
    && h3WindowPlan?.signature
    && closedWindowPlanSignature !== h3WindowPlan.signature
  )

  // Keep the prompt area at the bottom when the sidebar has spare room. The
  // textarea itself grows to its complete content height, and the sidebar's
  // outer scroller handles prompts taller than the viewport.
  return (
    <div className="relative grow shrink-0 flex flex-col">
      {/* Enhance status indicator */}
      {isEnhancing && enhanceStatus.phase !== 'idle' && (
        <div className="flex items-center gap-1.5 px-2 py-1 text-2xs text-text-muted bg-bg-tertiary/80 rounded-t-lg border border-b-0 border-border">
          {enhanceStatus.phase === 'loading' ? (
            <>
              <Loader2 size={10} className="text-text-muted animate-spin" />
              <span>Loading LLM...</span>
            </>
          ) : enhanceStatus.phase === 'thinking' ? (
            <>
              <Brain size={10} className="text-chip-purple animate-pulse" />
              <span>Thinking...</span>
            </>
          ) : (
            <>
              <PenLine size={10} className="text-accent-blue animate-pulse" />
              <span>Writing...</span>
            </>
          )}
        </div>
      )}
      {!isEnhancing && promptEnhanceError && (
        <div
          role="alert"
          className="mb-1.5 rounded-lg border border-indicator-error/40 bg-indicator-error/10 px-2.5 py-1.5 text-2xs text-indicator-error"
        >
          {promptEnhanceError}
        </div>
      )}
      {usesH3Plan && h3WindowPlan && (
        <div className="mb-1.5">
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-border bg-bg-tertiary/70">
            <button
              type="button"
              onClick={() => setClosedWindowPlanSignature(current => (
                current === h3WindowPlan?.signature ? null : (h3WindowPlan?.signature ?? null)
              ))}
              className="flex-1 min-w-0 flex items-center gap-1.5 text-left"
              title="Review the complete Context-IR prompt assigned to each H3 continuation window."
            >
              {windowPlanOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              <span className="text-2xs font-medium text-text-secondary truncate">
                Exact H3 prompts · {h3WindowPlan.window_count} {usesH3SequencePlanner && !h3NativeSequence ? 'clips' : 'windows'}
              </span>
              {h3PlanIsStale && (
                <span className="text-2xs text-amber-400">Needs update</span>
              )}
              {h3WindowPlan.order_edited && (
                <span
                  title="Prompts were moved into the existing time slots. Continuity summaries were cleared. Review actions, dialogue timing and transitions before approving this order."
                  className="text-2xs text-accent-blue"
                >
                  Order edited
                </span>
              )}
              {(h3WindowPlan.planned_by === 'deterministic_fallback' || h3WindowPlan.planned_by === 'hybrid_repair') && (
                <span className="text-2xs text-amber-400">
                  {h3WindowPlan.planned_by === 'hybrid_repair' ? 'Repaired' : 'Fallback'}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => enhancePrompt()}
              disabled={isEnhancing}
              title={`Rebuild the H3 ${usesH3SequencePlanner ? 'reference sequence' : 'window plan'} from the current idea and timing.`}
              className="p-1 text-text-muted hover:text-accent-blue disabled:opacity-50"
            >
              <RefreshCw size={11} className={isEnhancing ? 'animate-spin' : ''} />
            </button>
          </div>
          {!!h3WindowPlan.planning_warnings?.length && (
            <div
              role="alert"
              className="mt-1.5 rounded-lg border border-amber-400/35 bg-amber-400/10 px-2.5 py-2 text-2xs leading-relaxed text-amber-300"
            >
              <div className="font-medium">Maestro repaired this H3 plan</div>
              {h3WindowPlan.planning_warnings.map((warning, index) => (
                <div key={`${index}-${warning}`} className="mt-0.5">
                  {warning}
                </div>
              ))}
              {!!h3WindowPlan.planning_diagnostics?.length && (
                <details className="mt-1 text-text-muted">
                  <summary className="cursor-pointer select-none">Why repair was needed</summary>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {h3WindowPlan.planning_diagnostics.map((diagnostic, index) => (
                      <li key={`${index}-${diagnostic}`}>{diagnostic}</li>
                    ))}
                  </ul>
                </details>
              )}
              <div className="mt-1 text-text-muted">
                Review the exact window prompts below or press refresh to try the AI planner again.
              </div>
            </div>
          )}
          {!!h3WindowPlan.planning_notes?.length && (
            <div
              role="status"
              className="mt-1.5 rounded-lg border border-border bg-bg-tertiary/70 px-2.5 py-2 text-2xs leading-relaxed text-text-muted"
            >
              <div className="font-medium text-text-secondary">H3 timing note</div>
              {h3WindowPlan.planning_notes.map((note, index) => (
                <div key={`${index}-${note}`} className="mt-0.5">
                  {note}
                </div>
              ))}
            </div>
          )}
          {windowPlanOpen && (
            <div className="mt-2 space-y-3">
              {/* Real plan geometry, at a glance: one proportional segment per
                  window so the story arc is visible without opening each one. */}
              <div className="flex items-center gap-2">
                <div className="flex flex-1 h-2 overflow-hidden rounded bg-bg-secondary">
                  {h3WindowPlan.windows.map(window => {
                    const windowFrames = Math.max(0, (window.end_frame || 0) - (window.start_frame || 0))
                    const segmentBasis = Math.max(
                      1,
                      h3WindowPlan.total_frames
                      || (h3WindowPlan.windows[h3WindowPlan.windows.length - 1]?.end_frame || 1),
                    )
                    const width = Math.max(1.5, (windowFrames / segmentBasis) * 100)
                    return (
                      <div
                        key={`seg-${window.index}`}
                        title={`${window.title || `Beat ${window.index}`} · ${window.start_frame}–${window.end_frame}f (${window.start_seconds.toFixed(1)}–${window.end_seconds.toFixed(1)}s)`}
                        style={{ width: `${width}%` }}
                        className={activeH3Window === window.index ? 'bg-accent-blue' : 'bg-text-muted/45'}
                      >
                        &nbsp;
                      </div>
                    )
                  })}
                </div>
                <span className="shrink-0 text-2xs text-text-muted">
                  {h3WindowPlan.total_frames} frames
                </span>
              </div>
              {h3WindowPlan.windows.map((window, index) => (
                <div
                  key={`${window.index}-${window.start_frame}`}
                  className="space-y-1"
                >
                  <div className={`flex items-center justify-between gap-2 text-2xs ${
                    activeH3Window === window.index ? 'text-accent-blue' : 'text-text-muted'
                  }`}>
                    <span className="flex items-center gap-1 min-w-0 truncate">
                      {usesH3SequencePlanner && !h3NativeSequence ? 'Clip' : 'Window'} {window.index}: {window.title || `Beat ${window.index}`}
                      {activeH3Window === window.index ? ' · Generating now' : ''}
                      {!h3WindowPlan.order_edited && window.closing_state && (
                        <span
                          title={`Continuity carried into the next window: ${window.closing_state}`}
                          className="shrink-0 rounded-full border border-border bg-bg-secondary px-1.5 py-px text-2xs text-text-muted"
                        >
                          {window.closing_state}
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-1.5 shrink-0">
                      {!matchingActiveH3Phase && (
                        <span className="flex items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => moveH3Window(index, index - 1)}
                            disabled={index === 0}
                            title="Move this beat earlier"
                            className="p-0.5 rounded hover:bg-bg-hover text-text-muted hover:text-accent-blue disabled:opacity-30"
                          >
                            <ChevronUp size={10} />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveH3Window(index, index + 1)}
                            disabled={index === h3WindowPlan.windows.length - 1}
                            title="Move this beat later"
                            className="p-0.5 rounded hover:bg-bg-hover text-text-muted hover:text-accent-blue disabled:opacity-30"
                          >
                            <ChevronDown size={10} />
                          </button>
                        </span>
                      )}
                      <span>
                        {window.start_seconds.toFixed(1)}–{window.end_seconds.toFixed(1)}s
                        {' · '}
                        {window.start_frame}–{window.end_frame}f
                        {usesH3WindowPlanner && ` · ~${estimateH3TextTokens(window.prompt)} tokens`}
                      </span>
                    </span>
                  </div>
                  <H3WindowPromptTextarea
                    value={window.prompt}
                    onChange={value => updateH3WindowPrompt(index, value)}
                    readOnly={!!matchingActiveH3Phase}
                    title={matchingActiveH3Phase
                      ? 'This is the exact prompt already submitted for the active generation.'
                      : 'Edit this exact window prompt before the next generation.'}
                    active={activeH3Window === window.index}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {usesManualWindowPrompts && (
        <div className="mb-1.5 flex items-center justify-between gap-2 text-2xs text-text-muted">
          <span>One non-empty line per {manualPromptUnit}</span>
          <span className={manualPromptLineCount === manualPromptCount ? 'text-text-secondary' : 'text-amber-400'}>
            {manualPromptLineCount}/{manualPromptCount} prompts
          </span>
        </div>
      )}
      <div className="relative mt-auto">
        <textarea
          ref={promptTextareaRef}
          rows={1}
          value={prompt}
          onChange={e => setParam('prompt', e.target.value)}
          placeholder={usesManualWindowPrompts
            ? `Line 1 = ${manualPromptUnit} 1, line 2 = ${manualPromptUnit} 2... (${manualPromptCount} total)`
            : usesH3Plan
            ? `Describe the complete video idea—Maestro will plan ${expectedPlanCount} H3 ${usesH3SequencePlanner ? 'reference clips' : 'windows'}.`
            : usesWindows
              ? (isLtxSequence
                  ? `Describe the complete video idea - Maestro will plan ${windowCount} LTX windows.`
                  : `Line 1 = window 1, line 2 = window 2... (${windowCount} windows)`)
            : modePlaceholder}
          className="block w-full min-h-[112px] resize-none overflow-hidden bg-bg-tertiary border border-border rounded-lg px-3 py-2 pr-10 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue transition-colors"
        />
        <div className="absolute right-2 top-2 flex items-center gap-1 z-10">
          <div ref={historyMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setHistoryOpen(!historyOpen)}
              title="Recent prompts history"
              className={`p-1 rounded-md text-text-muted/60 hover:text-text-primary hover:bg-bg-hover transition-colors ${
                historyOpen ? 'text-accent-blue bg-bg-hover' : ''
              }`}
            >
              <History size={13} />
            </button>
            {historyOpen && (
              <div className="absolute right-0 top-full mt-1 w-72 max-h-64 overflow-y-auto bg-bg-secondary border border-border rounded-lg shadow-xl p-2 z-50 text-xs">
                <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-border/60">
                  <span className="font-medium text-text-secondary text-2xs uppercase tracking-wider">
                    Recent Prompts ({generationMode})
                  </span>
                  {getPromptHistory(generationMode).length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        clearPromptHistory(generationMode)
                        setHistoryOpen(false)
                      }}
                      className="text-2xs text-text-muted hover:text-red-400 flex items-center gap-1 transition-colors"
                    >
                      <Trash2 size={10} /> Clear
                    </button>
                  )}
                </div>
                {getPromptHistory(generationMode).length === 0 ? (
                  <div className="py-4 text-center text-text-muted text-2xs">
                    No saved prompts for {generationMode} mode yet.
                  </div>
                ) : (
                  <div className="space-y-1">
                    {getPromptHistory(generationMode).map((histPrompt, idx) => (
                      <div
                        key={idx}
                        className="group flex items-start justify-between gap-1.5 p-1.5 rounded hover:bg-bg-hover text-left transition-colors cursor-pointer"
                        onClick={() => {
                          setParam('prompt', histPrompt)
                          setHistoryOpen(false)
                        }}
                      >
                        <span className="text-2xs text-text-secondary group-hover:text-text-primary line-clamp-2 leading-relaxed flex-1">
                          {histPrompt}
                        </span>
                        <button
                          type="button"
                          title="Remove from history"
                          onClick={(e) => {
                            e.stopPropagation()
                            removePromptFromHistory(generationMode, idx)
                            setHistoryOpen(true)
                          }}
                          className="opacity-0 group-hover:opacity-100 p-0.5 text-text-muted hover:text-red-400 rounded transition-opacity"
                        >
                          <X size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          {prompt.trim() && (
            <button
              type="button"
              onClick={() => setParam('prompt', '')}
              title="Clear prompt"
              className="p-1 rounded-md text-text-muted/60 hover:text-text-primary hover:bg-bg-hover transition-colors"
            >
              <X size={13} />
            </button>
          )}
        </div>
        {prompt.trim() && !usesManualWindowPrompts && (
        isAudioOnly ? (
          /* TTS: mode-aware split button. Main button uses default mode based
             on voice-slot count; dropdown exposes both Speech and Dialogue
             explicitly so the user can override regardless of voice count.
             Previously the dropdown labels switched with isMultiVoice, leaving
             no way to enhance into dialogue format without first adding voice
             slots — bad UX trap especially with audio_mode_from_voice_count
             models like Scenema where the user may want a generated-voice
             dialogue script as a starting point. */
          <div ref={menuRef} className="absolute right-2 bottom-2">
            <div className="flex items-center">
              <button
                onClick={() => enhancePrompt(defaultMode)}
                disabled={isEnhancing}
                title={isMultiVoice
                  ? `Write ${voiceCount}-person dialogue (use dropdown to switch to speech)`
                  : 'Write a speech (use dropdown to switch to dialogue)'}
                className="p-1.5 rounded-l-md text-text-muted hover:text-accent-blue hover:bg-bg-hover transition-colors disabled:opacity-50"
              >
                {isEnhancing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              </button>
              <button
                onClick={() => setTtsMenuOpen(!ttsMenuOpen)}
                disabled={isEnhancing}
                className="p-1.5 rounded-r-md text-text-muted hover:text-accent-blue hover:bg-bg-hover transition-colors disabled:opacity-50 border-l border-border"
              >
                <ChevronUp size={10} />
              </button>
            </div>
            {ttsMenuOpen && (
              <div className="absolute bottom-full right-0 mb-1 bg-bg-secondary border border-border rounded-lg shadow-lg overflow-hidden min-w-[220px] z-50">
                <button
                  onClick={() => { setTtsMenuOpen(false); enhancePrompt('monologue') }}
                  className="w-full text-left px-3 py-2 text-xs text-text-secondary hover:bg-bg-hover transition-colors"
                >
                  Write Speech
                  <span className="block text-2xs text-text-muted">Single speaker, with thinking</span>
                </button>
                <button
                  onClick={() => { setTtsMenuOpen(false); enhancePrompt('monologue_fast') }}
                  className="w-full text-left px-3 py-2 text-xs text-text-secondary hover:bg-bg-hover transition-colors border-t border-border"
                >
                  Write Speech
                  <span className="block text-2xs text-text-muted">Single speaker, faster</span>
                </button>
                {supportsDialogue && (
                  <>
                    <button
                      onClick={() => { setTtsMenuOpen(false); enhancePrompt('dialogue') }}
                      className="w-full text-left px-3 py-2 text-xs text-text-secondary hover:bg-bg-hover transition-colors border-t border-border"
                    >
                      {voiceCount >= 2 ? `Write ${voiceCount}-Person Dialogue` : 'Write Dialogue (2 speakers)'}
                      <span className="block text-2xs text-text-muted">With thinking — more creative</span>
                    </button>
                    <button
                      onClick={() => { setTtsMenuOpen(false); enhancePrompt('dialogue_fast') }}
                      className="w-full text-left px-3 py-2 text-xs text-text-secondary hover:bg-bg-hover transition-colors border-t border-border"
                    >
                      {voiceCount >= 2 ? `Write ${voiceCount}-Person Dialogue` : 'Write Dialogue (2 speakers)'}
                      <span className="block text-2xs text-text-muted">No thinking — faster</span>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={() => enhancePrompt()}
            disabled={isEnhancing}
            title="Enhance prompt with AI"
            className="absolute right-2 bottom-2 p-1.5 rounded-md text-text-muted hover:text-accent-blue hover:bg-bg-hover transition-colors disabled:opacity-50"
          >
            {isEnhancing ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Sparkles size={14} />
            )}
          </button>
        )
        )}
      </div>
    </div>
  )
}
