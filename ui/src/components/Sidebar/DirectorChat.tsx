import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import { Upload, Loader2, Music, RotateCcw, Check, X, ChevronRight, ChevronDown, ImageIcon, Play, Send, Users, FileText, ListVideo, Sparkles } from 'lucide-react'
import { useStore, directorModelUsesFixedMediaStrength, resolveResolution } from '../../stores/useStore'
import { fetchModelOptions, getFileUrl } from '../../api/client'
import { DirectorLoraSelector } from '../SettingsDrawer/DirectorLoraSelector'
import { DirectorSongSetup } from './DirectorSongSetup'
import { DirectorH3Optimizations } from './DirectorH3Optimizations'
import { OmniReferenceSection } from './OmniReferenceSection'
import { DirectorTimelineIconButton } from './DirectorTimelineEditor'
import { DirectorActivityBadge } from './DirectorActivityBar'
import {
  AdditionalRefsSection,
  StructureView,
} from './DirectorReferencePanels'
// DirectorActivityBadge is still subscribed by ``DirectorChat``
// indirectly through ``DirectorActivityBar``'s internal hooks, but
// the type-only reference below keeps the import live so future
// orchestration hooks can wire it back without re-importing.
void DirectorActivityBadge
import {
  SectionBadge,
  EnergyDot,
  ShotStatus,
  SystemBubble,
  UserBubble,
} from './DirectorChatBadges'
import { DirectorErrorBanner } from './DirectorErrorBanner'

import { formatSeconds, recommendedWindowProfile } from './DurationSlider'
import { DurationPresetControl } from './DurationPresetControl'
import { LONG_FORM_MAX_SECONDS, formatDuration } from '../../lib/durationPlanning'
import type { DirectorShotImageGuidance, ModelOptions, ShortFilmCharacter, ShortFilmPath } from '../../types'
import { readDirectorScript } from '../../api/client'

// AUDIO_ACCEPT lists both audio formats AND video formats. When a video
// file is uploaded, the backend's /api/v1/upload-audio endpoint extracts
// the audio track via ffmpeg and returns a WAV path. The user sees the
// same workflow either way — they can drop a music video here and get
// the soundtrack analyzed without converting first.
const AUDIO_ACCEPT = '.wav,.mp3,.flac,.ogg,.m4a,.mp4,.mov,.mkv,.webm,.avi,.m4v'
const IMAGE_ACCEPT = '.png,.jpg,.jpeg,.webp,.bmp'
// Story scripts/roteiros the Short Film → Story path accepts. .txt/.md
// are read as plain text; .pdf goes through the backend extractor
// (/api/v1/director/script/read, backed by pypdf). The extracted text
// is injected into the story description before planning.
const SCRIPT_ACCEPT = '.txt,.md,.markdown,.pdf'


function DirectorTargetDurationControl() {
  const duration = useStore(s => s.shortFilmTargetDuration)
  const setDuration = useStore(s => s.shortFilmSetTargetDuration)
  const prompt = useStore(s => s.directorSceneDescription)
  const references = useStore(s => s.directorH3References)
  const videoModel = useStore(s => s.selectedModelPerMode.video || 'ltx2_22B_distilled_1_1')
  const resolution = useStore(s => s.directorResolution)
  const aspectRatio = useStore(s => s.directorAspectRatio)
  const totalVramGb = useStore(s => s.systemStats?.gpu.vram_total_gb ?? 0)
  const [options, setOptions] = useState<ModelOptions | null>(null)
  const [planningMode, setPlanningMode] = useState<'duration' | 'windows' | 'auto'>('auto')

  useEffect(() => {
    let cancelled = false
    fetchModelOptions(videoModel)
      .then(value => { if (!cancelled) setOptions(value) })
      .catch(() => { if (!cancelled) setOptions(null) })
    return () => { cancelled = true }
  }, [videoModel])

  const fps = options?.fps || 24
  const resolvedResolution = resolveResolution(options, resolution, aspectRatio)
  const recommendation = recommendedWindowProfile(
    options?.director_memory_policy || options?.sliding_window_memory_policy,
    resolvedResolution,
    totalVramGb,
  )
  const defaults = options?.sliding_window_defaults
  const windowFrames = recommendation?.frames
    || defaults?.window_max
    || options?.frames_maximum
    || Math.round(14.4 * fps)
  const windowSeconds = Math.max(1, windowFrames / fps)
  const driveReference = references.find(reference => (
    reference.type === 'audio' && reference.audio_intent === 'drive'
  ))
  const driveDuration = Number(driveReference?.duration_seconds)

  return (
    <DurationPresetControl
      label="Target duration"
      value={duration}
      onChange={setDuration}
      minSeconds={10}
      maxSeconds={LONG_FORM_MAX_SECONDS}
      windowSeconds={windowSeconds}
      overlapSeconds={(defaults?.overlap_default || 0) / fps}
      discardSeconds={(defaults?.discard_last_frames || 0) / fps}
      enablePlanningModes
      planningMode={planningMode}
      onPlanningModeChange={setPlanningMode}
      autoPrompt={prompt}
      autoPlanningStyle="creative"
      autoSourceSeconds={Number.isFinite(driveDuration) && driveDuration > 0 ? driveDuration : null}
      autoSourceLabel="music / performance timeline"
      modelLimitLabel={`Director plans ${formatDuration(duration, true)} as restart-safe scenes; current automatic shot target is ${formatDuration(windowSeconds, true)}.`}
    />
  )
}

function directorWillGenerateShotImages(
  support: 'required' | 'optional' | 'direct_references' | undefined,
  guidance: DirectorShotImageGuidance,
  hasVisualReferences: boolean,
): boolean {
  // Explicit choices from the Image model selector always win. In
  // particular, "None" maps to prompt_only even for Director models whose
  // legacy capability metadata says generated starts are required.
  if (guidance === 'prompt_only') return false
  if (guidance === 'generate') return true
  if (!support || support === 'required') return true
  if (support === 'direct_references') return false
  return hasVisualReferences
}

function AudioScaleSlider() {
  const audioScale = useStore(s => s.directorAudioScale)
  const setAudioScale = useStore(s => s.setDirectorAudioScale)
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-2xs text-text-muted whitespace-nowrap">Audio {audioScale.toFixed(1)}x</span>
        <input
          type="range"
          min={0}
          max={5}
          step={0.1}
          value={audioScale}
          onChange={e => setAudioScale(parseFloat(e.target.value))}
          className="flex-1 h-1"
        />
      </div>
      <div className="flex gap-2 text-2xs text-text-muted">
        <span>1x</span>
        <span>3x TTS</span>
        <span>5x</span>
      </div>
    </div>
  )
}

/** Image / source-video strength slider for the reference photo.
 *  Used to live inline under the reference-photo drop zone in the
 *  chat column; moved to the right-hand Generation Options column so
 *  the chat stays focused on inputs. Visibility gated on the
 *  reference photo being loaded AND the active model not pinning
 *  media strength (some architectures force a fixed value). */
function ReferenceImageStrengthSlider() {
  const referenceImage = useStore(s => s.directorReferenceImage)
  const strengthLabel = useStore(s => s.modelOptions?.input_video_strength_label ?? '')
  const inputVideoStrength = useStore(s => s.params.input_video_strength ?? 1.0)
  const setParam = useStore(s => s.setParam)
  const fixedMediaStrength = useStore(s => {
    const selected = s.selectedModelPerMode.video || 'ltx2_22B_distilled_1_1'
    const model = s.models.find(item => item.model_type === selected)
    return directorModelUsesFixedMediaStrength(selected, model?.architecture)
  })
  if (!referenceImage || fixedMediaStrength) return null
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-xs text-text-secondary">{strengthLabel || 'Image Strength'}</label>
        <span className="text-xs text-text-muted tabular-nums">{inputVideoStrength.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={inputVideoStrength}
        onChange={e => setParam('input_video_strength', parseFloat(e.target.value))}
        className="w-full h-1 accent-accent-blue"
      />
      <p className="text-2xs text-text-muted">Lower values can increase motion</p>
    </div>
  )
}

const STEP_ORDER = ['upload', 'analyze', 'structure', 'style', 'plan', 'review', 'generate_images', 'plan_video', 'review_video'] as const
type DirectorStep = typeof STEP_ORDER[number]

function formatTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

// sectionBarColors was moved to DirectorReferencePanels.tsx along
// with AdditionalRefsSection (which is the only consumer). The
// reference panel exposes it through its module exports if any
// other surface needs the palette in the future.

/**
 * Textarea that auto-resizes its height to fit the content.
 *
 * Used for the per-clip image_prompt and video_prompt fields in the
 * Director chat review steps. Without this, long prompts produce a
 * scrollable inner textarea — and that textarea sits inside another
 * scrollable container, inside the chat panel which is itself
 * scrollable. The user has to triple-scroll to read a long prompt.
 *
 * With auto-resize the textarea grows to its full content height and
 * the only scroll is the parent chat panel's, matching the user's
 * "one scroll per surface" preference.
 *
 * Re-measures whenever `value` changes (controlled-component pattern):
 * setting height to 'auto' first lets it shrink as well as grow.
 *
 * `overflow-y: hidden` is forced via inline style so the textarea
 * never shows its own scrollbar — even when the browser would render
 * one defensively at the boundary between content height and box
 * height (Firefox especially does this). Without `hidden`, a wheel
 * event over the textarea gets captured by the textarea's would-be
 * scroll instead of bubbling up to the chat panel, so the user
 * can't scroll the chat when their cursor happens to be over a
 * prompt field.
 *
 * Optional `minHeight`/`maxHeight` (px) bound the growth — used by the
 * chat composer (issue #11), which keeps its resting 2-row size when
 * empty and stops growing at a cap. Past the cap the textarea scrolls
 * itself, so overflow flips to `auto` there; that's fine for the
 * composer because it sits OUTSIDE the scrollable chat panel — the
 * wheel-capture concern above doesn't apply.
 */
export function AutoResizeTextarea({ minHeight, maxHeight, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  minHeight?: number
  maxHeight?: number
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  // The textarea needs to (a) auto-grow to its content, then (b)
  // cap itself at maxHeight, then (c) flip `overflow-y` to 'auto'
  // when the cap is hit so the user can still reach the truncated
  // text. We keep the overflow decision in state so the merged
  // style below can react to it; the state update happens inside a
  // layout effect (the documented escape hatch for "measure DOM,
  // mirror to state") so the synchronous DOM measurement still
  // happens before the browser paints. eslint is told to allow it
  // explicitly because the rule can't infer that this is the
  // intended pattern (see the comment on the disable line).
  const [overflowing, setOverflowing] = useState(false)
  /* eslint-disable react-hooks/set-state-in-effect --
     DOM measurement → state mirror is the documented useLayoutEffect
     pattern; useLayoutEffect cannot be used here because the parent
     only forwards style + value, and the cascading-render warning
     does not apply when the effect body does synchronous measurement
     against ref.current and mirrors the boolean to state. */
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    let h = el.scrollHeight
    if (minHeight) h = Math.max(h, minHeight)
    if (maxHeight) h = Math.min(h, maxHeight)
    el.style.height = `${h}px`
    const shouldOverflow = maxHeight ? el.scrollHeight > maxHeight : false
    el.style.overflowY = shouldOverflow ? 'auto' : 'hidden'
    setOverflowing(shouldOverflow)
  }, [props.value, minHeight, maxHeight])
  /* eslint-enable react-hooks/set-state-in-effect */
  // Merge any incoming style with our scrollbar-hiding override.
  // The `overflowY` override is conditional on `overflowing`: when
  // content fits inside the cap we hide the textarea's own scrollbar
  // (wheel-capture is the whole point of the component), but when
  // the content overflows the cap we expose the textarea's
  // internal scroll so the user can reach the rest of the text.
  const mergedStyle: React.CSSProperties = { ...(props.style || {}), overflowY: overflowing ? 'auto' : 'hidden' }
  return <textarea ref={ref} {...props} style={mergedStyle} />
}

/** Collapsed, persistent record of completed LLM streams for one stage.
 *  Replaces the old behavior where the thinking/output box vanished the
 *  moment a stage finished. Default-collapsed so history stays compact. */
export function LlmLogStage({ stage, label }: { stage: string; label: string }) {
  const log = useStore(s => s.directorLlmLog)
  const [openIdx, setOpenIdx] = useState<number | null>(null)
  const entries = log.filter(e => e.stage === stage)
  if (entries.length === 0) return null
  return (
    <div className="space-y-1">
      {entries.map((entry, i) => {
        const open = openIdx === i
        // Same thinking/output split as the live stream box
        const thinkMatch = entry.text.match(/<think>([\s\S]*?)(<\/think>|$)/)
        const thinking = thinkMatch ? thinkMatch[1].trim() : ''
        const output = entry.text.replace(/<think>[\s\S]*?(<\/think>|$)/, '').trim()
        return (
          <div key={i}>
            <button
              onClick={() => setOpenIdx(open ? null : i)}
              className="flex items-center gap-1 text-2xs text-text-muted hover:text-text-secondary transition-colors"
            >
              {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              {label}{entries.length > 1 ? ` · pass ${i + 1}` : ''} (done)
            </button>
            {open && (
              <div className="mt-1 rounded bg-bg-primary/50 border border-border/30 p-2 max-h-48 overflow-y-auto">
                {thinking && (
                  <pre className="text-2xs text-text-muted whitespace-pre-wrap font-mono leading-relaxed">{thinking}</pre>
                )}
                {output && (
                  <pre className={`text-2xs text-accent-blue/70 whitespace-pre-wrap font-mono leading-relaxed ${thinking ? 'mt-1 pt-1 border-t border-border/30' : ''}`}>{output}</pre>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function DirectorChat() {
  const step = useStore(s => s.directorStep)
  const loading = useStore(s => s.directorLoading)
  // Sub-status text ("Loading transcription model (first use downloads
  // ~300MB)...", "Transcribing audio...", etc.) updated by the polling
  // loop in directorUploadAndAnalyze. Falls back to a static message
  // in the loading spinner when null.
  const loadingMessage = useStore(s => s.directorLoadingMessage)
  // Tracks whether ANY generation job is currently running. The chat
  // column re-renders when this flips so the input / queue button can
  // disable itself, but the value is consumed inside DirectorPlanColumn.
  void useStore(s => s.isGenerating)
  const error = useStore(s => s.directorError)
  const clearDirectorError = useStore(s => s.clearDirectorError)
  const analysis = useStore(s => s.directorAnalysis)
  const plannedClips = useStore(s => s.directorPlannedClips)
  // Reactivated for the in-chat StructureView (moved from the middle
  // column so the user sees clip structure right below the upload).
  // Same selectors DirectorPlanColumn used to own.
  const energyBias = useStore(s => s.directorEnergyBias)
  const setEnergyBias = useStore(s => s.directorSetEnergyBias)
  const shortFilmSetPacingBias = useStore(s => s.shortFilmSetPacingBias)
  const confirmStructure = useStore(s => s.directorConfirmStructure)
  // Local slider state mirrors what the in-chat StructureView needs to
  // commit the bias to the store on mouse/touch release. Owned here
  // because the slider now lives inside the chat column.
  const [localBias, setLocalBias] = useState<number | null>(null)
  const sliderRef = useRef<number | null>(null)
  const totalClipDuration = plannedClips.length > 0 ? plannedClips[plannedClips.length - 1].end : 0
  const beatDistribution = useMemo(() => {
    const counts: Record<number, number> = {}
    for (const c of plannedClips) counts[c.beat_count] = (counts[c.beat_count] || 0) + 1
    return Object.entries(counts)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([beats, count]) => `${count}x${beats}-beat`)
      .join(', ')
  }, [plannedClips])
  const clipPlans = useStore(s => s.directorClipPlans)
  const selectedDirectorShotImageSupport = useStore(s => s.models.find(
    model => model.model_type === (s.selectedModelPerMode.video || 'ltx2_22B_distilled_1_1'),
  )?.director?.shot_image_support)
  const directorUsesOmniManifest = useStore(s => {
    const selected = s.selectedModelPerMode.video || 'ltx2_22B_distilled_1_1'
    return selected.toLowerCase().startsWith('minimax_h3_ref2va')
      || s.models.find(model => model.model_type === selected)
        ?.director?.video_strategy === 'omni_reference'
  })
  const directorShotImageGuidance = useStore(s => s.directorShotImageGuidance)
  const directorHasVisualReferences = useStore(s => Boolean(
    s.directorReferenceImage
    || s.directorReferenceImagePath
    || s.directorCharacterRefs.length
    || s.directorCharacterRefPaths.length
    || s.directorLocationRefs.length
    || s.directorLocationRefPaths.length
    || (
      s.models.find(model => model.model_type === (
        s.selectedModelPerMode.video || 'ltx2_22B_distilled_1_1'
      ))?.director?.video_strategy === 'omni_reference'
      && s.directorH3References.some(
        reference => reference.type === 'image' || reference.type === 'video',
      )
    )
  ))
  const sceneDescription = useStore(s => s.directorSceneDescription)
  const audioFile = useStore(s => s.directorAudioFile)
  const referenceImage = useStore(s => s.directorReferenceImage)
  const clipImages = useStore(s => s.directorClipImages)
  void useStore(s => s.directorSetClipImage)
  void useStore(s => s.directorImageGenProgress)
  const uploadAndAnalyze = useStore(s => s.directorUploadAndAnalyze)
  const setSceneDescription = useStore(s => s.directorSetSceneDescription)
  const setReferenceImage = useStore(s => s.directorSetReferenceImage)
  // The following selectors are still subscribed so the chat column
  // re-renders when the underlying state changes (the parent card
  // shows "Analyzing audio..." spinner / disabled state / etc.), but
  // their VALUES are no longer referenced directly in this file —
  // the surfaces that consumed them (StructureView, StyleForm,
  // ImagePromptsReview, ImageGenView, VideoPromptsReview,
  // LlmThinkingStream, LlmLogStage) moved to DirectorPlanColumn.
  const planPrompts = useStore(s => s.directorPlanPrompts)
  void useStore(s => s.directorPlanVideoPrompts)
  const generateStartImages = useStore(s => s.directorGenerateStartImages)
  void useStore(s => s.directorApplyToClips)
  void useStore(s => s.directorGenerate)
  void useStore(s => s.directorEditClipPlan)
  void useStore(s => s.directorReset)
  const speakers = useStore(s => s.directorSpeakers)
  // These three selectors used to be `void`-subscribed (their values
  // were consumed only by the StyleForm in DirectorPlanColumn). The
  // StyleForm moved into the chat column below the CLIP STRUCTURE
  // card, so we now read them normally and pass them to StyleForm.
  const speakerMappings = useStore(s => s.directorSpeakerMappings)
  const setSpeakerMapping = useStore(s => s.directorSetSpeakerMapping)
  const insertSpeakerMention = useStore(s => s.directorInsertSpeakerMention)
  const autoMode = useStore(s => s.directorAutoMode)
  const skill = useStore(s => s.directorSkill)
  const musicSource = useStore(s => s.directorMusicSource)
  const setMusicSource = useStore(s => s.setDirectorMusicSource)
  const songDescription = useStore(s => s.directorSongDescription)
  const setSongDescription = useStore(s => s.setDirectorSongDescription)
  const generateTrack = useStore(s => s.directorGenerateTrack)

  // Short film specific
  const shortFilmCharacters = useStore(s => s.shortFilmCharacters)
  const shortFilmSetCharacters = useStore(s => s.shortFilmSetCharacters)
  const shortFilmUploadAndAnalyze = useStore(s => s.shortFilmUploadAndAnalyze)
  void useStore(s => s.shortFilmSetPacingBias)
  const shortFilmPlanPrompts = useStore(s => s.shortFilmPlanPrompts)
  void useStore(s => s.shortFilmPlanVideoPrompts)
  const shortFilmPath = useStore(s => s.shortFilmPath)
  const shortFilmSetPath = useStore(s => s.shortFilmSetPath)
  const shortFilmPlanFromStory = useStore(s => s.shortFilmPlanFromStory)
  const shortFilmTargetDuration = useStore(s => s.shortFilmTargetDuration)
  const shortFilmNarrative = useStore(s => s.shortFilmNarrative)
  const shortFilmSetNarrative = useStore(s => s.shortFilmSetNarrative)
  const startDirectorPipeline = useStore(s => s.startDirectorPipeline)
  const pipelineStatus = useStore(s => s.pipelineStatus)
  void pipelineStatus?.phase
  void pipelineStatus
  // pipelineActive + the directorQueue trio are read by the chat composer
  // (Send / Queue buttons) further down — keep the destructures.
  void Boolean(
    pipelineStatus && !['completed', 'failed', 'cancelled'].includes(pipelineStatus.status),
  )
  const directorQueueLoading = useStore(s => s.directorQueueLoading)
  const directorQueueEditingEntryId = useStore(s => s.directorQueueEditingEntryId)
  const queueCurrentDirectorPipeline = useStore(s => s.queueCurrentDirectorPipeline)
  // The four hooks below were once consumed by the in-chat StructureView,
  // StyleForm, LlmThinkingStream, ImagePromptsReview, ImageGenView,
  // VideoPromptsReview blocks — those blocks moved to the middle column
  // (DirectorPlanColumn) so the chat only renders inputs now. Reads of
  // the store actions still happen via the directorApplyTimeline /
  // directorGenerate destructuring further down (those are user inputs).
  // directorQueueEntriesCount: the queue button's tooltip surfaces the
  // current pending count so the user knows how many drafts are waiting
  // before they click Queue. Empty array still triggers a re-render
  // because we read the array length via Zustand's selector equality.
  const directorQueueEntriesCount = useStore(s => s.directorQueue?.entries?.length ?? 0)
  void directorWillGenerateShotImages(
    selectedDirectorShotImageSupport,
    directorShotImageGuidance,
    directorHasVisualReferences,
  )

  const isShortFilm = skill === 'short_film'
  const isStoryPath = isShortFilm && shortFilmPath === 'story'
  const isMusicVideo = !!skill && !isShortFilm
  // Music Video "Generate a track" setup: the bottom chat IS the song
  // description, and Send kicks off the whole write-song → render → video chain.
  const isMvGenerate = isMusicVideo && musicSource === 'generate'
  const mvGenerateSetup = isMvGenerate && step === 'upload'

  const messagesEndRef = useRef<HTMLDivElement>(null)
  // Container ref so we can scroll-to-top when the user picks a new skill —
  // otherwise scrollIntoView would jump to the bottom composer and hide the
  // freshly-revealed skill options.
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [dragOver, setDragOver] = useState(false)
  // localBias + sliderRef were the in-chat pacing slider state. The
  // StructureView that consumed them moved to the middle column. The
  // component-level slider state is rebuilt inside DirectorPlanColumn.
  void useState<number | null>(null)
  void useRef<number | null>(null)
  const [chatInput, setChatInput] = useState('')
  const [draftQueuePending, setDraftQueuePending] = useState(false)
  const [draftQueueConfirmation, setDraftQueueConfirmation] = useState<string | null>(null)

  // Sync chatInput with store's sceneDescription when entering style step
  useEffect(() => {
    if (step === 'style' && sceneDescription && !chatInput) {
      setChatInput(sceneDescription)
    }
  }, [chatInput, sceneDescription, step])

  useEffect(() => {
    if (!draftQueueConfirmation) return
    const timer = window.setTimeout(() => setDraftQueueConfirmation(null), 5000)
    return () => window.clearTimeout(timer)
  }, [draftQueueConfirmation])

  const refImagePreview = useMemo(
    () => referenceImage ? URL.createObjectURL(referenceImage) : null,
    [referenceImage]
  )

  // speakerSamples used to feed the in-chat StyleForm. The form moved
  // back into the chat column (below the CLIP STRUCTURE card), so we
  // expose the memo here and pass it down. Only first 2 lines per
  // speaker are kept so the panel doesn't drown the user in lyrics.
  const speakerSamples = useMemo<Record<string, string[]>>(() => {
    const samples: Record<string, string[]> = {}
    if (analysis?.lyrics) {
      for (const seg of analysis.lyrics) {
        if (seg.speaker && !samples[seg.speaker]) {
          samples[seg.speaker] = []
        }
        if (seg.speaker && samples[seg.speaker].length < 2) {
          samples[seg.speaker].push(seg.text)
        }
      }
    }
    return samples
  }, [analysis?.lyrics])

  // Scene description card collapse state — defaults to **collapsed**
  // so the chat column doesn't bloat after the user submits the brief.
  // The card still owns the speaker-mapping + scene-text inputs that
  // need to be reachable when the user wants to revisit the brief, so
  // the chevron in the header toggles it back open. Re-mounting the
  // style step from a fresh project re-collapses it via the gating
  // `(atStep('style') || pastStep('style'))` so behaviour is identical
  // for every fresh project.
  const [sceneDescriptionOpen, setSceneDescriptionOpen] = useState(false)

  const currentIndex = STEP_ORDER.indexOf(step)
  const pastStep = useCallback((s: DirectorStep) => currentIndex > STEP_ORDER.indexOf(s), [currentIndex])
  const atStep = (s: DirectorStep) => step === s
    && step !== 'review_video'

  const handleFile = useCallback((file: File) => {
    // Accept audio/* MIME OR video/* MIME (backend extracts the audio
    // track from video) OR a matching file extension. Some browsers /
    // OSes don't set MIME on drag-drop, so the extension fallback is
    // load-bearing.
    const mimeOk = file.type.startsWith('audio/') || file.type.startsWith('video/')
    const extOk = AUDIO_ACCEPT.split(',').some(ext => file.name.toLowerCase().endsWith(ext))
    if (!mimeOk && !extOk) {
      return
    }
    if (isShortFilm) {
      shortFilmUploadAndAnalyze(file)
    } else {
      uploadAndAnalyze(file)
    }
  }, [uploadAndAnalyze, shortFilmUploadAndAnalyze, isShortFilm])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  // totalClipDuration + beatDistribution fed the in-chat StructureView.
  // DirectorPlanColumn now recomputes its own (with the same formula).
  useMemo(
    () => plannedClips.length > 0 ? plannedClips[plannedClips.length - 1].end : 0,
    [plannedClips]
  )
  useMemo(() => {
    const counts: Record<number, number> = {}
    for (const c of plannedClips) {
      counts[c.beat_count] = (counts[c.beat_count] || 0) + 1
    }
    return Object.entries(counts)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([beats, count]) => `${count}x${beats}-beat`)
      .join(', ')
  }, [plannedClips])

  // Auto-scroll behavior:
  //   - On `skill` change, scroll to the TOP so the user sees the freshly
  //     revealed skill options, not the composer pinned at the bottom.
  //   - On step/loading changes (and progress updates / new errors), scroll
  //     to the bottom so the newest content stays in view.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [step, loading, loadingMessage, error, clipPlans.length, clipImages.length])

  useEffect(() => {
    // Only act on skill changes — initial mount (skill === null) is a no-op.
    if (skill) {
      const el = scrollContainerRef.current
      if (el) el.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [skill])

  const handleChatSubmit = useCallback(() => {
    // Music Video "Generate a track": the chat is the song description, and
    // Send runs write-song → render track → analyze → plan → images → video.
    if (mvGenerateSetup) {
      if (songDescription.trim() && !loading) void generateTrack('now')
      return
    }
    if (step === 'style' && chatInput.trim()) {
      setSceneDescription(chatInput.trim())
      if (autoMode) {
        // Auto mode: run entire flow server-side via pipeline
        startDirectorPipeline()
      } else if (isStoryPath) {
        shortFilmPlanFromStory()
      } else if (isShortFilm) {
        shortFilmPlanPrompts()
      } else {
        planPrompts()
      }
    }
  }, [mvGenerateSetup, songDescription, loading, generateTrack, step, chatInput, setSceneDescription, autoMode, startDirectorPipeline, isStoryPath, shortFilmPlanFromStory, isShortFilm, shortFilmPlanPrompts, planPrompts])

  // Shared "attach a script" handler for the Story and Music Video paths.
  // Loads the extracted text into the scene description (and the composer)
  // so Send plans from it. Attaching a script is **non-destructive**: it
  // only repopulates the editable text inputs and never wipes
  // `directorPlannedClips` / `directorClipPlans` / `directorClipImages`.
  // The previous behaviour rewound the pipeline to the `style` step
  // (clearing clips + plans + images) whenever a script was attached
  // past the style step, which destroyed the user's already-generated
  // CLIP STRUCTURE — the panel went from N clips to 0 clips the moment
  // a script was attached, with no way to recover short of regenerating.
  // Now the script just seeds the text and the user can re-plan from
  // Send if they want a fresh structure.
  const loadScriptIntoDescription = useCallback(({ text }: { text: string }) => {
    setSceneDescription(text)
    setChatInput(text)
  }, [setSceneDescription, setChatInput])

  // Script/roteiro — owned by the parent so the composer (where the
  // orange attach button lives) can render it alongside the Send button
  // and stay in sync with the style-step surface that used to host it.
  const [attachedScript, setAttachedScript] = useState<{
    filename: string
    charCount: number
    truncated: boolean
  } | null>(null)
  const [scriptLoading, setScriptLoading] = useState(false)
  const [scriptError, setScriptError] = useState('')
  // Whether the "References" panel (photo + char/loc refs + voice)
  // is currently expanded below the header row. Sits alongside the
  // audio-source combobox as a peer affordance so the user can flip
  // either control independently without a nested tab structure.
  const [referencesOpen, setReferencesOpen] = useState(false)
  const handleScriptFile = useCallback(async (file: File) => {
    setScriptError('')
    setScriptLoading(true)
    try {
      const result = await readDirectorScript(file)
      const info = {
        filename: result.filename,
        text: result.text,
        charCount: result.char_count,
        truncated: result.truncated,
      }
      setAttachedScript({ filename: info.filename, charCount: info.charCount, truncated: info.truncated })
      loadScriptIntoDescription(info)
    } catch (e) {
      setScriptError(e instanceof Error ? e.message : 'Could not read script')
    } finally {
      setScriptLoading(false)
    }
  }, [loadScriptIntoDescription])

  const chatInputEnabled = (step === 'style' || mvGenerateSetup) && !loading

  const handleQueueDraft = useCallback(async () => {
    const description = (mvGenerateSetup ? songDescription : chatInput).trim()
    if (!description || !chatInputEnabled || draftQueuePending || directorQueueLoading) return

    // Keep the store authoritative even if the user clicks Queue immediately
    // after typing. startDirectorPipeline freezes this value along with every
    // selected model, LoRA, reference, and Director option.
    if (!mvGenerateSetup) setSceneDescription(description)
    setDraftQueuePending(true)
    setDraftQueueConfirmation(null)
    const before = useStore.getState()
    const editingEntryId = before.directorQueueEditingEntryId
    const beforeIds = new Set((before.directorQueue?.entries || []).map(entry => entry.id))
    try {
      if (mvGenerateSetup) {
        await generateTrack('queue')
      } else {
        await queueCurrentDirectorPipeline()
      }
      const after = useStore.getState()
      const queue = after.directorQueue
      const savedEntry = editingEntryId
        ? queue?.entries.find(entry => entry.id === editingEntryId)
        : queue?.entries.find(entry => !beforeIds.has(entry.id))
      if (!queue || !savedEntry || after.directorError) return
      const waitingCount = queue.entries.filter(
        entry => ['held', 'queued', 'running'].includes(entry.status),
      ).length
      setDraftQueueConfirmation(
        editingEntryId
          ? 'Queue changes saved. The project remains paused until Start Queue.'
          : `Added to Queue · ${waitingCount} Director ${waitingCount === 1 ? 'project' : 'projects'} waiting. Configure another idea or press Start Queue when ready.`,
      )
    } finally {
      setDraftQueuePending(false)
    }
  }, [mvGenerateSetup, songDescription, chatInput, chatInputEnabled, draftQueuePending, directorQueueLoading, generateTrack, queueCurrentDirectorPipeline, setSceneDescription, setDraftQueuePending, setDraftQueueConfirmation])

  useEffect(() => {
    const onDirectorShortcut = (event: KeyboardEvent) => {
      const command = event.metaKey || event.ctrlKey
      if (!command) return

      if (event.key === 'Enter' && chatInputEnabled) {
        event.preventDefault()
        if (event.shiftKey) void handleQueueDraft()
        else handleChatSubmit()
        return
      }

      if (event.key.toLowerCase() === 'g' && !event.shiftKey && step === 'review' && !loading) {
        event.preventDefault()
        void generateStartImages()
      }

      // Cmd/Ctrl+S — save current draft to the paused queue. The
      // browser's "save page" default is suppressed because the user
      // expects Director to swallow the key while focused on the
      // chat column. Falls back to Queue draft when chatInputEnabled.
      if (event.key.toLowerCase() === 's' && !event.shiftKey && chatInputEnabled) {
        event.preventDefault()
        void handleQueueDraft()
      }
    }
    window.addEventListener('keydown', onDirectorShortcut)
    return () => window.removeEventListener('keydown', onDirectorShortcut)
  }, [chatInputEnabled, handleQueueDraft, handleChatSubmit, step, loading, generateStartImages])

  const chatInputPlaceholder = mvGenerateSetup
    ? 'Describe your music video — subject, vibe, mood, setting…'
    : isShortFilm && !shortFilmPath
    ? 'Choose a path above...'
    : step === 'upload' || step === 'analyze'
    ? isMvGenerate
      ? 'Generating your music video…'
      : isShortFilm ? 'Upload dialogue audio to begin...' : 'Upload audio to begin...'
    : step === 'style'
    ? isStoryPath
      ? 'Describe the story... e.g., Two detectives argue over evidence in a dark office.'
      : isShortFilm
        ? 'Describe the story setting and mood... e.g., A tense interrogation in a dimly lit room.'
        : speakers.length >= 2
          ? 'Describe the scene... e.g., Rap music video in a gym. Neon lights and grunge aesthetic.'
          : 'Describe the scene and characters...'
    : step === 'structure'
    ? isShortFilm ? 'Adjust scene pacing above...' : 'Adjust clip structure above...'
    : 'Reviewing...'

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0">
      {/* The chat column is now strictly inputs (path chooser,
          audio upload, reference uploads, script attach) + the composer
          at the bottom. The Director skill itself is a project-level
          choice made on the project creation/setup screen, so there is
          no skill picker here. Removed: the skill name / BPM / duration
          / Start-Over header (informational), the welcome bubble
          (informational), the user-bubble echoes of past choices (the
          controls below already reflect the current selection), and
          the pipeline progress banner (status info, belongs elsewhere
          if needed). The parent .director-stage-chat provides the 16px
          padding so children don't add their own horizontal padding —
          that previously left uneven gutters against the card border. */}
      {/* Chat scroll container used to own overflow-y-auto, which painted
          a scrollbar that covered the upload/reference cards next door.
          The user asked to keep the bar visible only on the additional
          references section, so this container is now a plain flex
          child (no scroll). The composer below stays anchored; if the
          message list grows past the available height, the *outer*
          DirectorStage overflow will absorb it. The scrollContainerRef
          is still maintained because the chat anchors scrolling
          programmatically on new messages / errors. */}
      <div ref={scrollContainerRef} className="flex-1 min-h-0 space-y-3">
        {/* Short Film path chooser — render the prompt directly, no
            surrounding bubble, since the bubble was just decorative text. */}
        {isShortFilm && skill && !shortFilmPath && (
          <div>
            <p className="text-xs text-text-secondary mb-2">How would you like to create your short film?</p>
            <PathChooser onSelect={(path: ShortFilmPath) => {
              shortFilmSetPath(path)
              if (path === 'story') {
                useStore.setState({ directorStep: 'style' })
              }
            }} />
          </div>
        )}

        {/* Core project choices (aspect ratio, resolution, workflow,
            models) used to render here as a SystemBubble. They now live
            in the right-hand column on the Director page (mounted by
            DirectorStage) so the chat stays focused on creative
            decisions while technical settings sit beside it. */}

        {skill && (!isShortFilm || shortFilmPath === 'audio') && (atStep('upload') || atStep('analyze') || pastStep('analyze')) && (
          <SystemBubble>
            <div className="space-y-3">
              {/* Music Video: header row with the audio-source combobox
                  on the left (50%) and a "References" tab button on the
                  right (50%). Both occupy the same row so the eye reads
                  them as parallel affordances — the combobox chooses
                  WHERE the audio comes from, the References tab opens
                  the visual anchors panel. */}
              {!isShortFilm && (
                <div className="flex items-stretch gap-1.5">
                  <DirectorMusicSourceCombobox
                    value={(musicSource || 'upload') as 'upload' | 'generate'}
                    /* Clicking the combobox closes the References
                       panel so the user always sees the audio panel
                       reflect their latest selection. Without this the
                       audio content stays hidden behind the refs
                       panel and the combobox feels unresponsive. */
                    onChange={(v) => {
                      setMusicSource(v)
                      setReferencesOpen(false)
                    }}
                  />
                  <ReferencesTabButton
                    active={referencesOpen}
                    /* Clicking the References button also closes the
                       audio panel (mutually exclusive surfaces) so the
                       user always sees a single coherent section below
                       the header row. */
                    onClick={() => setReferencesOpen(o => {
                      const next = !o
                      // Toggling References off restores the audio
                      // panel automatically (no state to flip back).
                      return next
                    })}
                  />
                </div>
              )}
              {/* Audio source panel + CLIP STRUCTURE — both render
                  ONLY when the References panel is closed. The user
                  asked for clip structure to live in the same surface
                  as the audio panel (the "audio window") and not
                  follow the user into the References window. Gating
                  both behind `!referencesOpen` keeps them mutually
                  exclusive with the References content. */}
              {!isShortFilm && !referencesOpen && (
                <>
                  <AudioSourcePanel
                    dragOver={dragOver}
                    setDragOver={setDragOver}
                    handleDrop={handleDrop}
                    handleFile={handleFile}
                    loading={loading && atStep('analyze')}
                    loadingMessage={loadingMessage}
                    audioFile={audioFile}
                    isShortFilm={isShortFilm}
                    musicSource={musicSource || 'upload'}
                    pipelineLoading={loading}
                  />
                  {/* CLIP STRUCTURE card — moved from the middle column
                      (DirectorPlanColumn) so the user sees the clip
                      structure immediately below the upload card, in
                      the same conversation surface. Only renders after
                      the audio has been analyzed and the LLM has
                      segmented the song. The gating mirrors what
                      DirectorPlanColumn used to do so behaviour is
                      identical. */}
                  {!isStoryPath && (atStep('structure') || pastStep('structure')) && (
                    <section className="bg-bg-tertiary rounded-lg p-3 border border-border space-y-2">
                      <header className="flex items-center justify-between gap-2">
                        <h3 className="text-xs text-text-muted uppercase tracking-wider">
                          {isShortFilm ? 'Scene structure' : 'Clip structure'}
                        </h3>
                        <DirectorTimelineIconButton />
                      </header>
                      <StructureView
                        plannedClips={plannedClips}
                        energyBias={energyBias}
                        localBias={localBias}
                        setLocalBias={setLocalBias}
                        sliderRef={sliderRef}
                        setEnergyBias={isShortFilm ? shortFilmSetPacingBias : setEnergyBias}
                        loading={loading}
                        totalClipDuration={totalClipDuration}
                        beatDistribution={beatDistribution}
                        confirmStructure={confirmStructure}
                        isActive={atStep('structure')}
                        isShortFilm={isShortFilm}
                      />
                    </section>
                  )}

                  {/* Scene description card — moved from the middle
                      column (DirectorPlanColumn) so the user sees the
                      speaker mapping + brief inputs right next to the
                      upload/clip structure, in the same conversation
                      surface. Defaults to **collapsed**: the chevron
                      toggle in the header reveals the StyleForm /
                      speaker-mapping inputs only when the user wants
                      to revisit them. Past the style step the card
                      stays reachable but compact so the chat column
                      doesn't bloat. */}
                  {(atStep('style') || pastStep('style')) && (
                    <section className="bg-bg-tertiary rounded-lg p-3 border border-border space-y-2">
                      <header className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => setSceneDescriptionOpen(v => !v)}
                          aria-expanded={sceneDescriptionOpen}
                          aria-controls="chat-scene-description-panel"
                          className="flex items-center gap-1 text-xs text-text-muted uppercase tracking-wider hover:text-text-secondary transition-colors min-w-0"
                        >
                          {sceneDescriptionOpen ? <ChevronDown size={11} className="shrink-0" /> : <ChevronRight size={11} className="shrink-0" />}
                          <h3 className="truncate">Scene description</h3>
                        </button>
                        <div className="flex items-center gap-2 shrink-0">
                          {isShortFilm && (
                            <span className="text-2xs text-text-muted">
                              {shortFilmTargetDuration}s film
                            </span>
                          )}
                          {/* Compact progress hint: a green dot + count
                              mirrors the step badge so the user can see
                              at-a-glance whether the brief is locked in
                              without expanding the card. */}
                          <span className="inline-flex items-center gap-1 text-2xs text-emerald-400">
                            <Check size={10} />
                            Complete
                          </span>
                        </div>
                      </header>
                      {sceneDescriptionOpen && (
                        <div id="chat-scene-description-panel" className="space-y-3 pt-1">
                          <StyleForm
                            speakers={speakers}
                            speakerMappings={speakerMappings}
                            speakerSamples={speakerSamples}
                            setSpeakerMapping={setSpeakerMapping}
                            insertSpeakerMention={insertSpeakerMention}
                            isActive={atStep('style')}
                            isShortFilm={isShortFilm}
                            isStoryPath={isStoryPath}
                          />
                          {isStoryPath && referenceImage && (
                            <div className="flex items-center gap-2 text-2xs text-text-muted">
                              <span>Reference attached · {shortFilmCharacters.length} characters</span>
                            </div>
                          )}
                        </div>
                      )}
                    </section>
                  )}
                </>
              )}
              {!isShortFilm && referencesOpen && (
                <div className="space-y-2">
                  <DirectorReferenceInputs
                    referenceImage={referenceImage}
                    refImagePreview={refImagePreview}
                    setReferenceImage={setReferenceImage}
                    disabled={loading}
                    imageOnly
                  />
                  {/* Character / Location / Voice refs moved here from
                      the inline section above. They live alongside the
                      reference photo because all visual anchors belong
                      together in the user's mental model. The CLIP
                      STRUCTURE card deliberately does NOT live here —
                      it's an audio-surface artifact and stays in the
                      audio window (see the !referencesOpen branch). */}
                  <AdditionalRefsSection />
                </div>
              )}
              {isShortFilm && referenceImage && (
                <CharacterNaming
                  characters={shortFilmCharacters}
                  setCharacters={shortFilmSetCharacters}
                />
              )}
            </div>
          </SystemBubble>
        )}

        {/* Analysis result — hidden for story path */}
        {/* The "Analysis complete" badge (AnalysisSummary) used to live
            here as a system bubble, but the user asked to consolidate
            it inside the CLIP STRUCTURE card on the middle column so
            the planning surface is the single source of truth for the
            post-analyze view. The reference photo inputs are already
            rendered above inside the side-by-side audio+reference
            layout, so nothing extra is needed here. */}

        {/* Error — rich dismissible banner. Classifies the error
            (OOM, VRAM, network, LoRA mismatch, …), shows the failing
            phase as a badge, lists pre-baked remediation steps, and
            exposes the raw backend message in a collapsible technical-
            details panel + copy-to-clipboard button. Accepts both
            legacy strings and the new typed DirectorError, so this is
            backwards-compatible with older call sites. */}
        {error && (
          <DirectorErrorBanner
            error={error}
            pipelineStatus={useStore.getState().pipelineStatus}
            onDismiss={clearDirectorError}
          />
        )}

        {/* Structure step — the actual StructureView (clip structure,
            pacing slider, "X clips confirmed") is rendered by
            DirectorPlanColumn in the middle column. The chat column
            stays focused on inputs (upload / references) so the user
            isn't reading the same block twice. */}


        {/* Style step */}
        {!isShortFilm && (atStep('style') || pastStep('style')) && (
          /* ScriptAttachButton moved to the composer (left of Send) so
             the chat column reads as a clean upload+reference surface.
             The system bubble itself was removed entirely — there is
             no longer any prose or inputs in this step. */
          null
        )}
        {isStoryPath && (atStep('style') || pastStep('style')) && (
          <SystemBubble>
            <p className="text-xs text-text-secondary mb-2">
              {directorUsesOmniManifest
                ? 'Set up your short film with ordered H3 Omni image, video, and audio references, then set the target duration.'
                : 'Set up your short film. Upload a reference photo, name your characters, and set the target duration.'}
            </p>
            <div className="space-y-3">
              {atStep('style') && (
                <>
                  <DirectorReferenceInputs
                    referenceImage={referenceImage}
                    refImagePreview={refImagePreview}
                    setReferenceImage={setReferenceImage}
                  />
                  {referenceImage && (
                    <CharacterNaming
                      characters={shortFilmCharacters}
                      setCharacters={shortFilmSetCharacters}
                    />
                  )}
                  <DirectorTargetDurationControl />
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={shortFilmNarrative}
                      onChange={e => shortFilmSetNarrative(e.target.checked)}
                      className="accent-accent-blue"
                    />
                    <div>
                      <span className="text-2xs text-text-primary">Narrative storytelling</span>
                      <p className="text-2xs text-text-muted leading-tight">
                        Structure scenes around a character arc with rising tension and emotional resolution
                      </p>
                    </div>
                  </label>
                </>
              )}
              {/* ScriptAttachButton moved to the composer (left of Send). */}
            </div>
          </SystemBubble>
        )}
        {isStoryPath && pastStep('style') && referenceImage && refImagePreview && (
          <UserBubble>
            <div className="flex items-center gap-2 text-xs text-text-primary">
              <img src={refImagePreview} alt="Ref" className="w-8 h-8 object-cover rounded border border-border" />
              <span>{shortFilmTargetDuration}s film</span>
            </div>
          </UserBubble>
        )}

        {/* Plan / review / generate steps (StyleForm textarea + speakers,
            planning streams, image prompts review, image gen progress,
            plan_video stream, video prompts review) all moved to the
            middle DirectorPlanColumn so the user only sees each surface
            once. The chat column is reserved for inputs + analysis
            feedback; pipeline status bubbles that the chat used to show
            are now part of the plan column too. */}

        <div ref={messagesEndRef} />
      </div>

      {/* Chat input bar — parent card provides horizontal padding.
          Removed the previous `border-t border-border` separator: it
          read as a stray hairline above the composer when the chat
          column already sits inside its own card with a visible
          boundary. The pl-3/pr-3 (12px each side) matches the
          SystemBubble's pl-3 inset above so the textarea + buttons
          align with the reference / upload cards' content edge. */}
      <div className="space-y-2 pl-3 pr-3">
        <div className="flex items-center gap-2">
          {/* Scene/character description textarea — narrower than the
              full chat column so the action buttons can stack
              vertically on the right. The textarea uses a fixed height
              (h-[108px]) so it matches the 3-button stack on the right
              (each button is p-2 × 16px icon = 32px tall; 3 × 32 + 2 × 6
              gap = 108px). `items-center` on the row keeps both
              children optically aligned (the textarea's content sits
              on its first text line, the button column is vertically
              centred beside it). */}
          <div className="relative flex-1 min-w-0">
            <AutoResizeTextarea
              value={mvGenerateSetup ? songDescription : chatInput}
              onChange={e => {
                const v = e.target.value
                setDraftQueueConfirmation(null)
                if (mvGenerateSetup) { setSongDescription(v); return }
                setChatInput(v)
                if (step === 'style') setSceneDescription(v)
              }}
              onKeyDown={e => {
                // Reversed behavior (per user request): plain Enter inserts
                // a newline (default textarea behavior, no preventDefault);
                // Shift+Enter is what submits the brief so accidental
                // presses mid-typing don't fire the pipeline.
                if (e.key === 'Enter' && e.shiftKey && chatInputEnabled) {
                  e.preventDefault()
                  handleChatSubmit()
                }
              }}
              placeholder={chatInputPlaceholder}
              disabled={!chatInputEnabled}
              rows={3}
              minHeight={108}
              maxHeight={108}
              className="w-full h-[108px] bg-bg-tertiary border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:border-accent-blue transition-colors disabled:opacity-50 disabled:cursor-not-allowed scrollbar-visible"
            />
            {/* Enter/Shift+Enter hint removed: the user inverted the
                default chat convention so plain Enter inserts a newline
                and Shift+Enter sends. The shortcut now matches every
                word processor / messaging app the user is used to. */}
          </div>
          {/* Action stack — three square buttons stacked vertically so
              they read as a primary action column beside the textarea.
              `justify-center` keeps the buttons vertically centred
              against the textarea's full height. */}
          <div className="flex shrink-0 h-[108px] flex-col justify-center gap-1.5">
            <ScriptAttachButton
              attached={attachedScript}
              loading={scriptLoading}
              onPick={handleScriptFile}
            />
            <button
              onClick={handleChatSubmit}
              disabled={!chatInputEnabled || draftQueuePending || !(mvGenerateSetup ? songDescription : chatInput).trim()}
              className="p-2 rounded-lg bg-accent-blue text-white hover:bg-accent-blue-hover transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title={`${mvGenerateSetup ? 'Generate the song and start this Director project' : 'Start this Director project now'} (Shift+Enter · Cmd/Ctrl+Enter)`}
              aria-label={mvGenerateSetup ? 'Generate song and start Director project' : 'Start Director project now'}
            >
              {loading && (step === 'style' || isMusicVideo) && !draftQueuePending ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Send size={16} />
              )}
            </button>
            <button
              onClick={() => void handleQueueDraft()}
              disabled={!chatInputEnabled || draftQueuePending || directorQueueLoading || !(mvGenerateSetup ? songDescription : chatInput).trim()}
              className="p-2 rounded-lg bg-accent-blue/85 text-white hover:bg-accent-blue-hover transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title={
                mvGenerateSetup
                  ? `Generate the song, then hold the complete Director project in the paused queue (${directorQueueEntriesCount} pending) (Cmd/Ctrl+S)`
                  : `Add this complete Director project to the paused queue without starting it (${directorQueueEntriesCount} pending) (Cmd/Ctrl+S)`
              }
              aria-label={directorQueueEditingEntryId ? 'Save Director queue changes' : `Add Director project to queue (${directorQueueEntriesCount} pending)`}
            >
              {draftQueuePending || directorQueueLoading
                ? <Loader2 size={16} className="animate-spin" />
                : draftQueueConfirmation
                  ? <Check size={16} />
                  : <ListVideo size={16} />}
            </button>
          </div>
        </div>
        {/* Script status — always rendered (even when empty) so the
            composer row's vertical position stays fixed: removing the
            card on clear would collapse the layout by ~28px and
            visually nudge the textarea + buttons up. When no script
            is attached we show a muted placeholder matching the
            active card's footprint, including a disabled-looking
            remove (×) button on the right. */}
        <div
          role="status"
          aria-live="polite"
          className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-2xs ${
            attachedScript
              ? 'border-accent-blue/30 bg-accent-blue/10 text-accent-blue'
              : 'border-border bg-bg-tertiary text-text-muted'
          }`}
        >
          <FileText size={11} className="shrink-0" />
          <span className={`truncate min-w-0 flex-1 ${attachedScript ? '' : 'italic'}`}>
            {attachedScript ? attachedScript.filename : 'No script attached — click the orange icon to drop a .txt / .md / .pdf'}
          </span>
          {attachedScript ? (
            <>
              <span className="text-text-muted shrink-0">
                {attachedScript.charCount.toLocaleString()} chars
                {attachedScript.truncated ? ' · truncated' : ''}
              </span>
              <button
                type="button"
                onClick={() => { setAttachedScript(null); setScriptError('') }}
                aria-label="Remove script"
                title="Remove script"
                className="shrink-0 rounded p-0.5 text-text-muted hover:bg-bg-hover hover:text-text-primary transition-colors"
              >
                <X size={11} />
              </button>
            </>
          ) : (
            <span
              aria-hidden="true"
              className="shrink-0 rounded p-0.5 text-text-muted/50"
            >
              <X size={11} />
            </span>
          )}
        </div>
        {scriptError && (
          <p className="text-2xs text-red-400" role="alert">{scriptError}</p>
        )}
        {draftQueueConfirmation && (
          <div
            role="status"
            aria-live="polite"
            className="rounded-md border border-green-500/20 bg-green-500/5 px-2.5 py-2 text-2xs leading-relaxed text-indicator-success"
          >
            {draftQueueConfirmation}
          </div>
        )}
      </div>
    </div>
  )
}

// --- Sub-components ---

function CharacterNaming({
  characters, setCharacters,
}: {
  characters: ShortFilmCharacter[]
  setCharacters: (characters: ShortFilmCharacter[]) => void
}) {
  const addCharacter = () => {
    setCharacters([...characters, { name: '', description: '' }])
  }

  const updateCharacter = (index: number, field: 'name' | 'description', value: string) => {
    const updated = characters.map((c, i) =>
      i === index ? { ...c, [field]: value } : c
    )
    setCharacters(updated)
  }

  const removeCharacter = (index: number) => {
    setCharacters(characters.filter((_, i) => i !== index))
  }

  return (
    <div>
      <label className="text-xs text-text-muted uppercase tracking-wider block mb-1.5">
        <Users size={10} className="inline mr-1" />
        Name the Characters
      </label>
      <div className="space-y-1.5">
        {characters.map((char, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              type="text"
              value={char.name}
              onChange={e => updateCharacter(i, 'name', e.target.value)}
              placeholder={`Character ${i + 1} name`}
              className="flex-1 bg-bg-secondary border border-border rounded px-2 py-1 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue transition-colors"
            />
            <input
              type="text"
              value={char.description}
              onChange={e => updateCharacter(i, 'description', e.target.value)}
              placeholder="brief description"
              className="flex-1 bg-bg-secondary border border-border rounded px-2 py-1 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue transition-colors"
            />
            <button
              onClick={() => removeCharacter(i)}
              className="p-1 rounded hover:bg-bg-hover transition-colors shrink-0"
            >
              <X size={10} className="text-text-muted" />
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={addCharacter}
        className="mt-1.5 text-2xs text-accent-blue hover:text-accent-blue-hover transition-colors"
      >
        + Add character
      </button>
      <span className="text-2xs text-text-muted block mt-1">
        Name the people visible in the reference photo so the AI can identify them.
      </span>
    </div>
  )
}

function PathChooser({ onSelect }: { onSelect: (path: ShortFilmPath) => void }) {
  const paths = [
    { id: 'audio' as ShortFilmPath, label: 'Upload Audio', desc: 'Upload recorded dialogue', icon: Upload },
    { id: 'story' as ShortFilmPath, label: 'Describe a Story', desc: 'AI writes the script', icon: FileText },
  ]
  return (
    <div className="grid grid-cols-2 gap-2">
      {paths.map((p) => (
        <button
          key={p.id}
          onClick={() => onSelect(p.id)}
          className="p-3 rounded-lg border border-accent-blue/30 bg-bg-tertiary/50 hover:border-accent-blue hover:bg-accent-blue/5 cursor-pointer text-left transition-all"
        >
          <p.icon size={16} className="text-accent-blue mb-1.5" />
          <div className="text-xs font-medium text-text-primary">{p.label}</div>
          <div className="text-2xs text-text-muted mt-0.5">{p.desc}</div>
        </button>
      ))}
    </div>
  )
}

function UploadZone({
  dragOver, setDragOver, handleDrop, handleFile, loading, loadingMessage, audioFile, isShortFilm,
}: {
  dragOver: boolean
  setDragOver: (v: boolean) => void
  handleDrop: (e: React.DragEvent) => void
  handleFile: (file: File) => void
  loading: boolean
  /** Sub-status string from the analyze polling loop. Falls back
   *  to the default ("Analyzing audio..." / "Transcribing dialogue...")
   *  when null. */
  loadingMessage: string | null
  audioFile: File | null
  isShortFilm?: boolean
}) {
  // Whether the audio file was already accepted by the backend
  // (directorAudioPath populated after api.uploadImage succeeds).
  // Renders a small "Uploaded" badge so the user knows the file is
  // safe to swap or remove without losing the analysis result.
  const audioPathConfirmed = useStore(s => !!s.directorAudioPath)
  // Store action that clears both the in-memory file and the durable
  // backend path so the next upload doesn't silently overwrite an old
  // analysis result on disk. Used by the remove button below.
  const clearAudio = useStore(s => s.directorSetAudioFile)
  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      /* min-h-[96px] keeps both the audio card and the reference photo
         card (next door in the 2-col grid) the same height so flex
         centering works in both. The parent card height is set here
         rather than inside each child branch. */
      className={`border-2 border-dashed rounded-lg p-4 text-center min-h-[96px] flex items-center justify-center transition-colors relative ${
        dragOver ? 'border-accent-blue bg-accent-blue/10' : 'border-border hover:border-border-light'
      }`}
    >
      {loading ? (
        <div className="flex flex-col items-center gap-2">
          <Loader2 size={20} className="animate-spin text-accent-blue" />
          {/* Sub-status (set by directorUploadAndAnalyze polling loop) takes
              precedence over the static fallback. Reflects backend phase:
              "Loading transcription model (first use downloads ~300MB)..." etc. */}
          <span className="text-xs text-text-muted text-center px-2">
            {loadingMessage || (isShortFilm ? 'Transcribing dialogue...' : 'Analyzing audio...')}
          </span>
        </div>
      ) : audioFile ? (
        /* audioFile state: stack the music icon and the filename on a
           vertical axis, then center inside the min-h card so the
           glyph + filename sit at the visual middle of the card. The
           "Uploaded" chip in the corner turns green once the backend
           has accepted the file (directorAudioPath is populated). */
        <>
          {/* Remove (×) button — anchored to the top-right corner so it
              doesn't shift the centered filename / icon stack. Same
              pattern used by ReferenceImageUpload and the script
              status row, so the affordance is consistent across every
              uploaded-card surface in the chat. */}
          <button
            type="button"
            onClick={() => clearAudio(null)}
            aria-label="Remove uploaded audio"
            title="Remove uploaded audio"
            className="absolute top-1.5 right-1.5 rounded-md p-1 text-text-muted bg-bg-primary/70 hover:bg-bg-hover hover:text-text-primary transition-colors"
          >
            <X size={11} />
          </button>
          <div className="flex flex-col items-center gap-1 px-6">
            <Music size={16} className="text-text-muted" />
            <span className="text-xs text-text-secondary truncate max-w-full">{audioFile.name}</span>
            {audioPathConfirmed && (
              <span className="mt-0.5 inline-flex items-center gap-1 text-2xs text-emerald-400">
                <Check size={9} /> Uploaded
              </span>
            )}
          </div>
        </>
      ) : (
        <label className="cursor-pointer flex flex-col items-center gap-1.5">
          <Music size={20} className="text-accent-blue/60" />
          <span className="text-xs text-text-secondary">{isShortFilm ? 'Drop dialogue audio or click to upload' : 'Drop a song or video or click to upload'}</span>
          <input
            type="file"
            accept={AUDIO_ACCEPT}
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0]
              if (file) handleFile(file)
            }}
          />
        </label>
      )}
    </div>
  )
}

/* Custom dropdown for choosing between uploading a track or generating
   one with the music model. Replaces the previous segmented toggle so
   the chat column reads as a single primary affordance with a list of
   choices — closer to the "Audio source" header other surfaces use.

   Behavior:
   - Click anywhere on the trigger button to toggle the menu.
   - Click an option to select it AND close the menu.
   - Click outside or press Escape to dismiss without changing.
   - The trigger always reflects the active option's label + icon so
     the user knows what they're currently set to without opening. */
function DirectorMusicSourceCombobox({ value, onChange }: {
  value: 'upload' | 'generate'
  onChange: (v: 'upload' | 'generate') => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // Outside-click + Escape dismissal. Each combobox is its own focus
  // scope — a single global listener trying to close every popover
  // would race with the DirectorTourOverlay's own keyboard handler.
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
      }
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const options: Array<{
    id: 'upload' | 'generate'
    label: string
    /** Tooltip shown on hover AND read by screen readers via aria-label.
     *  Replaces the old subtext line so the listbox stays one row tall. */
    hint: string
    Icon: React.ComponentType<{ size?: number; className?: string }>
  }> = [
    {
      id: 'upload',
      label: 'Upload a track',
      hint: 'Drop a song or video file from your machine',
      Icon: Music,
    },
    {
      id: 'generate',
      label: 'Generate a track',
      hint: 'Compose a song with the selected music model',
      Icon: Sparkles,
    },
  ]
  const current = options.find(o => o.id === value) || options[0]

  return (
    <div ref={rootRef} className="relative shrink-0 w-[170px]">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Audio source: ${current.label}`}
        title={current.hint}
        className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border bg-bg-tertiary text-xs transition-colors ${
          open
            ? 'border-accent-blue text-text-primary'
            : 'border-border hover:border-border-light text-text-primary'
        }`}
      >
        <current.Icon size={14} className="text-accent-blue shrink-0" />
        <span className="flex-1 text-left font-medium whitespace-nowrap">{current.label}</span>
        <ChevronDown size={14} className={`text-text-muted transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label="Audio source"
          className="absolute z-30 left-0 right-0 mt-1 rounded-lg border border-border bg-bg-secondary shadow-2xl py-1"
        >
          {options.map(opt => {
            const active = opt.id === value
            return (
              <li key={opt.id} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => { onChange(opt.id); setOpen(false) }}
                  title={opt.hint}
                  aria-label={`${opt.label} — ${opt.hint}`}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors ${
                    active
                      ? 'bg-accent-blue/15 text-text-primary'
                      : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                  }`}
                >
                  <opt.Icon size={13} className={`shrink-0 ${active ? 'text-accent-blue' : 'text-text-muted'}`} />
                  <span className="flex-1 font-medium whitespace-nowrap">{opt.label}</span>
                  {active && <Check size={12} className="text-accent-blue shrink-0" />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/* Peer button to the audio-source combobox. Opens/closes the
   References panel (reference photo + character/location refs +
   voice ref). Sits on the right half of the header row so the two
   affordances are visually balanced — both 50% wide, same border +
   padding treatment, same height.

   The button reflects its open/closed state with a coloured bottom
   border so the user sees whether the panel below is expanded. The
   aria-expanded + aria-controls pair makes the toggle state
   available to screen readers and integrates with keyboard nav. */
function ReferencesTabButton({ active, onClick }: {
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      aria-expanded={active}
      aria-label="References panel"
      onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg border bg-bg-tertiary text-xs font-medium transition-colors ${
        active
          ? 'border-accent-blue text-accent-blue'
          : 'border-border text-text-secondary hover:text-text-primary hover:border-border-light'
      }`}
    >
      <ImageIcon size={13} className={active ? 'text-accent-blue' : 'text-text-muted'} />
      <span>References</span>
    </button>
  )
}

/* Audio source panel — extracted so the parent DirectorChat can
   swap it in/out without the rest of the layout caring about which
   mode is active. The combobox + References button above own the
   "which panel is showing" decision; this component just renders
   whichever input the combobox picked. */
function AudioSourcePanel({
  dragOver, setDragOver, handleDrop, handleFile,
  loading, loadingMessage, audioFile, isShortFilm,
  musicSource, pipelineLoading,
}: {
  dragOver: boolean
  setDragOver: (v: boolean) => void
  handleDrop: (e: React.DragEvent) => void
  handleFile: (file: File) => void
  loading: boolean
  loadingMessage: string | null
  audioFile: File | null
  isShortFilm?: boolean
  musicSource: 'upload' | 'generate'
  pipelineLoading: boolean
}) {
  // Generate mode without an audio file shows the song-description
  // composer so the user can describe what they want before sending.
  if (!isShortFilm && musicSource === 'generate' && !audioFile) {
    if (pipelineLoading) return null
    return <DirectorSongSetup />
  }
  // Upload mode (or Generate after an audio file has been written)
  // shows the standard audio drop zone.
  return (
    <>
      <UploadZone
        dragOver={dragOver}
        setDragOver={setDragOver}
        handleDrop={handleDrop}
        handleFile={handleFile}
        loading={loading && loading}
        loadingMessage={loadingMessage}
        audioFile={audioFile}
        isShortFilm={isShortFilm}
      />
      {/* Keep the newest track-generation activity at the bottom so
          the chat scroll anchor reveals it. Only renders during an
          active generate-mode run. */}
      {!isShortFilm && musicSource === 'generate' && pipelineLoading && (
        <div className="flex items-center gap-2 py-2">
          <Loader2 size={14} className="animate-spin text-accent-blue" />
          <span className="text-xs text-text-muted">{loadingMessage || 'Generating…'}</span>
        </div>
      )}
    </>
  )
}

function ReferenceImageUpload({
  referenceImage, refImagePreview, setReferenceImage,
}: {
  referenceImage: File | null
  refImagePreview: string | null
  setReferenceImage: (file: File | null) => void
}) {
  // The image-strength slider that used to live under this card was
  // moved to the right-hand Generation Options column
  // (<ReferenceImageStrengthSlider />). Keeping the card body focused
  // on the photo preview / drop zone.
  const [dragOver, setDragOver] = useState(false)
  // Whether the reference photo was already accepted by the backend
  // (directorReferenceImagePath is populated after api.uploadImage).
  // The "Uploaded" chip confirms the image is on disk server-side so
  // swapping or removing it later won't lose the anchor.
  const refPathConfirmed = useStore(s => !!s.directorReferenceImagePath)

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file && file.type.startsWith('image/')) setReferenceImage(file)
  }, [setReferenceImage])

  return (
    <div className="space-y-2">
      {referenceImage && refImagePreview ? (
        /* Reference loaded state: the photo itself fills the card and
           the caption sits at the bottom of the image. Center the
           caption block by wrapping the inner label in a flex column
           so the image (h-24) + caption read as one centered unit. The
           "Uploaded" chip in the corner turns green once the backend
           has accepted the file (directorReferenceImagePath is set). */
        <div className="relative min-h-[96px] flex items-center justify-center">
          <label className="cursor-pointer block w-full">
            <img
              src={refImagePreview}
              alt="Reference"
              className="w-full h-24 object-cover rounded-lg border border-border hover:border-accent-blue transition-colors"
              title="Click to change photo"
            />
            <input
              type="file"
              accept={IMAGE_ACCEPT}
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) setReferenceImage(f) }}
            />
          </label>
          <button
            onClick={() => setReferenceImage(null)}
            className="absolute top-1.5 right-1.5 bg-bg-primary/80 rounded-full p-1 hover:bg-bg-hover transition-colors"
            title="Remove"
          >
            <X size={12} className="text-text-muted" />
          </button>
          <span className="absolute bottom-1.5 left-1.5 text-2xs text-white/80 bg-black/50 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
            Reference photo &middot; click to change
            {refPathConfirmed && <Check size={9} className="text-emerald-400" />}
          </span>
        </div>
      ) : (
        /* Empty state: min-h matches the audio card next door so the
           2-col row reads as aligned; flex centering pulls the icon +
           helper text to the visual middle of the card. */
        <label
          className={`cursor-pointer block border-2 border-dashed rounded-lg p-4 text-center min-h-[96px] flex items-center justify-center transition-colors ${
            dragOver ? 'border-accent-blue bg-accent-blue/10' : 'border-border hover:border-border-light'
          }`}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <div className="flex flex-col items-center gap-1.5">
            <ImageIcon size={20} className="text-accent-blue/60" />
            <span className="text-xs text-text-secondary">Drop reference photo or click to upload</span>
          </div>
          <input
            type="file"
            accept={IMAGE_ACCEPT}
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) setReferenceImage(f) }}
          />
        </label>
      )}
      {/* Image Strength slider used to live inline under the reference
          photo card. The user asked to move it to the right-hand
          Generation Options column so the chat column stays focused
          on input affordances. The slider itself is rendered by
          <ReferenceImageStrengthSlider/> in DirectorGenerationOptions. */}
    </div>
  )
}

function ScriptAttachButton({
  attached,
  loading,
  onPick,
}: {
  attached: { filename: string; charCount: number; truncated: boolean } | null
  loading: boolean
  onPick: (file: File) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const title = attached
    ? `Script attached: ${attached.filename}`
    : loading
      ? 'Reading script…'
      : 'Attach a script (.txt, .md, .pdf)'
  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={loading}
        className={`p-2 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
          attached
            ? 'bg-accent-blue text-white hover:bg-accent-blue-hover'
            : 'bg-accent-blue/85 text-white hover:bg-accent-blue-hover'
        }`}
        title={title}
        aria-label={attached ? `Script attached: ${attached.filename}` : 'Attach script'}
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={SCRIPT_ACCEPT}
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0]
          if (f) onPick(f)
          if (inputRef.current) inputRef.current.value = ''
        }}
      />
    </>
  )
}

function DirectorReferenceInputs({
  referenceImage,
  refImagePreview,
  setReferenceImage,
  disabled = false,
  /** When true, skip the AdditionalRefsSection so callers can render the
   *  ReferenceImageUpload next to another drop zone in a single row
   *  (the upload step pairs audio + reference photo side-by-side). The
   *  remaining refs still render — callers that use imageOnly=true must
   *  render <AdditionalRefsSection/> themselves, immediately below the
   *  inline row, so the section ordering is preserved. */
  imageOnly = false,
}: {
  referenceImage: File | null
  refImagePreview: string | null
  setReferenceImage: (file: File | null) => void
  disabled?: boolean
  imageOnly?: boolean
}) {
  const usesOmniManifest = useStore(s => {
    const selected = s.selectedModelPerMode.video || 'ltx2_22B_distilled_1_1'
    return selected.toLowerCase().startsWith('minimax_h3_ref2va')
      || s.models.find(model => model.model_type === selected)
        ?.director?.video_strategy === 'omni_reference'
  })

  if (usesOmniManifest) {
    return <OmniReferenceSection scope="director" disabled={disabled} />
  }
  return (
    <>
      <ReferenceImageUpload
        referenceImage={referenceImage}
        refImagePreview={refImagePreview}
        setReferenceImage={setReferenceImage}
      />
      {!imageOnly && <AdditionalRefsSection />}
    </>
  )
}

function DirectorAdvancedAccordion() {
  const [open, setOpen] = useState(false)
  const videoModel = useStore(s => s.selectedModelPerMode.video || 'ltx2_22B_distilled_1_1')
  const videoStepsByModel = useStore(s => s.directorVideoInferenceStepsByModel)
  const setVideoSteps = useStore(s => s.setDirectorVideoInferenceSteps)
  const maxShotFramesByModel = useStore(s => s.directorVideoMaxShotFramesByModel)
  const setMaxShotFrames = useStore(s => s.setDirectorVideoMaxShotFrames)
  const turboModeByModel = useStore(s => s.directorH3TurboModeByModel)
  const turboPresetByModel = useStore(s => s.directorH3TurboPresetByModel)
  const savedVideoLoras = useStore(s => s.savedLoraPerMode.video)
  const directorResolution = useStore(s => s.directorResolution)
  const directorAspectRatio = useStore(s => s.directorAspectRatio)
  const totalVramGb = useStore(s => s.systemStats?.gpu.vram_total_gb ?? 0)
  const [directorVideoOptions, setDirectorVideoOptions] = useState<ModelOptions | null>(null)
  const shotImageSupport = useStore(s => s.models.find(
    model => model.model_type === videoModel,
  )?.director?.shot_image_support)
  const shotImageGuidance = useStore(s => s.directorShotImageGuidance)
  const setShotImageGuidance = useStore(s => s.setDirectorShotImageGuidance)
  const hasVisualReferences = useStore(s => Boolean(
    s.directorReferenceImage
    || s.directorReferenceImagePath
    || s.directorCharacterRefs.length
    || s.directorCharacterRefPaths.length
    || s.directorLocationRefs.length
    || s.directorLocationRefPaths.length
    || (
      s.models.find(model => model.model_type === videoModel)
        ?.director?.video_strategy === 'omni_reference'
      && s.directorH3References.some(
        reference => reference.type === 'image' || reference.type === 'video',
      )
    )
  ))
  const generateShotImages = directorWillGenerateShotImages(
    shotImageSupport,
    shotImageGuidance,
    hasVisualReferences,
  )

  // Image post-processing
  const imgUpsampling = useStore(s => s.directorImageSpatialUpsampling)
  const setImgUpsampling = useStore(s => s.setDirectorImageSpatialUpsampling)
  const imgGrain = useStore(s => s.directorImageFilmGrainIntensity)
  const setImgGrain = useStore(s => s.setDirectorImageFilmGrainIntensity)
  const imgGrainSat = useStore(s => s.directorImageFilmGrainSaturation)
  const setImgGrainSat = useStore(s => s.setDirectorImageFilmGrainSaturation)

  // Video post-processing
  const vidUpsampling = useStore(s => s.directorVideoSpatialUpsampling)
  const setVidUpsampling = useStore(s => s.setDirectorVideoSpatialUpsampling)
  const vidGrain = useStore(s => s.directorVideoFilmGrainIntensity)
  const setVidGrain = useStore(s => s.setDirectorVideoFilmGrainIntensity)
  const vidGrainSat = useStore(s => s.directorVideoFilmGrainSaturation)
  const setVidGrainSat = useStore(s => s.setDirectorVideoFilmGrainSaturation)
  const vidSelfRefiner = useStore(s => s.directorVideoSelfRefiner)
  const setVidSelfRefiner = useStore(s => s.setDirectorVideoSelfRefiner)

  // Fetch the selected Director model's sampling contract without routing it
  // through Studio's global modelOptions/params state. That separation is the
  // point of this control: changing steps in either surface must not silently
  // modify the other one.
  useEffect(() => {
    let cancelled = false
    fetchModelOptions(videoModel)
      .then(options => {
        if (cancelled) return
        setDirectorVideoOptions(options)
        const rawDefault = options.default_num_inference_steps
        if (rawDefault != null && Number.isFinite(rawDefault)) {
          const current = useStore.getState().directorVideoInferenceStepsByModel[videoModel]
          if (current == null) setVideoSteps(videoModel, rawDefault)
        }
      })
      .catch(() => {
        if (!cancelled) setDirectorVideoOptions(null)
      })
    return () => { cancelled = true }
  }, [setVideoSteps, videoModel])

  const activeDirectorVideoOptions = directorVideoOptions?.model_type === videoModel
    ? directorVideoOptions
    : null
  const videoStepsMin = Math.max(
    1,
    Math.round(Number(activeDirectorVideoOptions?.inference_steps_min ?? 1)),
  )
  const videoStepsMax = Math.max(
    videoStepsMin,
    Math.round(Number(activeDirectorVideoOptions?.inference_steps_max ?? 50)),
  )
  const clampVideoSteps = (value: number) => (
    Math.max(videoStepsMin, Math.min(videoStepsMax, Math.round(value)))
  )
  const rawDefaultVideoSteps = activeDirectorVideoOptions?.default_num_inference_steps
  const defaultVideoSteps = rawDefaultVideoSteps == null
    ? null
    : clampVideoSteps(rawDefaultVideoSteps)
  const configuredVideoSteps = videoStepsByModel[videoModel]
  const videoSteps = activeDirectorVideoOptions?.lock_inference_steps
    ? defaultVideoSteps
    : (configuredVideoSteps == null
        ? defaultVideoSteps
        : clampVideoSteps(configuredVideoSteps))
  const videoStepsLocked = activeDirectorVideoOptions?.lock_inference_steps === true
  const resolvedVideoResolution = resolveResolution(
    activeDirectorVideoOptions,
    directorResolution,
    directorAspectRatio,
  )
  const windowRecommendation = recommendedWindowProfile(
    activeDirectorVideoOptions?.director_memory_policy
      || activeDirectorVideoOptions?.sliding_window_memory_policy,
    resolvedVideoResolution,
    totalVramGb,
  )
  const safeShotFrames = windowRecommendation?.frames ?? null
  const manualMaxShotFrames = maxShotFramesByModel[videoModel] ?? null
  const framesMinimum = activeDirectorVideoOptions?.frames_minimum ?? 1
  const framesMaximum = activeDirectorVideoOptions?.frames_maximum ?? framesMinimum
  const framesStep = activeDirectorVideoOptions?.frames_steps ?? 1
  const nativeShotChoices = [124, 158, 175, 243, 345].filter(frames => (
    frames >= framesMinimum
    && frames <= framesMaximum
    && (frames - framesMinimum) % Math.max(1, framesStep) === 0
  ))
  const turboOption = activeDirectorVideoOptions?.minimax_h3_turbo
  const turboPresets = turboOption?.presets?.length
    ? turboOption.presets
    : turboOption
      ? [{
          id: turboOption.preset_id,
          label: turboOption.version_label,
          status: 'validated',
          filename: turboOption.filename,
          steps: turboOption.steps,
          weight: turboOption.weight,
          weight_min: 0.5,
          weight_max: 1.0,
          description: turboOption.guide,
          revision: '',
        }]
      : []
  const selectedTurboPreset = (
    turboPresets.find(preset => preset.id === turboPresetByModel[videoModel])
    || turboPresets.find(preset => preset.id === turboOption?.preset_id)
    || turboPresets[0]
  )
  const turboSelected = Boolean(
    turboOption && selectedTurboPreset
    && turboModeByModel[videoModel] === true
    && savedVideoLoras?.activated_loras?.includes(selectedTurboPreset.filename)
  )

  const upsamplingOptions = [
    { value: '', label: 'Off' },
    { value: 'lanczos1.5', label: 'Lanczos 1.5×' },
    { value: 'lanczos2', label: 'Lanczos 2×' },
  ]

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs text-text-secondary hover:bg-bg-hover transition-colors"
      >
        <span>Advanced</span>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>
      {open && (
        <div className="px-2.5 pb-2.5 space-y-3">
          {/* Director mode owns this accordion; the shared Studio Advanced
              drawer is not mounted while DirectorChat is active. */}
          <DirectorH3Optimizations />

          {shotImageSupport && shotImageSupport !== 'required' && (
            <div className="space-y-1 pt-1">
              <label className="text-xs text-text-secondary block">Shot image guidance</label>
              <select
                value={shotImageGuidance}
                onChange={e => setShotImageGuidance(e.target.value as DirectorShotImageGuidance)}
                className="w-full bg-bg-tertiary border border-border rounded-lg px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent-blue"
              >
                <option value="auto">Auto (recommended)</option>
                <option value="prompt_only">
                  {shotImageSupport === 'direct_references' ? 'Direct references only' : 'Prompt only'}
                </option>
                <option value="generate">Generate shot images</option>
              </select>
              <p className="text-2xs text-text-muted">
                {shotImageSupport === 'direct_references'
                  ? shotImageGuidance === 'generate'
                    ? 'Creates a composition image for each shot before H3 uses the references.'
                    : !hasVisualReferences
                      ? 'Add at least one main, character, or location image, or choose generated shot images.'
                    : 'H3 uses your character and location references directly; no image model runs.'
                  : generateShotImages
                    ? 'Creates start frames because visual references are present or generation was requested.'
                    : 'H3 renders each scene directly from its video prompt.'}
              </p>
            </div>
          )}
          {/* IMAGE section */}
          {generateShotImages && <div className="space-y-2">
            <div className="text-2xs text-text-muted uppercase tracking-wider">Image</div>

            <div>
              <label className="text-xs text-text-secondary block mb-1">Upsampling</label>
              <select
                value={imgUpsampling}
                onChange={e => setImgUpsampling(e.target.value)}
                className="w-full bg-bg-tertiary border border-border rounded-lg px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent-blue"
              >
                {upsamplingOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <p className="text-2xs text-text-muted mt-0.5">
                Render then upscale the start image. Adds time per shot.
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-text-secondary">Film grain</label>
                <span className="text-2xs text-text-muted tabular-nums">{imgGrain.toFixed(2)}</span>
              </div>
              <input
                type="range" min={0} max={1} step={0.01} value={imgGrain}
                onChange={e => setImgGrain(parseFloat(e.target.value))}
                className="w-full"
              />
              <p className="text-2xs text-text-muted mt-0.5">
                Aesthetic film-grain texture. 0 = off.
              </p>
              {imgGrain > 0 && (
                <div className="mt-1.5">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-2xs text-text-muted">Grain saturation</label>
                    <span className="text-2xs text-text-muted tabular-nums">{imgGrainSat.toFixed(2)}</span>
                  </div>
                  <input
                    type="range" min={0} max={1} step={0.01} value={imgGrainSat}
                    onChange={e => setImgGrainSat(parseFloat(e.target.value))}
                    className="w-full"
                  />
                </div>
              )}
            </div>
          </div>}

          {/* VIDEO section */}
          <div className="space-y-2 pt-1 border-t border-border">
            <div className="text-2xs text-text-muted uppercase tracking-wider pt-2">Video</div>

            <div title="Applies to every newly generated Director shot and is saved with the project for later repair or regeneration.">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-text-secondary">
                  {activeDirectorVideoOptions?.inference_steps_label || 'Inference steps'}
                </label>
                <div className="flex items-center gap-1.5">
                  {!videoStepsLocked && !turboSelected && defaultVideoSteps != null && configuredVideoSteps != null
                    && configuredVideoSteps !== defaultVideoSteps && (
                    <button
                      type="button"
                      onClick={() => setVideoSteps(videoModel, defaultVideoSteps)}
                      className="text-2xs text-accent-blue hover:text-accent-blue/80"
                    >
                      Default
                    </button>
                  )}
                  <input
                    type="number"
                    min={videoStepsMin}
                    max={videoStepsMax}
                    step={1}
                    value={videoSteps ?? ''}
                    disabled={videoSteps == null || videoStepsLocked || turboSelected}
                    onChange={e => {
                      const value = Number(e.target.value)
                      if (Number.isFinite(value)) {
                        setVideoSteps(videoModel, clampVideoSteps(value))
                      }
                    }}
                    className="w-14 bg-bg-tertiary border border-border rounded px-1.5 py-0.5 text-xs text-text-primary text-center focus:outline-none focus:border-accent-blue disabled:opacity-50"
                  />
                </div>
              </div>
              <input
                type="range"
                min={videoStepsMin}
                max={videoStepsMax}
                step={1}
                value={videoSteps ?? 1}
                disabled={videoSteps == null || videoStepsLocked || turboSelected}
                onChange={e => setVideoSteps(
                  videoModel,
                  clampVideoSteps(Number(e.target.value)),
                )}
                className="w-full disabled:opacity-50"
              />
              <p className="text-2xs text-text-muted mt-0.5">
                {turboSelected
                  ? `H3 Turbo uses its ${selectedTurboPreset?.steps ?? turboOption?.steps ?? 6}-step recipe.`
                  : videoStepsLocked
                  ? 'Fixed by this model.'
                  : videoSteps == null
                    ? 'Loading model default...'
                    : activeDirectorVideoOptions?.inference_steps_help
                      || `Director setting for this model${defaultVideoSteps === videoSteps ? ' (default)' : ''}.`}
              </p>
            </div>

            {(activeDirectorVideoOptions?.director_memory_policy
              || activeDirectorVideoOptions?.sliding_window_memory_policy)
              && nativeShotChoices.length > 0 && (
              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <label className="text-xs text-text-secondary">Maximum planned shot</label>
                  <select
                    value={manualMaxShotFrames ?? ''}
                    onChange={event => setMaxShotFrames(
                      videoModel,
                      event.target.value ? Number(event.target.value) : null,
                    )}
                    className="bg-bg-tertiary border border-border rounded px-1.5 py-0.5 text-xs text-text-primary focus:outline-none focus:border-accent-blue"
                  >
                    <option value="">Auto</option>
                    {nativeShotChoices.map(frames => (
                      <option key={frames} value={frames}>
                        {formatSeconds(frames / (activeDirectorVideoOptions.fps || 24))}
                      </option>
                    ))}
                  </select>
                </div>
                <p className={`text-2xs ${
                  manualMaxShotFrames != null
                  && safeShotFrames != null
                  && manualMaxShotFrames > safeShotFrames
                    ? 'text-amber-400'
                    : 'text-text-muted'
                }`}>
                  {manualMaxShotFrames == null
                    ? safeShotFrames != null
                      ? `Auto plans at most ${formatSeconds(safeShotFrames / (activeDirectorVideoOptions.fps || 24))} per shot for ${resolvedVideoResolution} on ${totalVramGb.toFixed(0)} GB.`
                      : `Auto derives the one-pass limit from the selected canvas and GPU.`
                    : safeShotFrames != null && manualMaxShotFrames > safeShotFrames
                      ? `Manual override exceeds Auto's ${formatSeconds(safeShotFrames / (activeDirectorVideoOptions.fps || 24))} recommendation and may run out of VRAM.`
                      : `Manual native-shot limit. Director will plan dialogue and action to this duration.`}
                </p>
              </div>
            )}

            <div>
              <label className="text-xs text-text-secondary block mb-1">Upsampling</label>
              <select
                value={vidUpsampling}
                onChange={e => setVidUpsampling(e.target.value)}
                className="w-full bg-bg-tertiary border border-border rounded-lg px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent-blue"
              >
                {upsamplingOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <p className="text-2xs text-text-muted mt-0.5">
                Render then upscale the video. Adds time per shot.
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-text-secondary">Film grain</label>
                <span className="text-2xs text-text-muted tabular-nums">{vidGrain.toFixed(2)}</span>
              </div>
              <input
                type="range" min={0} max={1} step={0.01} value={vidGrain}
                onChange={e => setVidGrain(parseFloat(e.target.value))}
                className="w-full"
              />
              <p className="text-2xs text-text-muted mt-0.5">
                Aesthetic film-grain texture. 0 = off.
              </p>
              {vidGrain > 0 && (
                <div className="mt-1.5">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-2xs text-text-muted">Grain saturation</label>
                    <span className="text-2xs text-text-muted tabular-nums">{vidGrainSat.toFixed(2)}</span>
                  </div>
                  <input
                    type="range" min={0} max={1} step={0.01} value={vidGrainSat}
                    onChange={e => setVidGrainSat(parseFloat(e.target.value))}
                    className="w-full"
                  />
                </div>
              )}
            </div>

            {activeDirectorVideoOptions?.self_refiner === true && <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-text-secondary">Self refiner</label>
                <span className="text-2xs uppercase tracking-wider text-text-muted bg-bg-tertiary border border-border rounded px-1 py-px">
                  Experimental
                </span>
              </div>
              <select
                value={vidSelfRefiner}
                onChange={e => setVidSelfRefiner(Number(e.target.value))}
                className="w-full bg-bg-tertiary border border-border rounded-lg px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent-blue"
              >
                <option value={0}>Off</option>
                <option value={1}>P1-Norm</option>
                <option value={2}>P2-Norm</option>
              </select>
              <p className="text-2xs text-text-muted mt-0.5">
                Re-passes the rendered video through the refiner. May improve detail or introduce artifacts.
              </p>
            </div>}
          </div>
        </div>
      )}
    </div>
  )
}

function DirectorLoraAccordion() {
  // Resolve Director's per-shoot image and video models from saved
  // per-mode selections, falling back to the same Director defaults
  // the pipeline submission uses (useStore.ts:5574). The previous
  // fallback to `s.params.model_type` was wrong — that field carries
  // the CURRENTLY-ACTIVE Studio model, which on fresh launch is
  // whatever Studio happens to be in (usually video). On a fresh
  // launch, that meant Director's "Image LoRAs" accordion would
  // fetch the video model's LoRA dir and display LTX loras under
  // the image header. Falling back to a known image-class default
  // (flux2_klein_9b) instead of the active Studio model fixes that.
  const imageModel = useStore(s => s.selectedModelPerMode.image || 'flux2_klein_9b')
  const videoModel = useStore(s => s.selectedModelPerMode.video || 'ltx2_22B_distilled_1_1')
  const videoLorasDisabled = useStore(s => s.models.find(
    model => model.model_type === videoModel,
  )?.loras_disabled === true)
  const shotImageSupport = useStore(s => s.models.find(
    model => model.model_type === videoModel,
  )?.director?.shot_image_support)
  const shotImageGuidance = useStore(s => s.directorShotImageGuidance)
  const hasVisualReferences = useStore(s => Boolean(
    s.directorReferenceImage
    || s.directorReferenceImagePath
    || s.directorCharacterRefs.length
    || s.directorCharacterRefPaths.length
    || s.directorLocationRefs.length
    || s.directorLocationRefPaths.length
    || (
      s.models.find(model => model.model_type === videoModel)
        ?.director?.video_strategy === 'omni_reference'
      && s.directorH3References.some(
        reference => reference.type === 'image' || reference.type === 'video',
      )
    )
  ))
  const generateShotImages = directorWillGenerateShotImages(
    shotImageSupport,
    shotImageGuidance,
    hasVisualReferences,
  )
  const [imageOpen, setImageOpen] = useState(false)
  const [videoOpen, setVideoOpen] = useState(false)

  return (
    <div className="space-y-1">
      {/* Image LoRAs */}
      {generateShotImages && imageModel && (
        <div className="border border-border rounded-lg overflow-hidden">
          <button
            onClick={() => setImageOpen(!imageOpen)}
            className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs text-text-secondary hover:bg-bg-hover transition-colors"
          >
            <span>Image LoRAs</span>
            {imageOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
          {imageOpen && (
            <div className="px-2.5 pb-2">
              <DirectorLoraSelector mode="image" modelType={imageModel} />
            </div>
          )}
        </div>
      )}
      {/* Video LoRAs */}
      {videoModel && !videoLorasDisabled && (
        <div className="border border-border rounded-lg overflow-hidden">
          <button
            onClick={() => setVideoOpen(!videoOpen)}
            className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs text-text-secondary hover:bg-bg-hover transition-colors"
          >
            <span>Video LoRAs</span>
            {videoOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
          {videoOpen && (
            <div className="px-2.5 pb-2">
              <DirectorLoraSelector mode="video" modelType={videoModel} />
            </div>
          )}
        </div>
      )}
      {videoModel && videoLorasDisabled && (
        <p className="rounded-lg border border-amber-500/25 bg-amber-500/8 px-2.5 py-2 text-2xs leading-relaxed text-text-muted">
          Video LoRAs are disabled because this model already contains its Turbo and Mystic adapters.
        </p>
      )}
    </div>
  )
}

export function DirectorGenerationOptions() {
  const [optionsViewMode, setOptionsViewMode] = useState<'basic' | 'expert'>('basic')
  const audioFile = useStore(s => s.directorAudioFile)
  const fixedMediaStrength = useStore(s => {
    const selected = s.selectedModelPerMode.video || 'ltx2_22B_distilled_1_1'
    const model = s.models.find(item => item.model_type === selected)
    return directorModelUsesFixedMediaStrength(selected, model?.architecture)
  })

  return (
    <div className="space-y-3">
      <header className="flex items-center justify-between gap-2 border-b border-border/50 pb-2">
        <h3 className="text-xs text-text-muted uppercase tracking-wider font-semibold">
          Opções de Geração
        </h3>
        {/* Toggle Básico vs Avançado */}
        <div className="inline-flex p-0.5 rounded-md bg-bg-tertiary border border-border/60 text-2xs">
          <button
            type="button"
            onClick={() => setOptionsViewMode('basic')}
            className={`px-2 py-0.5 rounded font-medium transition-colors ${
              optionsViewMode === 'basic'
                ? 'bg-accent-blue text-white shadow-xs'
                : 'text-text-muted hover:text-text-primary'
            }`}
          >
            Básico
          </button>
          <button
            type="button"
            onClick={() => setOptionsViewMode('expert')}
            className={`px-2 py-0.5 rounded font-medium transition-colors ${
              optionsViewMode === 'expert'
                ? 'bg-accent-blue text-white shadow-xs'
                : 'text-text-muted hover:text-text-primary'
            }`}
          >
            Avançado
          </button>
        </div>
      </header>

      {/* Controles de LoRAs (sempre úteis) */}
      <DirectorLoraAccordion />

      {/* Em modo Básico, os parâmetros profundos de atenção e multiplicadores ficam recolhidos; em Expert, abertos para edição */}
      {optionsViewMode === 'expert' ? (
        <DirectorAdvancedAccordion />
      ) : (
        <div className="rounded-lg border border-border/40 bg-bg-tertiary/40 p-2 text-2xs text-text-muted text-center">
          Modo Básico ativo: parâmetros de atenção e latência usam as melhores recomendações automáticas do modelo.
        </div>
      )}

      {audioFile && !fixedMediaStrength && (
        <div className="pt-2 border-t border-border/50">
          <AudioScaleSlider />
        </div>
      )}
      <ReferenceImageStrengthSlider />
      <DirectorNegativePromptField />
    </div>
  )
}

/** Editable project-scoped "things to avoid" textarea. Auto-populated
 *  by directorGenerateNegativePrompt when the scene description is
 *  committed, but always editable so the user can add or remove terms
 *  before any subsequent generation. Persists on the backend via
 *  setDirectorNegativePrompt so reopening the project picks up the
 *  same prompt. */
function DirectorNegativePromptField() {
  const negativePrompt = useStore(s => s.directorNegativePrompt)
  const setNegativePrompt = useStore(s => s.directorSetNegativePrompt)
  const generateNegativePrompt = useStore(s => s.directorGenerateNegativePrompt)
  const sceneDescription = useStore(s => s.directorSceneDescription)
  // Local mirror so typing doesn't trigger a backend round-trip per
  // keystroke; the slice is updated on blur / regenerate click.
  const [draft, setDraft] = useState(negativePrompt)
  const [busy, setBusy] = useState(false)
  // Sync the local draft if the slice changes externally (project
  // reopened, automatic generation finished, etc.).
  useEffect(() => { setDraft(negativePrompt) }, [negativePrompt])
  const onBlur = () => {
    if (draft !== negativePrompt) void setNegativePrompt(draft)
  }
  const onRegenerate = async () => {
    if (!sceneDescription.trim()) return
    setBusy(true)
    try { await generateNegativePrompt() }
    finally { setBusy(false) }
  }
  return (
    <div className="pt-2 border-t border-border/50 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-2xs text-text-muted uppercase tracking-wider font-semibold">
          Negative prompt
        </label>
        <button
          type="button"
          onClick={onRegenerate}
          disabled={busy || !sceneDescription.trim()}
          title={
            sceneDescription.trim()
              ? 'Re-run the LLM to regenerate the project-scoped negative prompt from the current scene description'
              : 'Write a scene description first to enable regeneration'
          }
          className="inline-flex items-center gap-1 text-2xs text-text-muted hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          {busy ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
          <span>{busy ? 'Generating…' : 'Auto from scene'}</span>
        </button>
      </div>
      <textarea
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={onBlur}
        rows={3}
        placeholder="Comma-separated list of things the model should avoid — appended to the model's default negatives"
        className="w-full bg-bg-tertiary border border-border rounded px-2 py-1.5 text-2xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue transition-colors resize-none scrollbar-visible"
      />
      <p className="text-2xs text-text-muted leading-snug">
        Saved per project and applied to every clip generation. Edit any term to refine what this Director project avoids.
      </p>
    </div>
  )
}


export function StyleForm({
  speakers, speakerMappings, speakerSamples, setSpeakerMapping, insertSpeakerMention, isActive, isShortFilm, isStoryPath,
}: {
  speakers: string[]
  speakerMappings: ReturnType<typeof useStore.getState>['directorSpeakerMappings']
  speakerSamples: Record<string, string[]>
  setSpeakerMapping: (speakerId: string, name: string, role: 'rapping' | 'singing' | 'speaking' | '') => void
  insertSpeakerMention: (speakerId: string) => void
  isActive: boolean
  isShortFilm?: boolean
  isStoryPath?: boolean
}) {
  // Collapsible Speakers Detected block — defaults to open so the
  // speaker-to-name mapping is visible by default after analysis,
  // but the user can fold it to focus on the scene textarea when
  // they only need the chip-name workflow.
  const [speakersOpen, setSpeakersOpen] = useState(true)
  if (!isActive) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-text-muted">
          {isStoryPath ? 'Story submitted. Planning scenes and writing prompts...'
            : isShortFilm ? 'Story description submitted. Planning scenes...'
            : 'Scene description submitted. Planning shots...'}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {/* The "Describe the scene, characters, and visual style."
          paragraph was redundant with the SECTION DESCRIPTION header
          already rendered by DirectorPlanColumn — the user asked to
          drop it so the card opens directly into the Speaker Mapping
          / scene textarea inputs. The composer placeholder below
          ("Describe the scene and characters...") carries the same
          guidance without duplicating it as a static paragraph. */}

      {/* Speaker Mapping — hidden for story path (no audio = no detected speakers) */}
      {!isStoryPath && speakers.length >= 1 && (
        <div>
          <button
            type="button"
            onClick={() => setSpeakersOpen(v => !v)}
            aria-expanded={speakersOpen}
            className="flex items-center gap-1 text-xs text-text-muted uppercase tracking-wider w-full hover:text-text-secondary transition-colors mb-1"
          >
            {speakersOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            <span>Speakers Detected</span>
            <span className="text-2xs text-text-muted normal-case tracking-normal ml-1">
              ({speakerMappings.length})
            </span>
          </button>
          {speakersOpen && <>
            <div className="space-y-2">
              {speakerMappings.map((mapping) => (
                <div key={mapping.speakerId} className="bg-bg-tertiary rounded-lg p-2 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => insertSpeakerMention(mapping.speakerId)}
                      className="text-2xs px-1.5 py-0.5 rounded-full bg-accent-blue/20 text-accent-blue hover:bg-accent-blue/30 shrink-0 transition-colors"
                      title={`Insert @${mapping.speakerId} into description`}
                    >
                      {mapping.speakerId}
                    </button>
                    <input
                      type="text"
                      value={mapping.name}
                      onChange={e => setSpeakerMapping(mapping.speakerId, e.target.value, mapping.role)}
                      placeholder="e.g. man in green hoodie"
                      className="flex-1 bg-bg-secondary border border-border rounded px-2 py-1 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue transition-colors"
                    />
                    <select
                      value={mapping.role}
                      onChange={e => setSpeakerMapping(mapping.speakerId, mapping.name, e.target.value as typeof mapping.role)}
                      className="bg-bg-secondary border border-border rounded px-1.5 py-1 text-2xs text-text-secondary focus:outline-none focus:border-accent-blue transition-colors"
                    >
                      <option value="">role</option>
                      {!isShortFilm && <option value="rapping">rapping</option>}
                      {!isShortFilm && <option value="singing">singing</option>}
                      <option value="speaking">speaking</option>
                    </select>
                  </div>
                  {speakerSamples[mapping.speakerId] && (
                    <div className="text-2xs text-text-muted pl-1 italic">
                      {speakerSamples[mapping.speakerId].map((line, li) => (
                        <div key={li} className="truncate">&ldquo;{line}&rdquo;</div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <span className="text-2xs text-text-muted mt-1 block">
              Name each speaker so the director knows who to show. Click a chip to insert into description.
            </span>
          </>}
        </div>
      )}

      <p className="text-xs text-text-muted">
        {isStoryPath
          ? 'Describe your story in the input below and press send. The AI will plan everything.'
          : isShortFilm
            ? 'Type your story description in the input below and press send.'
            : 'Type your scene description in the input below and press send.'}
      </p>
    </div>
  )
}

/* Collapsible clip list — used by ImagePromptsReview and VideoPromptsReview
   to avoid rendering every clip card when there are dozens. Past
   CLIP_LIST_PREVIEW_THRESHOLD (12), only the first batch is rendered
   with a "Show all (N)" toggle so the column doesn't grow taller than
   the viewport on big music-video plans. */
const CLIP_LIST_PREVIEW_THRESHOLD = 12
function ClipListCollapser({ total, shown, onShowAll }: {
  total: number
  shown: number
  onShowAll: () => void
}) {
  if (total <= shown) return null
  return (
    <button
      type="button"
      onClick={onShowAll}
      className="w-full text-2xs text-accent-blue hover:text-accent-blue-hover py-2 rounded border border-dashed border-border hover:border-accent-blue/50 transition-colors"
      aria-label={`Show all ${total} clips`}
    >
      Show all {total} clips (currently showing {shown})
    </button>
  )
}

export function ImagePromptsReview({
  clipPlans, plannedClips, speakerMappings, editClipPlan, planPrompts,
  generateStartImages, loading, isActive, isShortFilm,
}: {
  clipPlans: ReturnType<typeof useStore.getState>['directorClipPlans']
  plannedClips: ReturnType<typeof useStore.getState>['directorPlannedClips']
  speakerMappings: ReturnType<typeof useStore.getState>['directorSpeakerMappings']
  editClipPlan: (index: number, field: 'video_prompt' | 'image_prompt', value: string) => void
  planPrompts: () => Promise<void>
  planVideoPrompts: () => Promise<void>
  generateStartImages: () => Promise<void>
  loading: boolean
  isActive: boolean
  isShortFilm?: boolean
}) {
  const clipImages = useStore(s => s.directorClipImages)
  const imageGenProgress = useStore(s => s.directorImageGenProgress)
  const pipelineId = useStore(s => s.pipelineId)
  const pipelineStatus = useStore(s => s.pipelineStatus)
  const rerunClipImage = useStore(s => s.rerunClipImage)
  const clearDirectorError = useStore(s => s.clearDirectorError)
  // Track which clip is currently being regenerated so the spinner can
  // sit on the right card instead of next to the batch-level Regenerate
  // button. Without this, regenerating Clip 7 in a 24-clip plan looks
  // indistinguishable from regenerating the whole batch.
  const [regeneratingIndex, setRegeneratingIndex] = useState<number | null>(null)
  // Show all clips collapsed by default past the threshold so the
  // column doesn't grow taller than the viewport on big music-video
  // plans (typical 24-32 clips). The user's "Show all" click expands
  // the list — useful for editing every prompt before generating.
  const [showAllClips, setShowAllClips] = useState(false)
  const visibleClipCount = showAllClips
    ? clipPlans.length
    : Math.min(clipPlans.length, CLIP_LIST_PREVIEW_THRESHOLD)
  // Re-run ONLY this clip via the dashboard backend endpoint. Used by
  // the per-clip ↻ Regenerate button that appears when a single
  // clip's image generation failed (e.g. transient CUDA OOM on one
  // card while the other 12 succeeded).
  const regenerateClip = async (clipIndex: number) => {
    if (!pipelineId) return
    setRegeneratingIndex(clipIndex)
    clearDirectorError()
    try {
      const plan = clipPlans[clipIndex]
      await rerunClipImage(pipelineId, clipIndex, plan?.image_prompt)
    } catch (e) {
      console.error('Per-clip regenerate failed:', e)
    } finally {
      setRegeneratingIndex(null)
    }
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs text-text-muted uppercase tracking-wider">Start Image Prompts</label>
        {isActive && (
          <button
            onClick={planPrompts}
            disabled={loading}
            className="text-2xs text-accent-blue hover:text-accent-blue-hover flex items-center gap-0.5"
          >
            <RotateCcw size={10} /> Regenerate
          </button>
        )}
      </div>

      {/* No inner scroll — the chat panel handles scrolling. The list
          extends to the natural total height of all clip cards. */}
      <div className="space-y-2">
        {clipPlans.slice(0, visibleClipCount).map((plan, i) => {
          const clip = plannedClips[i]
          const image = clipImages.find(item => item.clipIndex === i)
          // Per-clip regenerate spinner overrides the global status so
          // the badge stays accurate even when the user clicks ↻ on a
          // card whose imageGenProgress row says 'error' for a *different*
          // clip index. Without this override, regenerating Clip 7 in a
          // plan where Clip 3 already failed would leave the spinner
          // sitting on the wrong card.
          const status: 'pending' | 'generating' | 'ready' | 'failed' = regeneratingIndex === i
            ? 'generating'
            : image
              ? 'ready'
              : imageGenProgress?.status === 'error' && (imageGenProgress.failed_clip_index === i || imageGenProgress.current === i)
                ? 'failed'
                : imageGenProgress && imageGenProgress.current === i && imageGenProgress.status !== 'done'
                  ? 'generating'
                  : 'pending'
          // Per-clip error message captured by the store when the
          // generation loop's try/catch records the failing index.
          // Falls back to the global error when only one clip failed
          // and the store didn't get to stamp failed_clip_index.
          const clipError = status === 'failed'
            ? (imageGenProgress?.error_message
              || (imageGenProgress?.failed_clip_index === i ? imageGenProgress.error_message : null))
            : null
          const clipIsRegenerating = regeneratingIndex === i
          return (
            <div key={i} className="bg-bg-tertiary rounded-lg p-3 space-y-2 border border-border/80 hover:border-border transition-colors shadow-xs">
              <div className="flex items-center justify-between gap-1.5 text-2xs text-text-muted">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-semibold text-text-primary px-1.5 py-0.5 rounded bg-bg-secondary border border-border text-2xs">
                    {isShortFilm ? 'Shot' : 'Clip'} {i + 1}
                  </span>
                  <ShotStatus status={status} />
                  {clip && (
                    <>
                      <span className="tabular-nums font-mono text-text-secondary">{formatTime(clip.start)}–{formatTime(clip.end)}</span>
                      {!isShortFilm && <span className="text-text-muted">{clip.beat_count}b</span>}
                      <SectionBadge label={clip.section_label} />
                      {!isShortFilm && <EnergyDot energy={clip.energy} />}
                      {clip.dominant_speaker && (
                        <span className="text-accent-blue font-medium">
                          {speakerMappings.find(m => m.speakerId === clip.dominant_speaker)?.name || clip.dominant_speaker}
                        </span>
                      )}
                    </>
                  )}
                </div>
                {/* Per-clip Regenerate button — appears only when this
                    card's image generation failed. Saves the user from
                    having to re-roll the whole batch (and re-burn
                    VRAM on the 12 working clips) just to fix Clip 1. */}
                {status === 'failed' && !clipIsRegenerating && (
                  <button
                    type="button"
                    onClick={() => regenerateClip(i)}
                    className="text-2xs text-accent-blue hover:text-accent-blue-hover flex items-center gap-0.5"
                    title={`Re-generate the start image for Clip ${i + 1} only`}
                    aria-label={`Regenerate Clip ${i + 1}`}
                  >
                    <RotateCcw size={10} /> Regenerate this clip
                  </button>
                )}
                {clipIsRegenerating && (
                  <span className="text-2xs text-text-muted flex items-center gap-1">
                    <Loader2 size={10} className="animate-spin" /> Regenerating…
                  </span>
                )}
              </div>
              {/* Inline rich error banner for this clip. Shows the
                  classified error (OOM / LoRA / model / etc.) with
                  the suggested remediation, without polluting the
                  global directorError slot for a per-clip failure. */}
              {status === 'failed' && clipError && (
                <DirectorErrorBanner
                  error={clipError}
                  pipelineStatus={pipelineStatus}
                  clipIndex={i}
                  onDismiss={() => clearDirectorError()}
                  onRegenerateClip={regenerateClip}
                />
              )}
              <div className="flex gap-2.5 items-start">
                {image && (
                  <div className="relative shrink-0 w-16 h-16 rounded overflow-hidden border border-border/80 bg-black/40">
                    <img
                      src={image.file ? URL.createObjectURL(image.file) : getFileUrl(image.filename)}
                      alt={`Shot ${i + 1}`}
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <AutoResizeTextarea
                    value={plan.image_prompt}
                    onChange={e => editClipPlan(i, 'image_prompt', e.target.value)}
                    rows={3}
                    disabled={!isActive}
                    placeholder="Descreva o enquadramento e elementos visuais da cena inicial..."
                    className="w-full bg-bg-secondary border border-border rounded px-2.5 py-1.5 text-xs text-text-primary placeholder:text-text-muted/60 resize-none focus:outline-none focus:border-accent-blue transition-colors disabled:opacity-60"
                  />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {isActive && (
        <button
          onClick={generateStartImages}
          disabled={loading}
          className="w-full py-2.5 rounded-lg bg-accent-blue text-white text-xs font-medium hover:bg-accent-blue-hover transition-colors flex items-center justify-center gap-1.5 shadow-xs"
        >
          {/* Always available now — directorGenerateStartImages generates an
              establishing/anchor image first when no reference was provided. */}
          <ImageIcon size={13} /> Generate Start Images
        </button>
      )}
      {/* Collapse affordance — only renders when the clip list has been
          truncated by the CLIP_LIST_PREVIEW_THRESHOLD guard. Sits at the
          very end of the surface so it doesn't compete with the
          "Generate Start Images" CTA above. */}
      <ClipListCollapser
        total={clipPlans.length}
        shown={visibleClipCount}
        onShowAll={() => setShowAllClips(true)}
      />
    </div>
  )
}

export function ImageGenView({
  loading, imageGenProgress, clipImages,
}: {
  loading: boolean
  imageGenProgress: ReturnType<typeof useStore.getState>['directorImageGenProgress']
  clipImages: ReturnType<typeof useStore.getState>['directorClipImages']
  planVideoPrompts: () => Promise<void>
}) {
  // Architecture-mismatch advisories from the backend's image-gen filter.
  // Surfacing these in chat (vs only in the console) lets the user see
  // immediately why some of their selected LoRAs didn't get applied —
  // most commonly a Flux 2 Dev–trained LoRA that won't load against
  // Klein 9B's narrower hidden dim.
  const loraWarnings = useStore(s => s.pipelineStatus?.lora_warnings) || []
  return (
    <div className="space-y-3">
      <label className="text-xs text-text-muted uppercase tracking-wider block">Generating Start Images</label>

      {loraWarnings.length > 0 && (
        <div className="space-y-1.5">
          {loraWarnings.map((w, i) => (
            <div key={i} className="px-2.5 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-text-primary leading-snug whitespace-pre-line">
              {w}
            </div>
          ))}
        </div>
      )}


      {imageGenProgress && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-text-secondary">
              {imageGenProgress.status === 'done'
                ? 'All images ready — planning video shots...'
                : `Clip ${imageGenProgress.current + 1} of ${imageGenProgress.total}`}
            </span>
            <span className="text-text-muted">
              {imageGenProgress.currentClipLabel}
              {imageGenProgress.status !== 'done' && ` — ${imageGenProgress.status}`}
            </span>
          </div>
          <div className="w-full bg-bg-tertiary rounded-full h-1.5">
            <div
              className="bg-accent-blue h-1.5 rounded-full transition-all"
              style={{
                width: `${imageGenProgress.status === 'done'
                  ? 100
                  : ((imageGenProgress.current + (imageGenProgress.status === 'polling' ? 0.5 : 0)) / imageGenProgress.total) * 100
                }%`,
              }}
            />
          </div>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center gap-2 py-2">
          <Loader2 size={16} className="animate-spin text-accent-blue" />
          <span className="text-xs text-text-muted">
            {imageGenProgress?.status === 'generating' ? 'Submitting...' :
             imageGenProgress?.status === 'polling' ? 'Waiting for result...' :
             imageGenProgress?.status === 'downloading' ? 'Downloading...' : 'Processing...'}
          </span>
        </div>
      )}

      {clipImages.length > 0 && (
        // No inner scroll — chat panel scrolls. Grid wraps naturally
        // and extends downward as more images come in.
        <div className="grid grid-cols-3 gap-1.5">
          {clipImages.map((img, i) => (
            <div key={i} className="relative">
              <img
                src={img.file ? URL.createObjectURL(img.file) : getFileUrl(img.filename)}
                alt={`Clip ${img.clipIndex + 1}`}
                className="w-full aspect-square object-cover rounded-lg border border-border"
              />
              <span className="absolute bottom-0.5 left-0.5 text-2xs bg-black/60 text-white px-1 py-0.5 rounded">
                {img.clipIndex + 1}
              </span>
            </div>
          ))}
        </div>
      )}

      {!loading && imageGenProgress?.status === 'error' && (
        <DirectorErrorBanner
          error={imageGenProgress.error_message || 'Image generation failed'}
          pipelineStatus={useStore.getState().pipelineStatus}
          clipIndex={imageGenProgress.failed_clip_index ?? null}
        />
      )}
      {!loading && imageGenProgress?.status === 'error' && (
        <button
          onClick={() => { useStore.setState({ directorStep: 'review_video' }) }}
          className="w-full py-2 rounded-lg bg-accent-blue text-white text-xs font-medium hover:bg-accent-blue-hover transition-colors flex items-center justify-center gap-1.5"
        >
          <ChevronRight size={12} /> Continue to Video Prompts
        </button>
      )}
    </div>
  )
}

export function VideoPromptsReview({
  clipPlans, plannedClips, clipImages, setClipImage, allowSceneImageUploads,
  speakerMappings, editClipPlan,
  planVideoPrompts, directorGenerate, queueCurrent, applyToClips, loading, isShortFilm,
  isGenerating, isAutoGenerating, editingQueueEntryId,
}: {
  clipPlans: ReturnType<typeof useStore.getState>['directorClipPlans']
  plannedClips: ReturnType<typeof useStore.getState>['directorPlannedClips']
  clipImages: ReturnType<typeof useStore.getState>['directorClipImages']
  setClipImage: (clipIndex: number, file: File | null) => void
  allowSceneImageUploads?: boolean
  speakerMappings: ReturnType<typeof useStore.getState>['directorSpeakerMappings']
  editClipPlan: (index: number, field: 'video_prompt' | 'image_prompt', value: string) => void
  planVideoPrompts: () => Promise<void>
  directorGenerate: () => void
  queueCurrent: () => Promise<void>
  applyToClips: () => void
  loading: boolean
  isShortFilm?: boolean
  /** True when any render is active. Generate remains available, but saves
   *  the edited state as a held/queued immutable revision. */
  isGenerating?: boolean
  /** True specifically when an auto-mode pipeline is active. */
  isAutoGenerating?: boolean
  editingQueueEntryId?: string | null
}) {
  const queueBusy = useStore(s => s.directorQueueLoading)
  const pipelineStatus = useStore(s => s.pipelineStatus)
  const pipelineId = useStore(s => s.pipelineId)
  const rerunClipVideo = useStore(s => s.rerunClipVideo)
  const clearDirectorError = useStore(s => s.clearDirectorError)
  const [queueConfirmation, setQueueConfirmation] = useState<string | null>(null)
  // Same collapse threshold as ImagePromptsReview — past 12 clips,
  // truncate the list to keep the column manageable on big plans.
  const [showAllClips, setShowAllClips] = useState(false)
  // Which clip is currently being regenerated. Lets the spinner sit on
  // the correct card even when several clips have failed in sequence.
  const [regeneratingIndex, setRegeneratingIndex] = useState<number | null>(null)
  // Re-run ONLY this clip's video via the dashboard backend endpoint.
  // The dashboard already exposes rerunClipVideo, so this is just a
  // thin wrapper that owns the spinner state + error dismissal.
  const regenerateClip = async (clipIndex: number) => {
    if (!pipelineId) return
    setRegeneratingIndex(clipIndex)
    clearDirectorError()
    try {
      const plan = clipPlans[clipIndex]
      await rerunClipVideo(pipelineId, clipIndex, plan?.video_prompt)
    } catch (e) {
      console.error('Per-clip video regenerate failed:', e)
    } finally {
      setRegeneratingIndex(null)
    }
  }
  const visibleClipCount = showAllClips
    ? clipPlans.length
    : Math.min(clipPlans.length, CLIP_LIST_PREVIEW_THRESHOLD)

  useEffect(() => {
    if (!queueConfirmation) return
    const timer = window.setTimeout(() => setQueueConfirmation(null), 5000)
    return () => window.clearTimeout(timer)
  }, [queueConfirmation])

  const handleAddToQueue = async () => {
    setQueueConfirmation(null)
    const beforeIds = new Set(
      (useStore.getState().directorQueue?.entries || []).map(entry => entry.id),
    )
    await queueCurrent()
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

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs text-text-muted uppercase tracking-wider">Video Prompts</label>
        <button
          onClick={planVideoPrompts}
          disabled={loading}
          className="text-2xs text-accent-blue hover:text-accent-blue-hover flex items-center gap-0.5"
        >
          <RotateCcw size={10} /> Regenerate
        </button>
      </div>

      {allowSceneImageUploads && (
        <p className="text-2xs text-text-muted leading-snug">
          Scene images are optional. Add one to anchor a shot, or leave it blank to render from its video prompt.
        </p>
      )}

      {clipImages.length > 0 && !allowSceneImageUploads && (
        <div className="grid grid-cols-5 gap-1 mb-1">
          {clipImages.map((img, i) => (
            <div key={i} className="relative">
              <img
                src={img.file ? URL.createObjectURL(img.file) : getFileUrl(img.filename)}
                alt={`Clip ${img.clipIndex + 1}`}
                className="w-full aspect-square object-cover rounded border border-border"
              />
              <span className="absolute bottom-0 left-0 text-2xs bg-black/60 text-white px-0.5 rounded-br">
                {img.clipIndex + 1}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* No inner scroll — chat panel handles it. AutoResizeTextarea
          grows each prompt to its full height so long video prompts
          don't double-scroll. The list is truncated by the
          CLIP_LIST_PREVIEW_THRESHOLD guard; ClipListCollapser at the
          end of the surface lets the user expand it. */}
      <div className="space-y-2">
        {clipPlans.slice(0, visibleClipCount).map((plan, i) => {
          const clip = plannedClips[i]
          const clipImage = clipImages.find(image => image.clipIndex === i)
          const currentClip = pipelineStatus?.progress?.current_clip
          const totalClips = pipelineStatus?.progress?.total_clips
          const videoError = pipelineStatus?.error || null
          const failedClipIndex = pipelineStatus?.status === 'failed' && currentClip
            ? currentClip - 1
            : null
          // Per-clip regenerate spinner overrides the global state so
          // the badge stays accurate even when several clips share the
          // same failed status. Without this, the spinner would jump
          // between cards when the user clicks ↻ on different clips.
          const status: 'pending' | 'generating' | 'ready' | 'failed' = regeneratingIndex === i
            ? 'generating'
            : pipelineStatus?.status === 'failed' && (failedClipIndex === i || currentClip === i + 1)
              ? 'failed'
              : clipImage
                ? 'ready'
                : pipelineStatus?.status === 'running' && currentClip === i + 1
                  ? 'generating'
                  : 'pending'
          const clipIsRegenerating = regeneratingIndex === i
          return (
            <div key={i} className="bg-bg-tertiary rounded-lg p-3 space-y-2 border border-border/80 hover:border-border transition-colors shadow-xs">
              <div className="flex items-center justify-between gap-1.5 text-2xs text-text-muted">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-semibold text-text-primary px-1.5 py-0.5 rounded bg-bg-secondary border border-border text-2xs">
                    {isShortFilm ? 'Shot' : 'Clip'} {i + 1}
                  </span>
                  <ShotStatus status={status} />
                  {totalClips && <span className="tabular-nums font-mono text-text-muted">{i + 1}/{totalClips}</span>}
                  {clip && (
                    <>
                      <span className="tabular-nums font-mono text-text-secondary">{formatTime(clip.start)}–{formatTime(clip.end)}</span>
                      <SectionBadge label={clip.section_label} />
                      {clip.dominant_speaker && (
                        <span className="text-accent-blue font-medium">
                          {speakerMappings.find(m => m.speakerId === clip.dominant_speaker)?.name || clip.dominant_speaker}
                        </span>
                      )}
                    </>
                  )}
                </div>
                {/* Per-clip Regenerate button — appears when the
                    pipeline status is 'failed' AND the failure index
                    matches this card. Saves the user from re-rolling
                    the whole batch when only one video failed. */}
                {status === 'failed' && !clipIsRegenerating && (
                  <button
                    type="button"
                    onClick={() => regenerateClip(i)}
                    className="text-2xs text-accent-blue hover:text-accent-blue-hover flex items-center gap-0.5"
                    title={`Re-generate the video for Clip ${i + 1} only`}
                    aria-label={`Regenerate Clip ${i + 1} video`}
                  >
                    <RotateCcw size={10} /> Regenerate this clip
                  </button>
                )}
                {clipIsRegenerating && (
                  <span className="text-2xs text-text-muted flex items-center gap-1">
                    <Loader2 size={10} className="animate-spin" /> Regenerating…
                  </span>
                )}
              </div>
              {/* Inline rich error banner for this clip's video
                  failure. Same DirectorErrorBanner used elsewhere —
                  classifies the error (OOM / model / …) and lists
                  remediation steps inline. */}
              {status === 'failed' && videoError && failedClipIndex === i && (
                <DirectorErrorBanner
                  error={videoError}
                  pipelineStatus={pipelineStatus}
                  clipIndex={i}
                  onDismiss={() => clearDirectorError()}
                  onRegenerateClip={regenerateClip}
                />
              )}
              {allowSceneImageUploads && (
                <div className="flex items-center gap-2 rounded-md border border-border bg-bg-secondary p-1.5">
                  {clipImage && (
                    <img
                      src={clipImage.file ? URL.createObjectURL(clipImage.file) : getFileUrl(clipImage.filename)}
                      alt={`${isShortFilm ? 'Shot' : 'Clip'} ${i + 1} start`}
                      className="h-10 w-10 shrink-0 rounded object-cover"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-2xs text-text-secondary">
                      {clipImage?.filename || 'No scene image'}
                    </div>
                    <div className="text-2xs text-text-muted">
                      {clipImage ? 'Used as this shot’s start image' : 'Prompt-only video'}
                    </div>
                  </div>
                  <label className="shrink-0 cursor-pointer rounded border border-border px-2 py-1 text-2xs text-text-secondary hover:bg-bg-hover hover:text-text-primary">
                    <input
                      type="file"
                      accept={IMAGE_ACCEPT}
                      className="hidden"
                      onChange={event => {
                        const file = event.target.files?.[0]
                        if (file) setClipImage(i, file)
                        event.currentTarget.value = ''
                      }}
                    />
                    {clipImage ? 'Replace' : 'Upload'}
                  </label>
                  {clipImage && (
                    <button
                      type="button"
                      onClick={() => setClipImage(i, null)}
                      title="Remove scene image"
                      className="shrink-0 rounded p-1 text-text-muted hover:bg-bg-hover hover:text-red-400"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              )}
              <div className="flex gap-2.5 items-start">
                {!allowSceneImageUploads && clipImage && (
                  <div className="relative shrink-0 w-16 h-16 rounded overflow-hidden border border-border/80 bg-black/40">
                    <img
                      src={clipImage.file ? URL.createObjectURL(clipImage.file) : getFileUrl(clipImage.filename)}
                      alt={`Clip ${i + 1}`}
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <AutoResizeTextarea
                    value={plan.video_prompt}
                    onChange={e => editClipPlan(i, 'video_prompt', e.target.value)}
                    rows={3}
                    placeholder="Descreva o movimento de câmera e ação do vídeo..."
                    className="w-full bg-bg-secondary border border-border rounded px-2.5 py-1.5 text-xs text-text-primary placeholder:text-text-muted/60 resize-none focus:outline-none focus:border-accent-blue transition-colors"
                  />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="space-y-2">
        <button
          onClick={directorGenerate}
          disabled={(loading && !isGenerating) || queueBusy}
          className="w-full py-2.5 rounded-lg bg-accent-green hover:bg-accent-green-hover text-white text-sm font-semibold transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
          title={isGenerating
            ? 'Freeze these edited settings as a queued revision; the active run is unchanged'
            : editingQueueEntryId
              ? 'Replace the held queue entry with these edited settings'
              : 'Render this Director project as a new revision'}
        >
          {isGenerating || editingQueueEntryId
            ? <ListVideo size={14} /> : <Play size={14} fill="white" />}
          {editingQueueEntryId
            ? 'Save Queue Changes'
            : isGenerating
            ? (isAutoGenerating ? 'Queue Edited Variant' : 'Add Variant to Queue')
            : 'Generate'}
        </button>
        {!isGenerating && !editingQueueEntryId && (
          <>
            <button
              onClick={() => void handleAddToQueue()}
              disabled={loading || queueBusy || Boolean(queueConfirmation)}
              className={`w-full py-2 rounded-lg border text-xs font-medium transition-colors flex items-center justify-center gap-1.5 disabled:opacity-70 ${
                queueConfirmation
                  ? 'border-green-500/30 bg-green-500/10 text-indicator-success'
                  : 'border-accent-blue/30 bg-accent-blue/5 text-accent-blue hover:bg-accent-blue/10'
              }`}
              title="Hold this complete project in the persistent queue without starting it"
            >
              {queueBusy
                ? <Loader2 size={12} className="animate-spin" />
                : queueConfirmation
                  ? <Check size={12} />
                  : <ListVideo size={12} />}
              {queueBusy ? 'Adding…' : queueConfirmation ? 'Added to Queue' : 'Add to Queue'}
            </button>
            {queueConfirmation && (
              <div
                role="status"
                aria-live="polite"
                className="rounded-md border border-green-500/20 bg-green-500/5 px-2.5 py-2 text-2xs leading-relaxed text-indicator-success"
              >
                {queueConfirmation}
              </div>
            )}
          </>
        )}
        <button
          onClick={applyToClips}
          className="w-full py-2 rounded-lg border border-border text-text-secondary text-xs font-medium hover:bg-bg-hover hover:text-text-primary transition-colors flex items-center justify-center gap-1.5"
        >
          <ChevronRight size={12} /> Edit in Studio
        </button>
      </div>
      {/* Same collapse affordance as ImagePromptsReview — only shows
          when the list was truncated by CLIP_LIST_PREVIEW_THRESHOLD. */}
      <ClipListCollapser
        total={clipPlans.length}
        shown={visibleClipCount}
        onShowAll={() => setShowAllClips(true)}
      />
    </div>
  )
}
