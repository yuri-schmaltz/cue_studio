import { projectAdvancedDefaults } from './projectAdvancedDefaults'
import type { StateCreator } from 'zustand'
import * as api from '../api/client'
import type {
  AppSection,
  AspectRatio,
  DirectorSkill,
  GenerationMode,
  ProjectsRootInfo,
  ResolutionPreset,
} from '../types'
import type { AppState } from './useStore'

export type WorkspaceSlice = Pick<AppState,
  'workspaces' | 'activeWorkspace' | 'activeWorkspaceSetup' | 'activeWorkspaceSetupLoading' |
  'workspacesLoading' | 'browsingUploads' | 'loadWorkspaceSetup' | 'saveWorkspaceSetup' | 'applyWorkspaceSetup' |
  'loadWorkspaces' | 'switchWorkspace' | 'createWorkspace' | 'deleteWorkspace' |
  'projectsRoot' | 'loadProjectsRoot' | 'setProjectsRoot' |
  'loadDirectorDraft' | 'saveDirectorDraftNow' | 'clearDirectorDraft' |
  'directorDraftSnapshots' | 'restoreDraftSnapshot'
>

/** Workspace state and actions composed into the root store. */
export const createWorkspaceSlice: StateCreator<AppState, [], [], WorkspaceSlice> = (set, get) => {
  let setupRequest = 0
  let workspaceRequest = 0
  return ({
  workspaces: [],
  activeWorkspace: 'default',
  activeWorkspaceSetup: null,
  activeWorkspaceSetupLoading: false,
  workspacesLoading: false,
  browsingUploads: false,

  // Storage settings: where new workspaces are created. Hydrated by
  // `loadProjectsRoot` at boot and updated through `setProjectsRoot`.
  // `null` until the first fetch resolves so the Settings UI doesn't
  // render stale values from a previous session.
  projectsRoot: null as ProjectsRootInfo | null,
  loadProjectsRoot: async () => {
    try {
      const info = await api.fetchProjectsRoot()
      set({ projectsRoot: info })
    } catch (e) {
      console.error('Failed to load projects root:', e)
      // Leave the previous value in place; the UI surfaces the error.
    }
  },
  setProjectsRoot: async (path: string) => {
    const info = await api.setProjectsRoot(path)
    set({ projectsRoot: info })
    // The new root only affects future workspaces, but the visible
    // workspace list may have stale paths for entries that were
    // resolved before the change. Reload so the gallery reflects the
    // new layout immediately.
    await get().loadWorkspaces()
    return info
  },

  loadWorkspaceSetup: async (name) => {
    const request = ++setupRequest
    if (!name || name === 'default') {
      set({ activeWorkspaceSetup: null, activeWorkspaceSetupLoading: false })
      return
    }
    set({ activeWorkspaceSetupLoading: true })
    try {
      const setup = await api.fetchWorkspaceSetup(name)
      if (request !== setupRequest || get().activeWorkspace !== name) return
      set({ activeWorkspaceSetup: setup, activeWorkspaceSetupLoading: false })
      get().applyWorkspaceSetup(setup)
    } catch (error) {
      if (request !== setupRequest || get().activeWorkspace !== name) return
      console.error('Failed to load workspace setup:', error)
      set({ activeWorkspaceSetup: null, activeWorkspaceSetupLoading: false })
    }
  },

  saveWorkspaceSetup: async (setup) => {
    const name = get().activeWorkspace
    if (!name || name === 'default') {
      throw new Error('The default workspace cannot hold a custom project setup.')
    }
    const request = ++setupRequest
    const persisted = await api.saveWorkspaceSetup(name, setup)
    if (request !== setupRequest || get().activeWorkspace !== name) return
    ++workspaceRequest // Discard list responses captured before this save.
    set(state => ({
      activeWorkspaceSetup: persisted,
      activeWorkspaceSetupLoading: false,
      workspaces: state.workspaces.map(workspace => workspace.name === name
        ? { ...workspace, setup: persisted } : workspace),
    }))
    get().applyWorkspaceSetup(persisted)
  },

  applyWorkspaceSetup: (setup) => {
    const patch: {
      directorAspectRatio?: AspectRatio
      directorResolution?: ResolutionPreset
      directorSeamless?: boolean
      directorAutoMode?: boolean
      selectedModelPerMode?: Partial<Record<GenerationMode, string>>
      directorMusicSource?: 'upload' | 'generate' | null
      directorMusicModel?: string
      directorAdvancedDefaults?: Record<string, unknown>
    } = {}
    if (setup.aspect_ratio) patch.directorAspectRatio = setup.aspect_ratio as AspectRatio
    if (setup.resolution) patch.directorResolution = setup.resolution as ResolutionPreset
    if (typeof setup.seamless === 'boolean') patch.directorSeamless = setup.seamless
    if (typeof setup.auto_mode === 'boolean') patch.directorAutoMode = setup.auto_mode

    let nextModels: Partial<Record<GenerationMode, string>> | undefined
    if (setup.video_model) nextModels = { ...(get().selectedModelPerMode || {}), video: setup.video_model }
    if (setup.image_model) nextModels = { ...(nextModels || get().selectedModelPerMode || {}), image: setup.image_model }
    if (nextModels) patch.selectedModelPerMode = nextModels
    if (setup.music_source === 'upload' || setup.music_source === 'generate') {
      patch.directorMusicSource = setup.music_source
    }
    if (typeof setup.music_model === 'string') {
      patch.directorMusicModel = setup.music_model || 'ace_step_v1_5_xl_sft_lm_4b'
    }
    // The Director skill is a project-level choice (picked on the project
    // creation/setup screen). Sync it here so the chat never asks again.
    // A changed skill restarts the flow (path/step) but preserves media
    // and analysis — same contract as the old in-chat skill switch.
    const setupSkill = setup.director_skill === 'music_video' || setup.director_skill === 'short_film'
      ? setup.director_skill : undefined
    if (setupSkill && setupSkill !== get().directorSkill) {
      get().setDirectorSkill(setupSkill)
      set({ shortFilmPath: null, directorStep: 'upload', directorError: null })
    }
    const advanced = setup.advanced && typeof setup.advanced === 'object' && !Array.isArray(setup.advanced)
      ? setup.advanced : {}
    const videoModel = setup.video_model || get().selectedModelPerMode.video || 'ltx2_22B_distilled_1_1'
    set({ ...patch, ...projectAdvancedDefaults(advanced, get(), videoModel) })

    const applyLoraDefaults = (mode: 'image' | 'video', value: unknown) => {
      if (!value || typeof value !== 'object') return
      const blob = value as {
        activated_loras?: unknown
        loras_multipliers?: unknown
        loraWeights?: unknown
        availableLoras?: unknown
      }
      const activated = Array.isArray(blob.activated_loras) ? blob.activated_loras as string[] : []
      const multipliers = typeof blob.loras_multipliers === 'string' ? blob.loras_multipliers : ''
      const weights = blob.loraWeights && typeof blob.loraWeights === 'object'
        ? blob.loraWeights as Record<string, number[]>
        : {}
      const available = Array.isArray(blob.availableLoras) ? blob.availableLoras as string[] : []
      get().directorSetLora(mode, activated, multipliers, weights, available)
    }
    applyLoraDefaults('image', setup.default_image_loras)
    applyLoraDefaults('video', setup.default_video_loras)
  },

  loadWorkspaces: async () => {
    const request = ++workspaceRequest
    set({ workspacesLoading: true })
    try {
      const data = await api.fetchWorkspaces()
      if (request !== workspaceRequest) return
      const realWorkspaces = data.workspaces.filter(workspace => workspace.name !== 'default')
      const activeIsReal = data.active !== 'default'
      const current = get()
      const previousActive = current.activeWorkspace
      if (realWorkspaces.length === 0 && !activeIsReal && current.appSection !== 'configurations') {
        set({ workspaces: data.workspaces, activeWorkspace: data.active, appSection: 'projects' as AppSection, workspacesLoading: false })
      } else {
        set({ workspaces: data.workspaces, activeWorkspace: data.active, workspacesLoading: false })
      }
      if (activeIsReal && data.active !== previousActive) {
        get().loadWorkspaceSetup(data.active)
        get().loadDirectorDraft(data.active)
      }
    } catch (error) {
      console.error('Failed to load workspaces:', error)
      set({ workspacesLoading: false })
    }
  },

  switchWorkspace: async (name) => {
    ++setupRequest
    const request = ++workspaceRequest
    if (name === '__uploads__') {
      set({ browsingUploads: true, outputs: [], outputsTotal: 0, selectedOutput: 0, selectedOutputMeta: null })
      get().loadOutputs()
      return
    }
    try {
      await api.setActiveWorkspace(name)
      if (request !== workspaceRequest) return
      set({ browsingUploads: false, activeWorkspace: name, outputs: [], outputsTotal: 0, selectedOutput: 0, selectedOutputMeta: null })
      get().loadOutputs()
      get().loadWorkspaces()
      get().loadWorkspaceSetup(name)
      get().loadDirectorDraft(name)
    } catch (error) {
      console.error('Failed to switch workspace:', error)
    }
  },

  createWorkspace: async (name) => {
    ++setupRequest
    ++workspaceRequest
    try {
      await api.createWorkspace(name)
      await api.setActiveWorkspace(name)
      set({ browsingUploads: false, activeWorkspace: name, outputs: [], outputsTotal: 0, selectedOutput: 0, selectedOutputMeta: null })
      set({ activeWorkspaceSetup: null })
      get().loadOutputs()
      await get().loadWorkspaces()
    } catch (error) {
      console.error('Failed to create workspace:', error)
      throw error
    }
  },

  deleteWorkspace: async (name) => {
    const result = await api.deleteWorkspace(name)
    if (result.switched_to_default) {
      set({ browsingUploads: false, activeWorkspace: 'default', outputs: [], outputsTotal: 0, selectedOutput: 0, selectedOutputMeta: null })
      get().loadOutputs()
    }
    get().loadWorkspaces()
  },

  loadDirectorDraft: async (name: string) => {
    const current = get()
    if (current.pipelineId && current.pipelineStatus && !['completed', 'failed', 'cancelled'].includes(current.pipelineStatus.status)) {
      return
    }
    try {
      const draft = await api.fetchDirectorDraft(name)
      if (!draft) return

      const patch: Partial<AppState> = {}
      if (draft.directorSkill && draft.directorSkill !== current.directorSkill) {
        patch.directorSkill = draft.directorSkill as DirectorSkill
      }
      if (draft.directorStep) {
        patch.directorStep = draft.directorStep as AppState['directorStep']
      }
      if (draft.directorSceneDescription !== undefined) {
        patch.directorSceneDescription = draft.directorSceneDescription
      }
      if (draft.directorAudioPath) {
        patch.directorAudioPath = draft.directorAudioPath
        const audioName = draft.directorAudioName || draft.directorAudioPath.replace(/\\/g, '/').split('/').pop() || 'Director Audio'
        patch.directorAudioFile = new File([], audioName, { type: 'audio/wav' })
      }
      if (draft.directorAnalysis) {
        patch.directorAnalysis = draft.directorAnalysis
      }
      if (Array.isArray(draft.directorPlannedClips)) {
        patch.directorPlannedClips = draft.directorPlannedClips
      }
      if (Array.isArray(draft.directorClipPlans)) {
        patch.directorClipPlans = draft.directorClipPlans
      }
      if (Array.isArray(draft.directorSpeakers)) {
        patch.directorSpeakers = draft.directorSpeakers
      }
      if (Array.isArray(draft.directorSpeakerMappings)) {
        patch.directorSpeakerMappings = draft.directorSpeakerMappings
      }
      if (typeof draft.directorEnergyBias === 'number') {
        patch.directorEnergyBias = draft.directorEnergyBias
      }
      if (typeof draft.directorSeamless === 'boolean') {
        patch.directorSeamless = draft.directorSeamless
      }
      if (typeof draft.directorAutoMode === 'boolean') {
        patch.directorAutoMode = draft.directorAutoMode
      }
      if (draft.directorShotImageGuidance) {
        patch.directorShotImageGuidance = draft.directorShotImageGuidance
      }
      if (draft.directorSongDescription !== undefined) {
        patch.directorSongDescription = draft.directorSongDescription
      }
      if (draft.directorSongLyrics !== undefined) {
        patch.directorSongLyrics = draft.directorSongLyrics
      }
      if (draft.directorSongStyle !== undefined) {
        patch.directorSongStyle = draft.directorSongStyle
      }
      if (typeof draft.directorSongInstrumental === 'boolean') {
        patch.directorSongInstrumental = draft.directorSongInstrumental
      }
      if (Array.isArray(draft.snapshots)) {
        patch.directorDraftSnapshots = draft.snapshots
      }

      set(patch)
    } catch (e) {
      console.warn('Failed to load director draft:', e)
    }
  },

  directorDraftSnapshots: [],

  restoreDraftSnapshot: async (index: number) => {
    const s = get()
    const snap = s.directorDraftSnapshots[index]
    if (!snap) return
    set({
      directorPlannedClips: snap.plannedClips || [],
      directorClipPlans: snap.clipPlans || [],
      directorSceneDescription: snap.sceneDescription ?? s.directorSceneDescription,
    })
    await get().saveDirectorDraftNow()
  },

  saveDirectorDraftNow: async () => {
    const s = get()
    const workspace = s.activeWorkspace
    if (!workspace || workspace === '__uploads__') return
    if (s.pipelineId && s.pipelineStatus && !['completed', 'failed', 'cancelled'].includes(s.pipelineStatus.status)) {
      return
    }
    const hasContent = Boolean(
      s.directorAudioPath
      || s.directorAnalysis
      || s.directorPlannedClips.length > 0
      || s.directorClipPlans.length > 0
      || s.directorSceneDescription.trim()
      || s.directorSongDescription.trim()
    )
    if (!hasContent) return

    const currentSnapshots = [...(s.directorDraftSnapshots || [])]
    const hasClips = s.directorPlannedClips.length > 0
    if (hasClips) {
      const lastSnap = currentSnapshots[currentSnapshots.length - 1]
      const snapClips = lastSnap?.plannedClips || []
      const isDifferent = JSON.stringify(snapClips) !== JSON.stringify(s.directorPlannedClips)
      if (isDifferent) {
        currentSnapshots.push({
          timestamp: Date.now(),
          label: `Storyboard ${currentSnapshots.length + 1} (${s.directorPlannedClips.length} scenes)`,
          plannedClips: s.directorPlannedClips,
          clipPlans: s.directorClipPlans,
          sceneDescription: s.directorSceneDescription,
        })
        while (currentSnapshots.length > 5) currentSnapshots.shift()
        set({ directorDraftSnapshots: currentSnapshots })
      }
    }

    const draft: api.DirectorDraft = {
      directorSkill: s.directorSkill,
      directorStep: s.directorStep,
      directorAudioPath: s.directorAudioPath,
      directorAudioName: s.directorAudioFile?.name || null,
      directorAnalysis: s.directorAnalysis,
      directorPlannedClips: s.directorPlannedClips,
      directorClipPlans: s.directorClipPlans,
      directorSceneDescription: s.directorSceneDescription,
      directorEnergyBias: s.directorEnergyBias,
      directorSpeakers: s.directorSpeakers,
      directorSpeakerMappings: s.directorSpeakerMappings,
      directorSeamless: s.directorSeamless,
      directorAutoMode: s.directorAutoMode,
      directorShotImageGuidance: s.directorShotImageGuidance,
      directorSongDescription: s.directorSongDescription,
      directorSongLyrics: s.directorSongLyrics,
      directorSongStyle: s.directorSongStyle,
      directorSongInstrumental: s.directorSongInstrumental,
      snapshots: currentSnapshots,
      updatedAt: Date.now(),
    }
    try {
      await api.saveDirectorDraft(workspace, draft)
    } catch (err) {
      console.warn('[Director] Save draft failed:', err)
    }
  },

  clearDirectorDraft: async () => {
    const workspace = get().activeWorkspace
    if (!workspace || workspace === '__uploads__') return
    try {
      await api.deleteDirectorDraft(workspace)
      set({ directorDraftSnapshots: [] })
    } catch (err) {
      console.warn('[Director] Clear draft failed:', err)
    }
  },
  })
}
