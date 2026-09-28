import { useRef, useCallback, useState, useEffect, useMemo } from 'react'
import { Film, Play, Square, FolderOpen, Plus, Check, Loader2, X, BookMarked, Trash2, ChevronDown, ChevronUp } from 'lucide-react'
import { TabFilter } from './TabFilter'
import { MediaGallery } from './MediaGallery'
import { MediaInspector } from './MediaInspector'
import { DirectorReview } from '../DirectorDashboard/DirectorReview'
import { useStore } from '../../stores/useStore'
import { formatEstimatedClock, formatEtaDuration } from '../../lib/format'
import { PROMPT_ENHANCEMENT_ACTIVITY } from '../../lib/promptEnhancementActivity'
import type { GenerationJob } from '../../types'

export function WorkspaceSelector() {
  const workspaces = useStore(s => s.workspaces)
  const activeWorkspace = useStore(s => s.activeWorkspace)

  const switchWorkspace = useStore(s => s.switchWorkspace)
  const deleteWorkspace = useStore(s => s.deleteWorkspace)
  const [open, setOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const handleDelete = async (name: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (confirmDelete !== name) {
      setConfirmDelete(name)
      setTimeout(() => setConfirmDelete(c => (c === name ? null : c)), 4000)
      return
    }
    setConfirmDelete(null)
    setDeleting(name)
    setDeleteError(null)
    try {
      await deleteWorkspace(name)
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err))
      setTimeout(() => setDeleteError(null), 6000)
    } finally {
      setDeleting(null)
    }
  }

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors border border-border"
        title="Switch workspace"
      >
        <FolderOpen size={12} />
        <span className="max-w-[120px] truncate">{activeWorkspace}</span>
      </button>

      {open && (
        <div className="absolute left-0 bottom-full mb-2 w-64 bg-bg-secondary border border-border rounded-lg shadow-lg z-50 overflow-hidden">
          <div className="px-2 py-1.5 border-b border-border">
            <span className="text-2xs text-text-muted uppercase tracking-wider">Projects</span>
          </div>
          <div className="max-h-[200px] overflow-y-auto">
            {/* Filter "default" — it's the backend's implicit root
                outputs/ folder, not a real user project. Showing it would
                let users switch to a non-project bucket and defeat the
                per-project organization. */}
            {workspaces.filter(ws => ws.name !== 'default').map(ws => (
              <div key={ws.name} className="flex items-center group hover:bg-bg-hover transition-colors">
                <button
                  onClick={() => { switchWorkspace(ws.name); setOpen(false) }}
                  className={`flex-1 min-w-0 text-left px-3 py-2 text-xs flex items-center justify-between ${
                    ws.name === activeWorkspace ? 'text-accent-blue' : 'text-text-secondary'
                  }`}
                >
                  <span className="truncate">{ws.name}</span>
                  {ws.name === activeWorkspace && <Check size={12} className="shrink-0" />}
                </button>
                {/* default IS filtered out above, so all listed projects
                    are real user projects and can be deleted here too. */}
                <button
                  onClick={e => handleDelete(ws.name, e)}
                  disabled={deleting === ws.name}
                  className={`px-2 py-2 shrink-0 transition-colors ${
                    confirmDelete === ws.name
                      ? 'text-red-400 bg-red-500/15'
                      : deleting === ws.name
                        ? 'text-text-muted cursor-wait'
                        : 'text-text-muted opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-red-400'
                  }`}
                  title={confirmDelete === ws.name
                    ? `Click again to permanently delete "${ws.name}" and its ${ws.file_count ?? 0} files`
                    : `Delete project (${ws.file_count ?? 0} files)`}
                >
                  {deleting === ws.name ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                </button>
              </div>
            ))}
          </div>
          {deleteError && (
            <div className="px-3 py-1.5 text-2xs text-red-400 border-t border-border leading-snug">{deleteError}</div>
          )}
          {/* Project management happens on the Projects page — that's
              where projects (= workspaces) are created and deleted.
              This dropdown just lets the user jump back there from
              wherever they are, or quickly create a new project. */}
          <div className="border-t border-border p-2 space-y-1">
            <button
              onClick={() => { useStore.getState().setAppSection('projects'); setOpen(false) }}
              className="w-full text-left px-1 py-1 text-xs text-text-secondary hover:text-text-primary flex items-center gap-1"
              title="Open the Projects page to switch projects"
            >
              <FolderOpen size={12} /> All projects
            </button>
            <button
              onClick={() => { useStore.getState().setAppSection('projects'); setOpen(false) }}
              className="w-full text-left px-1 py-1 text-xs text-accent-blue hover:text-accent-blue-hover flex items-center gap-1"
              title="Create a new project (= workspace)"
            >
              <Plus size={12} /> New project
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function stripTimeSuffix(msg: string): string {
  return msg.replace(/\s*\|\s*\d+:\d+.*$/, '').trim()
}

function JobPlaceholder({ job, onStop, onDismiss }: { job: GenerationJob; onStop?: () => void; onDismiss: () => void }) {
  const hasSteps = job.totalSteps > 0
  const progressPct = hasSteps ? (job.step / job.totalSteps) * 100 : job.progress * 100
  const phase = stripTimeSuffix(job.phase || job.message)
  const isFailed = job.status === 'failed' || job.status === 'cancelled'
  const isPromptPlanning = job.kind === 'prompt_enhancement'
  const errorText = job.error || job.message || (job.status === 'cancelled' ? 'Cancelled' : 'Generation failed')
  const h3PlanSignature = job.h3WindowPlan?.signature
  const [h3PromptDisclosure, setH3PromptDisclosure] = useState({
    signature: h3PlanSignature,
    open: false,
  })
  const showH3Prompts = (
    h3PromptDisclosure.signature === h3PlanSignature && h3PromptDisclosure.open
  )
  const h3WindowMatch = (job.phase || job.message || '').match(/Sliding Window\s+(\d+)\/(\d+)/i)
  const activeH3Window = job.currentWindow ?? (h3WindowMatch ? Number(h3WindowMatch[1]) : 1)
  const totalStudioWindows = job.totalWindows ?? (h3WindowMatch ? Number(h3WindowMatch[2]) : 1)
  const isMultiWindow = totalStudioWindows > 1
  const isMultiClip = (job.totalClips ?? 1) > 1
  const windowEta = formatEtaDuration(job.windowEtaSeconds)
  const windowClock = formatEstimatedClock(job.windowCompletionAt)
  const generationEta = formatEtaDuration(job.generationEtaSeconds)
  const generationClock = formatEstimatedClock(job.generationCompletionAt)
  const activeH3PlanWindow = job.h3WindowPlan?.windows.find(
    window => window.index === activeH3Window,
  ) || job.h3WindowPlan?.windows[0]

  return (
    <div className={`rounded-xl border overflow-hidden ${
      isFailed ? 'border-red-500/30 bg-bg-tertiary' : 'border-accent-blue/30 bg-bg-tertiary'
    }`}>
      <div className="w-full aspect-video flex items-center justify-center relative">
        {/* Dismiss button (top-right, failed only) */}
        {isFailed && (
          <button
            onClick={onDismiss}
            className="absolute top-2 right-2 p-1.5 rounded-full bg-bg-active text-text-secondary hover:bg-red-600 hover:text-white transition-colors z-10"
            title="Dismiss"
          >
            <X size={14} />
          </button>
        )}
        <div className="flex flex-col items-center gap-3 text-text-muted w-full max-w-md px-4">
          <Film size={40} className={isFailed ? 'text-red-400' : 'animate-pulse'} />

          <div className="text-center w-full">
            <p className={`text-sm font-medium ${isFailed ? 'text-red-400' : 'text-text-secondary'}`}>
              {isFailed
                ? (job.status === 'cancelled' ? 'Cancelled' : 'Generation Failed')
                : isPromptPlanning
                  ? 'Planning with AI...'
                  : job.status === 'queued'
                    ? 'Queued...'
                    : 'Generating...'}
            </p>
            {!isFailed && phase && (
              <p className="text-xs mt-1 truncate">{phase}</p>
            )}
            {hasSteps && !isFailed && (
              <p className="text-2xs text-text-muted mt-0.5">
                Step {job.step}/{job.totalSteps}
              </p>
            )}
            {!isFailed && job.status === 'running' && (
              <div className="mt-1 space-y-0.5 text-2xs text-text-muted">
                {isMultiClip && (
                  <p>
                    Clip {job.currentClip ?? 1}/{job.totalClips}
                    {isMultiWindow ? ` · Window ${activeH3Window}/${totalStudioWindows}` : ''}
                  </p>
                )}
                {isMultiWindow && windowEta && (
                  <p>
                    Window {activeH3Window}/{totalStudioWindows} · {windowEta} remaining
                    {windowClock ? ` · around ${windowClock}` : ''}
                  </p>
                )}
                {generationEta ? (
                  <p>
                    {isMultiWindow || isMultiClip ? 'Full Studio render' : 'Estimated'} {generationEta}
                    {generationClock ? ` · around ${generationClock}` : ''}
                  </p>
                ) : job.etaConfidence === 'calibrating' ? (
                  <p>Calibrating ETA…</p>
                ) : null}
                {(job.etaHistorySamples ?? 0) > 0 && (
                  <p>
                    Learned from {job.etaHistorySamples} {job.etaHistoryMatch === 'exact' ? 'matching' : 'related'} local render{job.etaHistorySamples === 1 ? '' : 's'}
                  </p>
                )}
              </div>
            )}
            {isFailed && (
              <p className="text-xs text-text-secondary mt-2 max-h-24 overflow-y-auto px-2 leading-relaxed whitespace-pre-wrap break-words">
                {errorText}
              </p>
            )}
          </div>

          {/* Progress bar — hidden when failed */}
          {!isFailed && (
            <div className="w-full bg-bg-active rounded-full h-1.5 overflow-hidden">
              {progressPct > 0 ? (
                <div
                  className="h-full bg-accent-green rounded-full transition-all duration-300"
                  style={{ width: `${progressPct}%` }}
                />
              ) : (
                <div className="h-full bg-accent-green/60 rounded-full animate-pulse w-full" />
              )}
            </div>
          )}
        </div>
      </div>

      {job.h3WindowPlan && activeH3PlanWindow && (
        <div className="border-t border-border bg-bg-secondary/60 px-3 py-2">
          <div className="flex items-center justify-between gap-2 text-2xs text-text-muted">
            <span className="font-medium text-text-secondary">
              Exact H3 prompt · Window {activeH3PlanWindow.index}/{job.h3WindowPlan.window_count}
            </span>
            <button
              type="button"
              onClick={() => setH3PromptDisclosure(current => ({
                signature: h3PlanSignature,
                open: current.signature === h3PlanSignature ? !current.open : true,
              }))}
              className="flex items-center gap-1 text-accent-blue hover:text-accent-blue/80"
            >
              {showH3Prompts ? 'Hide all' : 'View all'}
              {showH3Prompts ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            </button>
          </div>
          <p className="mt-1 text-2xs leading-relaxed text-text-muted line-clamp-3 whitespace-pre-wrap break-words">
            {activeH3PlanWindow.prompt}
          </p>
          {showH3Prompts && (
            <div className="mt-2 max-h-80 overflow-y-auto space-y-2 border-t border-border pt-2">
              {job.h3WindowPlan.windows.map(window => (
                <div
                  key={`${window.index}-${window.start_frame}`}
                  className={`rounded-md border p-2 ${
                    window.index === activeH3Window
                      ? 'border-accent-blue/70 bg-accent-blue/5'
                      : 'border-border bg-bg-tertiary/60'
                  }`}
                >
                  <div className="mb-1 flex items-center justify-between text-2xs text-text-muted">
                    <span>
                      Window {window.index}: {window.title || `Beat ${window.index}`}
                      {window.index === activeH3Window ? ' · Generating now' : ''}
                    </span>
                    <span>{window.start_seconds.toFixed(1)}–{window.end_seconds.toFixed(1)}s</span>
                  </div>
                  <pre className="whitespace-pre-wrap break-words font-sans text-2xs leading-relaxed text-text-secondary">
                    {window.prompt}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Bottom bar */}
      <div className="px-3 py-2 min-h-[40px] flex items-center justify-between">
        <div className="text-xs text-text-muted truncate flex-1">
          {isFailed ? 'Click × to dismiss — the tile stays so you can see what failed' : phase || 'Preparing...'}
        </div>
        {!isFailed && onStop && (
          <button
            onClick={onStop}
            className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 transition-colors shrink-0 ml-2"
          >
            <Square size={11} />
            Stop
          </button>
        )}
      </div>
    </div>
  )
}

export function PipelinePlaceholder() {
  const pipelineStatus = useStore(s => s.pipelineStatus)
  const pipelineId = useStore(s => s.pipelineId)
  const stopPipeline = useStore(s => s.stopPipeline)
  const resumePipeline = useStore(s => s.resumePipeline)
  const reattachDirectorPipeline = useStore(s => s.reattachDirectorPipeline)
  const [resuming, setResuming] = useState(false)

  if (!pipelineId || !pipelineStatus) return null
  if (pipelineStatus.status === 'completed') return null
  if (pipelineStatus.status === 'paused') return <DirectorReview />

  const phase = pipelineStatus.phase || 'planning'
  const progress = pipelineStatus.progress
  const message = progress?.message || phase
  const isFailed = pipelineStatus.status === 'failed' || pipelineStatus.status === 'cancelled'
  const errorText = pipelineStatus.error || message || 'Director pipeline stopped'

  const hasSteps = (progress?.total_steps ?? 0) > 0
  const progressPct = hasSteps
    ? ((progress?.step ?? 0) / progress!.total_steps) * 100
    : progress && progress.total > 0
      ? (progress.current / progress.total) * 100
      : 0
  const phaseLabel = stripTimeSuffix(message)
  const currentClip = progress?.current_clip
  const totalClips = progress?.total_clips
  const clipEta = formatEtaDuration(progress?.clip_eta_seconds)
  const clipClock = formatEstimatedClock(progress?.clip_completion_at)
  const projectEta = formatEtaDuration(progress?.project_eta_seconds)
  const projectClock = formatEstimatedClock(progress?.project_completion_at)

  return (
    <div className={`rounded-xl overflow-hidden border ${isFailed ? 'border-red-500/30' : 'border-accent-blue/30'} bg-bg-tertiary`}>
      <div className="w-full aspect-video flex items-center justify-center relative">
        {isFailed && (
          <button
            type="button"
            onClick={() => useStore.setState({ pipelineId: null, pipelineStatus: null, directorError: null })}
            className="absolute top-2 right-2 p-1.5 rounded-full bg-bg-active text-text-secondary hover:bg-red-600 hover:text-white transition-colors z-10"
            title="Dismiss"
          >
            <X size={14} />
          </button>
        )}
        <div className="flex flex-col items-center gap-3 text-text-muted w-full max-w-xs px-4">
          <Film size={40} className={isFailed ? 'text-red-400' : 'animate-pulse'} />

          <div className="text-center w-full">
            <p className={`text-sm font-medium ${isFailed ? 'text-red-400' : 'text-text-secondary'}`}>
              {isFailed
                ? (pipelineStatus.status === 'cancelled' ? 'Director Cancelled' : 'Director Failed')
                : 'Director'}
            </p>
            {!isFailed && <p className="text-xs mt-1 truncate">{phaseLabel}</p>}
            {hasSteps && !isFailed && (
              <p className="text-2xs text-text-muted mt-0.5">
                Step {progress!.step}/{progress!.total_steps}
              </p>
            )}
            {!isFailed && currentClip ? (
              <div className="mt-1 space-y-0.5 text-2xs text-text-muted">
                <p>
                  Clip {currentClip}/{totalClips || '?'}
                  {clipEta
                    ? ` · ${clipEta} remaining${clipClock ? ` · around ${clipClock}` : ''}`
                    : ' · Calibrating ETA…'}
                </p>
                {projectEta && (
                  <p>
                    Full Director render {projectEta}
                    {projectClock ? ` · around ${projectClock}` : ''}
                  </p>
                )}
                {(progress?.eta_history_samples ?? 0) > 0 && (
                  <p>
                    Learned from {progress!.eta_history_samples} {progress!.eta_history_match === 'exact' ? 'matching' : 'related'} local render{progress!.eta_history_samples === 1 ? '' : 's'}
                  </p>
                )}
              </div>
            ) : null}
            {isFailed && (
              <>
                {progress && progress.total > 0 && (
                  <p className="mt-1 text-2xs text-text-muted">
                    Saved progress: {progress.current}/{progress.total}
                  </p>
                )}
                <p className="text-xs text-text-secondary mt-2 max-h-24 overflow-y-auto px-2 leading-relaxed whitespace-pre-wrap break-words">
                  {errorText}
                </p>
              </>
            )}
          </div>

          {/* Progress bar */}
          {!isFailed && (
            <div className="w-full bg-bg-active rounded-full h-1.5 overflow-hidden">
              {progressPct > 0 ? (
                <div
                  className="h-full bg-accent-green rounded-full transition-all duration-300"
                  style={{ width: `${progressPct}%` }}
                />
              ) : (
                <div className="h-full bg-accent-green/60 rounded-full animate-pulse w-full" />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Bottom bar with stop button */}
      <div className="px-3 py-2 min-h-[40px] flex items-center justify-between">
        <div className="text-xs text-text-muted truncate flex-1">
          {isFailed ? 'The saved Director checkpoint can be resumed' : phaseLabel || 'Preparing...'}
        </div>
        {isFailed ? (
          <div className="flex items-center gap-2 shrink-0 ml-2">
            <button
              type="button"
              onClick={() => void reattachDirectorPipeline(pipelineId, true)}
              className="text-xs text-text-secondary hover:text-text-primary transition-colors"
            >
              Open Director
            </button>
            <button
              type="button"
              disabled={resuming}
              onClick={async () => {
                setResuming(true)
                try {
                  await resumePipeline(pipelineId)
                } finally {
                  setResuming(false)
                }
              }}
              className="flex items-center gap-1 rounded-md bg-accent-blue px-2 py-1 text-xs text-white hover:bg-accent-blue-hover disabled:opacity-50"
            >
              {resuming ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
              Resume
            </button>
          </div>
        ) : (
          <button
            onClick={() => stopPipeline()}
            className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 transition-colors shrink-0 ml-2"
          >
            <Square size={11} />
            Stop
          </button>
        )}
      </div>
    </div>
  )
}
export function MainContent() {
  const standalone = useStore(s => s.appSection === 'medias')
  const outputs = useStore(s => s.filteredOutputs())
  const outputsLoading = useStore(s => s.outputsLoading)
  const jobs = useStore(s => s.jobs)
  const isEnhancing = useStore(s => s.isEnhancing)
  const generationMode = useStore(s => s.generationMode)
  const stopGeneration = useStore(s => s.stopGeneration)
  const dismissJob = useStore(s => s.dismissJob)
  const activeIndex = useStore(s => s.selectedOutput)
  const setSelectedOutput = useStore(s => s.setSelectedOutput)
  const outputsTotal = useStore(s => s.outputsTotal)
  const loadMoreOutputs = useStore(s => s.loadMoreOutputs)
  const selectedNames = useStore(s => s.mediaGallerySelectedNames)
  const selectAllMediaGallery = useStore(s => s.selectAllMediaGallery)
  const clearMediaGallerySelection = useStore(s => s.clearMediaGallerySelection)
  const toggleMediaGallerySelection = useStore(s => s.toggleMediaGallerySelection)
  const toggleMediaGallerySelectionRange = useStore(s => s.toggleMediaGallerySelectionRange)
  const bulkDeleteSelected = useStore(s => s.bulkDeleteSelectedOutputs)

  // Waiting work now lives in the universal top-bar queue. Keep the gallery
  // focused on media plus useful live/error cards instead of large blank
  // placeholders for every job that has not started yet.
  const galleryJobs = useMemo(
    () => {
      const visibleJobs = jobs.filter(job => (
        job.status !== 'held'
        && (job.status !== 'queued' || job.showInGallery === true)
      ))
      return isEnhancing ? [PROMPT_ENHANCEMENT_ACTIVITY, ...visibleJobs] : visibleJobs
    },
    [isEnhancing, jobs],
  )

  // ── Gallery ↔ inspector wiring ─────────────────────────────────
  // The gallery owns click-to-inspect (set selectedOutput). The
  // selection set is independent so the user can tick a batch without
  // losing the currently-inspected asset.
  const handleInspect = useCallback((index: number) => {
    if (useStore.getState().selectedOutput !== index) {
      setSelectedOutput(index)
    }
  }, [setSelectedOutput])

  const handleToggleSelected = useCallback((name: string) => {
    toggleMediaGallerySelection(name)
  }, [toggleMediaGallerySelection])

  const handleToggleRange = useCallback((fromIndex: number, toIndex: number) => {
    const list = useStore.getState().filteredOutputs()
    const fromName = list[fromIndex]?.name
    const toName = list[toIndex]?.name
    if (!fromName || !toName) return
    toggleMediaGallerySelectionRange(fromName, toName)
  }, [toggleMediaGallerySelectionRange])

  const handleSelectAll = useCallback(() => {
    selectAllMediaGallery(outputs.map(o => o.name))
  }, [selectAllMediaGallery, outputs])

  const handleClearSelection = useCallback(() => {
    clearMediaGallerySelection()
  }, [clearMediaGallerySelection])

  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkConfirm, setBulkConfirm] = useState(false)
  const bulkConfirmTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => {
    if (bulkConfirmTimeout.current) clearTimeout(bulkConfirmTimeout.current)
  }, [])

  const handleBulkDelete = useCallback(async () => {
    if (selectedNames.size === 0) return
    if (!bulkConfirm) {
      setBulkConfirm(true)
      clearTimeout(bulkConfirmTimeout.current)
      bulkConfirmTimeout.current = setTimeout(() => setBulkConfirm(false), 3000)
      return
    }
    clearTimeout(bulkConfirmTimeout.current)
    setBulkConfirm(false)
    setBulkBusy(true)
    try {
      await bulkDeleteSelected()
    } finally {
      setBulkBusy(false)
    }
  }, [selectedNames.size, bulkConfirm, bulkDeleteSelected])

  // Whenever the filter or outputs list mutates, drop selections that
  // no longer point at a visible item. Avoids "ghost" names haunting the
  // bulk-action toolbar after a search/filter change.
  useEffect(() => {
    const visibleNames = new Set(outputs.map(o => o.name))
    let changed = false
    const next = new Set<string>()
    selectedNames.forEach(name => {
      if (visibleNames.has(name)) next.add(name)
      else changed = true
    })
    if (changed) useStore.setState({ mediaGallerySelectedNames: next })
  }, [outputs, selectedNames])

  const hasMore = outputs.length < outputsTotal

  return (
    <main className="min-w-0 flex-1 flex flex-col h-full overflow-hidden">
      {/* Top bar */}
      <div className="flex min-h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        <TabFilter />
      </div>

      {/* Sub-toolbar: bulk selection actions */}
      {outputs.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-bg-secondary/60 px-4 py-2 text-xs">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSelectAll}
              className="rounded-md border border-border bg-bg-tertiary px-2 py-1 text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
              aria-label="Select all visible items"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={handleClearSelection}
              disabled={selectedNames.size === 0}
              className="rounded-md border border-border bg-bg-tertiary px-2 py-1 text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Clear selection"
            >
              Clear
            </button>
            <span className="text-2xs text-text-muted">
              {selectedNames.size === 0
                ? `${outputs.length} loaded`
                : `${selectedNames.size} selected of ${outputs.length}`}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={handleBulkDelete}
              disabled={selectedNames.size === 0 || bulkBusy}
              className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 transition-colors disabled:cursor-not-allowed ${
                bulkConfirm
                  ? 'border-red-500/60 bg-red-500/20 text-red-400 hover:bg-red-500/30'
                  : selectedNames.size > 0
                    ? 'border-red-500/40 bg-red-500/10 text-red-400 hover:bg-red-500/20'
                    : 'border-border bg-bg-tertiary text-text-muted'
              } ${bulkBusy ? 'opacity-60' : ''}`}
              title={
                bulkConfirm
                  ? `Click again to permanently delete ${selectedNames.size} item${selectedNames.size === 1 ? '' : 's'}`
                  : `Delete ${selectedNames.size} selected item${selectedNames.size === 1 ? '' : 's'}`
              }
              aria-label={
                bulkConfirm
                  ? `Confirm delete ${selectedNames.size} items`
                  : `Delete ${selectedNames.size} selected items`
              }
            >
              {bulkBusy
                ? <Loader2 size={12} className="animate-spin" />
                : <Trash2 size={12} />}
              {bulkConfirm
                ? `Confirm delete (${selectedNames.size})`
                : `Delete selected (${selectedNames.size})`}
            </button>
          </div>
        </div>
      )}

      {/* Content area: gallery (left, 2/3) + inspector (right, 1/3) */}
      <div className="flex-1 flex flex-row gap-0 overflow-hidden relative media-gallery-layout">
        {/* Scrollable media gallery */}
        <div className="media-gallery-column min-w-0 flex-1 overflow-hidden">
          {/* Pipeline + Job placeholders at top */}
          <div className="space-y-3 p-3 md:p-4 pb-0">
            <PipelinePlaceholder />
            {galleryJobs.map((j, i) => (
              <JobPlaceholder
                key={j.id || `pending-${i}`}
                job={j}
                onStop={j.kind === 'prompt_enhancement' ? undefined : () => stopGeneration(j.id)}
                onDismiss={() => dismissJob(j.id)}
              />
            ))}
          </div>

          {/* Loading state */}
          {outputsLoading && outputs.length === 0 && (
            <div className="flex items-center justify-center min-h-[300px] px-3 md:px-4">
              <div className="flex flex-col items-center gap-3 text-text-muted">
                <Loader2 size={24} className="animate-spin text-accent-blue" />
                <p className="text-sm">Indexing workspace...</p>
              </div>
            </div>
          )}

          {/* Empty state — first-run quick start. Teaches the three steps
              to a first generation and sets the one expectation that most
              surprises new users: the first run of each model downloads
              its weights (tens of GB) before anything appears. */}
          {!outputsLoading && outputs.length === 0 && jobs.length === 0 && (() => {
            const noun = generationMode === 'image' ? 'images'
              : generationMode === 'audio' ? 'audio' : 'videos'
            const example = generationMode === 'image'
              ? 'a neon city street at night, cinematic'
              : generationMode === 'audio'
              ? 'a dreamy synthwave track about the ocean'
              : 'a golden retriever surfing a big wave, slow motion'
            return (
              <div className="flex items-center justify-center min-h-[300px] px-6">
                <div className="flex flex-col items-center gap-4 text-center max-w-sm">
                  <div className="w-16 h-16 rounded-2xl bg-bg-active flex items-center justify-center text-text-muted">
                    <Play size={24} />
                  </div>
                  <p className="text-sm text-text-secondary">Your generated {noun} will appear here.</p>
                  <ol className="text-xs text-text-muted space-y-1.5 text-left">
                    <li><span className="text-accent-blue font-medium">1.</span> {standalone ? 'Open Director → Studio and choose a model.' : 'Choose a model in the controls on the left.'}</li>
                    <li><span className="text-accent-blue font-medium">2.</span> Type a prompt — e.g. <span className="text-text-secondary italic">“{example}”</span></li>
                    <li><span className="text-accent-blue font-medium">3.</span> Hit Generate.</li>
                  </ol>
                  <p className="text-xs text-text-muted leading-snug">
                    Heads up: the first time you use a model, its weights download
                    once (often tens of GB) before generation starts — later runs
                    are fast. Progress shows at the bottom-right.
                  </p>
                  {standalone && <button onClick={() => useStore.getState().closeDirectorStage()} className="shell-primary-button">Open Studio</button>}
                  <button
                    onClick={() => useStore.getState().setRecipesOpen(true)}
                    className="mt-1 flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent-blue/10 border border-accent-blue/30 rounded-lg text-accent-blue hover:bg-accent-blue/20 transition-colors"
                  >
                    <BookMarked size={13} /> Browse recipes
                  </button>
                </div>
              </div>
            )
          })()}

          {outputs.length > 0 && (
            <MediaGallery
              selectedIndex={activeIndex}
              selectedNames={selectedNames}
              onInspect={handleInspect}
              onToggleSelected={handleToggleSelected}
              onToggleRange={handleToggleRange}
              onLoadMore={() => { void loadMoreOutputs() }}
              hasMore={hasMore}
            />
          )}
        </div>

        {/* Inspector / large-preview panel */}
        <div className="media-inspector-column shrink-0 overflow-hidden border-l border-border">
          <MediaInspector />
        </div>
      </div>
    </main>
  )
}
