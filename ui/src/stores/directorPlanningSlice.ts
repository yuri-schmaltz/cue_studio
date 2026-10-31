/**
 * Director planning & storyboard slice.
 *
 * Encapsulates:
 * - Audio analysis and plan orchestration (directorUploadAndAnalyze, directorAnalyzeAndPlan)
 * - Music video track writing and generation (directorWriteSong, directorGenerateTrack)
 * - Clip structure planning (directorEnsureStructure, directorSetEnergyBias, directorConfirmStructure)
 * - Prompt generation (directorPlanPrompts, directorPlanVideoPrompts, directorEditClipPlan)
 * - Start-image generation loop (directorGenerateStartImages)
 * - Timeline / editor handoff (directorApplyToClips, directorGenerate, directorReset)
 * - Reference management (_uploadDirectorRefs, character & location refs)
 * - Negative prompt derivation & debouncing
 * - In-flight cancellations (cancelDirectorV2Plan, cancelDirectorAnalyze, cancelDirectorTrackGen, cancelDirectorImageGen)
 */

import type { StateCreator } from 'zustand'
import * as api from '../api/client'
import type { AppState } from './useStore'
import type {
  DirectorClipImage,
  DirectorShotImageGuidance,
  MultiClip,
  SpeakerMapping,
} from '../types'
import { trackAnalysisProgress } from './analysisProgress'

export const DIRECTOR_NEGATIVE_PROMPT_DEBOUNCE_MS = 1200
export const DIRECTOR_PIPELINE_ACTIVE = new Set(['queued', 'running', 'paused'])

export type DirectorPlanningSlice = {
  directorUploadAndAnalyze: (file: File) => Promise<void>
  directorMusicSource: 'upload' | 'generate' | null
  directorMusicModel: string
  directorAdvancedDefaults: Record<string, unknown>
  directorSongDescription: string
  directorSongInstrumental: boolean
  directorSongStyle: string
  directorSongLyrics: string
  directorSongDuration: number
  directorTrackGenerating: boolean
  setDirectorMusicSource: (s: 'upload' | 'generate' | null) => void
  setDirectorMusicModel: (modelType: string) => void
  setDirectorSongDescription: (v: string) => void
  setDirectorSongInstrumental: (v: boolean) => void
  setDirectorSongStyle: (v: string) => void
  setDirectorSongLyrics: (v: string) => void
  setDirectorSongDuration: (v: number) => void
  directorWriteSong: () => Promise<void>
  directorGenerateTrack: (mode?: 'now' | 'queue') => Promise<void>
  directorSetAudioFile: (file: File | null) => void
  directorNegativePrompt: string
  directorGenerateNegativePrompt: () => Promise<void>
  directorSetNegativePrompt: (v: string) => Promise<void>
  directorAnalyzeAndPlan: (audioPath: string, opts?: { transcribe?: boolean; lyricsHint?: string }) => Promise<void>
  directorEnsureStructure: () => Promise<Awaited<ReturnType<typeof import('../api/client').planClipStructure>>>
  directorSetEnergyBias: (bias: number) => Promise<void>
  directorConfirmStructure: () => void
  directorSetSceneDescription: (prompt: string) => void
  directorSetReferenceImage: (file: File | null) => void
  directorAddCharacterRef: (file: File) => void
  directorRemoveCharacterRef: (index: number) => void
  directorSetCharacterRefLabel: (index: number, label: string) => void
  directorReorderCharacterRefs: (from: number, to: number) => void
  directorAddLocationRef: (file: File) => void
  directorRemoveLocationRef: (index: number) => void
  directorSetLocationRefLabel: (index: number, label: string) => void
  directorReorderLocationRefs: (from: number, to: number) => void
  directorPlanPrompts: () => Promise<void>
  directorPlanVideoPrompts: () => Promise<void>
  cancelDirectorV2Plan: () => void
  cancelDirectorAnalyze: () => boolean
  cancelDirectorTrackGen: () => boolean
  cancelDirectorImageGen: () => boolean
  directorGenerateStartImages: () => Promise<void>
  directorApplyToClips: () => void
  directorGenerate: () => void
  directorReset: () => void
  directorEditClipPlan: (index: number, field: 'video_prompt' | 'image_prompt', value: string) => void
  _uploadDirectorRefs: () => Promise<{ refImagePath: string | null; charPaths: string[]; locPaths: string[]; speakerImagePaths: Record<string, string> }>
}

export type DirectorPlanningDeps = {
  startDirectLlmStreamPolling: (set: any, get: any) => () => void
  directorUsesGeneratedShotImages: (state: AppState) => boolean
  resolveResolution: (options: any, preset: string, aspectRatio: string) => string
  normalizeH3ClipFrameSchedule: (frames: number[], min: number, max: number, step: number) => number[]
  getAnalysisSequence: () => number
  bumpAnalysisSequence: () => number
  getAnalyzeController: () => AbortController | null
  setAnalyzeController: (c: AbortController | null) => void
  getAnalyzeStopPoll: () => (() => void) | null
  setAnalyzeStopPoll: (fn: (() => void) | null) => void
  getTrackGenSequence: () => number
  bumpTrackGenSequence: () => number
  getTrackGenPoll: () => ReturnType<typeof setInterval> | null
  setTrackGenPoll: (poll: ReturnType<typeof setInterval> | null) => void
  getTrackGenController: () => AbortController | null
  setTrackGenController: (c: AbortController | null) => void
  getImageGenSequence: () => number
  bumpImageGenSequence: () => number
  getImageGenJob: () => string | null
  setImageGenJob: (j: string | null) => void
  getImageGenPoll: () => ReturnType<typeof setInterval> | null
  setImageGenPoll: (poll: ReturnType<typeof setInterval> | null) => void
  getV2PlanController: () => AbortController | null
  setV2PlanController: (c: AbortController | null) => void
  bumpPipelineAttachToken: () => number
  getNegativePromptDebounce: () => ReturnType<typeof setTimeout> | null
  setNegativePromptDebounce: (timer: ReturnType<typeof setTimeout> | null) => void
}

export const createDirectorPlanningSlice = (
  set: Parameters<StateCreator<AppState, [], [], DirectorPlanningSlice>>[0],
  get: Parameters<StateCreator<AppState, [], [], DirectorPlanningSlice>>[1],
  _store: Parameters<StateCreator<AppState, [], [], DirectorPlanningSlice>>[2],
  deps: DirectorPlanningDeps,
): DirectorPlanningSlice => ({
  directorMusicSource: null,
  directorMusicModel: 'ace_step',
  directorAdvancedDefaults: {},
  directorSongDescription: '',
  directorSongInstrumental: false,
  directorSongStyle: '',
  directorSongLyrics: '',
  directorSongDuration: 120,
  directorTrackGenerating: false,
  directorNegativePrompt: '',

  setDirectorMusicSource: (s) => set({ directorMusicSource: s }),
  setDirectorMusicModel: (modelType) => set({ directorMusicModel: modelType }),
  setDirectorSongDescription: (v) => set({ directorSongDescription: v }),
  setDirectorSongInstrumental: (v) => set({ directorSongInstrumental: v }),
  setDirectorSongStyle: (v) => set({ directorSongStyle: v }),
  setDirectorSongLyrics: (v) => set({ directorSongLyrics: v }),
  setDirectorSongDuration: (v) => set({ directorSongDuration: Math.min(60 * 60, Math.max(10, v)) }),

  directorUploadAndAnalyze: async (file) => {
    set({
      directorLoading: true,
      directorActivityLabel: 'Analyzing',
      directorLoadingMessage: 'Uploading audio...',
      directorError: null,
      directorAudioFile: file,
      directorStep: 'analyze',
    })
    const analysisSequence = deps.bumpAnalysisSequence()
    const analyzeController = new AbortController()
    deps.setAnalyzeController(analyzeController)
    try {
      const uploaded = await api.uploadAudio(file, analyzeController.signal)
      if (analysisSequence !== deps.getAnalysisSequence()) return
      await get().directorAnalyzeAndPlan(uploaded.path, { transcribe: true })
    } catch (e: unknown) {
      if (analysisSequence !== deps.getAnalysisSequence()) return
      const msg = e instanceof Error ? e.message : 'Upload failed'
      console.error('Director upload failed:', e)
      set({ directorLoading: false, directorLoadingMessage: null, directorActivityLabel: 'Idle', directorError: msg, directorStep: 'upload' })
    } finally {
      if (analysisSequence === deps.getAnalysisSequence() && deps.getAnalyzeController() === analyzeController) {
        deps.setAnalyzeController(null)
      }
    }
  },

  directorAnalyzeAndPlan: async (audioPath, opts) => {
    const transcribe = opts?.transcribe !== false
    set({
      directorAudioPath: audioPath,
      directorLoading: true,
      directorActivityLabel: 'Analyzing',
      directorLoadingMessage: 'Analyzing audio...',
      directorError: null,
      directorStep: 'analyze',
    })
    const analysisSequence = deps.bumpAnalysisSequence()
    const analyzeController = new AbortController()
    deps.setAnalyzeController(analyzeController)
    const progress = trackAnalysisProgress(
      api.fetchAudioAnalyzeStatus,
      value => set({
        directorAnalyzeProgress: value,
        ...(value.status === 'running' ? { directorLoadingMessage: `${value.message}...` } : {}),
      }),
      () => analysisSequence === deps.getAnalysisSequence(),
    )
    let analyzePoll: ReturnType<typeof setInterval> | null = null
    const startAnalyzePolling = () => {
      analyzePoll = setInterval(() => { void progress.refresh() }, 1000)
    }
    const stopAnalyzePolling = () => {
      if (analyzePoll !== null) clearInterval(analyzePoll)
      analyzePoll = null
      progress.cancel()
      deps.setAnalyzeStopPoll(null)
    }
    deps.setAnalyzeStopPoll(stopAnalyzePolling)
    try {
      startAnalyzePolling()
      let analysis = await api.analyzeAudio({
        audio_path: audioPath,
        transcribe,
        extract_vocals: transcribe,
        lyrics_hint: opts?.lyricsHint || undefined,
      }, analyzeController.signal)
      if (analysisSequence !== deps.getAnalysisSequence()) return
      progress.finish('done')
      stopAnalyzePolling()
      if (Number(analysis.duration || 0) > 60 * 60 + 0.5) {
        throw new Error('Director supports source timelines up to 60 minutes. Trim this audio to one hour or less and try again.')
      }

      if (analysis.lyrics && analysis.lyrics.length > 0) {
        try {
          set({ directorLoadingMessage: 'Identifying sections (LLM)...' })
          const classified = await api.classifySections({ analysis })
          analysis = {
            ...analysis,
            sections: classified.sections,
            song_structure: classified.song_structure || null,
          }
        } catch {
          // LLM not available — keep heuristic labels
        }
      }

      if (analysisSequence !== deps.getAnalysisSequence()) return
      set({ directorAnalysis: analysis })

      const speakers: string[] = []
      if (analysis.lyrics) {
        const seen = new Set<string>()
        for (const seg of analysis.lyrics) {
          if (seg.speaker && !seen.has(seg.speaker)) {
            seen.add(seg.speaker)
            speakers.push(seg.speaker)
          }
        }
      }
      const existingMappings = get().directorSpeakerMappings
      const existingCharRefs = get().directorCharacterRefs
      const existingCharLabels = get().directorCharacterRefLabels
      const speakerMappings: SpeakerMapping[] = speakers.map((s, idx) => {
        const prev = existingMappings.find(m => m.speakerId === s)
        if (prev) return prev
        const existingRef = existingCharRefs[idx]
        const existingLabel = existingCharLabels[idx] || ''
        if (existingRef) {
          return {
            speakerId: s,
            name: existingLabel,
            role: '' as const,
            image: existingRef,
            imagePreview: URL.createObjectURL(existingRef),
          }
        }
        return {
          speakerId: s,
          name: '',
          role: '' as const,
        }
      })
      set({ directorSpeakers: speakers, directorSpeakerMappings: speakerMappings })

      set({ directorLoadingMessage: 'Planning clip structure...' })
      const structure = await get().directorEnsureStructure()
      const isMusicVideo = get().directorSkill === 'music_video'
      set({
        directorPlannedClips: structure.clips,
        directorStep: isMusicVideo ? 'style' : 'structure',
        directorLoading: false,
        directorLoadingMessage: null,
      })
    } catch (e: unknown) {
      if (analysisSequence !== deps.getAnalysisSequence()) return
      progress.finish('error')
      const msg = e instanceof Error ? e.message : 'Analysis failed'
      console.error('Director analysis failed:', e)
      set({ directorLoading: false, directorLoadingMessage: null, directorError: msg, directorStep: 'upload' })
      throw e
    } finally {
      stopAnalyzePolling()
      deps.setAnalyzeController(null)
      deps.setAnalyzeStopPoll(null)
    }
  },

  directorEnsureStructure: async () => {
    const state = get()
    if (!state.directorAnalysis) {
      throw new Error('Analyze the audio before planning its structure.')
    }
    const structure = await api.planClipStructure({
      analysis: state.directorAnalysis,
      energy_bias: state.directorEnergyBias,
      fps: state.modelOptions?.fps ?? 16,
      frames_steps: state.modelOptions?.frames_steps ?? 4,
      frames_minimum: state.modelOptions?.frames_minimum ?? 5,
      video_model: state.selectedModelPerMode.video || undefined,
    })
    set({ directorPlannedClips: structure.clips })
    return structure
  },

  directorWriteSong: async () => {
    const s = get()
    const description = s.directorSongDescription.trim()
    if (!description) return
    let refPath = s.directorReferenceImagePath
    if (!refPath && s.directorReferenceImage) {
      try {
        refPath = (await api.uploadImage(s.directorReferenceImage)).path
        set({ directorReferenceImagePath: refPath })
      } catch { /* image upload is best-effort */ }
    }
    set({ directorError: null })
    const r = await api.writeSong({
      description,
      instrumental: s.directorSongInstrumental,
      duration_seconds: s.directorSongDuration,
      reference_image_path: refPath || undefined,
      model_type: s.directorMusicModel,
    })
    set({
      directorSongStyle: r.style || '',
      directorSongLyrics: s.directorSongInstrumental ? '[Instrumental]' : (r.lyrics || ''),
    })
  },

  directorGenerateTrack: async (mode = 'now') => {
    const s = get()
    const instrumental = s.directorSongInstrumental
    const description = s.directorSongDescription.trim()
    const style = s.directorSongStyle.trim()
    const lyrics = s.directorSongLyrics.trim()
    if (!description && !style && !lyrics) {
      set({ directorError: 'Describe your song (or fill in Style / Lyrics) first.' })
      return
    }
    let refPath = s.directorReferenceImagePath
    if (!refPath && s.directorReferenceImage) {
      try {
        refPath = (await api.uploadImage(s.directorReferenceImage)).path
        set({ directorReferenceImagePath: refPath })
      } catch { /* image upload is best-effort */ }
    }
    set({
      directorTrackGenerating: true,
      directorError: null,
      directorLoading: true,
      directorActivityLabel: (!style || !lyrics) && description
        ? 'Writing song'
        : 'Generating music',
      directorLoadingMessage: (!style || !lyrics) && description
        ? 'Writing song…'
        : 'Preparing music generation…',
      directorStep: 'analyze',
    })
    const randomPart = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '')
      : `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`
    const musicProgressId = `music_${randomPart.slice(0, 32)}`
    const trackSequence = deps.bumpTrackGenSequence()
    const trackController = new AbortController()
    deps.setTrackGenController(trackController)
    let musicProgressPoll: ReturnType<typeof setInterval> | null = null
    const pollMusicProgress = async () => {
      if (trackSequence !== deps.getTrackGenSequence()) return
      try {
        const status = await api.fetchJobStatus(musicProgressId)
        if (trackSequence !== deps.getTrackGenSequence()) return
        const phase = (status.phase || status.message || '').trim()
        if (status.status === 'queued') {
          set({ directorLoadingMessage: 'Music generation queued…' })
          return
        }
        if (status.status === 'running') {
          const percent = status.total_steps > 0
            ? Math.min(100, Math.max(0, Math.round((status.step / status.total_steps) * 100)))
            : Math.min(100, Math.max(0, Math.round(status.progress || 0)))
          const counter = status.total_steps > 0
            ? ` · ${status.step}/${status.total_steps} (${percent}%)`
            : status.progress > 0 ? ` · ${percent}%` : ''
          set({ directorLoadingMessage: `${phase || 'Generating music…'}${counter}` })
        }
      } catch {
        // Still active or preparing
      }
    }
    deps.setTrackGenPoll(null)
    try {
      const trackPromise = api.generateMusic({
        description: description || undefined,
        style: style || undefined,
        lyrics: instrumental ? '[Instrumental]' : (lyrics || undefined),
        instrumental,
        duration_seconds: s.directorSongDuration,
        reference_image_path: refPath || undefined,
        model_type: s.directorMusicModel,
        workspace: get().activeWorkspace || undefined,
        progress_id: musicProgressId,
        signal: trackController.signal,
      })
      void pollMusicProgress()
      musicProgressPoll = setInterval(() => { void pollMusicProgress() }, 1000)
      deps.setTrackGenPoll(musicProgressPoll)
      setTimeout(() => { void get().reconnectJobs() }, 1200)
      setTimeout(() => { void get().reconnectJobs() }, 5000)
      const r = await trackPromise
      if (trackSequence !== deps.getTrackGenSequence()) return
      set({
        directorSongStyle: r.style || style,
        directorSongLyrics: instrumental ? '[Instrumental]' : (r.lyrics || lyrics),
        directorTrackGenerating: false,
      })
      if (!get().directorSceneDescription.trim() && description) {
        set({ directorSceneDescription: description })
      }
      await get().directorAnalyzeAndPlan(r.audio_path, {
        transcribe: !instrumental,
        lyricsHint: instrumental ? undefined : (r.lyrics || lyrics || undefined),
      })
      if (get().directorStep === 'style') {
        if (mode === 'queue') {
          await get().startDirectorPipeline('queue')
        } else if (get().directorAutoMode) {
          await get().startDirectorPipeline()
        } else {
          await get().directorPlanPrompts()
        }
      }
    } catch (e: unknown) {
      if (trackSequence !== deps.getTrackGenSequence()) return
      const msg = e instanceof Error ? e.message : 'Music generation failed'
      console.error('Director music generation failed:', e)
      set({
        directorTrackGenerating: false,
        directorLoading: false,
        directorLoadingMessage: null,
        directorError: msg,
        directorStep: 'upload',
      })
    } finally {
      if (musicProgressPoll !== null) clearInterval(musicProgressPoll)
      if (deps.getTrackGenPoll() === musicProgressPoll) deps.setTrackGenPoll(null)
      if (deps.getTrackGenController() === trackController) deps.setTrackGenController(null)
    }
  },

  directorSetEnergyBias: async (bias) => {
    const { directorAnalysis } = get()
    if (!directorAnalysis) return
    set({ directorLoading: true, directorEnergyBias: bias })
    try {
      const structure = await api.planClipStructure({
        analysis: directorAnalysis,
        energy_bias: bias,
        fps: get().modelOptions?.fps ?? 16,
        frames_steps: get().modelOptions?.frames_steps ?? 4,
        frames_minimum: get().modelOptions?.frames_minimum ?? 5,
        video_model: get().selectedModelPerMode.video || undefined,
      })
      set({ directorPlannedClips: structure.clips, directorLoading: false })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to update structure'
      set({ directorLoading: false, directorError: msg })
    }
  },

  directorConfirmStructure: () => {
    set({ directorStep: 'style', directorLoading: false })
  },

  directorSetAudioFile: (file) => set({
    directorAudioFile: file,
    directorAudioPath: null,
  }),

  directorGenerateNegativePrompt: async () => {
    const state = get()
    const scene = (state.directorSceneDescription || '').trim()
    if (!scene) return
    const pid = state.directorProjectId || state.pipelineId
    try {
      const lyricsSummary = state.directorAnalysis?.lyrics
        ? state.directorAnalysis.lyrics
            .slice(0, 8)
            .map((seg: { speaker?: string | null; text?: string }) =>
              `${seg.speaker || '—'}: ${(seg.text || '').slice(0, 80)}`)
            .join(' / ')
        : ''
      let styleBibles: Array<{ name?: string; description?: string }> = []
      try {
        const all = await api.fetchStyleBibles()
        styleBibles = (all?.bibles || []).slice(0, 3).map((sb: { name?: string; description?: string }) => ({
          name: sb.name,
          description: sb.description,
        }))
      } catch {
        // Best-effort
      }
      const { negative_prompt } = await api.generateDirectorNegativePrompt({
        scene_description: scene,
        style_bibles: styleBibles,
        lyrics_summary: lyricsSummary,
      })
      set({ directorNegativePrompt: negative_prompt })
      if (pid) {
        try {
          await api.setDirectorNegativePrompt(pid, negative_prompt)
        } catch {
          // Best-effort
        }
      }
    } catch {
      // Surface failure as no-op
    }
  },

  directorSetNegativePrompt: async (v) => {
    const state = get()
    const pid = state.directorProjectId || state.pipelineId
    set({ directorNegativePrompt: v })
    if (pid) {
      try {
        await api.setDirectorNegativePrompt(pid, v)
      } catch {
        // Best-effort
      }
    }
  },

  directorSetReferenceImage: (file) => set({
    directorReferenceImage: file,
    directorReferenceImagePath: null,
  }),

  directorAddCharacterRef: (file) => set(s => ({
    directorCharacterRefs: [...s.directorCharacterRefs, file],
    directorCharacterRefLabels: [...s.directorCharacterRefLabels, ''],
  })),

  directorRemoveCharacterRef: (index) => set(s => ({
    directorCharacterRefs: s.directorCharacterRefs.filter((_, i) => i !== index),
    directorCharacterRefPaths: s.directorCharacterRefPaths.filter((_, i) => i !== index),
    directorCharacterRefLabels: s.directorCharacterRefLabels.filter((_, i) => i !== index),
  })),

  directorSetCharacterRefLabel: (index, label) => set(s => {
    const labels = [...s.directorCharacterRefLabels]
    labels[index] = label
    return { directorCharacterRefLabels: labels }
  }),

  directorReorderCharacterRefs: (from, to) => set(s => {
    const refs = [...s.directorCharacterRefs]
    const paths = [...s.directorCharacterRefPaths]
    const labels = [...s.directorCharacterRefLabels]
    const [rF] = refs.splice(from, 1); refs.splice(to, 0, rF)
    const [pF] = paths.splice(from, 1); paths.splice(to, 0, pF)
    const [lF] = labels.splice(from, 1); labels.splice(to, 0, lF)
    return { directorCharacterRefs: refs, directorCharacterRefPaths: paths, directorCharacterRefLabels: labels }
  }),

  directorAddLocationRef: (file) => set(s => ({
    directorLocationRefs: [...s.directorLocationRefs, file],
    directorLocationRefLabels: [...s.directorLocationRefLabels, ''],
  })),

  directorRemoveLocationRef: (index) => set(s => ({
    directorLocationRefs: s.directorLocationRefs.filter((_, i) => i !== index),
    directorLocationRefPaths: s.directorLocationRefPaths.filter((_, i) => i !== index),
    directorLocationRefLabels: s.directorLocationRefLabels.filter((_, i) => i !== index),
  })),

  directorSetLocationRefLabel: (index, label) => set(s => {
    const labels = [...s.directorLocationRefLabels]
    labels[index] = label
    return { directorLocationRefLabels: labels }
  }),

  directorReorderLocationRefs: (from, to) => set(s => {
    const refs = [...s.directorLocationRefs]
    const paths = [...s.directorLocationRefPaths]
    const labels = [...s.directorLocationRefLabels]
    const [rF] = refs.splice(from, 1); refs.splice(to, 0, rF)
    const [pF] = paths.splice(from, 1); paths.splice(to, 0, pF)
    const [lF] = labels.splice(from, 1); labels.splice(to, 0, lF)
    return { directorLocationRefs: refs, directorLocationRefPaths: paths, directorLocationRefLabels: labels }
  }),

  directorSetSceneDescription: (prompt) => {
    set({ directorSceneDescription: prompt })
    const debounce = deps.getNegativePromptDebounce()
    if (debounce) {
      clearTimeout(debounce)
      deps.setNegativePromptDebounce(null)
    }
    if (prompt.trim()) {
      const timer = setTimeout(() => {
        deps.setNegativePromptDebounce(null)
        void get().directorGenerateNegativePrompt()
      }, DIRECTOR_NEGATIVE_PROMPT_DEBOUNCE_MS)
      deps.setNegativePromptDebounce(timer)
    } else {
      void get().directorSetNegativePrompt('')
    }
  },

  _uploadDirectorRefs: async () => {
    const s = get()
    let refImagePath = s.directorReferenceImagePath
    if (s.directorReferenceImage && !refImagePath) {
      const uploaded = await api.uploadImage(s.directorReferenceImage)
      refImagePath = uploaded.path
      set({ directorReferenceImagePath: refImagePath })
    }
    const charPaths = [...s.directorCharacterRefPaths]
    for (let i = charPaths.length; i < s.directorCharacterRefs.length; i++) {
      const uploaded = await api.uploadImage(s.directorCharacterRefs[i])
      charPaths.push(uploaded.path)
    }
    if (charPaths.length > s.directorCharacterRefPaths.length) {
      set({ directorCharacterRefPaths: charPaths })
    }
    const locPaths = [...s.directorLocationRefPaths]
    for (let i = locPaths.length; i < s.directorLocationRefs.length; i++) {
      const uploaded = await api.uploadImage(s.directorLocationRefs[i])
      locPaths.push(uploaded.path)
    }
    if (locPaths.length > s.directorLocationRefPaths.length) {
      set({ directorLocationRefPaths: locPaths })
    }
    const speakerImagePaths: Record<string, string> = {}
    for (const m of s.directorSpeakerMappings) {
      if (m.image) {
        try {
          const uploaded = await api.uploadImage(m.image)
          speakerImagePaths[m.speakerId] = uploaded.path
        } catch (e) {
          console.warn(`[Director] Failed to upload speaker reference image for ${m.speakerId}:`, e)
        }
      }
    }
    return { refImagePath, charPaths, locPaths, speakerImagePaths }
  },

  directorPlanPrompts: async () => {
    let { directorPlannedClips, directorAnalysis } = get()
    const directorSceneDescription = get().directorSceneDescription
    if (!directorSceneDescription.trim()) return

    const shouldPlanStructure = (
      get().directorSkill === 'music_video'
      && get().directorStep === 'style'
      && directorPlannedClips.length === 0
    )
    deps.getV2PlanController()?.abort()
    const planController = new AbortController()
    deps.setV2PlanController(planController)
    set({
      directorLoading: true,
      directorError: null,
      directorStep: 'plan',
      directorActivityLabel: 'Planning with LLM',
      directorLoadingMessage: 'Planning scene prompts with LLM...',
      directorActivityFraction: NaN,
      llmStreamText: '',
      llmStreamDone: false,
    })
    const stopStreamPoll = deps.startDirectLlmStreamPolling(set, get)
    try {
      if (shouldPlanStructure) {
        set({ directorLoadingMessage: 'Planning clips from the analyzed timeline...' })
        const structure = await get().directorEnsureStructure()
        directorPlannedClips = structure.clips
        directorAnalysis = get().directorAnalysis
      }
      if (!directorPlannedClips.length || !directorAnalysis) return

      const { refImagePath, charPaths, locPaths, speakerImagePaths } = await get()._uploadDirectorRefs()
      const { directorCharacterRefLabels: charLabels, directorLocationRefLabels: locLabels } = get()
      const mergedCharPaths = [...charPaths]
      const mergedCharLabels = [...charLabels]
      for (const m of get().directorSpeakerMappings) {
        if (m.image && speakerImagePaths[m.speakerId]) {
          const p = speakerImagePaths[m.speakerId]
          if (!mergedCharPaths.includes(p)) {
            mergedCharPaths.push(p)
            mergedCharLabels.push(m.name.trim() || m.speakerId)
          }
        }
      }
      const extraRefs = {
        ...(mergedCharPaths.length > 0 ? { character_ref_paths: mergedCharPaths, character_ref_labels: mergedCharLabels } : {}),
        ...(locPaths.length > 0 ? { location_ref_paths: locPaths, location_ref_labels: locLabels } : {}),
      }
      const generateShotImages = deps.directorUsesGeneratedShotImages(get())
      const promptType = generateShotImages ? 'both' : 'video'

      const speakerMappings: Record<string, { name: string; role: string }> = {}
      for (const m of get().directorSpeakerMappings) {
        if (m.name.trim()) {
          speakerMappings[m.speakerId] = { name: m.name, role: m.role }
        }
      }

      const selectedSkill = get().directorSkill || 'music_video'
      const useV2 = (get().servicesConfig?.use_director_v2 ?? true)
        || !['music_video', 'short_film'].includes(selectedSkill)
      let plans: Array<{ video_prompt: string; image_prompt: string }>

      if (useV2) {
        const result = await api.directorV2Plan({
          skill_type: get().directorSkill || 'music_video',
          clips: directorPlannedClips,
          scene_description: directorSceneDescription,
          lyrics: directorAnalysis?.lyrics ?? undefined,
          bpm: directorAnalysis?.bpm ?? 120,
          reference_image_path: refImagePath ?? undefined,
          ...extraRefs,
          speaker_mappings: Object.keys(speakerMappings).length > 0 ? speakerMappings : undefined,
          prompt_type: promptType,
          register_pipeline: {
            enable: true,
            params: {
              workspace: get().activeWorkspace || '',
              auto_mode: get().directorAutoMode ?? true,
              skill_type: get().directorSkill || 'music_video',
              pipeline_type: get().directorSkill || 'music_video',
            },
          },
        }, { signal: planController.signal })
        if (result.pipeline_id) {
          const attachToken = deps.bumpPipelineAttachToken()
          void api.fetchPipelineStatus(result.pipeline_id).then(status => {
            const active = DIRECTOR_PIPELINE_ACTIVE.has(status.status)
            set(state => ({
              pipelineId: result.pipeline_id,
              directorProjectId: state.directorProjectId || result.pipeline_id,
              directorSourcePipelineId: result.pipeline_id,
              pipelineStatus: status,
              pipelinePolling: active,
            }))
            if (active) get().pollPipelineStatus()
          }).catch(e => {
            console.warn('[Director] Failed to attach registered pipeline:', e)
          })
        }
        plans = result.clip_plans.map(p => ({
          video_prompt: p.video_prompt || '',
          image_prompt: p.image_prompt || '',
        }))
      } else {
        const result = await api.planClipPromptsAndImages({
          clips: directorPlannedClips,
          scene_description: directorSceneDescription,
          lyrics: directorAnalysis?.lyrics ?? undefined,
          bpm: directorAnalysis?.bpm ?? 120,
          reference_image_path: refImagePath,
          ...extraRefs,
          speaker_mappings: Object.keys(speakerMappings).length > 0 ? speakerMappings : undefined,
          prompt_type: promptType,
        }, { signal: planController.signal })
        plans = result.clip_plans.map(p => ({
          video_prompt: p.video_prompt || '',
          image_prompt: p.image_prompt || '',
        }))
      }
      set({
        directorClipPlans: plans,
        directorStep: generateShotImages ? 'review' : 'review_video',
        directorLoading: false,
        directorActivityLabel: '',
        directorActivityFraction: 0,
        llmStreamDone: true,
      })

      if (get().directorAutoMode) {
        if (generateShotImages) {
          get().directorGenerateStartImages()
        } else {
          get().directorGenerate()
        }
      }
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        set({
          directorLoading: false,
          directorError: null,
          directorStep: 'style',
          directorActivityLabel: '',
          directorActivityFraction: 0,
          llmStreamDone: true,
        })
        return
      }
      const msg = e instanceof Error ? e.message : 'Planning failed'
      console.error('Director planning failed:', e)
      set({
        directorLoading: false,
        directorError: msg,
        directorStep: 'style',
        directorActivityLabel: '',
        directorActivityFraction: 0,
        llmStreamDone: true,
      })
    } finally {
      stopStreamPoll()
      if (deps.getV2PlanController() === planController) {
        deps.setV2PlanController(null)
      }
    }
  },

  cancelDirectorV2Plan: () => {
    const controller = deps.getV2PlanController()
    if (!controller) return
    controller.abort()
    void api.cancelDirectorV2Plan().catch(() => undefined)
    set({
      directorLoading: false,
      directorError: null,
      directorActivityLabel: 'Idle',
      directorActivityFraction: 0,
      llmStreamDone: true,
    })
  },

  cancelDirectorAnalyze: () => {
    const isAnalyzing = deps.getAnalyzeController() !== null || deps.getAnalyzeStopPoll() !== null || get().directorStep === 'analyze'
    if (!isAnalyzing) return false
    const controller = deps.getAnalyzeController()
    const stop = deps.getAnalyzeStopPoll()
    deps.setAnalyzeController(null)
    deps.setAnalyzeStopPoll(null)
    deps.bumpAnalysisSequence()
    if (controller) {
      try { controller.abort() } catch { /* already aborted */ }
    }
    if (stop) {
      try { stop() } catch { /* best-effort */ }
    }
    set({
      directorLoading: false,
      directorLoadingMessage: null,
      directorActivityLabel: 'Idle',
      directorError: null,
      directorStep: 'upload',
    })
    return true
  },

  cancelDirectorTrackGen: () => {
    if (!deps.getTrackGenController() && !deps.getTrackGenPoll()) return false
    const controller = deps.getTrackGenController()
    const poll = deps.getTrackGenPoll()
    deps.setTrackGenController(null)
    deps.setTrackGenPoll(null)
    deps.bumpTrackGenSequence()
    if (controller) {
      try { controller.abort() } catch { /* already aborted */ }
    }
    if (poll !== null) {
      clearInterval(poll)
    }
    set({
      directorTrackGenerating: false,
      directorLoading: false,
      directorLoadingMessage: null,
      directorError: null,
      directorStep: 'upload',
    })
    return true
  },

  cancelDirectorImageGen: () => {
    if (!deps.getImageGenJob() && deps.getImageGenPoll() === null) return false
    const job = deps.getImageGenJob()
    const poll = deps.getImageGenPoll()
    deps.setImageGenJob(null)
    deps.setImageGenPoll(null)
    deps.bumpImageGenSequence()
    if (poll !== null) {
      clearInterval(poll)
    }
    if (job) {
      void api.cancelJob(job).catch(() => undefined)
    }
    const current = get().directorImageGenProgress
    set({
      directorLoading: false,
      directorError: null,
      directorStep: 'review',
      directorImageGenProgress: current
        ? { ...current, status: 'cancelled' }
        : null,
    })
    return true
  },

  directorPlanVideoPrompts: async () => {
    const { directorPlannedClips, directorSceneDescription, directorAnalysis, directorClipPlans, directorReferenceImagePath } = get()
    if (!directorPlannedClips.length || !directorClipPlans.length) return
    deps.getV2PlanController()?.abort()
    const planController = new AbortController()
    deps.setV2PlanController(planController)
    set({
      directorLoading: true,
      directorError: null,
      directorStep: 'plan_video',
      directorActivityLabel: 'Planning video prompts',
      directorLoadingMessage: 'Planning video prompts with LLM...',
      directorActivityFraction: NaN,
      llmStreamText: '',
      llmStreamDone: false,
    })
    const stopStreamPoll = deps.startDirectLlmStreamPolling(set, get)
    try {
      const speakerMappings: Record<string, { name: string; role: string }> = {}
      for (const m of get().directorSpeakerMappings) {
        if (m.name.trim()) {
          speakerMappings[m.speakerId] = { name: m.name, role: m.role }
        }
      }

      const existingImagePrompts = directorClipPlans.map(p => p.image_prompt || '')
      const { directorCharacterRefPaths: crp, directorLocationRefPaths: lrp } = get()
      const result = await api.planClipPromptsAndImages({
        clips: directorPlannedClips,
        scene_description: directorSceneDescription,
        lyrics: directorAnalysis?.lyrics ?? undefined,
        bpm: directorAnalysis?.bpm ?? 120,
        reference_image_path: directorReferenceImagePath,
        ...(crp.length > 0 ? { character_ref_paths: crp } : {}),
        ...(lrp.length > 0 ? { location_ref_paths: lrp } : {}),
        speaker_mappings: Object.keys(speakerMappings).length > 0 ? speakerMappings : undefined,
        prompt_type: 'video',
        existing_image_prompts: existingImagePrompts,
      }, { signal: planController.signal })
      const updatedPlans = directorClipPlans.map((plan, i) => ({
        ...plan,
        video_prompt: result.clip_plans[i]?.video_prompt || '',
      }))
      set({
        directorClipPlans: updatedPlans,
        directorStep: 'review_video',
        directorLoading: false,
        directorActivityLabel: '',
        directorActivityFraction: 0,
        llmStreamDone: true,
      })

      if (get().directorAutoMode) {
        get().directorGenerate()
      }
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        set({
          directorLoading: false,
          directorError: null,
          directorStep: 'generate_images',
          directorActivityLabel: '',
          directorActivityFraction: 0,
          llmStreamDone: true,
        })
        return
      }
      const msg = e instanceof Error ? e.message : 'Video prompt planning failed'
      console.error('Director video planning failed:', e)
      set({
        directorLoading: false,
        directorError: msg,
        directorStep: 'generate_images',
        directorActivityLabel: '',
        directorActivityFraction: 0,
        llmStreamDone: true,
      })
    } finally {
      stopStreamPoll()
      if (deps.getV2PlanController() === planController) {
        deps.setV2PlanController(null)
      }
    }
  },

  directorEditClipPlan: (index, field, value) => {
    set(s => {
      const plans = [...s.directorClipPlans]
      if (plans[index]) {
        plans[index] = { ...plans[index], [field]: value }
      }
      return { directorClipPlans: plans }
    })
  },

  directorGenerateStartImages: async () => {
    if (get().pipelineStatus?.status === 'paused') {
      set({ directorError: 'Approve the scene cards in the main workspace to continue this production.' })
      return
    }
    const imageGenSequenceAtStart = deps.bumpImageGenSequence()
    const { directorClipPlans, directorPlannedClips, params, selectedModelPerMode, savedParamsPerMode, savedLoraPerMode, directorResolution, directorAspectRatio, directorSceneDescription } = get()
    if (!directorClipPlans.length) return

    const imageModel = selectedModelPerMode.image || 'flux2_klein_9b'
    const imageOptions = await api.fetchModelOptions(imageModel).catch(() => null)
    const directorRes = deps.resolveResolution(
      imageOptions,
      directorResolution,
      directorAspectRatio,
    )
    const imageParams = savedParamsPerMode.image || { num_inference_steps: 4, guidance_scale: 1, resolution: directorRes }
    imageParams.resolution = directorRes
    const imageLora = savedLoraPerMode.image

    const buildImgPostProc = (): Record<string, unknown> => {
      const pp: Record<string, unknown> = {}
      const imgSpatial = get().directorImageSpatialUpsampling
      if (imgSpatial) pp.spatial_upsampling = imgSpatial
      const imgGrainIntensity = get().directorImageFilmGrainIntensity
      if (imgGrainIntensity > 0) {
        pp.film_grain_intensity = imgGrainIntensity
        pp.film_grain_saturation = get().directorImageFilmGrainSaturation
      }
      return pp
    }

    const genImage = async (prompt: string, refs: string[], label: string): Promise<{ file: File; filename: string }> => {
      const genParams = {
        model_type: imageModel,
        prompt,
        image_refs: refs,
        image_mode: 1,
        num_inference_steps: imageParams.num_inference_steps,
        guidance_scale: imageParams.guidance_scale,
        video_prompt_type: refs.length ? 'KI' : '',
        resolution: imageParams.resolution,
        seed: -1,
        settings_version: 2.52,
        generation_mode: 'image',
        repeat_generation: 1,
        negative_prompt: '',
        video_length: 1,
        activated_loras: imageLora?.activated_loras || params.activated_loras || [],
        loras_multipliers: imageLora?.loras_multipliers || params.loras_multipliers || '',
        ...buildImgPostProc(),
      }
      const { job_id } = await api.submitGeneration(genParams)
      deps.setImageGenJob(job_id)
      let outputFiles: string[] = []
      let attempts = 0
      const maxAttempts = 300
      const imageSequence = deps.getImageGenSequence()
      const stopImagePoll = () => {
        const poll = deps.getImageGenPoll()
        if (poll !== null) {
          clearInterval(poll)
          deps.setImageGenPoll(null)
        }
      }
      const imagePoll = setInterval(() => {
        if (imageSequence !== deps.getImageGenSequence()) stopImagePoll()
      }, 2000)
      deps.setImageGenPoll(imagePoll)
      try {
        if (imageSequence !== deps.getImageGenSequence()) {
          throw new Error('Image generation cancelled')
        }
        while (attempts < maxAttempts) {
          if (imageSequence !== deps.getImageGenSequence()) {
            throw new Error('Image generation cancelled')
          }
          await new Promise(r => setTimeout(r, 2000))
          const status = await api.fetchJobStatus(job_id)
          if (imageSequence !== deps.getImageGenSequence()) {
            throw new Error('Image generation cancelled')
          }
          if (status.status === 'completed') { outputFiles = status.output_files; break }
          if (status.status === 'cancelled') break
          if (status.status === 'failed') throw new Error(status.error || `${label} generation failed`)
          attempts++
        }
        if (imageSequence !== deps.getImageGenSequence()) {
          throw new Error('Image generation cancelled')
        }
        if (attempts >= maxAttempts) throw new Error(`${label} generation timed out`)
        if (outputFiles.length === 0) throw new Error(`No output file for ${label}`)
        const filename = outputFiles[0]
        const imgRes = await fetch(api.getFileUrl(filename))
        const blob = await imgRes.blob()
        const file = new File([blob], filename, { type: blob.type || 'image/png' })
        return { file, filename }
      } finally {
        stopImagePoll()
        if (deps.getImageGenJob() === job_id) deps.setImageGenJob(null)
      }
    }

    if (get().llmStatus?.loaded) {
      try {
        await api.unloadLlm()
        set({ llmStatus: { loaded: false, model_id: null, device: null, provider: '' } })
      } catch { /* best-effort */ }
    }

    set({ directorStep: 'generate_images', directorLoading: true, directorError: null, directorClipImages: [], directorImageGenProgress: null })

    try {
      let anchorMade = false
      if (!get().directorReferenceImage && !get().directorReferenceImagePath) {
        anchorMade = true
        set({
          directorImageGenProgress: {
            current: 0,
            total: directorClipPlans.length + 1,
            currentClipLabel: 'Establishing image…',
            status: 'generating',
          },
        })
        const anchorPrompt = directorSceneDescription.trim() || directorClipPlans[0]?.image_prompt || 'cinematic establishing shot'
        const { file: anchorFile } = await genImage(anchorPrompt, [], 'Establishing image')
        set({ directorReferenceImage: anchorFile, directorReferenceImagePath: null })
      }

      const { refImagePath: refPath, charPaths, locPaths, speakerImagePaths } = await get()._uploadDirectorRefs()
      const allRefs = [refPath, ...charPaths, ...locPaths].filter(Boolean) as string[]

      const total = directorClipPlans.length + (anchorMade ? 1 : 0)
      const base = anchorMade ? 1 : 0
      const generatedImages: DirectorClipImage[] = []

      for (let i = 0; i < directorClipPlans.length; i++) {
        const clip = directorPlannedClips[i]
        const plan = directorClipPlans[i]
        const clipLabel = `Clip ${i + 1} (${clip?.section_label || 'verse'})`
        set({
          directorImageGenProgress: { current: base + i, total, currentClipLabel: clipLabel, status: 'generating' },
        })

        let clipRefs = allRefs
        const dominantSpeaker = clip?.dominant_speaker
        if (dominantSpeaker && speakerImagePaths[dominantSpeaker]) {
          const speakerImg = speakerImagePaths[dominantSpeaker]
          clipRefs = [speakerImg, ...allRefs.filter(r => r !== speakerImg)]
        }

        try {
          const { file, filename } = await genImage(plan.image_prompt, clipRefs, clipLabel)
          generatedImages.push({ clipIndex: i, prompt: plan.image_prompt, file, filename })
          set({ directorClipImages: [...generatedImages] })
        } catch (clipErr: unknown) {
          const msg = clipErr instanceof Error ? clipErr.message : 'Image generation failed for this clip'
          console.error(`Director image generation failed for clip ${i}:`, clipErr)
          set({
            directorLoading: false,
            directorError: msg,
            directorImageGenProgress: {
              current: base + i,
              total,
              currentClipLabel: `${clipLabel} — failed`,
              status: 'error',
              error_message: msg,
              failed_clip_index: i,
              failed_phase: 'image_gen',
            },
          })
          return
        }
      }

      set({
        directorImageGenProgress: { current: total, total, currentClipLabel: '', status: 'done' },
        directorLoading: false,
      })

      const hasVideoPrompts = get().directorClipPlans.some(p => p.video_prompt)
      if (hasVideoPrompts) {
        set({ directorStep: 'review_video' })
        if (get().directorAutoMode) {
          get().directorGenerate()
        }
      } else {
        get().directorPlanVideoPrompts()
      }
    } catch (e: unknown) {
      if (imageGenSequenceAtStart !== deps.getImageGenSequence()) return
      const msg = e instanceof Error ? e.message : 'Image generation failed'
      console.error('Director image generation failed:', e)
      set({
        directorLoading: false,
        directorError: msg,
        directorImageGenProgress: get().directorImageGenProgress
          ? { ...get().directorImageGenProgress!, status: 'error' }
          : null,
      })
    }
  },

  directorApplyToClips: () => {
    const { directorClipPlans, directorPlannedClips, directorAnalysis, directorClipImages,
            directorAudioPath, directorAudioFile, directorSeamless,
            selectedModelPerMode, savedParamsPerMode, savedLoraPerMode } = get()
    if (!directorClipPlans.length) return

    const videoModel = selectedModelPerMode.video || 'ltx2_22B_distilled_1_1'
    const videoParams = savedParamsPerMode.video
      ? { ...savedParamsPerMode.video }
      : {}
    const directorSteps = get().directorVideoInferenceStepsByModel[videoModel]
    if (directorSteps != null) videoParams.num_inference_steps = directorSteps
    const videoLora = savedLoraPerMode.video

    const directorVideoOptions = get().modelOptions?.model_type === videoModel
      ? get().modelOptions
      : null
    const isH3Video = videoModel.startsWith('minimax_h3')
    const fps = isH3Video ? (directorVideoOptions?.fps ?? 24) : (directorVideoOptions?.fps ?? 16)
    const totalDuration = directorAnalysis?.duration ?? 180
    const totalDurationCapped = Math.min(totalDuration, 60 * 60)

    const clips: MultiClip[] = directorClipPlans.map((plan, i) => {
      const plannedClip = directorPlannedClips[i]
      const clipImage = directorClipImages.find(img => img.clipIndex === i)

      let endImage: File | null = null
      if (directorSeamless && i < directorClipPlans.length - 1) {
        const nextClipImage = directorClipImages.find(img => img.clipIndex === i + 1)
        endImage = nextClipImage?.file ?? null
      }

      return {
        prompt: plan.video_prompt,
        startImage: clipImage?.file ?? null,
        startImagePath: null,
        endImage,
        endImagePath: null,
        durationFrames: plannedClip?.duration_frames,
      }
    })

    const requestedClipFrames = clips.map(
      c => c.durationFrames ?? Math.round(5 * fps),
    )
    const perClipFrames = isH3Video
      ? deps.normalizeH3ClipFrameSchedule(
          requestedClipFrames,
          directorVideoOptions?.frames_minimum ?? 124,
          directorVideoOptions?.frames_maximum ?? 345,
          directorVideoOptions?.frames_steps ?? 17,
        )
      : requestedClipFrames
    const totalFrames = perClipFrames.reduce((sum, f) => sum + f, 0)
    const maxClipFrames = Math.max(...perClipFrames)

    const audioParams: Record<string, unknown> = {}
    if (directorAudioPath) {
      audioParams.audio_prompt_type = 'A'
      audioParams.audio_guide = directorAudioPath
    }

    set(s => ({
      params: {
        ...s.params,
        ...(videoModel ? { model_type: videoModel } : {}),
        ...(videoParams || {}),
        ...(videoLora ? { activated_loras: videoLora.activated_loras, loras_multipliers: (videoLora.loras_multipliers || '').split(' ').map(m => m.split(';')[0]).join(' ') } : {}),
        image_mode: 2,
        video_length: totalFrames,
        sliding_window_size: maxClipFrames,
        per_clip_frames: perClipFrames,
        ...audioParams,
      },
      clips,
      singlePromptMode: false,
      durationSeconds: totalDurationCapped,
      slidingWindowSeconds: maxClipFrames / fps,
      audioGuideFilename: directorAudioFile?.name ?? null,
      appSection: 'director' as const, workspaceStage: 'studio' as const, sidebarMode: 'studio' as const,
    }))
  },

  directorGenerate: () => {
    const state = get()
    if (state.pipelineStatus?.status === 'paused') {
      set({ directorError: 'Approve the scene cards in the main workspace to continue this production.' })
      return
    }
    if (!state.directorClipPlans.length) {
      set({ directorError: 'Add at least one shot prompt before generating the Director project.' })
      return
    }
    if (!state.selectedModelPerMode.video) {
      set({ directorError: 'Select a compatible video model in Director setup before generating.' })
      return
    }
    void state.startDirectorPipeline(
      state.directorQueueEditingEntryId
        || state.pipelinePolling
        || state.isGenerating
        || state.directorQueue?.running
        ? 'queue' : 'now',
    )
  },

  directorReset: () => {
    deps.bumpAnalysisSequence()
    set({
      directorAnalyzeProgress: null,
      appSection: 'director' as const, workspaceStage: 'director' as const, sidebarMode: 'workspace' as const,
      directorStep: 'upload',
      directorActivityLabel: 'Idle',
      directorActivityFraction: NaN,
      directorAudioFile: null,
      directorAudioPath: null,
      directorAnalysis: null,
      directorPlannedClips: [],
      directorEnergyBias: 0,
      directorClipPlans: [],
      directorSceneDescription: '',
      directorNegativePrompt: '',
      directorLoading: false,
      directorError: null,
      directorReferenceImage: null,
      directorReferenceImagePath: null,
      directorH3References: [],
      directorH3ReferenceDetail: 'match' as const,
      directorCharacterRefs: [],
      directorCharacterRefPaths: [],
      directorCharacterRefLabels: [],
      directorLocationRefs: [],
      directorLocationRefPaths: [],
      directorLocationRefLabels: [],
      directorVoiceRef: null,
      directorVoiceRefPath: null,
      directorClipImages: [],
      directorImageGenProgress: null,
      directorSpeakers: [],
      directorSpeakerMappings: [],
      directorAutoMode: false,
      directorSeamless: false,
      directorShotImageGuidance: 'auto' as DirectorShotImageGuidance,
      directorLlmLog: [],
      directorSkill: get().activeWorkspaceSetup?.director_skill === 'short_film' ? 'short_film' : 'music_video',
      directorMusicSource: null,
      directorSongDescription: '',
      directorSongInstrumental: false,
      directorSongStyle: '',
      directorSongLyrics: '',
      directorSongDuration: 120,
    })
  },
})
