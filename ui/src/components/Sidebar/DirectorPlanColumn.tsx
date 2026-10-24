// filepath: ui/src/components/Sidebar/DirectorPlanColumn.tsx
//
// DirectorPlanColumn — middle column of the Director 3-col layout.
//
// Renders the "what the AI is planning for me" surfaces that used to
// live inline in DirectorChat:
//   1. Structure (clip structure with pacing slider) for music-video path
//   2. Style / scene description view (after the user submits the brief)
//   3. Image prompts review (one card per shot, editable textareas)
//   4. Image generation progress + the generated clip images grid
//   5. Video prompts review (one card per shot, editable textareas)
//
// The chat on the left keeps the conversational surface (welcome, skill
// picker, upload, analyze, completion badges, chat composer). The
// technical setup on the right keeps aspect ratio / resolution / models
// / LoRAs. The plan column is where the user actually *works* on the
// shots — the things that determine what the renderer will draw.
//
// Step gating mirrors what DirectorChat used to do:
//   - structure shows while step ∈ {structure, style, plan, review, ...}
//   - style shows once the user has entered the style step
//   - image prompts / image gen show for shot-image workflows
//   - video prompts show once plan_video or review_video is reached
//
// All state lives in the store (useStore); this component is purely a
// re-mount of the same sub-components DirectorChat already exported.

import { useStore } from '../../stores/useStore'
import { useMemo } from 'react'
import { Sparkles } from 'lucide-react'
import {
  ImagePromptsReview,
  ImageGenView,
  VideoPromptsReview,
  LlmLogStage,
} from './DirectorChat'
import { DirectorActivityBlock } from './DirectorActivityBar'
import { DirectorStatusPanel } from '../Stages/DirectorStatusPanel'

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
  // Clip structure + pacing slider moved to the chat column (see
  // DirectorChat). These selectors are kept subscribed so the plan
  // column still re-renders when the user changes them in the chat,
  // but the values are no longer consumed here.
  void useStore(s => s.directorEnergyBias)
  void useStore(s => s.directorSetEnergyBias)
  void useStore(s => s.shortFilmSetPacingBias)
  void useStore(s => s.directorConfirmStructure)

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
  const setClipImage = useStore(s => s.directorSetClipImage)
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
  const autoMode = useStore(s => s.directorAutoMode)
  const isGenerating = useStore(s => s.isGenerating)
  const pipelineStatus = useStore(s => s.pipelineStatus)
  const pipelineActive = Boolean(
    pipelineStatus && !['completed', 'failed', 'cancelled'].includes(pipelineStatus.status),
  )
  const directorQueue = useStore(s => s.directorQueue)
  const directorQueueEditingEntryId = useStore(s => s.directorQueueEditingEntryId)
  const queueCurrentDirectorPipeline = useStore(s => s.queueCurrentDirectorPipeline)

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
  const cardTitle = isShortFilm ? 'Scene planning' : usesShotImages ? 'Image and video prompts' : 'Video planning'

  return (
    /* Wrapper padding: p-4 (16px) matches the inner padding of the
       sections below so the first/last cards sit at the same inset
       as the cards stacked underneath them. The outer
       .director-stage-plan card adds another 20px on top, so the
       visible inset is 36px from the column's rounded border —
       generous enough to let the cards breathe without wasting
       vertical real estate. */
    <div className="h-full flex flex-col min-h-0" data-testid="director-plan-column">
      <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1 -mr-1">
      {/* 1) When planning with LLM is actively running:
          Directly show the Planning with LLM activity block as the single container,
          without enclosing it in another container. */}
      {isPlanningActive && (
        <DirectorActivityBlock />
      )}

      {/* 2) When not actively planning:
          - Shows empty state before planning starts
          - Shows prompt review cards once planning completes, filling vertical space */}
      {!isPlanningActive && (
        <section className={`bg-bg-secondary rounded-lg p-4 border border-border flex flex-col min-h-0 ${hasPlan ? 'flex-1' : 'space-y-3'}`} data-testid="director-prompts-card">
          <div className="flex items-center justify-between pb-2 shrink-0">
            <h3 className="text-xs text-text-muted uppercase tracking-wider font-semibold">
              {cardTitle}
            </h3>
            {clipPlans.length > 0 && (
              <span className="text-2xs text-text-muted px-2 py-0.5 rounded bg-bg-tertiary border border-border">
                {clipPlans.length} {clipPlans.length === 1 ? 'cena' : 'cenas'}
              </span>
            )}
          </div>

          {/* State B: Prompt review cards once plan is ready */}
          {hasPlan && usesShotImages && (
            <div className="flex-1 flex flex-col min-h-0 space-y-3">
              <ImagePromptsReview
                clipPlans={clipPlans}
                plannedClips={plannedClips}
                speakerMappings={speakerMappings}
                editClipPlan={editPlanWithHistory}
                planPrompts={isStoryPath ? shortFilmPlanFromStory : isShortFilm ? shortFilmPlanPrompts : planPrompts}
                planVideoPrompts={isShortFilm ? shortFilmPlanVideoPrompts : planVideoPrompts}
                generateStartImages={generateStartImages}
                loading={loading}
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

          {/* State C: Empty State when no planning has occurred yet */}
          {!hasPlan && (
            <div className="flex flex-col items-center justify-center py-10 px-4 text-center space-y-3 bg-bg-tertiary/40 rounded-lg border border-dashed border-border/80">
              <div className="h-10 w-10 rounded-full bg-accent-blue/10 flex items-center justify-center text-accent-blue">
                <Sparkles size={20} />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-semibold text-text-primary">Nenhum prompt gerado ainda</p>
                <p className="text-2xs text-text-muted max-w-sm leading-relaxed">
                  Configure a música, referências visuais e a descrição da cena na coluna ao lado. Os roteiros visuais e prompts detalhados de cada corte serão organizados aqui.
                </p>
              </div>
            </div>
          )}
        </section>
      )}

      {/* 5) Image generation — progress + the actual images that came
          back from the image model. Each card is tagged with the clip
          index so the user can mentally pair it with the prompt above.
          Merged with the planning card above into a single
          "Image and video prompts" container so the central column
          doesn't show two stacked headers during the transition from
          LLM planning to image generation. */}
      {usesShotImages && (atStep('generate_images') || pastStep('generate_images')) && !(pastStep('plan') || atStep('plan')) && !(usesShotImages && (atStep('review') || pastStep('review'))) && (
        <section className="bg-bg-secondary rounded-lg p-4 border border-border space-y-3">
          <h3 className="text-xs text-text-muted uppercase tracking-wider">Image and video prompts</h3>
          <ImageGenView
            loading={loading}
            imageGenProgress={imageGenProgress}
            clipImages={clipImages}
            planVideoPrompts={isShortFilm ? shortFilmPlanVideoPrompts : planVideoPrompts}
          />
        </section>
      )}

      {/* 6) Plan video log — second LLM pass that writes video_prompt
          per clip. During the load we mount the DirectorActivityBlock so
          the user sees the live phase + progress + token counter; after
          the load completes we surface the collapsible history. */}
      {(pastStep('plan_video') || atStep('plan_video') || atStep('review_video')) && (
        <section className="bg-bg-secondary rounded-lg p-4 border border-border space-y-3">
          <h3 className="text-xs text-text-muted uppercase tracking-wider">Video prompts</h3>
          <DirectorActivityBlock />
          {!loading && <LlmLogStage stage="plan_video" label="Video prompts" />}
        </section>
      )}

      {/* 7) Video prompts review — final per-clip editing surface
          before the user clicks Generate. The "Video Prompts" header used
          to live here as an <h3>, but the inner VideoPromptsReview
          already renders an identical label alongside its Regenerate /
          Re-roll controls — keeping both produced two back-to-back
          headers in the middle column, so the outer one was removed. */}
      {atStep('review_video') && (
        <section className="bg-bg-secondary rounded-lg p-4 border border-border space-y-3">
          <VideoPromptsReview
            clipPlans={clipPlans}
            plannedClips={plannedClips}
            clipImages={clipImages}
            setClipImage={setClipImage}
            allowSceneImageUploads={!usesShotImages && !autoMode}
            speakerMappings={speakerMappings}
            editClipPlan={editPlanWithHistory}
            planVideoPrompts={isShortFilm ? shortFilmPlanVideoPrompts : planVideoPrompts}
            directorGenerate={directorGenerate}
            queueCurrent={queueCurrentDirectorPipeline}
            applyToClips={applyToClips}
            loading={loading}
            isShortFilm={isShortFilm}
            isGenerating={isGenerating || pipelineActive || Boolean(directorQueue?.running)}
            isAutoGenerating={autoMode && pipelineActive}
            editingQueueEntryId={directorQueueEditingEntryId}
          />
        </section>
      )}
      </div>
      <DirectorStatusPanel />
    </div>
  )
}

/* formatTotalDuration used to power the "N clips · 2:33" counter in
 * the clip-structure header. Removed: the header now just shows the
 * section title + wizard icon, and the same numbers live inside the
 * <StructureView/> preview row. */
