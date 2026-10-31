/**
 * Short Film Director slice.
 *
 * Encapsulates the state and actions for the Short Film skill:
 * - characters list, path, duration and narrative toggles
 * - upload & analysis for short films
 * - pacing bias adjustments
 * - prompt planning (v1 & v2 LLM pipelines)
 * - story scripting and dialogue scene generation
 */

import type { StateCreator } from 'zustand'
import * as api from '../api/client'
import type { AppState } from './useStore'
import type { ShortFilmCharacter, ShortFilmPath, PlannedClip, SpeakerMapping } from '../types'
import { trackAnalysisProgress } from './analysisProgress'

export type ShortFilmSlice = {
  shortFilmCharacters: ShortFilmCharacter[]
  shortFilmPath: ShortFilmPath | null
  shortFilmTargetDuration: number
  shortFilmNarrative: boolean
  shortFilmSetCharacters: (characters: ShortFilmCharacter[]) => void
  shortFilmSetPath: (path: ShortFilmPath) => void
  shortFilmSetTargetDuration: (duration: number) => void
  shortFilmSetNarrative: (v: boolean) => void
  shortFilmUploadAndAnalyze: (file: File) => Promise<void>
  shortFilmSetPacingBias: (bias: number) => Promise<void>
  shortFilmPlanPrompts: () => Promise<void>
  shortFilmPlanVideoPrompts: () => Promise<void>
  shortFilmPlanFromStory: () => Promise<void>
}

export type ShortFilmSliceDeps = {
  startDirectLlmStreamPolling: (set: any, get: any) => () => void
  directorUsesGeneratedShotImages: (state: AppState) => boolean
  getAnalysisSequence: () => number
  bumpAnalysisSequence: () => number
  setAnalyzeController: (ctrl: AbortController | null) => void
  getAnalyzeController: () => AbortController | null
  setAnalyzeStopPoll: (fn: (() => void) | null) => void
}

export const createShortFilmSlice = (
  set: Parameters<StateCreator<AppState, [], [], ShortFilmSlice>>[0],
  get: Parameters<StateCreator<AppState, [], [], ShortFilmSlice>>[1],
  _store: Parameters<StateCreator<AppState, [], [], ShortFilmSlice>>[2],
  deps: ShortFilmSliceDeps,
): ShortFilmSlice => ({
  shortFilmCharacters: [],
  shortFilmPath: null,
  shortFilmTargetDuration: 30,
  shortFilmNarrative: false,

  shortFilmSetCharacters: (characters) => set({ shortFilmCharacters: characters }),
  shortFilmSetPath: (path) => set({ shortFilmPath: path }),
  shortFilmSetTargetDuration: (duration) => set({
    shortFilmTargetDuration: Math.min(60 * 60, Math.max(10, duration)),
  }),
  shortFilmSetNarrative: (v) => set({ shortFilmNarrative: v }),

  shortFilmUploadAndAnalyze: async (file) => {
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
      const uploaded = await api.uploadAudio(file, analyzeController.signal)
      set({ directorAudioPath: uploaded.path, directorLoadingMessage: 'Analyzing audio...' })

      startAnalyzePolling()
      const analysis = await api.analyzeAudio({
        audio_path: uploaded.path,
        transcribe: true,
        extract_vocals: true,
      }, analyzeController.signal)
      if (analysisSequence !== deps.getAnalysisSequence()) return
      progress.finish('done')
      stopAnalyzePolling()

      if (Number(analysis.duration || 0) > 60 * 60 + 0.5) {
        throw new Error('Director supports source timelines up to 60 minutes. Trim this audio to one hour or less and try again.')
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
      const speakerMappings: SpeakerMapping[] = speakers.map(s => ({
        speakerId: s,
        name: '',
        role: 'speaking' as const,
      }))
      set({ directorSpeakers: speakers, directorSpeakerMappings: speakerMappings })

      set({ directorLoadingMessage: 'Planning scenes...' })
      const structure = await api.planDialogueScenes({
        analysis,
        pacing_bias: get().directorEnergyBias,
        fps: get().modelOptions?.fps ?? 16,
        frames_steps: get().modelOptions?.frames_steps ?? 4,
        frames_minimum: get().modelOptions?.frames_minimum ?? 5,
      })
      set({
        directorPlannedClips: structure.clips,
        directorStep: 'structure',
        directorLoading: false,
        directorLoadingMessage: null,
      })
    } catch (e: unknown) {
      if (analysisSequence !== deps.getAnalysisSequence()) return
      progress.finish('error')
      const msg = e instanceof Error ? e.message : 'Analysis failed'
      console.error('Short film analysis failed:', e)
      set({ directorLoading: false, directorLoadingMessage: null, directorActivityLabel: 'Idle', directorError: msg, directorStep: 'upload' })
    } finally {
      stopAnalyzePolling()
      if (deps.getAnalyzeController() === analyzeController) {
        deps.setAnalyzeController(null)
      }
      deps.setAnalyzeStopPoll(null)
    }
  },

  shortFilmSetPacingBias: async (bias) => {
    const { directorAnalysis } = get()
    if (!directorAnalysis) return
    set({ directorLoading: true, directorEnergyBias: bias })
    try {
      const structure = await api.planDialogueScenes({
        analysis: directorAnalysis,
        pacing_bias: bias,
        fps: get().modelOptions?.fps ?? 16,
        frames_steps: get().modelOptions?.frames_steps ?? 4,
        frames_minimum: get().modelOptions?.frames_minimum ?? 5,
      })
      set({ directorPlannedClips: structure.clips, directorLoading: false })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to update structure'
      set({ directorLoading: false, directorError: msg })
    }
  },

  shortFilmPlanPrompts: async () => {
    const { directorPlannedClips, directorSceneDescription, directorAnalysis,
            shortFilmCharacters } = get()
    if (!directorPlannedClips.length || !directorSceneDescription.trim()) return
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

      const useV2 = get().servicesConfig?.use_director_v2 ?? true
      let plans: Array<{ video_prompt: string; image_prompt: string }>

      if (useV2) {
        const result = await api.directorV2Plan({
          skill_type: 'short_film',
          clips: directorPlannedClips,
          scene_description: directorSceneDescription,
          lyrics: directorAnalysis?.lyrics ?? undefined,
          reference_image_path: refImagePath ?? undefined,
          ...extraRefs,
          speaker_mappings: Object.keys(speakerMappings).length > 0 ? speakerMappings : undefined,
          characters: shortFilmCharacters.length > 0 ? shortFilmCharacters : undefined,
          prompt_type: promptType,
        })
        plans = result.clip_plans.map(p => ({
          video_prompt: p.video_prompt || '',
          image_prompt: p.image_prompt || '',
        }))
      } else {
        const result = await api.planShortFilmPrompts({
          clips: directorPlannedClips,
          scene_description: directorSceneDescription,
          lyrics: directorAnalysis?.lyrics ?? undefined,
          reference_image_path: refImagePath,
          ...extraRefs,
          speaker_mappings: Object.keys(speakerMappings).length > 0 ? speakerMappings : undefined,
          characters: shortFilmCharacters.length > 0 ? shortFilmCharacters : undefined,
          prompt_type: promptType,
        })
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
      const msg = e instanceof Error ? e.message : 'Planning failed'
      console.error('Short film planning failed:', e)
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
    }
  },

  shortFilmPlanVideoPrompts: async () => {
    const { directorPlannedClips, directorSceneDescription, directorAnalysis,
            directorClipPlans, directorReferenceImagePath, shortFilmCharacters } = get()
    if (!directorPlannedClips.length || !directorClipPlans.length) return
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
      const { directorCharacterRefPaths: crp2, directorLocationRefPaths: lrp2 } = get()
      const result = await api.planShortFilmPrompts({
        clips: directorPlannedClips,
        scene_description: directorSceneDescription,
        lyrics: directorAnalysis?.lyrics ?? undefined,
        reference_image_path: directorReferenceImagePath,
        ...(crp2.length > 0 ? { character_ref_paths: crp2 } : {}),
        ...(lrp2.length > 0 ? { location_ref_paths: lrp2 } : {}),
        speaker_mappings: Object.keys(speakerMappings).length > 0 ? speakerMappings : undefined,
        characters: shortFilmCharacters.length > 0 ? shortFilmCharacters : undefined,
        prompt_type: 'video',
        existing_image_prompts: existingImagePrompts,
      })
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
      const msg = e instanceof Error ? e.message : 'Video prompt planning failed'
      console.error('Short film video planning failed:', e)
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
    }
  },

  shortFilmPlanFromStory: async () => {
    const { directorSceneDescription,
            shortFilmCharacters, shortFilmTargetDuration, shortFilmNarrative } = get()
    if (!directorSceneDescription.trim()) return
    set({
      directorLoading: true,
      directorError: null,
      directorStep: 'plan',
      directorActivityLabel: 'Planning short film',
      directorLoadingMessage: 'Planning short film script and scenes with LLM...',
      directorActivityFraction: NaN,
      llmStreamText: '',
      llmStreamDone: false,
    })
    const stopStreamPoll = deps.startDirectLlmStreamPolling(set, get)
    try {
      const { refImagePath, charPaths, locPaths } = await get()._uploadDirectorRefs()
      const { directorCharacterRefLabels: charLabels, directorLocationRefLabels: locLabels } = get()
      const extraRefs = {
        ...(charPaths.length > 0 ? { character_ref_paths: charPaths, character_ref_labels: charLabels } : {}),
        ...(locPaths.length > 0 ? { location_ref_paths: locPaths, location_ref_labels: locLabels } : {}),
      }
      const generateShotImages = deps.directorUsesGeneratedShotImages(get())
      const promptType = generateShotImages ? 'both' : 'video'

      const useV2 = get().servicesConfig?.use_director_v2 ?? true
      let plans: Array<{ video_prompt: string; image_prompt: string }>
      let storyClips: PlannedClip[] | undefined

      if (useV2) {
        const result = await api.directorV2Plan({
          skill_type: 'short_film',
          scene_description: directorSceneDescription,
          story_description: directorSceneDescription,
          characters: shortFilmCharacters.length > 0 ? shortFilmCharacters : undefined,
          reference_image_path: refImagePath ?? undefined,
          ...extraRefs,
          target_duration: shortFilmTargetDuration,
          narrative_mode: shortFilmNarrative,
          fps: get().modelOptions?.fps ?? 24,
          frames_steps: get().modelOptions?.frames_steps ?? 4,
          frames_minimum: get().modelOptions?.frames_minimum ?? 5,
          prompt_type: promptType,
        })
        plans = result.clip_plans.map(p => ({
          video_prompt: p.video_prompt || '',
          image_prompt: p.image_prompt || '',
        }))
        const pp = result.production_plan
        if (pp?.shots) {
          let cumulative = 0
          storyClips = pp.shots.map((shot) => {
            const duration = shot.duration_sec || 15
            const clip = {
              start: cumulative,
              end: cumulative + duration,
              duration_frames: typeof shot.metadata?.duration_frames === 'number'
                ? shot.metadata.duration_frames
                : Math.round(duration * (get().modelOptions?.fps ?? 24)),
              section_label: shot.narrative_role || shot.scene_type || 'scene',
              energy: 0.5,
              suggested_prompt_hint: shot.ending_beat || shot.spatial_setup || '',
              beat_count: 0,
            }
            cumulative += duration
            return clip
          })
        }
      } else {
        const result = await api.planShortFilmScript({
          story_description: directorSceneDescription,
          characters: shortFilmCharacters.length > 0 ? shortFilmCharacters : undefined,
          reference_image_path: refImagePath ?? undefined,
          ...extraRefs,
          target_duration: shortFilmTargetDuration,
          narrative_mode: shortFilmNarrative,
          fps: get().modelOptions?.fps ?? 24,
          frames_steps: get().modelOptions?.frames_steps ?? 4,
          frames_minimum: get().modelOptions?.frames_minimum ?? 5,
        })
        storyClips = result.clips
        plans = result.clip_plans.map(p => ({
          video_prompt: p.video_prompt || '',
          image_prompt: p.image_prompt || '',
        }))
      }

      set({
        directorPlannedClips: storyClips || get().directorPlannedClips,
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
      const msg = e instanceof Error ? e.message : 'Story planning failed'
      console.error('Short film story planning failed:', e)
      set({
        directorLoading: false,
        directorError: msg,
        directorStep: 'style',
      })
    } finally {
      stopStreamPoll()
    }
  },
})
