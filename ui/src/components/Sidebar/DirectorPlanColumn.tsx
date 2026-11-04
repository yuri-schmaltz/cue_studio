// filepath: ui/src/components/Sidebar/DirectorPlanColumn.tsx
//
// DirectorPlanColumn — middle column of the Director 3-col layout.
//
// Renders the "what the AI is planning for me" surfaces that used to
// live inline in DirectorBriefingColumn (formerly DirectorChat):
//   1. Structure (clip structure with pacing slider) for music-video path
//   2. Style / scene description view (after the user submits the brief)
//   3. Image prompts review (one card per shot, editable textareas)
//   4. Image generation progress + the generated clip images grid
//   5. Video prompts review (one card per shot, editable textareas)
//
// The briefing column on the left keeps the input surface (welcome, skill
// picker, upload, analyze, completion badges, composer). The
// technical setup on the right keeps aspect ratio / resolution / models
// / LoRAs. The plan column is where the user actually *works* on the
// shots — the things that determine what the renderer will draw.
//
// Step gating mirrors what DirectorBriefingColumn used to do:
//   - structure shows while step ∈ {structure, style, plan, review, ...}
//   - style shows once the user has entered the style step
//   - image prompts / image gen show for shot-image workflows
//   - video prompts show once plan_video or review_video is reached
//
// All state lives in the store (useStore); this component is purely a
// re-mount of the same sub-components DirectorChat already exported.

import { useStore } from '../../stores/useStore'
import { useMemo, useState, useEffect } from 'react'
import { Sparkles, RotateCcw, ImageIcon } from 'lucide-react'
import {
  ImagePromptsReview,
  ImageGenView,
  LlmLogStage,
  DirectorActionControls,
} from './DirectorBriefingColumn'
import { DirectorActivityBlock } from './DirectorActivityBar'
import { DirectorPreflightCard } from '../Director/DirectorPreflightCard'
import { clipCountLabel } from '../../director/clipNoun'

const STEP_ORDER = ['upload', 'analyze', 'structure', 'style', 'plan', 'review', 'generate_images', 'plan_video', 'review_video'] as const
type DirectorStep = typeof STEP_ORDER[number]

/**
 * Middle column of the Director planning layout. Renders only the stages
 * that are relevant given the current `directorStep` — the chat on the
 * left keeps the conversational layer, the setup on the right keeps the
 * technical choices, and this column owns the per-shot artifacts.
 */
export function DirectorPlanColumn() {
  const step = useStore(s => s.directorStep)
  const loading = useStore(s => s.directorLoading)
  const skill = useStore(s => s.directorSkill)
  const shortFilmPath = useStore(s => s.shortFilmPath)
  const isShortFilm = skill === 'short_film'
  const isStoryPath = isShortFilm && shortFilmPath === 'story'

  // Step navigation helpers — same logic DirectorChat used inline.
  const currentIndex = STEP_ORDER.indexOf(step as DirectorStep)
  const pastStep = (s: DirectorStep) => currentIndex > STEP_ORDER.indexOf(s)
  const atStep = (s: DirectorStep) => step === s

  // planning surfaces
  const plannedClips = useStore(s => s.directorPlannedClips)

  // analysis snapshot still consumed by the speaker-sample aggregation
  // further down (lyrics → speakers). Hoisted up here so the memo can
  // read it without violating the temporal dead zone.
  const analysis = useStore(s => s.directorAnalysis)

  // style / scene description
  // The directorSceneDescription state is still tracked (the
  // composer textarea on the left binds to it), but we no longer
  // re-render it as a read-only confirmation in this column. The
  // left composer is the single source of truth for the brief, and
  // the Scene description card moved into DirectorChat's chat column
  // (rendered below the CLIP STRUCTURE). The selectors below stay
  // subscribed so this column still re-renders when the user mutates
  // them elsewhere, but the values are no longer consumed here.
  void useStore(s => s.directorSceneDescription)
  void useStore(s => s.directorSpeakers)
  // speakerMappings is still consumed downstream (ImagePromptsReview
  // and VideoPromptsReview both read it for the @SPEAKER_xx chip
  // rendering), so we keep a real subscription here.
  const speakerMappings = useStore(s => s.directorSpeakerMappings)
  void useStore(s => s.directorSetSpeakerMapping)
  void useStore(s => s.directorInsertSpeakerMention)
  void useStore(s => s.directorReferenceImage)
  void useStore(s => s.shortFilmCharacters)
  void useStore(s => s.shortFilmTargetDuration)

  // pipeline / model selection affects whether shot images are generated
  const selectedDirectorShotImageSupport = useStore(s => s.models.find(
    model => model.model_type === (s.selectedModelPerMode.video || 'ltx2_22B_distilled_1_1'),
  )?.director?.shot_image_support)
  const directorShotImageGuidance = useStore(s => s.directorShotImageGuidance)
  const directorHasVisualReferences = useStore(s => Boolean(
    s.directorReferenceImage
    || s.directorReferenceImagePath
    || s.directorCharacterRefs.length
    || s.directorCharacterRefPaths.length
    || s.directorLocationRefs.length
    || s.directorLocationRefPaths.length,
  ))
  const usesShotImages = useMemo(() => {
    const support = selectedDirectorShotImageSupport
    if (support === 'required') return true
    if (directorHasVisualReferences) return true
    // 'direct_references' means the model wants raw reference images
    // without going through the shot-image pipeline.
    if (support === 'direct_references') return false
    return directorShotImageGuidance !== 'prompt_only'
  }, [selectedDirectorShotImageSupport, directorHasVisualReferences, directorShotImageGuidance])

  // planning prompts / image gen
  const clipPlans = useStore(s => s.directorClipPlans)
  const clipImages = useStore(s => s.directorClipImages)
  const imageGenProgress = useStore(s => s.directorImageGenProgress)
  const editClipPlan = useStore(s => s.directorEditClipPlan)
  const planPrompts = useStore(s => s.directorPlanPrompts)
  const planVideoPrompts = useStore(s => s.directorPlanVideoPrompts)
  const generateStartImages = useStore(s => s.directorGenerateStartImages)
  const applyToClips = useStore(s => s.directorApplyToClips)
  const directorGenerate = useStore(s => s.directorGenerate)
  const shortFilmPlanPrompts = useStore(s => s.shortFilmPlanPrompts)
  const shortFilmPlanVideoPrompts = useStore(s => s.shortFilmPlanVideoPrompts)
  const shortFilmPlanFromStory = useStore(s => s.shortFilmPlanFromStory)
  const isGenerating = useStore(s => s.isGenerating)
  const pipelineStatus = useStore(s => s.pipelineStatus)
  const pipelineActive = Boolean(
    pipelineStatus && !['completed', 'failed', 'cancelled'].includes(pipelineStatus.status),
  )
  const directorQueue = useStore(s => s.directorQueue)
  const directorQueueLoading = useStore(s => s.directorQueueLoading)
  const directorQueueEditingEntryId = useStore(s => s.directorQueueEditingEntryId)
  const queueCurrentDirectorPipeline = useStore(s => s.queueCurrentDirectorPipeline)
  const pipelineId = useStore(s => s.pipelineId)
  const rejoinPipelineClips = useStore(s => s.rejoinPipelineClips)

  const [queueConfirmation, setQueueConfirmation] = useState<string | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [exportMessage, setExportMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!queueConfirmation) return
    const timer = window.setTimeout(() => setQueueConfirmation(null), 5000)
    return () => window.clearTimeout(timer)
  }, [queueConfirmation])

  // Pre-flight: price the plan on the server whenever the shots, the
  // model or the render settings change. The signature keeps the
  // request to one per meaningful edit instead of one per keystroke.
  const refreshPreflight = useStore(s => s.refreshDirectorPreflight)
  const directorVideoModel = useStore(s => s.selectedModelPerMode.video || 'ltx2_22B_distilled_1_1')
  const directorResolutionPreset = useStore(s => s.directorResolution)
  const directorAspect = useStore(s => s.directorAspectRatio)
  const directorVideoSteps = useStore(s => s.directorVideoInferenceStepsByModel[directorVideoModel])
  const preflightSignature = useMemo(
    () => [
      plannedClips.map(clip => `${clip.start}-${clip.end}`).join(','),
      directorVideoModel,
      directorResolutionPreset,
      directorAspect,
      directorVideoSteps ?? '',
    ].join('#'),
    [plannedClips, directorVideoModel, directorResolutionPreset, directorAspect, directorVideoSteps],
  )

  useEffect(() => {
    if (!atStep('review_video') && !pastStep('review_video')) return
    if (plannedClips.length === 0) return
    const timer = window.setTimeout(() => { void refreshPreflight() }, 400)
    return () => window.clearTimeout(timer)
  }, [preflightSignature, plannedClips.length, refreshPreflight])

  const handleAddToQueue = async () => {
    setQueueConfirmation(null)
    const beforeIds = new Set(
      (useStore.getState().directorQueue?.entries || []).map(entry => entry.id),
    )
    await queueCurrentDirectorPipeline()
    const state = useStore.getState()
    const queue = state.directorQueue
    const added = queue?.entries.find(entry => !beforeIds.has(entry.id))
    if (!queue || !added || state.directorError) return
    const heldCount = queue.entries.filter(
      entry => ['held', 'queued', 'running'].includes(entry.status),
    ).length
    setQueueConfirmation(
      `Added to Queue · ${heldCount} Director ${heldCount === 1 ? 'project' : 'projects'} waiting. Open the queue in the top bar when ready.`,
    )
  }

  const handleExportFullVideo = async () => {
    if (!pipelineId) return
    setIsExporting(true)
    setExportMessage(null)
    try {
      const res = await rejoinPipelineClips(pipelineId) as { filename?: string }
      setExportMessage(`Video exported successfully: ${res?.filename || 'done'}`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to export video'
      setExportMessage(`Error: ${msg}`)
    } finally {
      setIsExporting(false)
    }
  }

  // The undo/redo history (planHistory ref + historyCursor/length state
  // + undoPlanEdit/redoPlanEdit handlers + the "Prompt edits" Undo/Redo
  // row below the planning cards) used to live here. The row has been
  // removed — the Image Prompts / Video Prompts cards now own their own
  // textareas and rely on the underlying editClipPlan store action for
  // persistence, which means there is no UI affordance for the history
  // any more. editPlanWithHistory is now a thin wrapper kept around so
  // the existing call sites in ImagePromptsReview / VideoPromptsReview
  // don't need to be touched; it preserves the no-op guard against
  // setting the same value twice.
  const editPlanWithHistory = (index: number, field: 'video_prompt' | 'image_prompt', value: string) => {
    const current = useStore.getState().directorClipPlans[index]?.[field] || ''
    if (current === value) return
    editClipPlan(index, field, value)
  }

  // speakerSamples used to feed the StyleForm that lived in this
  // column; the form moved to DirectorChat's chat column, so the
  // memo is now consumed there. Keeping the analysis subscription
  // here (void) so the column still re-renders when the lyrics
  // change, but the value computation is owned by the chat column.
  void useMemo<Record<string, string[]>>(() => {
    const out: Record<string, string[]> = {}
    const lyrics = analysis?.lyrics
    if (!Array.isArray(lyrics)) return out
    for (const seg of lyrics) {
      if (seg.speaker && seg.text) {
        if (!out[seg.speaker]) out[seg.speaker] = []
        if (out[seg.speaker].length < 2) out[seg.speaker].push(seg.text)
      }
    }
    return out
  }, [analysis])

  // Has planning started or completed?
  const hasPlan = clipPlans.length > 0 || pastStep('plan') || atStep('review') || pastStep('review')
  const isPlanningActive = loading && atStep('plan')
  const cardTitle = isShortFilm ? 'Scenes' : 'Clips'

  return (
    /* Wrapper padding: p-4 (16px) matches the inner padding of the
       sections below so the first/last cards sit at the same inset
       as the cards stacked underneath them. The outer
       .director-stage-plan card adds another 20px on top, so the
       visible inset is 36px from the column's rounded border —
       generous enough to let the cards breathe without wasting
       vertical real estate. */
    <div className="h-full flex flex-col min-h-0" data-testid="director-plan-column">
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col space-y-3 pr-1 -mr-1">
      {/* 0) Clip Structure card was removed from here because it already lives in the left column */}

      {/* 1) When planning with LLM is actively running:
          Directly show the Planning with LLM activity block as the single container,
          without enclosing it in another container. */}
      {isPlanningActive && (
        <DirectorActivityBlock />
      )}

      {/* 2) When not actively planning:
          - Shows empty state before planning starts (taking full vertical height cleanly)
          - Shows prompt review cards once planning completes, filling vertical space */}
      {!isPlanningActive && (
        <section className={`flex flex-col min-h-0 ${hasPlan ? 'flex-1' : 'flex-1'}`} data-testid="director-prompts-card">
          {hasPlan && (
            <div className="flex items-center justify-between pb-2 shrink-0 gap-2">
              <h3 className="text-xs text-text-muted uppercase tracking-wider font-semibold">
                {cardTitle}
              </h3>
              {/* The Regenerate action sits immediately to the left of the
                  scene counter — it re-runs the LLM pass that produced
                  those scenes, so it belongs next to the count of them. */}
              <div className="flex items-center gap-2 shrink-0">
                {(atStep('review') || atStep('plan')) && (
                  <button
                    onClick={isStoryPath ? shortFilmPlanFromStory : isShortFilm ? shortFilmPlanPrompts : planPrompts}
                    disabled={loading}
                    className="text-2xs text-accent-blue hover:text-accent-blue-hover flex items-center gap-1"
                  >
                    <RotateCcw size={10} /> Regenerate
                  </button>
                )}
                {clipPlans.length > 0 && (
                  <span className="text-2xs text-text-muted px-2 py-0.5 rounded bg-bg-tertiary border border-border">
                    {clipCountLabel(clipPlans.length, isShortFilm)}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* State B: Prompt review cards once plan is ready */}
          {hasPlan && usesShotImages && (
            <div className="flex-1 flex flex-col min-h-0 space-y-3">
              <ImagePromptsReview
                clipPlans={clipPlans}
                plannedClips={plannedClips}
                speakerMappings={speakerMappings}
                editClipPlan={editPlanWithHistory}
                isActive={atStep('review') || atStep('plan')}
                isShortFilm={isShortFilm}
              />
              <div className="shrink-0">
                <LlmLogStage
                  stage="plan"
                  label={cardTitle}
                />
              </div>
            </div>
          )}

          {/* State C: Empty State when no planning has occurred yet — fills vertical height */}
          {!hasPlan && (
            <div className="flex-1 flex flex-col items-center justify-center py-10 px-4 text-center space-y-3 bg-bg-tertiary/40 rounded-lg border border-dashed border-border/80">
              <div className="h-10 w-10 rounded-full bg-accent-blue/10 flex items-center justify-center text-accent-blue">
                <Sparkles size={20} />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-semibold text-text-primary">No prompts generated yet</p>
                <p className="text-2xs text-text-muted max-w-sm leading-relaxed">
                  Set the music, the visual references and the scene description in the column next to this one. The shot scripts and the detailed prompts for every cut are organised here.
                </p>
              </div>
            </div>
          )}
        </section>
      )}

      {/* 5) Image generation progress view when active without scenes */}
      {usesShotImages && (atStep('generate_images') || pastStep('generate_images')) && !hasPlan && (
        <section className="space-y-3 flex-1 flex flex-col">
          <ImageGenView
            loading={loading}
            imageGenProgress={imageGenProgress}
            clipImages={clipImages}
            planVideoPrompts={isShortFilm ? shortFilmPlanVideoPrompts : planVideoPrompts}
          />
        </section>
      )}

      {/* 6) Plan video log — second LLM pass that writes video_prompt
          per clip. Shown only while planning video prompts (or if actively loading). */}
      {((pastStep('plan_video') && !atStep('review_video')) || atStep('plan_video') || (atStep('review_video') && loading)) && (
        <section className="space-y-3">
          <h3 className="text-xs text-text-muted uppercase tracking-wider">Video prompts</h3>
          <DirectorActivityBlock />
          {!loading && <LlmLogStage stage="plan_video" label="Video prompts" />}
        </section>
      )}

      {/* 7) Action Controls bar when video prompts / generation is ready.
          The redundant "Video Prompts" card list in the middle column has been
          removed as requested since video prompts and details are now inspected and edited
          in the right column upon selecting any scene card. */}
      {(atStep('review_video') || pastStep('review_video')) && (
        <>
          {/* The pre-flight sits immediately above the action controls:
              it is the last thing the user reads before committing GPU
              time to the project. */}
          <DirectorPreflightCard />
          <DirectorActionControls
            directorGenerate={directorGenerate}
            handleAddToQueue={handleAddToQueue}
            handleExportFullVideo={handleExportFullVideo}
            applyToClips={applyToClips}
            loading={loading}
            isGenerating={isGenerating || pipelineActive || Boolean(directorQueue?.running)}
            queueBusy={directorQueueLoading}
            queueConfirmation={queueConfirmation}
            pipelineId={pipelineId}
            isExporting={isExporting}
            exportMessage={exportMessage}
            editingQueueEntryId={directorQueueEditingEntryId}
          />
        </>
      )}
      </div>
      {/* Footer — the pipeline tracker moved to its own bar under the
          three columns, so this slot is free for the action that was
          buried at the bottom of the prompt list: generating the start
          images. */}
      <footer
        className="shrink-0 border-t border-border/40 bg-bg-secondary/70 backdrop-blur-sm px-3 h-[54px] min-h-[54px] flex items-center select-none"
        data-testid="director-plan-rodape"
        aria-label="Generate start images"
      >
        {(atStep('review') || atStep('plan')) && hasPlan && usesShotImages && (
          <button
            onClick={generateStartImages}
            disabled={loading}
            className="w-full py-2 rounded-lg bg-accent-blue text-white text-xs font-medium hover:bg-accent-blue-hover transition-colors flex items-center justify-center gap-1.5 shadow-xs"
          >
            {/* Always available now — directorGenerateStartImages generates an
                establishing/anchor image first when no reference was provided. */}
            <ImageIcon size={13} /> Generate Start Images
          </button>
        )}
      </footer>
    </div>
  )
}

/* formatTotalDuration used to power the "N clips · 2:33" counter in
 * the clip-structure header. Removed: the header now just shows the
 * section title + wizard icon, and the same numbers live inside the
 * <StructureView/> preview row. */
