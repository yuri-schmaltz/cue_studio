// filepath: ui/src/stores/directorSelectors.ts
//
// directorSelectors — read-only hooks that expose Director state under
// the `workspace.director.*` namespace (Strategy B, Stage 3). The
// underlying state still lives at the top level on the Zustand store
// (`directorStep`, `directorClipPlans`, etc.) because moving 35 slices
// at once would touch ~200 call sites and break the cancelPlan /
// Stage wrapper contracts in one go.
//
// These selectors are the migration seam. New code should import from
// here; existing call sites can stay until a future cleanup pass
// renames the underlying slices. The compatibility shim is the same
// data, no transformation — call once, returns the same value.

import { useStore } from './useStore'
import type { DirectorShotImageGuidance, DirectorSkill, ResolutionPreset, AspectRatio } from '../types'
import type { AudioAnalysisResult, PlannedClip, ClipPlan } from '../types'
import type { DirectorError } from './directorError'

/** Read-only view of all Director state under `workspace.director.*`. */
export interface DirectorNamespace {
  step: 'upload' | 'analyze' | 'structure' | 'style' | 'plan' | 'review' | 'generate_images' | 'plan_video' | 'review_video'
  loading: boolean
  loadingMessage: string | null
  error: DirectorError | string | null
  audioFile: File | null
  audioPath: string | null
  analysis: AudioAnalysisResult | null
  plannedClips: PlannedClip[]
  energyBias: number
  clipPlans: ClipPlan[]
  sceneDescription: string
  referenceImage: File | null
  referenceImagePath: string | null
  h3References: ReturnType<typeof useStore.getState>['directorH3References']
  h3ReferenceDetail: 'match' | 'max'
  characterRefs: File[]
  characterRefPaths: string[]
  characterRefLabels: string[]
  locationRefs: File[]
  locationRefPaths: string[]
  locationRefLabels: string[]
  voiceRef: File | null
  voiceRefPath: string | null
  identityGuidanceScale: number
  clipImages: ReturnType<typeof useStore.getState>['directorClipImages']
  speakers: string[]
  speakerMappings: ReturnType<typeof useStore.getState>['directorSpeakerMappings']
  autoMode: boolean
  seamless: boolean
  shotImageGuidance: DirectorShotImageGuidance
  llmLog: ReturnType<typeof useStore.getState>['directorLlmLog']
  skill: DirectorSkill | null
  resolution: ResolutionPreset
  aspectRatio: AspectRatio
  sourcePipelineId: string | null
  projectId: string | null
  queue: ReturnType<typeof useStore.getState>['directorQueue']
  queueEditingEntryId: string | null
  pipelineId: string | null
  pipelineStatus: ReturnType<typeof useStore.getState>['pipelineStatus']
  imageGenProgress: ReturnType<typeof useStore.getState>['directorImageGenProgress']
  analyzeProgress: ReturnType<typeof useStore.getState>['directorAnalyzeProgress']
  shortFilmTargetDuration: number
}

type DirectorStateSlice = ReturnType<typeof useStore.getState>

const _selectorTable: Record<keyof DirectorNamespace, (s: DirectorStateSlice) => unknown> = {
  step: s => s.directorStep,
  loading: s => s.directorLoading,
  loadingMessage: s => s.directorLoadingMessage,
  error: s => s.directorError,
  audioFile: s => s.directorAudioFile,
  audioPath: s => s.directorAudioPath,
  analysis: s => s.directorAnalysis,
  plannedClips: s => s.directorPlannedClips,
  energyBias: s => s.directorEnergyBias,
  clipPlans: s => s.directorClipPlans,
  sceneDescription: s => s.directorSceneDescription,
  referenceImage: s => s.directorReferenceImage,
  referenceImagePath: s => s.directorReferenceImagePath,
  h3References: s => s.directorH3References,
  h3ReferenceDetail: s => s.directorH3ReferenceDetail,
  characterRefs: s => s.directorCharacterRefs,
  characterRefPaths: s => s.directorCharacterRefPaths,
  characterRefLabels: s => s.directorCharacterRefLabels,
  locationRefs: s => s.directorLocationRefs,
  locationRefPaths: s => s.directorLocationRefPaths,
  locationRefLabels: s => s.directorLocationRefLabels,
  voiceRef: s => s.directorVoiceRef,
  voiceRefPath: s => s.directorVoiceRefPath,
  identityGuidanceScale: s => s.directorIdentityGuidanceScale,
  clipImages: s => s.directorClipImages,
  speakers: s => s.directorSpeakers,
  speakerMappings: s => s.directorSpeakerMappings,
  autoMode: s => s.directorAutoMode,
  seamless: s => s.directorSeamless,
  shotImageGuidance: s => s.directorShotImageGuidance,
  llmLog: s => s.directorLlmLog,
  skill: s => s.directorSkill,
  resolution: s => s.directorResolution,
  aspectRatio: s => s.directorAspectRatio,
  sourcePipelineId: s => s.directorSourcePipelineId,
  projectId: s => s.directorProjectId,
  queue: s => s.directorQueue,
  queueEditingEntryId: s => s.directorQueueEditingEntryId,
  pipelineId: s => s.pipelineId,
  pipelineStatus: s => s.pipelineStatus,
  imageGenProgress: s => s.directorImageGenProgress,
  analyzeProgress: s => s.directorAnalyzeProgress,
  shortFilmTargetDuration: s => s.shortFilmTargetDuration,
}

/** Subscribe to a single Director slice through the namespace hook. */
export function useDirectorSlice<K extends keyof DirectorNamespace>(
  field: K,
): DirectorNamespace[K] {
  // Use the same selector each render — the namespace key is stable.
  const selector = _selectorTable[field]
  return useStore(selector as (s: DirectorStateSlice) => DirectorNamespace[K])
}

/** Read the full Director namespace snapshot once. Mutating the
 *  returned object has no effect — callers should use actions on
 *  the store for writes (e.g. `useStore(s => s.directorSetStep)`). */
export function readDirectorNamespace(): DirectorNamespace {
  const s = useStore.getState()
  return {
    step: s.directorStep,
    loading: s.directorLoading,
    loadingMessage: s.directorLoadingMessage,
    error: s.directorError,
    audioFile: s.directorAudioFile,
    audioPath: s.directorAudioPath,
    analysis: s.directorAnalysis,
    plannedClips: s.directorPlannedClips,
    energyBias: s.directorEnergyBias,
    clipPlans: s.directorClipPlans,
    sceneDescription: s.directorSceneDescription,
    referenceImage: s.directorReferenceImage,
    referenceImagePath: s.directorReferenceImagePath,
    h3References: s.directorH3References,
    h3ReferenceDetail: s.directorH3ReferenceDetail,
    characterRefs: s.directorCharacterRefs,
    characterRefPaths: s.directorCharacterRefPaths,
    characterRefLabels: s.directorCharacterRefLabels,
    locationRefs: s.directorLocationRefs,
    locationRefPaths: s.directorLocationRefPaths,
    locationRefLabels: s.directorLocationRefLabels,
    voiceRef: s.directorVoiceRef,
    voiceRefPath: s.directorVoiceRefPath,
    identityGuidanceScale: s.directorIdentityGuidanceScale,
    clipImages: s.directorClipImages,
    speakers: s.directorSpeakers,
    speakerMappings: s.directorSpeakerMappings,
    autoMode: s.directorAutoMode,
    seamless: s.directorSeamless,
    shotImageGuidance: s.directorShotImageGuidance,
    llmLog: s.directorLlmLog,
    skill: s.directorSkill,
    resolution: s.directorResolution,
    aspectRatio: s.directorAspectRatio,
    sourcePipelineId: s.directorSourcePipelineId,
    projectId: s.directorProjectId,
    queue: s.directorQueue,
    queueEditingEntryId: s.directorQueueEditingEntryId,
    pipelineId: s.pipelineId,
    pipelineStatus: s.pipelineStatus,
    imageGenProgress: s.directorImageGenProgress,
    analyzeProgress: s.directorAnalyzeProgress,
    shortFilmTargetDuration: s.shortFilmTargetDuration,
  }
}