import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import { Upload, Loader2, Music, RotateCcw, Check, X, ChevronRight, ChevronDown, ImageIcon, Play, Mic, Send, Users, FileText, ListVideo } from 'lucide-react'
import { useStore, directorModelUsesFixedMediaStrength, resolveResolution } from '../../stores/useStore'
import { fetchModelOptions, getFileUrl } from '../../api/client'
import { DirectorLoraSelector } from '../SettingsDrawer/DirectorLoraSelector'
import { DirectorSongSetup } from './DirectorSongSetup'
import { DirectorH3Optimizations } from './DirectorH3Optimizations'
import { OmniReferenceSection } from './OmniReferenceSection'

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

const sectionColors: Record<string, string> = {
  intro: 'bg-blue-500/20 text-chip-blue',
  verse: 'bg-green-500/20 text-chip-green',
  chorus: 'bg-purple-500/20 text-chip-purple',
  bridge: 'bg-yellow-500/20 text-chip-yellow',
  outro: 'bg-gray-500/20 text-chip-gray',
  instrumental: 'bg-cyan-500/20 text-chip-cyan',
  // Short film scene types
  dialogue: 'bg-green-500/20 text-chip-green',
  action: 'bg-orange-500/20 text-chip-orange',
  opening: 'bg-blue-500/20 text-chip-blue',
  closing: 'bg-gray-500/20 text-chip-gray',
  scene: 'bg-teal-500/20 text-chip-teal',
}

const sectionBarColors: Record<string, string> = {
  intro: 'bg-blue-500',
  verse: 'bg-green-500',
  chorus: 'bg-purple-500',
  bridge: 'bg-yellow-500',
  outro: 'bg-gray-500',
  instrumental: 'bg-cyan-500',
  // Short film scene types
  dialogue: 'bg-green-500',
  action: 'bg-orange-500',
  opening: 'bg-blue-500',
  closing: 'bg-gray-500',
  scene: 'bg-teal-500',
}

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

function SectionBadge({ label }: { label: string }) {
  return (
    <span className={`text-2xs px-1.5 py-0.5 rounded-full ${sectionColors[label] || 'bg-bg-hover text-text-muted'}`}>
      {label}
    </span>
  )
}

function EnergyDot({ energy }: { energy: number }) {
  const color = energy > 0.6 ? 'bg-chip-red' : energy < 0.3 ? 'bg-chip-blue' : 'bg-chip-yellow'
  return <span className={`inline-block w-2 h-2 rounded-full ${color}`} title={`Energy: ${(energy * 100).toFixed(0)}%`} />
}

function ShotStatus({ status }: { status: 'pending' | 'generating' | 'ready' | 'failed' }) {
  const labels = { pending: 'Pending', generating: 'Generating', ready: 'Ready', failed: 'Failed' }
  const styles = {
    pending: 'bg-bg-hover text-text-muted',
    generating: 'bg-accent-blue/15 text-accent-blue',
    ready: 'bg-indicator-success/15 text-indicator-success',
    failed: 'bg-red-500/15 text-red-400',
  }
  return <span className={`rounded-full px-1.5 py-0.5 text-2xs ${styles[status]}`}>{labels[status]}</span>
}

// Event/entry wrapper used by the chat column on the Director page.
//
// The app moved away from the conversational "chat bubble" pattern
// (left system bubble / right user reply). Every chat event is now a
// neutral log line — the user's selections and the app's prompts share
// the same left-rail, neutral styling so the eye scans a single timeline
// rather than two alternating speakers. Indentation comes from a left
// rule, not a margin offset, so alignment stays consistent across event
// sizes.
function SystemBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="pl-3 py-2 border-l-2 border-border/60 space-y-2">
      {children}
    </div>
  )
}

function UserBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="pl-3 py-2 border-l-2 border-accent-blue/40 space-y-1">
      {children}
    </div>
  )
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
  void useStore(s => s.directorEnergyBias)
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
  void useStore(s => s.directorSetEnergyBias)
  void useStore(s => s.directorConfirmStructure)
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
  void useStore(s => s.directorSpeakerMappings)
  void useStore(s => s.directorSetSpeakerMapping)
  void useStore(s => s.directorInsertSpeakerMention)
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
  void useStore(s => s.directorQueue)
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

  // speakerSamples used to feed the in-chat StyleForm (now lives in the
  // middle column). The directorPlanColumn rebuilds its own equivalent
  // when it mounts.
  useMemo(() => {
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
  // so Send plans from it. Past the style step it rewinds the plan back to
  // style — reapplies the pending texts and re-enables Send — but only when
  // no pipeline is running or paused, to avoid detaching from live work.
  const loadScriptIntoDescription = useCallback(({ text }: { text: string }) => {
    setSceneDescription(text)
    setChatInput(text)
    const pipelineActive = !!(pipelineStatus &&
      ['running', 'paused', 'queued', 'starting'].includes(pipelineStatus.status))
    if (pastStep('style') && !loading && !pipelineActive) {
      useStore.setState({
        directorStep: 'style',
        directorPlannedClips: [],
        directorClipPlans: [],
        directorClipImages: [],
        directorImageGenProgress: null,
        directorLoadingMessage: null,
      })
    }
  }, [pipelineStatus, loading, pastStep, setSceneDescription, setChatInput])

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
          <>
            {!audioFile && !pastStep('analyze') ? (
              <SystemBubble>
                <div className="space-y-3">
                  {/* Music Video: upload a track OR generate one with the selected music model. */}
                  {!isShortFilm && (
                    <div className="flex gap-1.5 p-1 bg-bg-tertiary rounded-lg border border-border">
                      {(['upload', 'generate'] as const).map(opt => {
                        const active = (musicSource || 'upload') === opt
                        return (
                          <button
                            key={opt}
                            onClick={() => setMusicSource(opt)}
                            className={`flex-1 px-2 py-1.5 rounded-md text-xs font-medium transition-all ${
                              active ? 'bg-accent-blue text-white' : 'text-text-secondary hover:text-text-primary'
                            }`}
                          >
                            {opt === 'upload' ? 'Upload a track' : 'Generate a track'}
                          </button>
                        )
                      })}
                    </div>
                  )}
                  {!isShortFilm && musicSource === 'generate' ? (
                    !loading && <DirectorSongSetup />
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      <UploadZone
                        dragOver={dragOver}
                        setDragOver={setDragOver}
                        handleDrop={handleDrop}
                        handleFile={handleFile}
                        loading={loading && atStep('analyze')}
                        loadingMessage={loadingMessage}
                        audioFile={audioFile}
                        isShortFilm={isShortFilm}
                      />
                      <DirectorReferenceInputs
                        referenceImage={referenceImage}
                        refImagePreview={refImagePreview}
                        setReferenceImage={setReferenceImage}
                        imageOnly
                      />
                    </div>
                  )}
                  {/* Additional refs (character / location / voice) live
                      below the inline audio+reference row. Pulled out of
                      DirectorReferenceInputs via the imageOnly flag above
                      so the reference photo could sit beside the audio
                      drop zone in the same row. */}
                  <AdditionalRefsSection />
                  {isShortFilm && referenceImage && (
                    <CharacterNaming
                      characters={shortFilmCharacters}
                      setCharacters={shortFilmSetCharacters}
                    />
                  )}
                  {/* Keep the newest track-generation activity at the bottom
                      of the input group so the chat scroll anchor reveals it. */}
                  {!isShortFilm && musicSource === 'generate' && loading && (
                    <div className="flex items-center gap-2 py-2">
                      <Loader2 size={14} className="animate-spin text-accent-blue" />
                      <span className="text-xs text-text-muted">{loadingMessage || 'Generating…'}</span>
                    </div>
                  )}
                </div>
              </SystemBubble>
            ) : audioFile && (atStep('analyze') || atStep('upload')) ? (
              <SystemBubble>
                {/* Same side-by-side row as the empty upload state above —
                    keeping the layout stable through the analyze step
                    (e.g. "Analyzing audio..." spinner in the audio card,
                    "Drop reference photo" still on the right) stops the
                    column from jumping vertically when an audio file is
                    added. */}
                <div className="grid grid-cols-2 gap-3">
                  <UploadZone
                    dragOver={dragOver}
                    setDragOver={setDragOver}
                    handleDrop={handleDrop}
                    handleFile={handleFile}
                    loading={loading}
                    loadingMessage={loadingMessage}
                    audioFile={audioFile}
                    isShortFilm={isShortFilm}
                  />
                  {/* Keep the reference selections VISIBLE during analysis —
                      they used to unmount behind a `!loading` gate, which read
                      as "my selections disappeared". Interaction is disabled
                      while loading; the state is untouched. */}
                  <div className={loading ? 'opacity-60 pointer-events-none' : ''}>
                    <DirectorReferenceInputs
                      referenceImage={referenceImage}
                      refImagePreview={refImagePreview}
                      setReferenceImage={setReferenceImage}
                      disabled={loading}
                      imageOnly
                    />
                  </div>
                </div>
                <AdditionalRefsSection />
              </SystemBubble>
            ) : audioFile && pastStep('analyze') ? (
              /* Post-analyze state: keep the same two-card side-by-side
                 layout as the upload/analyze states so the column
                 doesn't collapse into a thin bubble. The user
                 explicitly asked to preserve the audio + reference
                 photo cards (with the loaded audio name visible) after
                 the analysis completes — the inputs stay here because
                 they're still editable (e.g. swap reference photo to
                 restyle the shots). */
              <SystemBubble>
                <div className="grid grid-cols-2 gap-3">
                  <UploadZone
                    dragOver={dragOver}
                    setDragOver={setDragOver}
                    handleDrop={handleDrop}
                    handleFile={handleFile}
                    loading={false}
                    loadingMessage={null}
                    audioFile={audioFile}
                    isShortFilm={isShortFilm}
                  />
                  <DirectorReferenceInputs
                    referenceImage={referenceImage}
                    refImagePreview={refImagePreview}
                    setReferenceImage={setReferenceImage}
                    imageOnly
                  />
                </div>
                <AdditionalRefsSection />
              </SystemBubble>
            ) : null}
          </>
        )}

        {/* Analysis result — hidden for story path */}
        {/* The "Analysis complete" badge (AnalysisSummary) used to live
            here as a system bubble, but the user asked to consolidate
            it inside the CLIP STRUCTURE card on the middle column so
            the planning surface is the single source of truth for the
            post-analyze view. The reference photo inputs are already
            rendered above inside the side-by-side audio+reference
            layout, so nothing extra is needed here. */}

        {/* Error — dismissible banner. The text "Failed to fetch" is what
            fetch() throws when the request never reached the backend (CORS,
            backend down, network blip). We surface that as a friendlier hint
            so the user has something actionable to copy/paste instead of a
            raw browser error string. */}
        {error && (
          <div className="flex items-start gap-2 text-xs text-red-400 bg-red-500/10 rounded px-2 py-1.5 border border-red-500/20" role="alert">
            <span className="flex-1">
              {error === 'Failed to fetch'
                ? 'Could not reach the Maestro backend. Check that start.sh is still running and try again.'
                : error}
            </span>
            <button
              type="button"
              onClick={clearDirectorError}
              aria-label="Dismiss error"
              title="Dismiss"
              className="shrink-0 -mr-1 -mt-0.5 px-1 leading-none text-red-400 hover:text-red-200 transition-colors"
            >
              ×
            </button>
          </div>
        )}

        {/* Structure step — the actual StructureView (clip structure,
            pacing slider, "X clips confirmed") is rendered by
            DirectorPlanColumn in the middle column. The chat column
            stays focused on inputs (upload / references) so the user
            isn't reading the same block twice. */}


        {/* Style step */}
        {!isShortFilm && (atStep('style') || pastStep('style')) && (
          <SystemBubble>
            <p className="text-xs text-text-secondary mb-2">
              Attach a story outline or lyric script to shape the music video. The text loads into the scene
              description in the composer below, alongside the song's audio structure.
            </p>
            <ScriptAttachCard onLoaded={loadScriptIntoDescription} />
          </SystemBubble>
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
              <ScriptAttachCard onLoaded={loadScriptIntoDescription} />
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
        <div className="flex flex-col gap-2">
          {/* The composer used to put the textarea + Send/Queue buttons
              side-by-side, which forced the textarea into a tall narrow
              column and pushed the buttons off the right edge of the
              card. The user asked to stack the textarea above the
              buttons, full width, so the brief sits directly below the
              reference cards (no awkward horizontal jump), and the
              buttons read as a single primary action row underneath.
              AutoResizeTextarea still grows up to 240px so a long brief
              doesn't break out of the chat column. */}
          <div className="relative">
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
                if (e.key === 'Enter' && !e.shiftKey && chatInputEnabled) {
                  e.preventDefault()
                  handleChatSubmit()
                }
              }}
              placeholder={chatInputPlaceholder}
              disabled={!chatInputEnabled}
              rows={3}
              minHeight={84}
              maxHeight={140}
              className="w-full bg-bg-tertiary border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:border-accent-blue transition-colors disabled:opacity-50 disabled:cursor-not-allowed scrollbar-visible"
            />
            <span className="pointer-events-none absolute bottom-1 right-3 select-none text-2xs text-text-muted/60">
              Enter to send · Shift+Enter for a new line
            </span>
          </div>
          <div className="flex shrink-0 self-end overflow-hidden rounded-lg border border-accent-blue/60">
            <button
              onClick={handleChatSubmit}
              disabled={!chatInputEnabled || draftQueuePending || !(mvGenerateSetup ? songDescription : chatInput).trim()}
              className="p-2 bg-accent-blue text-white hover:bg-accent-blue-hover transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title={mvGenerateSetup ? 'Generate the song and start this Director project' : 'Start this Director project now'}
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
              className="border-l border-white/20 bg-accent-blue/85 px-2 text-white hover:bg-accent-blue-hover transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title={mvGenerateSetup
                ? 'Generate the song, then hold the complete Director project in the paused queue'
                : 'Add this complete Director project to the paused queue without starting it'}
              aria-label={directorQueueEditingEntryId ? 'Save Director queue changes' : 'Add Director project to queue'}
            >
              {draftQueuePending || directorQueueLoading
                ? <Loader2 size={14} className="animate-spin" />
                : draftQueueConfirmation
                  ? <Check size={14} />
                  : <ListVideo size={14} />}
            </button>
          </div>
        </div>
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
  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      /* min-h-[96px] keeps both the audio card and the reference photo
         card (next door in the 2-col grid) the same height so flex
         centering works in both. The parent card height is set here
         rather than inside each child branch. */
      className={`border-2 border-dashed rounded-lg p-4 text-center min-h-[96px] flex items-center justify-center transition-colors ${
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
           glyph + filename sit at the visual middle of the card. */
        <div className="flex flex-col items-center gap-1">
          <Music size={16} className="text-text-muted" />
          <span className="text-xs text-text-secondary truncate max-w-full">{audioFile.name}</span>
        </div>
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
           so the image (h-24) + caption read as one centered unit. */
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
          <span className="absolute bottom-1.5 left-1.5 text-2xs text-white/80 bg-black/50 px-1.5 py-0.5 rounded">
            Reference photo &middot; click to change
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

function ScriptAttachCard({ onLoaded }: {
  onLoaded: (info: { filename: string; text: string; charCount: number; truncated: boolean }) => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [attached, setAttached] = useState<{ filename: string; charCount: number; truncated: boolean } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback(async (file: File) => {
    setError('')
    setLoading(true)
    try {
      const result = await readDirectorScript(file)
      const info = { filename: result.filename, text: result.text, charCount: result.char_count, truncated: result.truncated }
      setAttached({ filename: info.filename, charCount: info.charCount, truncated: info.truncated })
      onLoaded(info)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read script')
    } finally {
      setLoading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }, [onLoaded])

  return (
    <div className="space-y-1.5">
      <span className="text-xs text-text-muted uppercase tracking-wider block">Script / Roteiro</span>
      {attached ? (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-bg-tertiary px-2.5 py-2">
          <FileText size={14} className="text-accent-blue shrink-0" />
          <span className="text-xs text-text-primary truncate min-w-0">{attached.filename}</span>
          <span className="text-2xs text-text-muted shrink-0">
            {attached.charCount.toLocaleString()} chars{attached.truncated ? ' · truncated' : ''}
          </span>
          <button
            type="button"
            onClick={() => { setAttached(null); setError('') }}
            aria-label="Remove script"
            title="Remove script"
            className="ml-auto shrink-0 p-0.5 rounded hover:bg-bg-hover transition-colors"
          >
            <X size={12} className="text-text-muted" />
          </button>
        </div>
      ) : (
        <label className={`flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 cursor-pointer transition-colors ${loading ? 'opacity-60 pointer-events-none' : 'border-border hover:border-accent-blue'}`}>
          {loading
            ? <Loader2 size={14} className="animate-spin text-accent-blue" />
            : <FileText size={14} className="text-accent-blue/70" />}
          <span className="text-xs text-text-secondary">{loading ? 'Reading script…' : 'Attach a script (.txt, .md, .pdf)'}</span>
          <input
            ref={inputRef}
            type="file"
            accept={SCRIPT_ACCEPT}
            className="hidden"
            disabled={loading}
            onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f) }}
          />
        </label>
      )}
      {attached && (
        <p className="text-2xs text-text-muted">
          Loaded into the story description — check the composer below and press Send to plan the film.
        </p>
      )}
      {error && <p className="text-2xs text-red-400" role="alert">{error}</p>}
    </div>
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

function DraggableRefRow({ file, label, index, onRemove, onLabelChange, onReorder, placeholder }: {
  file: File; label: string; index: number
  onRemove: (i: number) => void
  onLabelChange: (i: number, v: string) => void
  onReorder: (from: number, to: number) => void
  placeholder: string
}) {
  const [dragOver, setDragOver] = useState(false)

  return (
    <div
      draggable
      onDragStart={e => { e.dataTransfer.setData('text/plain', String(index)); e.dataTransfer.effectAllowed = 'move' }}
      onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => {
        e.preventDefault(); setDragOver(false)
        const from = parseInt(e.dataTransfer.getData('text/plain'), 10)
        if (!isNaN(from) && from !== index) onReorder(from, index)
      }}
      /* Card layout: thumbnail stacks on top, label input sits directly
         beneath it. Vertical stacking (instead of horizontal row) lets
         multiple refs share a column under "Character refs" / "Location
         refs" without making each row as wide as the parent column. */
      className={`flex flex-col gap-1 group cursor-grab active:cursor-grabbing rounded border border-border bg-bg-secondary p-1 transition-colors ${
        dragOver ? 'border-accent-blue bg-accent-blue/10' : 'hover:border-border-light'
      }`}
    >
      <div className="relative">
        <img src={URL.createObjectURL(file)} alt={`Ref ${index+1}`}
          className="w-full h-16 object-cover rounded border border-border pointer-events-none" />
        <button onClick={() => onRemove(index)}
          className="absolute -top-1 -right-1 bg-red-500 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity z-10">
          <X size={8} className="text-white" />
        </button>
        <span className="absolute bottom-0 left-0 bg-black/60 text-white text-2xs px-1 rounded-br rounded-tl pointer-events-none">
          {index + 1}
        </span>
      </div>
      <input
        type="text"
        value={label}
        onChange={e => onLabelChange(index, e.target.value)}
        placeholder={placeholder}
        className="w-full min-w-0 bg-bg-tertiary border border-border rounded px-1.5 py-0.5 text-2xs text-text-primary placeholder:text-text-muted focus:border-accent-blue outline-none"
      />
    </div>
  )
}

function AdditionalRefsSection() {
  const charRefs = useStore(s => s.directorCharacterRefs)
  const charLabels = useStore(s => s.directorCharacterRefLabels)
  const locRefs = useStore(s => s.directorLocationRefs)
  const locLabels = useStore(s => s.directorLocationRefLabels)
  const addCharRef = useStore(s => s.directorAddCharacterRef)
  const removeCharRef = useStore(s => s.directorRemoveCharacterRef)
  const setCharLabel = useStore(s => s.directorSetCharacterRefLabel)
  const reorderCharRefs = useStore(s => s.directorReorderCharacterRefs)
  const addLocRef = useStore(s => s.directorAddLocationRef)
  const removeLocRef = useStore(s => s.directorRemoveLocationRef)
  const setLocLabel = useStore(s => s.directorSetLocationRefLabel)
  const reorderLocRefs = useStore(s => s.directorReorderLocationRefs)
  const voiceRef = useStore(s => s.directorVoiceRef)
  const setVoiceRef = useStore(s => s.setDirectorVoiceRef)
  const identityScale = useStore(s => s.directorIdentityGuidanceScale)
  const setIdentityScale = useStore(s => s.setDirectorIdentityGuidanceScale)
  const voiceReferenceEnabled = useStore(s => s.servicesConfig?.voice_reference_enabled ?? false)
  const selectedVideoModel = useStore(s => s.selectedModelPerMode.video || 'ltx2_22B_distilled_1_1')
  const supportsVoiceReference = useStore(s => (
    s.models.find(model => model.model_type === selectedVideoModel)
      ?.director?.supports_voice_reference ?? false
  ))
  const voiceReferenceMode = useStore(s => (
    s.models.find(model => model.model_type === selectedVideoModel)
      ?.director?.voice_reference_mode ?? 'none'
  ))

  const handleFiles = useCallback((files: FileList | null, type: 'char' | 'loc') => {
    if (!files) return
    const add = type === 'char' ? addCharRef : addLocRef
    Array.from(files).forEach(f => { if (f.type.startsWith('image/')) add(f) })
  }, [addCharRef, addLocRef])

  const nativeVoiceReference = voiceReferenceMode === 'native_reference'
  const showVoiceReference = supportsVoiceReference
    && (nativeVoiceReference || voiceReferenceEnabled)

  return (
    /* The "Additional references" header (collapsible <button> with
       chevron + Users icon + count badge) used to gate the section
       behind a click. The user asked to drop the header entirely and
       keep the "Character refs" / "Location refs" column titles
       always visible, so the section reads as two parallel reference
       columns under the audio / reference upload row. The local
       scroll wrapper is preserved so the section still respects the
       40vh ceiling and shows the only visible scrollbar in the chat
       column. */
    <div className="mt-1.5 space-y-2 pl-1 max-h-[40vh] overflow-y-auto scrollbar-visible">
          {/* Two-column grid: characters on the left, locations on the
              right. Each card stacks its reference photo on top and the
              label input directly below so the eye reads top-to-bottom
              per ref instead of side-by-side. */}
          <div className="grid grid-cols-2 gap-2">
            {/* Character References — left column */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-2xs text-text-secondary">Character refs</span>
                <label className="cursor-pointer text-2xs text-accent-blue hover:underline">
                  + Add
                  <input type="file" accept={IMAGE_ACCEPT} multiple className="hidden"
                    onChange={e => handleFiles(e.target.files, 'char')} />
                </label>
              </div>
              {charRefs.length > 0 && (
                <div className="space-y-1.5">
                  {charRefs.map((f, i) => (
                    <DraggableRefRow key={`c${i}-${f.name}`} file={f} label={charLabels[i] || ''} index={i}
                      onRemove={removeCharRef} onLabelChange={setCharLabel} onReorder={reorderCharRefs}
                      placeholder="e.g. Thor - blonde, hammer" />
                  ))}
                </div>
              )}
              {charRefs.length === 0 && (
                <p className="text-2xs text-text-muted italic">Individual character close-ups improve identity</p>
              )}
            </div>
            {/* Location References — right column */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-2xs text-text-secondary">Location refs</span>
                <label className="cursor-pointer text-2xs text-accent-blue hover:underline">
                  + Add
                  <input type="file" accept={IMAGE_ACCEPT} multiple className="hidden"
                    onChange={e => handleFiles(e.target.files, 'loc')} />
                </label>
              </div>
              {locRefs.length > 0 && (
                <div className="space-y-1.5">
                  {locRefs.map((f, i) => (
                    <DraggableRefRow key={`l${i}-${f.name}`} file={f} label={locLabels[i] || ''} index={i}
                      onRemove={removeLocRef} onLabelChange={setLocLabel} onReorder={reorderLocRefs}
                      placeholder="e.g. backstage, leather couches" />
                  ))}
                </div>
              )}
              {locRefs.length === 0 && (
                <p className="text-2xs text-text-muted italic">Scene/environment reference images</p>
              )}
            </div>
          </div>
          {/* LTX uses an ID-LoRA; H3 Omni maps the sample as a native voice
              reference in each shot's Ref2VA manifest. */}
          {showVoiceReference && <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-2xs text-text-secondary"><Mic size={9} className="inline mr-0.5" />Voice ref</span>
              {!voiceRef ? (
                <label className="cursor-pointer text-2xs text-accent-blue hover:underline">
                  + Add
                  <input type="file" accept={AUDIO_ACCEPT} className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) setVoiceRef(f); e.target.value = '' }} />
                </label>
              ) : (
                <button onClick={() => setVoiceRef(null)} className="text-2xs text-red-400 hover:text-red-300">Remove</button>
              )}
            </div>
            {voiceRef ? (
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 bg-bg-tertiary rounded px-1.5 py-1">
                  <Mic size={10} className="text-accent-blue shrink-0" />
                  <span className="text-2xs text-text-secondary truncate">{voiceRef.name}</span>
                </div>
                {!nativeVoiceReference && <div className="flex items-center gap-1.5">
                  <span className="text-2xs text-text-muted whitespace-nowrap">Identity scale</span>
                  <input type="range" min={0} max={10} step={0.5} value={identityScale}
                    onChange={e => setIdentityScale(parseFloat(e.target.value))}
                    className="flex-1 h-1 accent-accent-blue" />
                  <span className="text-2xs text-text-muted w-5 text-right">{identityScale}</span>
                </div>}
              </div>
            ) : (
              <p className="text-2xs text-text-muted italic">
                {nativeVoiceReference
                  ? 'Voice sample used by H3 Omni for the primary speaking character'
                  : '~5 sec voice sample for consistent voice across clips'}
              </p>
            )}
          </div>}
        </div>
  )
}

export function AnalysisSummary({
  analysis, showDetails, setShowDetails, isShortFilm,
}: {
  analysis: NonNullable<ReturnType<typeof useStore.getState>['directorAnalysis']>
  showDetails: boolean
  setShowDetails: (v: boolean | ((p: boolean) => boolean)) => void
  speakerMappings?: ReturnType<typeof useStore.getState>['directorSpeakerMappings']
  isShortFilm?: boolean
}) {
  // Count unique speakers
  const speakerCount = new Set(
    (analysis.lyrics || []).map(l => l.speaker).filter(Boolean)
  ).size

  return (
    /* The "Analysis complete" / "Transcription complete" header used
       to render as a static paragraph above the stats toggle. The
       user asked to drop it because the toggle's own chips
       (duration, BPM, sections, lyric segments) already convey the
       same outcome — the prose paragraph was redundant. */
    <div className="space-y-1">
      <button
        onClick={() => setShowDetails(v => !v)}
        className="flex items-center gap-3 text-xs text-text-muted w-full hover:text-text-secondary transition-colors"
      >
        <ChevronDown size={10} className={`transition-transform ${showDetails ? '' : '-rotate-90'}`} />
        <span>{formatTime(analysis.duration)}</span>
        {!isShortFilm && <span>{analysis.bpm.toFixed(0)} BPM</span>}
        {isShortFilm && speakerCount > 0 && <span>{speakerCount} speaker{speakerCount > 1 ? 's' : ''}</span>}
        {!isShortFilm && <span>{analysis.sections.length} sections</span>}
        {analysis.lyrics && <span>{analysis.lyrics.length} {isShortFilm ? 'dialogue lines' : 'lyric segments'}</span>}
      </button>

      {showDetails && (
        // No inner scroll — chat panel handles scrolling.
        <div className="bg-bg-tertiary rounded-lg p-2 space-y-2 text-2xs">
          <div>
            <div className="text-text-muted uppercase tracking-wider mb-1 font-medium">Sections</div>
            <div className="space-y-0.5">
              {analysis.sections.map((sec, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-text-muted w-16 shrink-0">
                    {formatTime(sec.start)}-{formatTime(sec.end)}
                  </span>
                  <SectionBadge label={sec.label} />
                  <EnergyDot energy={sec.energy} />
                  <span className="text-text-muted">{(sec.energy * 100).toFixed(0)}%</span>
                </div>
              ))}
            </div>
          </div>

          {analysis.lyrics && analysis.lyrics.length > 0 && (
            <div>
              <div className="text-text-muted uppercase tracking-wider mb-1 font-medium">
                Lyrics {analysis.song_structure?.length ? '(LLM Structure)' : '(Whisper)'}
              </div>
              <div className="space-y-0.5">
                {analysis.song_structure && analysis.song_structure.length > 0 ? (
                  analysis.song_structure.map((section, si) => {
                    const nextStart = si < analysis.song_structure!.length - 1
                      ? analysis.song_structure![si + 1].start
                      : Infinity
                    const sectionLyrics = analysis.lyrics!.filter(
                      seg => seg.start >= section.start && seg.start < nextStart
                    )
                    return (
                      <div key={si} className="mb-1.5">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <SectionBadge label={section.label} />
                          <span className="text-text-muted">{formatTime(section.start)}</span>
                          <span className="text-text-secondary font-medium">[{section.display_label}]</span>
                        </div>
                        {sectionLyrics.map((seg, li) => (
                          <div key={li} className="flex gap-2 pl-2">
                            <span className="text-text-muted w-14 shrink-0 text-right">
                              {formatTime(seg.start)}
                            </span>
                            <span className="text-text-secondary">
                              {seg.speaker && (
                                <span className="text-accent-blue text-2xs mr-1">[{seg.speaker}]</span>
                              )}
                              {seg.text}
                            </span>
                          </div>
                        ))}
                        {sectionLyrics.length === 0 && (
                          <div className="pl-2 text-text-muted italic">(instrumental)</div>
                        )}
                      </div>
                    )
                  })
                ) : (
                  analysis.lyrics.map((seg, i) => (
                    <div key={i} className="flex gap-2">
                      <span className="text-text-muted w-16 shrink-0">
                        {formatTime(seg.start)}-{formatTime(seg.end)}
                      </span>
                      <span className="text-text-secondary">
                        {seg.speaker && (
                          <span className="text-accent-blue text-2xs mr-1">[{seg.speaker}]</span>
                        )}
                        {seg.text}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function StructureView({
  plannedClips, energyBias, localBias, setLocalBias, sliderRef, setEnergyBias,
  loading, totalClipDuration, beatDistribution, confirmStructure, isActive, isShortFilm,
}: {
  plannedClips: ReturnType<typeof useStore.getState>['directorPlannedClips']
  energyBias: number
  localBias: number | null
  setLocalBias: (v: number | null) => void
  sliderRef: React.MutableRefObject<number | null>
  setEnergyBias: (bias: number) => Promise<void>
  loading: boolean
  totalClipDuration: number
  beatDistribution: string
  confirmStructure: () => void
  isActive: boolean
  isShortFilm?: boolean
}) {
  return (
    <div className="space-y-3">
      {/* The old "Here's the clip structure based on the audio analysis.
          Adjust the cut speed if needed." paragraph was redundant with the
          CLIP STRUCTURE header above and the slider label below. The user
          asked to drop it from the audio-analysis card so the structure
          preview reads as a clean visual block without instructional prose. */}

      {isActive && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs text-text-muted uppercase tracking-wider">{isShortFilm ? 'Scene Pacing' : 'Cut Speed'}</label>
            <span className="text-xs text-text-secondary">
              {(localBias ?? energyBias) > 0 ? '+' : ''}{localBias ?? energyBias}
            </span>
          </div>
          <input
            type="range"
            min={-2}
            max={2}
            step={1}
            value={localBias ?? energyBias}
            onChange={e => {
              const v = Number(e.target.value)
              setLocalBias(v)
              sliderRef.current = v
            }}
            onMouseUp={() => {
              if (sliderRef.current !== null && sliderRef.current !== energyBias) {
                setEnergyBias(sliderRef.current)
              }
              setLocalBias(null)
              sliderRef.current = null
            }}
            onTouchEnd={() => {
              if (sliderRef.current !== null && sliderRef.current !== energyBias) {
                setEnergyBias(sliderRef.current)
              }
              setLocalBias(null)
              sliderRef.current = null
            }}
            className="w-full"
          />
          <div className="flex items-center justify-between mt-1 text-2xs text-text-muted">
            <span>{isShortFilm ? 'Longer scenes' : 'Slower cuts'}</span>
            <span>{isShortFilm ? 'Shorter scenes' : 'Faster cuts'}</span>
          </div>
        </div>
      )}

      <div className="bg-bg-tertiary rounded-lg p-2 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-text-secondary font-medium">{plannedClips.length} {isShortFilm ? 'scenes' : 'clips'}</span>
          <span className="text-text-muted">{formatTime(totalClipDuration)} total</span>
        </div>

        {loading ? (
          /* Stop button sits on the right so the spinner + label stay
             left-aligned (matches the layout used in DirectorPanel's
             "Writing image prompts..." / "Writing video prompts..."
             overlays — same affordance, same icon). The cancel action
             goes through useStore.cancelDirectorV2Plan() which aborts
             the in-flight HTTP request AND tells the backend to short-
             circuit the worker thread, so the GPU/llama-server stops
             generating tokens that no one will read. */
          <div className="relative flex items-center gap-1.5 text-2xs text-text-muted py-1 pr-5">
            <Loader2 size={10} className="animate-spin" /> Recalculating...
            <button
              type="button"
              onClick={() => useStore.getState().cancelDirectorV2Plan()}
              title="Stop recalculating"
              aria-label="Stop recalculating"
              className="absolute right-0 top-1/2 -translate-y-1/2 bg-bg-secondary rounded-full p-0.5 border border-border text-text-muted hover:bg-bg-hover hover:text-text-primary transition-colors"
            >
              <X size={10} />
            </button>
          </div>
        ) : (
          <>
            <div className="flex gap-px h-8 rounded overflow-hidden">
              {plannedClips.map((clip, i) => {
                const clipDur = clip.end - clip.start
                const totalDur = plannedClips.reduce((s, c) => s + (c.end - c.start), 0)
                const widthPct = isShortFilm
                  ? Math.max((clipDur / totalDur) * 100, 1.5)
                  : Math.max((clip.beat_count / plannedClips.reduce((s, c) => s + c.beat_count, 0)) * 100, 1.5)
                const barColor = sectionBarColors[clip.section_label] || 'bg-gray-500'
                const tooltipLabel = isShortFilm
                  ? `Scene ${i + 1}: ${clip.section_label} (${clipDur.toFixed(1)}s)`
                  : `Clip ${i + 1}: ${clip.section_label}, ${clip.beat_count} beats (${clipDur.toFixed(1)}s)`
                return (
                  <div
                    key={i}
                    className={`${barColor} opacity-70 hover:opacity-100 transition-opacity relative group cursor-default`}
                    style={{ width: `${widthPct}%` }}
                    title={tooltipLabel}
                  >
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block z-10 pointer-events-none">
                      <div className="bg-bg-primary border border-border rounded px-1.5 py-1 text-2xs text-text-secondary whitespace-nowrap shadow-lg">
                        {tooltipLabel}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="text-2xs text-text-muted space-y-1">
              {!isShortFilm && <div>{beatDistribution}</div>}
              <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                {Object.entries(sectionBarColors).map(([label, color]) => {
                  const count = plannedClips.filter(c => c.section_label === label).length
                  if (count === 0) return null
                  return (
                    <div key={label} className="flex items-center gap-1">
                      <span className={`w-2 h-2 rounded-sm ${color}`} />
                      <span>{label} ({count})</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </>
        )}
      </div>

      {isActive && (
        <button
          onClick={confirmStructure}
          disabled={loading || plannedClips.length === 0}
          className="w-full py-2 rounded-lg bg-accent-blue text-white text-xs font-medium hover:bg-accent-blue-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
        >
          <ChevronRight size={12} /> Continue
        </button>
      )}
    </div>
  )
}

/**
 * DirectorAdvancedAccordion — collapsed-by-default panel exposing Director's
 * model-specific generation controls and post-processing knobs. It sits in
 * the chat sidebar alongside the LoRA accordion so per-shoot tweaks are
 * co-located with the rest of the per-shoot setup.
 *
 * Defaults are intentionally "off" for all controls so a user who
 * never opens this accordion gets clean unprocessed output. Each
 * control has a one-line description making clear what it does and
 * what it costs (e.g. "may introduce artifacts" for the refiner)
 * rather than implying a quality hierarchy.
 *
 * No "Quality" preset bundling — the three controls are independent
 * with distinct purposes (resolution change vs aesthetic vs
 * experimental). See the design discussion captured in commit notes.
 */
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
        {clipPlans.map((plan, i) => {
          const clip = plannedClips[i]
          const image = clipImages.find(item => item.clipIndex === i)
          const status = image
            ? 'ready'
            : imageGenProgress?.status === 'error' && imageGenProgress.current === i
              ? 'failed'
              : imageGenProgress && imageGenProgress.current === i && imageGenProgress.status !== 'done'
                ? 'generating'
                : 'pending'
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
              </div>
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
  const [queueConfirmation, setQueueConfirmation] = useState<string | null>(null)

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
          don't double-scroll. */}
      <div className="space-y-2">
        {clipPlans.map((plan, i) => {
          const clip = plannedClips[i]
          const clipImage = clipImages.find(image => image.clipIndex === i)
          const currentClip = pipelineStatus?.progress?.current_clip
          const totalClips = pipelineStatus?.progress?.total_clips
          const status = pipelineStatus?.status === 'failed' && currentClip === i + 1
            ? 'failed'
            : clipImage
              ? 'ready'
              : pipelineStatus?.status === 'running' && currentClip === i + 1
                ? 'generating'
                : 'pending'
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
              </div>
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
    </div>
  )
}
