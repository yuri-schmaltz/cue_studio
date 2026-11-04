// ui/src/stores/directorPreflightSlice.ts
//
// Director Pre-flight slice.
//
// The pre-flight answers the question a Director user has *before*
// pressing "Generate Videos": how many shots will this plan become,
// how long will the render take, and will the longest shot fit in this
// machine's VRAM?
//
// A 4:15 music video is the case that makes this matter. The plan is
// one line in the UI, but it becomes a dozen renders, and on a modest
// GPU that is hours of compute — or an out-of-memory crash halfway
// through, with the bill already paid.
//
// The slice is deliberately thin. It assembles the payload the backend
// needs (the planned shots plus the settings the render would use),
// calls `POST /api/v1/director/preflight`, and stores the report. All
// of the arithmetic — frames per shot, the ETA synthesis, the VRAM
// check — lives on the server, where the model registry and the
// machine's timing history live.

import type { StateCreator } from 'zustand'
import * as api from '../api/client'
import type { AspectRatio, DirectorPreflightReport, ModelOptions, ResolutionPreset } from '../types'
import type { AppState } from './useStore'

export type DirectorPreflightDeps = {
  resolveResolution: (
    options: ModelOptions | null,
    preset: ResolutionPreset,
    aspectRatio: AspectRatio,
  ) => string
  directorUsesGeneratedShotImages: (state: AppState) => boolean
}

export type DirectorPreflightSlice = Pick<AppState,
  | 'directorPreflight'
  | 'directorPreflightLoading'
  | 'directorPreflightError'
  | 'refreshDirectorPreflight'
>

const initialState = {
  directorPreflight: null as DirectorPreflightReport | null,
  directorPreflightLoading: false,
  directorPreflightError: null as string | null,
}

/** Cached model options per video model — the options drive fps and the
 *  resolution presets, and they change only when the model changes. */
const optionsCache = new Map<string, Promise<ModelOptions>>()

function loadModelOptions(modelType: string): Promise<ModelOptions> {
  const cached = optionsCache.get(modelType)
  if (cached) return cached
  const request = api.fetchModelOptions(modelType).catch((error) => {
    optionsCache.delete(modelType)
    throw error
  })
  optionsCache.set(modelType, request)
  return request
}

export const createDirectorPreflightSlice = (
  set: Parameters<StateCreator<AppState, [], [], DirectorPreflightSlice>>[0],
  get: Parameters<StateCreator<AppState, [], [], DirectorPreflightSlice>>[1],
  _store: Parameters<StateCreator<AppState, [], [], DirectorPreflightSlice>>[2],
  deps: DirectorPreflightDeps,
): DirectorPreflightSlice => ({
  ...initialState,

  refreshDirectorPreflight: async () => {
    const state = get()
    const plannedClips = state.directorPlannedClips || []
    if (plannedClips.length === 0) {
      set({
        directorPreflight: null,
        directorPreflightLoading: false,
        directorPreflightError: null,
      })
      return
    }

    const videoModel = state.selectedModelPerMode?.video || 'ltx2_22B_distilled_1_1'
    set({ directorPreflightLoading: true, directorPreflightError: null })

    try {
      const options = await loadModelOptions(videoModel)
      const resolution = deps.resolveResolution(
        options,
        state.directorResolution,
        state.directorAspectRatio,
      )
      const fps = Number(options?.fps) || 25
      const steps = Number(
        state.directorVideoInferenceStepsByModel?.[videoModel]
        ?? options?.default_num_inference_steps
        ?? 8,
      ) || 8
      const loras = state.savedLoraPerMode?.video
      const usesShotImages = deps.directorUsesGeneratedShotImages(state)

      const report = await api.fetchDirectorPreflight({
        video_model: videoModel,
        planned_clips: plannedClips.map(clip => ({
          start: clip.start,
          end: clip.end,
        })),
        resolution,
        fps,
        num_inference_steps: steps,
        manual_max_frames: state.directorVideoMaxShotFramesByModel?.[videoModel] ?? null,
        // A Director music video always carries the track as an audio
        // guide, which is what makes its ETA shape differ from an
        // ordinary single-shot render.
        has_audio_guide: Boolean(state.directorAudioPath),
        has_start_images: usesShotImages,
        has_end_images: false,
        video_params: {
          resolution,
          num_inference_steps: steps,
          activated_loras: loras?.activated_loras || [],
          loras_multipliers: loras?.loras_multipliers || '',
        },
      })
      set({
        directorPreflight: report,
        directorPreflightLoading: false,
        directorPreflightError: null,
      })
    } catch (error) {
      set({
        directorPreflightLoading: false,
        directorPreflightError:
          error instanceof Error ? error.message : 'Failed to price the project',
      })
    }
  },
})

export const __resetDirectorPreflightOptionsCache = () => optionsCache.clear()
