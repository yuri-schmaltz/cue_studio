import type { StateCreator } from 'zustand'
import type { GenerationMode, ResolutionPreset, AspectRatio } from '../types'
import * as api from '../api/client'
import { composeModelCatalog } from './modelCatalog'
import { loraPhaseCount, toggleLoraState, updateLoraWeight } from './loraState'
import { studioModelRuntime } from './studioModelRuntime'
import { h3WindowOverrideKey, recommendedH3OmniSequenceProfile, recommendedH3PassProfile, normalizeH3NativeFrames } from '../lib/h3Memory'
import type { AppState, StudioModelDependencies } from './useStore'

export type StudioModelSlice = Pick<AppState,
  "families" |
  "models" |
  "modelsLoaded" |
  "enabledModels" |
  "toggleModelEnabled" |
  "resetEnabledModels" |
  "setAllModelsEnabled" |
  "setModelsEnabled" |
  "modelVisibilityFocus" |
  "openModelVisibility" |
  "clearModelVisibilityFocus" |
  "loadModels" |
  "availableLoras" |
  "lorasLoading" |
  "loraWeights" |
  "loraIdByFilename" |
  "filenameByLoraId" |
  "refreshLoraIdMap" |
  "loadLoras" |
  "toggleLora" |
  "ensureTransitionLoraForBlend" |
  "ensureEditAnythingLora" |
  "setLoraWeight" |
  "modelOptions" |
  "modelOptionsLoading" |
  "loadModelOptions" |
  "selectModel"
>

/** Model catalog, remote hydration, selection, options and LoRA lifecycle. */
export function createStudioModelSlice(
  set: Parameters<StateCreator<AppState>>[0],
  get: Parameters<StateCreator<AppState>>[1],
  dependencies: StudioModelDependencies,
): StudioModelSlice {
  const { _loadEnabledModels, DEFAULT_ENABLED_MODELS, _markMatureModelsInitialized, _saveEnabledModels, SFX_VIRTUAL_MODELS, DEFAULTS_VERSION_KEY, DEFAULTS_VERSION, DEFAULTS_ADDED_IN, _loadSettings, _audioSubModeForModel, _normalizeStudioImageWorkflow, OLD_MUSIC_DEFAULT, NEW_MUSIC_DEFAULT, getDefaultModelForMode, _normalizeStudioVideoWorkflow, _isOmniVideoModel, sfxModelTypes, _applyModelDefaults, _persistStickyStudioPreferences, _enableUninitializedMatureModels, _saveSettings, resolveResolution } = dependencies
  let _modelOptionsSeq = 0
  let _h3WindowOverridesHydrated = false
  let _studioPreferencesHydrated = false
  return ({

  // Models & families
  families: [],
  models: [],
  modelsLoaded: false,
  enabledModels: _loadEnabledModels() ?? new Set(DEFAULT_ENABLED_MODELS),
  toggleModelEnabled: (modelType) => {
    _markMatureModelsInitialized(get().models, [modelType])
    set(s => {
      const next = new Set(s.enabledModels)
      if (next.has(modelType)) next.delete(modelType)
      else next.add(modelType)
      _saveEnabledModels(next)
      return { enabledModels: next }
    })
  },
  resetEnabledModels: () => {
    _markMatureModelsInitialized(get().models)
    const next = new Set(DEFAULT_ENABLED_MODELS)
    _saveEnabledModels(next)
    set({ enabledModels: next })
  },
  setAllModelsEnabled: (enabled) => {
    _markMatureModelsInitialized(get().models)
    if (enabled) {
      const all = new Set(get().models.map(m => m.model_type))
      _saveEnabledModels(all)
      set({ enabledModels: all })
    } else {
      const empty = new Set<string>()
      _saveEnabledModels(empty)
      set({ enabledModels: empty })
    }
  },
  setModelsEnabled: (modelTypes, enabled) => {
    _markMatureModelsInitialized(get().models, modelTypes)
    set(s => {
      const next = new Set(s.enabledModels)
      for (const mt of modelTypes) {
        if (enabled) next.add(mt)
        else next.delete(mt)
      }
      _saveEnabledModels(next)
      return { enabledModels: next }
    })
  },
  // Open Settings → Performance and ask the Enabled Models section to
  // expand + scroll to the given mode (fired by the ModelSelector hint).
  modelVisibilityFocus: null,
  openModelVisibility: (mode) => set({
    settingsOpen: true,
    settingsTab: 'appearance',
    modelVisibilityFocus: mode,
  }),
  clearModelVisibilityFocus: () => set({ modelVisibilityFocus: null }),
  loadModels: async () => {
    try {
      const shouldHydrateVisibility = !studioModelRuntime.visibilityHydrated
      const shouldHydrateH3WindowOverrides = !_h3WindowOverridesHydrated
      const shouldHydrateStudioPreferences = !_studioPreferencesHydrated
      const [data, visibility, h3WindowPreferences, studioPreferences] = await Promise.all([
        api.fetchModels(),
        shouldHydrateVisibility
          ? api.fetchModelVisibility().catch(error => {
              console.warn('Failed to load model visibility:', error)
              return null
            })
          : Promise.resolve(null),
        shouldHydrateH3WindowOverrides
          ? api.fetchH3WindowOverrides().catch(error => {
              console.warn('Failed to load H3 window overrides:', error)
              return null
            })
          : Promise.resolve(null),
        shouldHydrateStudioPreferences
          ? api.fetchStudioPreferences().catch(error => {
              console.warn('Failed to load Studio preferences:', error)
              return null
            })
          : Promise.resolve(null),
      ])
      const families = data.families
      // Keep the complete backend capability record and inject virtual
      // SFX models through the pure catalog boundary. Director metadata
      // must survive normalization.
      const models = composeModelCatalog(data.models, SFX_VIRTUAL_MODELS)

      if (shouldHydrateH3WindowOverrides && h3WindowPreferences) {
        _h3WindowOverridesHydrated = true
        set({ h3WindowOverrides: h3WindowPreferences.overrides || {} })
      }
      if (shouldHydrateStudioPreferences && studioPreferences) {
        _studioPreferencesHydrated = true
      }

      // Pinokio can assign a different web-server port on every launch.
      // Browser localStorage is origin-bound, so hydrate durable visibility
      // once from the server config and keep localStorage only as a
      // migration/cache layer.
      if (shouldHydrateVisibility && visibility) {
        let restoredModels: Set<string>
        if (visibility.configured) {
          restoredModels = new Set(visibility.enabled_models)
          studioModelRuntime.initializedMatureModels = new Set(
            visibility.initialized_mature_models,
          )
          studioModelRuntime.defaultsVersion = (
            visibility.defaults_version || 1
          )
        } else {
          const legacyModels = _loadEnabledModels()
          restoredModels = legacyModels ?? new Set(DEFAULT_ENABLED_MODELS)
          const legacyDefaultsVersion = parseInt(
            localStorage.getItem(DEFAULTS_VERSION_KEY) || '',
            10,
          )
          studioModelRuntime.defaultsVersion = legacyModels
            ? (legacyDefaultsVersion || 1)
            : DEFAULTS_VERSION
          // An existing browser whitelist is an explicit snapshot. Mark the
          // current Mature entries initialized so migration cannot re-enable
          // one the user deliberately disabled.
          studioModelRuntime.initializedMatureModels = legacyModels
            ? new Set(
                models
                  .filter(model => model.nsfw_only)
                  .map(model => model.model_type),
              )
            : new Set()
        }
        studioModelRuntime.visibilityHydrated = true
        set({ enabledModels: restoredModels })
        if (!visibility.configured) _saveEnabledModels(restoredModels)
      }

      // One-time curated-defaults upgrade for existing installs (see
      // DEFAULTS_VERSION). Fresh installs already start from the full
      // DEFAULT_ENABLED_MODELS list; for them this only stamps the
      // version key.
      let migrateMusicDefault = false
      try {
        const storedVer = studioModelRuntime.visibilityHydrated
          ? studioModelRuntime.defaultsVersion
          : (
              parseInt(
                localStorage.getItem(DEFAULTS_VERSION_KEY) || '1',
                10,
              ) || 1
            )
        if (storedVer < DEFAULTS_VERSION) {
          const additions: string[] = []
          for (let v = storedVer + 1; v <= DEFAULTS_VERSION; v++) {
            additions.push(...(DEFAULTS_ADDED_IN[v] || []))
          }
          const present = additions.filter(id => models.some(m => m.model_type === id))
          if (present.length > 0) {
            set(s => {
              const next = new Set(s.enabledModels)
              present.forEach(id => next.add(id))
              _saveEnabledModels(next)
              return { enabledModels: next }
            })
          }
          migrateMusicDefault = storedVer < 2
          studioModelRuntime.defaultsVersion = DEFAULTS_VERSION
          localStorage.setItem(DEFAULTS_VERSION_KEY, String(DEFAULTS_VERSION))
          _saveEnabledModels(get().enabledModels)
        }
      } catch { /* localStorage blocked — defaults only apply this session */ }

      // Hydrate persisted per-mode settings from localStorage.
      //
      // Deliberately PARTIAL: only navigation, per-mode model selections,
      // and H3 Sol/First Block preferences survive a page refresh. The working
      // state — prompt text and Advanced settings (seed, steps, LoRA
      // selection, …) — starts fresh from the model's defaults on every
      // load. The per-mode snapshots (savedParamsPerMode /
      // savedLoraPerMode / savedPromptPerMode) still carry edits across
      // MODE SWITCHES within a session, in-memory only. v1.2.0 restored
      // them here on refresh; stale text/seeds/LoRAs re-appearing after
      // a reload felt wrong, so a refresh is a clean slate again.
      const saved = _loadSettings()
      const durableConfigured = studioPreferences?.configured === true
      let selectedModelPerMode: Partial<Record<GenerationMode, string>> = {
        ...(saved?.selectedModelPerMode || {}),
        ...(durableConfigured
          ? studioPreferences.selected_model_per_mode as Partial<Record<GenerationMode, string>>
          : {}),
      }
      let selectedModelPerAudioSubMode: Partial<Record<import('../types').AudioSubMode, string>> = {
        ...(saved?.selectedModelPerAudioSubMode || {}),
        ...(durableConfigured
          ? studioPreferences.selected_model_per_audio_sub_mode as Partial<Record<import('../types').AudioSubMode, string>>
          : {}),
      }
      const rememberedAudioModel = selectedModelPerMode.audio || ''
      const requestedAudioSubMode = durableConfigured
        ? studioPreferences.audio_sub_mode
        : saved?.audioSubMode
      const restoredAudioSubMode: import('../types').AudioSubMode = (
        requestedAudioSubMode === 'speech'
        || requestedAudioSubMode === 'music'
        || requestedAudioSubMode === 'sfx'
        || requestedAudioSubMode === 'mixer'
        || requestedAudioSubMode === 'revoice'
      ) ? requestedAudioSubMode : _audioSubModeForModel(rememberedAudioModel)
      const requestedVideoWorkflow = durableConfigured
        ? studioPreferences.studio_video_workflow
        : saved?.studioVideoWorkflow
      const requestedImageWorkflow = durableConfigured
        ? studioPreferences.studio_image_workflow
        : saved?.studioImageWorkflow
      const restoredImageWorkflow = _normalizeStudioImageWorkflow(requestedImageWorkflow)
        ?? get().studioImageWorkflow
      const h3Preferences = durableConfigured
        ? studioPreferences.h3_optimizations
        : saved?.h3OptimizationPreferences
      const restoredH3Attention: '' | 'sol' | 'sla' | 'sdpa' = (
        h3Preferences?.override_attention === 'sol'
        || h3Preferences?.override_attention === 'sla'
        || h3Preferences?.override_attention === 'sdpa'
      ) ? h3Preferences.override_attention : ''
      const restoredH3OptimizationPreferences = {
        override_attention: restoredH3Attention,
        skip_steps_cache_type: h3Preferences?.skip_steps_cache_type === 'first_block'
          ? 'first_block' as const
          : '' as const,
        ...(typeof h3Preferences?.skip_steps_multiplier === 'number'
          ? { skip_steps_multiplier: h3Preferences.skip_steps_multiplier }
          : {}),
        ...(typeof h3Preferences?.skip_steps_start_step_perc === 'number'
          ? { skip_steps_start_step_perc: h3Preferences.skip_steps_start_step_perc }
          : {}),
      }
      // v2 migration: users whose saved audio model IS the old music
      // default follow it to the new default (see NEW_MUSIC_DEFAULT).
      // (The old-model-params concern the migration used to handle is
      // gone: saved params no longer rehydrate, and the defaults
      // hydration below runs on every boot.)
      if (migrateMusicDefault && selectedModelPerMode.audio === OLD_MUSIC_DEFAULT
          && models.some(m => m.model_type === NEW_MUSIC_DEFAULT)) {
        selectedModelPerMode = { ...selectedModelPerMode, audio: NEW_MUSIC_DEFAULT }
        if (selectedModelPerAudioSubMode.music === OLD_MUSIC_DEFAULT) {
          selectedModelPerAudioSubMode = {
            ...selectedModelPerAudioSubMode,
            music: NEW_MUSIC_DEFAULT,
          }
        }
      }
      let mode = get().generationMode
      let initialModelType: string

      if (saved || durableConfigured) {
        // Restore saved generation mode
        mode = (
          durableConfigured
            ? studioPreferences.generation_mode
            : saved?.generationMode
        ) || mode
        // Validate saved model for this mode still exists
        const savedModel = mode === 'audio'
          ? selectedModelPerAudioSubMode[restoredAudioSubMode] || selectedModelPerMode.audio
          : selectedModelPerMode[mode]
        initialModelType = savedModel
          && get().enabledModels.has(savedModel)
          && models.some(m => m.model_type === savedModel)
          ? savedModel
          : getDefaultModelForMode(mode, families, models, get().enabledModels)
        const bootedIntoRecast = mode === 'avatar'
          && (initialModelType === 'scail2_14B_recast_fast' || initialModelType === 'scail2_14B')
        const bootedIntoRepaint = mode === 'avatar'
          && initialModelType === 'scail2_14B_fast'
        const initialModel = models.find(model => model.model_type === initialModelType)
        const restoredVideoWorkflow = _normalizeStudioVideoWorkflow(
          requestedVideoWorkflow,
          initialModel,
        ) ?? (_isOmniVideoModel(initialModel) ? 'references' : get().studioVideoWorkflow)

        set(s => ({
          families,
          models,
          modelsLoaded: true,
          generationMode: mode,
          ...(bootedIntoRecast
            ? { editSubMode: 'recast' as const }
            : bootedIntoRepaint
              ? { editSubMode: 'restyle' as const }
              : {}),
          // Seed the VALIDATED boot model into the map (the saved entry
          // may point at a removed model) — _applyModelDefaults' race
          // guard compares against selectedModelPerMode[mode].
          selectedModelPerMode: { ...selectedModelPerMode, [mode]: initialModelType },
          selectedModelPerAudioSubMode,
          studioVideoWorkflow: restoredVideoWorkflow,
          studioImageWorkflow: restoredImageWorkflow,
          audioSubMode: restoredAudioSubMode,
          h3OptimizationPreferences: restoredH3OptimizationPreferences,
          // Mode-shaping mirrored from setGenerationMode: booting into
          // image mode needs image_mode 1 + Auto resolution. These used
          // to arrive via the restored params snapshot.
          ...(mode === 'image' ? { resolutionPreset: 'auto' as ResolutionPreset, aspectRatio: 'auto' as AspectRatio } : {}),
          params: {
            ...s.params,
            model_type: initialModelType || s.params.model_type,
            ...(mode === 'image' ? {
              image_mode: restoredImageWorkflow === 'inpaint' || restoredImageWorkflow === 'outpaint' ? 2 : 1,
              _studio_image_workflow: restoredImageWorkflow,
            } : {}),
            ...(mode === 'video' ? {
              image_mode: restoredVideoWorkflow === 'extend' ? 3 : restoredVideoWorkflow === 'blend' ? 4 : 0,
              _studio_video_workflow: restoredVideoWorkflow,
            } : {}),
            ...restoredH3OptimizationPreferences,
          },
        }))
      } else {
        initialModelType = getDefaultModelForMode(
          mode,
          families,
          models,
          get().enabledModels,
        )
        set(s => ({
          families,
          models,
          modelsLoaded: true,
          selectedModelPerMode: { [mode]: initialModelType },
          ...(mode === 'image' ? { resolutionPreset: 'auto' as ResolutionPreset, aspectRatio: 'auto' as AspectRatio } : {}),
          params: {
            ...s.params,
            model_type: initialModelType || s.params.model_type,
            ...(mode === 'image' ? { image_mode: 1 } : {}),
          },
        }))
      }

      // Load LoRAs, model options, and tuned defaults for the initial
      // model. The defaults hydration (steps, guidance, LM sampling…)
      // must run on every boot now that saved params don't rehydrate —
      // without it the sliders would show INITIAL_PARAMS' generic values
      // instead of the model's.
      const mt = initialModelType || get().params.model_type
      if (mt && !sfxModelTypes.has(mt)) {
        get().loadLoras(mt)
        get().loadModelOptions(mt)
        _applyModelDefaults(get, set, mt)
      }
      if (
        mode === 'video'
        && (get().studioVideoWorkflow === 'frames' || get().studioVideoWorkflow === 'references')
      ) {
        get().setStudioVideoCreateRoute(get().studioVideoCreateRoute)
      }
      // Migrate browser-only preferences to the durable server record and
      // refresh its validated model selections after defaults/fallbacks.
      _persistStickyStudioPreferences(get())
      // Refresh the lora_id ↔ filename map from /installed and reconcile
      // any filename renames since save (LoRA version updates land here
      // transparently — saved weights/activations carry over to the new
      // filename without user intervention).
      get().refreshLoraIdMap()

      // Auto-enable each Mature model once, then preserve an explicit
      // disable. The initialized IDs live in the same server-side visibility
      // record, so a changing Pinokio port cannot reset this decision.
      const cfg = get().servicesConfig
      if (cfg?.nsfw_mode && studioModelRuntime.visibilityHydrated) {
        set(s => {
          const next = _enableUninitializedMatureModels(
            models,
            s.enabledModels,
          )
          if (!next) return s
          _saveEnabledModels(next)
          return { enabledModels: next }
        })
      }
    } catch (e) {
      console.error('Failed to load models:', e)
    }
  },


  // LoRA state
  availableLoras: [],
  lorasLoading: false,
  loraWeights: {},
  loraIdByFilename: {},
  filenameByLoraId: {},

  /**
   * Refresh the lora_id ↔ filename maps from /api/v1/loras/installed.
   * Called once at boot (from loadModels) and again whenever LoRAs may
   * have been added/removed (after CivitAI download, scan, etc.).
   *
   * Side effect: runs reconciliation against the persisted savedLoraPerMode.
   * If a saved filename no longer exists on disk but the snapshot lora_id
   * resolves to a different filename in the fresh map, the rename is
   * applied transparently — that's the LoRA-version-update flow.
   */
  refreshLoraIdMap: async () => {
    try {
      const { loras } = await api.fetchInstalledLoras()
      const byFilename: Record<string, string> = {}
      const byLoraId: Record<string, string> = {}
      for (const l of loras) {
        if (!l.lora_id || !l.filename) continue
        byFilename[l.filename] = l.lora_id
        // If two files share a lora_id (rare — user kept v1 + v2 side by
        // side), the last one wins. Reconciliation will prefer whichever
        // matches the saved filename.
        byLoraId[l.lora_id] = l.filename
      }
      // Reconcile: rewrite stale filenames in savedLoraPerMode using the
      // snapshot loaded from localStorage (lora_id → filename-at-save-time).
      const s = get()
      const snapshot = s._loraFilenameSnapshotAtLoad || {}
      const reconciled: typeof s.savedLoraPerMode = {}
      let changed = false
      for (const [mode, blob] of Object.entries(s.savedLoraPerMode)) {
        if (!blob) continue
        const renameFilename = (fname: string): string | null => {
          if (byFilename[fname]) return fname  // still on disk, no change
          // Stale: look up its lora_id in snapshot, then current filename in fresh map.
          // Walk snapshot backwards (lora_id → fname) to find the lora_id this filename had.
          let foundId: string | null = null
          for (const [id, snapFname] of Object.entries(snapshot)) {
            if (snapFname === fname) { foundId = id; break }
          }
          if (foundId && byLoraId[foundId]) {
            changed = true
            return byLoraId[foundId]  // renamed
          }
          // LoRA was deleted entirely.
          changed = true
          return null
        }
        const newActivated = (blob.activated_loras || [])
          .map(renameFilename)
          .filter((x): x is string => x !== null)
        const newWeights: Record<string, number[]> = {}
        for (const [fname, w] of Object.entries(blob.loraWeights || {})) {
          const renamed = renameFilename(fname)
          if (renamed) newWeights[renamed] = w
        }
        const newAvailable = (blob.availableLoras || [])
          .map(renameFilename)
          .filter((x): x is string => x !== null)
        reconciled[mode as GenerationMode] = {
          ...blob,
          activated_loras: newActivated,
          loraWeights: newWeights,
          availableLoras: newAvailable,
        }
      }
      if (changed) {
        // Also rewrite the in-memory runtime state if its keys are stale
        const renameRuntimeFilename = (fname: string): string | null => {
          if (byFilename[fname]) return fname
          let foundId: string | null = null
          for (const [id, snapFname] of Object.entries(snapshot)) {
            if (snapFname === fname) { foundId = id; break }
          }
          if (foundId && byLoraId[foundId]) return byLoraId[foundId]
          return null
        }
        const curActivated = (s.params.activated_loras || [])
          .map(renameRuntimeFilename)
          .filter((x): x is string => x !== null)
        const curWeights: Record<string, number[]> = {}
        for (const [fname, w] of Object.entries(s.loraWeights || {})) {
          const renamed = renameRuntimeFilename(fname)
          if (renamed) curWeights[renamed] = w
        }
        set(state => ({
          loraIdByFilename: byFilename,
          filenameByLoraId: byLoraId,
          savedLoraPerMode: reconciled,
          params: { ...state.params, activated_loras: curActivated },
          loraWeights: curWeights,
        }))
        // Persist the reconciled state so next boot doesn't need to redo it.
        const ns = get()
        _saveSettings({
          generationMode: ns.generationMode,
          selectedModelPerMode: ns.selectedModelPerMode,
          savedParamsPerMode: ns.savedParamsPerMode,
          savedLoraPerMode: ns.savedLoraPerMode,
          savedPromptPerMode: ns.savedPromptPerMode,
        }, byFilename)
      } else {
        set({ loraIdByFilename: byFilename, filenameByLoraId: byLoraId })
      }
      // Fire-and-forget: kick off an update check, debounced server-side
      // by a 24h staleness window. If the manifest is fresh, the backend
      // returns immediately without hitting CivitAI; if stale, it walks
      // the library and refreshes badges in the background. The user's
      // current LoraSelector instance will pick up new badges on its
      // next /details fetch (mode change or refresh).
      api.checkLoraUpdates(false).catch(() => {
        // Network failures here are non-fatal — the manual "Check" button
        // in the LoraSelector remains available for retries.
      })
    } catch {
      // Non-fatal. Persistence will keep using filename-keyed legacy shape
      // until the map populates on a subsequent attempt.
    }
  },

  loadLoras: async (modelType) => {
    set({ lorasLoading: true })
    try {
      const data = await api.fetchLoras(modelType)
      set({ availableLoras: data.loras, lorasLoading: false })
    } catch {
      set({ availableLoras: [], lorasLoading: false })
    }
  },

  toggleLora: (filename) => {
    const { params, loraWeights, modelOptions, generationMode, editSubMode } = get()
    const phases = loraPhaseCount(modelOptions, generationMode, editSubMode)
    const managedTurboFilenames = new Set(
      modelOptions?.minimax_h3_turbo?.presets?.map(preset => preset.filename)
      || (modelOptions?.minimax_h3_turbo?.filename
        ? [modelOptions.minimax_h3_turbo.filename]
        : []),
    )
    const removedTurboPreset = params.activated_loras.includes(filename) && managedTurboFilenames.has(filename)
    const toggled = toggleLoraState(params.activated_loras, loraWeights, filename, phases)
    const { activatedLoras: current, weights: newWeights, multipliers } = toggled

    set(s => ({
      loraWeights: newWeights,
      params: {
        ...s.params,
        activated_loras: current,
        loras_multipliers: multipliers,
        ...(removedTurboPreset ? { minimax_h3_turbo_mode: false } : {}),
      },
    }))
    // Persist LoRA state
    const s = get()
    const mode = s.generationMode
    const updatedLoraPerMode = {
      ...s.savedLoraPerMode,
      [mode]: { activated_loras: current, loras_multipliers: multipliers, loraWeights: newWeights, availableLoras: s.availableLoras },
    }
    const updatedParamsPerMode = removedTurboPreset
      ? {
          ...s.savedParamsPerMode,
          [mode]: {
            ...(s.savedParamsPerMode[mode] || {}),
            minimax_h3_turbo_mode: false,
          },
        }
      : s.savedParamsPerMode
    set({
      savedLoraPerMode: updatedLoraPerMode,
      savedParamsPerMode: updatedParamsPerMode,
    })
    _saveSettings({ generationMode: mode, selectedModelPerMode: s.selectedModelPerMode, savedParamsPerMode: updatedParamsPerMode, savedLoraPerMode: updatedLoraPerMode, savedPromptPerMode: s.savedPromptPerMode }, s.loraIdByFilename)
  },

  ensureTransitionLoraForBlend: async () => {
    const state = get()
    const modelType = state.params.model_type as string
    // Only applies to LTX-2 family models — the LoRA is trained for LTX-2.3
    if (!modelType || !modelType.startsWith('ltx2')) return

    const HF_URL = 'https://huggingface.co/valiantcat/LTX-2.3-Transition-LORA'
    const matchesTransitionLora = (name: string) => /transition/i.test(name)

    try {
      // Step 1: check if already installed
      let { loras } = await api.fetchLoras(modelType)
      let transitionFilename = loras.find(matchesTransitionLora)

      // Step 2: if not installed, trigger HF download
      if (!transitionFilename) {
        console.log('[Blend] Transition LoRA not found locally — downloading from HuggingFace')
        let result: { filename: string } | null = null
        try {
          result = await api.importHuggingFaceLora(HF_URL)
        } catch (e) {
          console.error('[Blend] Transition LoRA download request failed:', e)
          return
        }
        // Poll the LoRA list until the new file appears (download runs in
        // a backend thread). Cap at ~3 min total.
        const expectedFilename = result?.filename
        for (let i = 0; i < 90; i++) {
          await new Promise(r => setTimeout(r, 2000))
          const refreshed = await api.fetchLoras(modelType)
          loras = refreshed.loras
          const found = expectedFilename
            ? loras.find(l => l === expectedFilename || matchesTransitionLora(l))
            : loras.find(matchesTransitionLora)
          if (found) { transitionFilename = found; break }
        }
        if (!transitionFilename) {
          console.warn('[Blend] Transition LoRA download did not complete in time — skipping auto-activation')
          return
        }
        console.log(`[Blend] Transition LoRA ready: ${transitionFilename}`)
        // Refresh the in-store available LoRA list so the UI shows the new file
        try { await get().loadLoras(modelType) } catch { /* non-fatal */ }
      }

      // Step 3: ensure it's in activated_loras (but don't toggle-off if it
      // happens to already be there)
      const activated = (get().params.activated_loras as string[]) || []
      if (!activated.includes(transitionFilename)) {
        get().toggleLora(transitionFilename)
        console.log(`[Blend] Auto-activated transition LoRA: ${transitionFilename}`)
      }
    } catch (e) {
      console.error('[Blend] ensureTransitionLoraForBlend failed:', e)
    }
  },

  ensureEditAnythingLora: async () => {
    const state = get()
    const modelType = state.params.model_type as string
    if (!modelType || !modelType.startsWith('ltx2')) return

    const HF_URL = 'https://huggingface.co/Alissonerdx/LTX-LoRAs'
    // Must match EDIT_ANYTHING_LORA_FILENAME in app/launch.py. The endpoint
    // will activate this server-side regardless of the client's LoRA list,
    // so we only need to ensure the file is present on disk before the
    // user hits Generate.
    const EDIT_ANYTHING_FILENAME =
      'ltx23_edit_anything_global_rank128_v1_9000steps_adamw.safetensors'
    const matchesEditAnything = (name: string) =>
      name === EDIT_ANYTHING_FILENAME ||
      /edit_anything.*9000steps/i.test(name)

    try {
      const { loras } = await api.fetchLoras(modelType)
      const already = loras.find(matchesEditAnything)
      if (already) return

      console.log('[EditAnything] LoRA not found locally — downloading from HuggingFace')
      try {
        await api.importHuggingFaceLora(HF_URL, undefined, EDIT_ANYTHING_FILENAME)
      } catch (e) {
        console.error('[EditAnything] LoRA download request failed:', e)
        return
      }
      // Poll every 2s until the file appears (up to ~3 min)
      for (let i = 0; i < 90; i++) {
        await new Promise(r => setTimeout(r, 2000))
        const refreshed = await api.fetchLoras(modelType)
        if (refreshed.loras.find(matchesEditAnything)) {
          console.log(`[EditAnything] LoRA ready: ${EDIT_ANYTHING_FILENAME}`)
          try { await get().loadLoras(modelType) } catch { /* non-fatal */ }
          return
        }
      }
      console.warn('[EditAnything] LoRA download did not complete in time')
    } catch (e) {
      console.error('[EditAnything] ensureEditAnythingLora failed:', e)
    }
  },

  setLoraWeight: (filename, phaseIndex, value) => {
    const { params, loraWeights, modelOptions, generationMode, editSubMode } = get()
    const phases = loraPhaseCount(modelOptions, generationMode, editSubMode)
    const updated = updateLoraWeight(
      params.activated_loras,
      loraWeights,
      filename,
      phaseIndex,
      value,
      phases,
    )
    if (!updated) return
    const { weights: newWeights, multipliers } = updated

    set(s => ({
      loraWeights: newWeights,
      params: { ...s.params, loras_multipliers: multipliers },
    }))
    // Persist LoRA state
    const s = get()
    const mode = s.generationMode
    const updatedLoraPerMode = {
      ...s.savedLoraPerMode,
      [mode]: { activated_loras: s.params.activated_loras, loras_multipliers: multipliers, loraWeights: newWeights, availableLoras: s.availableLoras },
    }
    set({ savedLoraPerMode: updatedLoraPerMode })
    _saveSettings({ generationMode: mode, selectedModelPerMode: s.selectedModelPerMode, savedParamsPerMode: s.savedParamsPerMode, savedLoraPerMode: updatedLoraPerMode, savedPromptPerMode: s.savedPromptPerMode }, s.loraIdByFilename)
  },


  // Model options
  modelOptions: null,
  modelOptionsLoading: false,

  loadModelOptions: async (modelType) => {
    const seq = ++_modelOptionsSeq
    set({ modelOptionsLoading: true })
    try {
      const options = await api.fetchModelOptions(modelType)
      // Staleness guard: a newer loadModelOptions call was issued while this
      // fetch was in flight (rapid model switching, or a settings restore
      // that jumped models). Applying a superseded response would clobber
      // params (default steps/guidance) and modelOptions with the WRONG
      // model's values — last requested wins.
      if (seq !== _modelOptionsSeq) return
      const activeState = get()
      const { durationSeconds, slidingWindowSeconds } = activeState
      const fps = options.fps || 16
      // Set overlap from model defaults
      const swDefaults = (options as unknown as Record<string, unknown>).sliding_window_defaults as Record<string, number> | undefined
      const overlapDefault = swDefaults?.overlap_default ?? 5
      const discardDefault = swDefaults?.discard_last_frames ?? 0
      const minimumDuration = Math.max(1, (options.frames_minimum || fps) / fps)
      const nativeMaximumDuration = options.frames_maximum
        ? options.frames_maximum / fps
        : null
      const h3ReferenceSequence = (
        options.omni_reference === true
        && activeState.params.minimax_h3_reference_sequence === true
      )
      const isH3 = String(options.architecture || '').startsWith('minimax_h3')
      const maximumDuration = options.omni_reference === true
        ? (nativeMaximumDuration && !h3ReferenceSequence
            ? nativeMaximumDuration
            : Number.POSITIVE_INFINITY)
        : (!options.sliding_window && nativeMaximumDuration
            ? nativeMaximumDuration
            : Number.POSITIVE_INFINITY)
      let nextDurationSeconds = Math.min(
        maximumDuration,
        Math.max(minimumDuration, durationSeconds),
      )
      if (
        options.sliding_window
        && nativeMaximumDuration
        && nextDurationSeconds <= Math.round(nativeMaximumDuration * 10) / 10
      ) {
        // H3's native ceiling is 14.375s but the UI displays one decimal.
        // Treat displayed 14.4s as that same one-window endpoint instead of
        // scheduling a second minimum-size pass for one rounded frame.
        nextDurationSeconds = Math.min(
          nextDurationSeconds,
          nativeMaximumDuration,
        )
      }
      let nextWindowFrames = Math.round(slidingWindowSeconds * fps)
      if (options.sliding_window && swDefaults?.window_default != null) {
        nextWindowFrames = swDefaults.window_default
      }
      if (options.sliding_window && swDefaults) {
        nextWindowFrames = Math.max(
          swDefaults.window_min ?? 1,
          Math.min(swDefaults.window_max ?? nextWindowFrames, nextWindowFrames),
        )
      } else if (!options.sliding_window) {
        nextWindowFrames = h3ReferenceSequence && options.frames_maximum
          ? options.frames_maximum
          : Math.round(nextDurationSeconds * fps)
      }
      let nextWindowSeconds = nextWindowFrames / fps
      let nextWindowLocked = false
      const paramUpdates: Record<string, unknown> = {
        guidance_phases: options.guidance_max_phases,
        video_length: Math.round(nextDurationSeconds * fps),
        sliding_window_size: nextWindowFrames,
        sliding_window_overlap: overlapDefault,
        sliding_window_discard_last_frames: discardDefault,
      }
      let nextResolutionPreset = activeState.resolutionPreset
      let nextAspectRatio = activeState.aspectRatio
      const modelPresetOrder = options.resolution_preset_order || []
      if (modelPresetOrder.length > 0) {
        if (!modelPresetOrder.includes(nextResolutionPreset)) {
          // A model-specific list can contain an expensive experimental tier
          // at the end. Select its ordinary 720p tier when the previous
          // model's preset is unavailable instead of silently jumping to the
          // largest canvas.
          nextResolutionPreset = modelPresetOrder.includes('720p')
            ? '720p'
            : modelPresetOrder[0]
        }
        if (nextAspectRatio === 'auto' && !options.supports_auto_aspect) {
          nextAspectRatio = '16:9'
        }
        const selectedPresetValues = options.resolution_presets?.[nextResolutionPreset]?.values
        if (nextAspectRatio === '21:9' && !selectedPresetValues?.['21:9']) {
          nextAspectRatio = '16:9'
        }
        paramUpdates.resolution = resolveResolution(
          options,
          nextResolutionPreset,
          nextAspectRatio,
        )
      } else if (
        nextAspectRatio === 'auto'
        && activeState.generationMode !== 'image'
        && !options.supports_auto_aspect
      ) {
        nextAspectRatio = '16:9'
        paramUpdates.resolution = resolveResolution(
          options,
          nextResolutionPreset,
          nextAspectRatio,
        )
      }
      if (isH3) {
        const selectedResolution = String(
          paramUpdates.resolution || activeState.params.resolution || '',
        )
        const overrideKey = h3WindowOverrideKey(modelType, selectedResolution)
        const savedOverride = activeState.h3WindowOverrides[overrideKey]
        const memoryPolicy = options.omni_reference === true
          ? options.omni_sequence_memory_policy
          : options.sliding_window_memory_policy
        const recommendation = h3ReferenceSequence
          ? recommendedH3OmniSequenceProfile(
              memoryPolicy,
              selectedResolution,
              activeState.systemStats?.gpu.vram_total_gb ?? 0,
              options.frames_minimum ?? 124,
              options.frames_maximum ?? 345,
              options.frames_steps ?? 17,
            )
          : recommendedH3PassProfile(
              memoryPolicy,
              selectedResolution,
              activeState.systemStats?.gpu.vram_total_gb ?? 0,
            )
        const selectedFrames = savedOverride ?? recommendation?.frames
        if (selectedFrames != null) {
          nextWindowFrames = normalizeH3NativeFrames(
            selectedFrames,
            options.frames_minimum ?? 124,
            options.frames_maximum ?? 345,
            options.frames_steps ?? 17,
          )
          nextWindowSeconds = nextWindowFrames / fps
          paramUpdates.sliding_window_size = nextWindowFrames
        }
        nextWindowLocked = savedOverride != null
        paramUpdates.sliding_window_memory_override = nextWindowLocked
        if (options.omni_reference === true) {
          paramUpdates.minimax_h3_sequence_memory_override = nextWindowLocked
          if (h3ReferenceSequence) {
            paramUpdates.minimax_h3_sequence_clip_frames = nextWindowFrames
          }
        }
        const multiWindowEnabled = options.omni_reference === true
          ? h3ReferenceSequence
          : activeState.params.minimax_h3_multi_window === true
        if (!multiWindowEnabled) {
          nextDurationSeconds = Math.min(nextDurationSeconds, nextWindowSeconds)
          paramUpdates.video_length = Math.round(nextDurationSeconds * fps)
        }
      }
      // Apply model defaults for inference steps and guidance scale
      if (options.default_num_inference_steps != null) {
        paramUpdates.num_inference_steps = options.default_num_inference_steps
      }
      if (options.default_guidance_scale != null) {
        paramUpdates.guidance_scale = options.default_guidance_scale
      }
      if (options.minimax_h3_text_encoder_choices?.length) {
        const currentEncoder = get().params.minimax_h3_text_encoder
        const valid = options.minimax_h3_text_encoder_choices.some(
          choice => choice.value === currentEncoder
        )
        if (!valid) {
          paramUpdates.minimax_h3_text_encoder = (
            options.minimax_h3_text_encoder_default
            || options.minimax_h3_text_encoder_choices[0].value
          )
        }
      }
      if (options.ltx25_video_vae_choices?.length) {
        const currentVideoVae = get().params.ltx25_video_vae
        const valid = options.ltx25_video_vae_choices.some(
          choice => choice.value === currentVideoVae
        )
        if (!valid) {
          paramUpdates.ltx25_video_vae = (
            options.ltx25_video_vae_default
            || options.ltx25_video_vae_choices[0].value
          )
        }
      }
      if (options.sla_attention) {
        const requestedAttention = get().params.override_attention
        paramUpdates.override_attention = requestedAttention === 'sdpa'
          ? 'sdpa'
          : 'sla'
        // This checkpoint's acceleration adapters are already fused into
        // its transformer. Never inherit an independent cache recipe across
        // a model switch.
        paramUpdates.skip_steps_cache_type = ''
      } else if (
        get().params.override_attention === 'sla'
        || get().params.override_attention === 'sdpa'
      ) {
        paramUpdates.override_attention = ''
      }
      if (options.minimax_h3_turbo) {
        const turboPresets = options.minimax_h3_turbo.presets?.length
          ? options.minimax_h3_turbo.presets
          : [{
              id: options.minimax_h3_turbo.preset_id,
              filename: options.minimax_h3_turbo.filename,
              steps: options.minimax_h3_turbo.steps,
            }]
        const requestedPresetId = get().params.minimax_h3_turbo_preset
        const selectedPreset = (
          turboPresets.find(preset => preset.id === requestedPresetId)
          || turboPresets.find(preset => preset.id === options.minimax_h3_turbo?.preset_id)
          || turboPresets[0]
        )
        paramUpdates.minimax_h3_turbo_preset = selectedPreset.id
        // A restored Turbo preset always displays the same step count the
        // backend will enforce. This also closes a race where model defaults
        // (20 steps) arrive after the user checks Turbo (currently 8-step PDD).
        if (get().params.minimax_h3_turbo_mode === true) {
          paramUpdates.num_inference_steps = selectedPreset.steps
        }
      } else {
        // Model switches preserve most Studio params. Never carry the Full-H3
        // Turbo flag invisibly into a Pruned H3 or unrelated model.
        paramUpdates.minimax_h3_turbo_mode = false
        paramUpdates.minimax_h3_turbo_preset = undefined
      }
      // TTS default duration. Prefer the model's declared `default` (DramaBox
      // uses 0 = auto-derive from prompt); fall back to `max` (legacy behavior
      // for older TTS models that didn't declare a default), then 600.
      const ttsDefaults: Record<string, unknown> = {}
      if (options.audio_only && options.duration_slider) {
        const ds = options.duration_slider
        ttsDefaults.durationSeconds = ds.default ?? ds.max ?? 600
      }
      // Clamp current voice count to the new model's max_voice_count (e.g.
      // user had 5 voices on Kugel, switches to Scenema which caps at 2 —
      // trim slots 3-5 so the UI doesn't show ghost voices that the backend
      // would silently ignore).
      const newMaxVoiceCount = ((options as { max_voice_count?: number }).max_voice_count) ?? 6
      const currentVoiceCount = get().ttsVoiceCount
      if (currentVoiceCount > newMaxVoiceCount) {
        const trimmedVoices = get().ttsVoices.slice(0, newMaxVoiceCount)
        ttsDefaults.ttsVoiceCount = newMaxVoiceCount
        ttsDefaults.ttsVoices = trimmedVoices
        // Re-derive audio_prompt_type from the clamped count using the new
        // model's selection list.
        const selection = (options.audio_prompt_type_sources?.selection as string[] | undefined) || ['', 'A', 'AB']
        const audioType = selection[Math.min(newMaxVoiceCount, selection.length - 1)]
        paramUpdates.audio_prompt_type = audioType
      }
      set(s => ({
        ...ttsDefaults,
        modelOptions: options,
        modelOptionsLoading: false,
        durationSeconds: (
          typeof ttsDefaults.durationSeconds === 'number'
            ? ttsDefaults.durationSeconds
            : nextDurationSeconds
        ),
        slidingWindowSeconds: nextWindowSeconds,
        slidingWindowOverlap: overlapDefault,
        slidingWindowLocked: nextWindowLocked,
        resolutionPreset: nextResolutionPreset,
        aspectRatio: nextAspectRatio,
        params: {
          ...s.params,
          ...paramUpdates,
        },
      }))
    } catch {
      // Same staleness rule as the success path — a superseded request's
      // failure must not null out the newer request's options.
      if (seq === _modelOptionsSeq) {
        set({ modelOptions: null, modelOptionsLoading: false })
      }
    }
  },


  selectModel: (modelType) => {
    const currentMode = get().generationMode
    set(s => ({
      params: {
        ...s.params,
        model_type: modelType,
        activated_loras: [],
        loras_multipliers: '',
        minimax_h3_turbo_mode: false,
        minimax_h3_turbo_preset: undefined,
      },
      selectedModelPerMode: { ...s.selectedModelPerMode, [currentMode]: modelType },
      ...(currentMode === 'audio' ? {
        selectedModelPerAudioSubMode: {
          ...s.selectedModelPerAudioSubMode,
          [s.audioSubMode]: modelType,
        },
      } : {}),
      h3WindowPlan: null,
      loraWeights: {},
      availableLoras: [],
    }))
    // Virtual SFX models don't have backend model options or LoRAs
    if (!sfxModelTypes.has(modelType)) {
      get().loadLoras(modelType)
      get().loadModelOptions(modelType)
      _applyModelDefaults(get, set, modelType)
    }
    _persistStickyStudioPreferences(get())
  }
  })
}
