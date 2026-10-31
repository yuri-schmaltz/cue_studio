/** Director submission is loaded when a production is started or queued. */
import type { StoreApi } from 'zustand'
import type { AppState, StudioModelDependencies } from './useStore'
import * as api from '../api/client'

type Dependencies = Pick<StudioModelDependencies, 'resolveResolution'> & {
  directorModelUsesFixedMediaStrength: (modelType: string, architecture?: string) => boolean
  onAttach: () => void
}

export async function startDirectorPipeline(
  set: StoreApi<AppState>['setState'],
  get: StoreApi<AppState>['getState'],
  mode: 'now' | 'queue',
  { resolveResolution, directorModelUsesFixedMediaStrength, onAttach }: Dependencies,
): Promise<void> {
    const initialState = get()
    if (
      initialState.directorSkill === 'music_video'
      && initialState.directorSceneDescription.trim()
      && initialState.directorAnalysis
      && initialState.directorPlannedClips.length === 0
    ) {
      if (mode === 'queue') {
        set({ directorQueueLoading: true, directorError: null })
      } else {
        set({ directorLoading: true, directorError: null })
      }
      try {
        await get().directorEnsureStructure()
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed to plan clip structure'
        set({ directorLoading: false, directorQueueLoading: false, directorError: msg })
        return
      }
    }
    const state = get()
    if (mode === 'queue') {
      set({ directorQueueLoading: true, directorError: null })
    } else {
      set({ directorLoading: true, directorError: null })
    }
    const { directorPlannedClips, directorSceneDescription,
            directorAudioPath, directorAnalysis, directorReferenceImagePath,
            directorAutoMode, directorSeamless, directorShotImageGuidance,
            directorResolution, directorAspectRatio,
            directorVideoMaxShotFramesByModel, directorH3TurboModeByModel,
            directorH3TurboPresetByModel, directorH3SolModeByModel,
            directorH3FirstBlockCacheByModel,
            directorH3FirstBlockCacheMultiplierByModel,
            directorH3FirstBlockCacheWarmupByModel,
            selectedModelPerMode, savedParamsPerMode, savedLoraPerMode,
            directorSpeakerMappings, directorImageSpatialUpsampling,
            directorImageFilmGrainIntensity, directorImageFilmGrainSaturation,
            directorVideoSpatialUpsampling, directorVideoFilmGrainIntensity,
            directorVideoFilmGrainSaturation, directorVideoSelfRefiner,
            shortFilmPath, shortFilmCharacters, shortFilmTargetDuration,
            shortFilmNarrative } = state

    const selectedImageModel = selectedModelPerMode.image || 'flux2_klein_9b'
    const selectedVideoModel = selectedModelPerMode.video || 'ltx2_22B_distilled_1_1'
    const selectedVideoDefinition = state.models.find(
      model => model.model_type === selectedVideoModel,
    )
    const usesH3OmniReferences = (
      selectedVideoModel.toLowerCase().startsWith('minimax_h3_ref2va')
      ||
      selectedVideoDefinition?.director?.video_strategy === 'omni_reference'
    )
    const directorH3References = usesH3OmniReferences
      ? state.directorH3References.map(reference => ({ ...reference }))
      : []
    const exactDriveReferences = directorH3References.filter(
      reference => reference.type === 'audio'
        && (reference.audio_intent || 'voice') === 'drive',
    )
    if (exactDriveReferences.length > 1) {
      set({
        directorLoading: false,
        directorQueueLoading: false,
        directorError: 'H3 Omni accepts one Music / performance timeline. Change additional audio references to Voice or Style.',
      })
      return
    }
    const exactDriveReference = exactDriveReferences[0]
    const exactDriveDuration = Number(exactDriveReference?.duration_seconds)
    const analyzedDuration = Number(directorAnalysis?.duration)
    if (
      exactDriveReference
      && shortFilmPath !== 'story'
      && Number.isFinite(exactDriveDuration) && exactDriveDuration > 0
      && Number.isFinite(analyzedDuration) && analyzedDuration > 0
      && Math.abs(exactDriveDuration - analyzedDuration) > 0.75
    ) {
      set({
        directorLoading: false,
        directorQueueLoading: false,
        directorError: `The H3 Omni performance timeline is ${exactDriveDuration.toFixed(1)}s, but Director planned this project for ${analyzedDuration.toFixed(1)}s. Use the same track as Director’s main audio, or re-analyze that track first.`,
      })
      return
    }
    const effectiveDirectorAudioPath = exactDriveReference?.path || directorAudioPath

    // Director model choices are independent from whichever Studio model was
    // edited most recently. Hydrate each selected model's own tuned defaults,
    // then reuse saved Studio overrides only when they explicitly belong to
    // that same model. This prevents a distilled model's settings from
    // leaking into a full model (or vice versa) after a Director-only switch.
    const [imageModelDefaults, videoModelDefaults, fetchedImageOptions, fetchedVideoOptions] = await Promise.all([
      api.fetchDefaults(selectedImageModel).catch(() => ({})),
      api.fetchDefaults(selectedVideoModel).catch(() => ({})),
      api.fetchModelOptions(selectedImageModel).catch(() => null),
      api.fetchModelOptions(selectedVideoModel).catch(() => null),
    ])
    const cachedVideoOptions = state.modelOptions?.model_type === selectedVideoModel
      ? state.modelOptions
      : null
    const directorVideoOptions = fetchedVideoOptions || cachedVideoOptions
    const directorFixedMediaStrength = directorModelUsesFixedMediaStrength(
      selectedVideoModel,
      directorVideoOptions?.architecture
        || state.models.find(model => model.model_type === selectedVideoModel)?.architecture,
    )
    const directorImageOptions = fetchedImageOptions
    const directorImageResolution = resolveResolution(
      directorImageOptions,
      directorResolution,
      directorAspectRatio,
    )
    const directorVideoResolution = resolveResolution(
      directorVideoOptions,
      directorResolution,
      directorAspectRatio,
    )
    const fps = directorVideoOptions?.fps ?? 16
    const savedImageParams = savedParamsPerMode.image || {}
    const savedVideoParams = savedParamsPerMode.video || {}
    const matchingImageParams = savedImageParams.model_type === selectedImageModel
      ? savedImageParams
      : {}
    const matchingVideoParams = savedVideoParams.model_type === selectedVideoModel
      ? savedVideoParams
      : {}
    const rawDefaultVideoSteps = (
      directorVideoOptions?.default_num_inference_steps
      ?? (videoModelDefaults as Record<string, unknown>).num_inference_steps
      ?? 8
    )
    const parsedDefaultVideoSteps = Number(rawDefaultVideoSteps)
    const defaultVideoSteps = Number.isFinite(parsedDefaultVideoSteps) && parsedDefaultVideoSteps > 0
      ? Math.max(1, Math.min(50, Math.round(parsedDefaultVideoSteps)))
      : 8
    const configuredVideoSteps = state.directorVideoInferenceStepsByModel[selectedVideoModel]
    // A model may publish a fixed distilled recipe. In that case the model
    // default wins even if an older adjustable build left an override behind.
    let directorVideoSteps = directorVideoOptions?.lock_inference_steps
      ? defaultVideoSteps
      : (configuredVideoSteps ?? defaultVideoSteps)
    const directorTurboOption = directorVideoOptions?.minimax_h3_turbo
    const directorTurboPresets = directorTurboOption?.presets?.length
      ? directorTurboOption.presets
      : directorTurboOption
        ? [{
            id: directorTurboOption.preset_id,
            label: directorTurboOption.version_label,
            status: 'validated',
            filename: directorTurboOption.filename,
            steps: directorTurboOption.steps,
            weight: directorTurboOption.weight,
            weight_min: 0.5,
            weight_max: 1.0,
            description: directorTurboOption.guide,
            revision: '',
          }]
        : []
    const directorTurboPreset = (
      directorTurboPresets.find(
        preset => preset.id === directorH3TurboPresetByModel[selectedVideoModel],
      )
      || directorTurboPresets.find(
        preset => preset.id === directorTurboOption?.preset_id,
      )
      || directorTurboPresets[0]
    )
    const savedDirectorVideoLoras = savedLoraPerMode.video
    const directorTurboEnabled = Boolean(
      directorTurboOption && directorTurboPreset
      && directorH3TurboModeByModel[selectedVideoModel] === true
      && savedDirectorVideoLoras?.activated_loras?.includes(directorTurboPreset.filename)
    )
    if (directorTurboEnabled) directorVideoSteps = directorTurboPreset!.steps
    const directorSolEnabled = Boolean(
      directorVideoOptions?.sol_attention
      && directorVideoOptions.sol_attention_status?.supported
      && directorH3SolModeByModel[selectedVideoModel] === true
    )
    const directorSlaEnabled = Boolean(
      directorVideoOptions?.sla_attention
      && (
        directorH3SolModeByModel[selectedVideoModel]
        ?? directorVideoOptions.sla_attention_default
      ) !== false
    )
    const directorFirstBlockCacheEnabled = Boolean(
      directorVideoOptions?.first_block_cache
      && directorH3FirstBlockCacheByModel[selectedVideoModel] === true
    )
    const cacheChoices = directorVideoOptions?.skip_steps_multiplier_choices || []
    const requestedCacheMultiplier = (
      directorH3FirstBlockCacheMultiplierByModel[selectedVideoModel]
      ?? directorVideoOptions?.default_skip_steps_multiplier
      ?? 0.08
    )
    const directorCacheMultiplier = cacheChoices.length
      ? cacheChoices.reduce((closest, choice) => (
          Math.abs(choice[1] - requestedCacheMultiplier)
            < Math.abs(closest - requestedCacheMultiplier)
            ? choice[1]
            : closest
        ), cacheChoices[0][1])
      : requestedCacheMultiplier
    const directorCacheWarmup = Math.max(0, Math.min(75, Math.round((
      directorH3FirstBlockCacheWarmupByModel[selectedVideoModel]
      ?? directorVideoOptions?.default_skip_steps_start_step_perc
      ?? 25
    ) / 5) * 5))
    // Defensive cleanup: if the active video model doesn't publish an
    // architectural ``frames_maximum`` (rolling-window models like LTX2
    // / Wan), drop any stale manual override that might have leaked
    // across a model switch in localStorage. Without this, a saved value
    // from a previous model can sneak into a request for a model that
    // would reject it (backend 400) — and the user can't fix it from the
    // UI because no dropdown is rendered for sliding-window models.
    const selectedFramesMaximum = directorVideoOptions?.frames_maximum ?? null
    if (
      !Number.isFinite(selectedFramesMaximum)
      && directorVideoMaxShotFramesByModel[selectedVideoModel] != null
    ) {
      get().setDirectorVideoMaxShotFrames(selectedVideoModel, null)
    }
    const directorMaxShotFrames = directorVideoMaxShotFramesByModel[selectedVideoModel]

    // Upload all reference images (main + character + location) if not already uploaded
    let refImagePath = directorReferenceImagePath
    if (!refImagePath && state.directorReferenceImage) {
      try {
        const uploaded = await api.uploadImage(state.directorReferenceImage)
        refImagePath = uploaded.path
        set({ directorReferenceImagePath: refImagePath })
      } catch (e) {
        console.error('Failed to upload reference image for pipeline:', e)
      }
    }
    // Upload character refs that haven't been uploaded yet
    const charPaths = [...state.directorCharacterRefPaths]
    for (let i = charPaths.length; i < state.directorCharacterRefs.length; i++) {
      try {
        const uploaded = await api.uploadImage(state.directorCharacterRefs[i])
        charPaths.push(uploaded.path)
      } catch { /* skip failed uploads */ }
    }
    if (charPaths.length > state.directorCharacterRefPaths.length) {
      set({ directorCharacterRefPaths: charPaths })
    }
    // Upload location refs that haven't been uploaded yet
    const locPaths = [...state.directorLocationRefPaths]
    for (let i = locPaths.length; i < state.directorLocationRefs.length; i++) {
      try {
        const uploaded = await api.uploadImage(state.directorLocationRefs[i])
        locPaths.push(uploaded.path)
      } catch { /* skip failed uploads */ }
    }
    if (locPaths.length > state.directorLocationRefPaths.length) {
      set({ directorLocationRefPaths: locPaths })
    }
    const supportsVoiceReference = (
      selectedVideoDefinition?.director?.supports_voice_reference === true
    )
    const voiceReferenceMode = (
      selectedVideoDefinition?.director?.voice_reference_mode ?? 'none'
    )

    // Voice Reference is an LTX-2 ID-LoRA or a native H3 Omni audio
    // reference. Keep the local selection across model switches, but only
    // upload and submit it when the selected Director model can consume it.
    let voiceRefPath = state.directorVoiceRefPath
    if (supportsVoiceReference && !voiceRefPath && state.directorVoiceRef) {
      try {
        const uploaded = await api.uploadAudio(state.directorVoiceRef)
        voiceRefPath = uploaded.path
        set({ directorVoiceRefPath: voiceRefPath })
      } catch { /* skip */ }
    }

    // A reviewed project is a frozen edit decision, not a request to ask the
    // LLM to invent a new plan. Upload any user-edited scene images and pass
    // the exact prompts/timeline to the new immutable revision.
    let preparedClipImagePaths: string[] | undefined
    if (state.directorClipPlans.length > 0) {
      const paths: string[] = []
      for (let index = 0; index < state.directorClipPlans.length; index++) {
        const image = state.directorClipImages.find(item => item.clipIndex === index)
        if (!image) {
          paths.length = 0
          break
        }
        if (image.file && image.file.size > 0) {
          try {
            const uploaded = await api.uploadImage(image.file)
            paths.push(uploaded.path)
          } catch {
            paths.length = 0
            break
          }
        } else if (image.filename) {
          paths.push(image.filename)
        } else {
          paths.length = 0
          break
        }
      }
      if (paths.length === state.directorClipPlans.length) {
        preparedClipImagePaths = paths
      }
    }

    // Determine pipeline type
    let pipelineType = 'music_video'
    if (shortFilmPath === 'story') pipelineType = 'short_film_story'
    else if (shortFilmPath === 'audio') pipelineType = 'short_film_audio'

    const pipelineParams: Record<string, unknown> = {
      pipeline_type: pipelineType,
      skill_type: state.directorSkill || (pipelineType.startsWith('short_film') ? 'short_film' : 'music_video'),
      // Queueing never changes the user's approval policy.
      auto_mode: directorAutoMode,
      workspace: get().activeWorkspace,
      _director_project_id: state.directorProjectId || undefined,
      _director_parent_pipeline_id: state.directorSourcePipelineId || undefined,
      scene_description: directorSceneDescription,
      audio_path: effectiveDirectorAudioPath,
      // Audio analysis already produced this reusable stem for transcription.
      // LTX-2.5 can condition mouth motion on it while Director keeps the
      // untouched song as the final joined soundtrack.
      audio_vocals_path: effectiveDirectorAudioPath === directorAudioPath
        ? (directorAnalysis?.vocals_path || undefined)
        : undefined,
      reference_image_path: refImagePath,
      ...(usesH3OmniReferences ? {
        minimax_h3_references: directorH3References,
        minimax_h3_reference_detail: state.directorH3ReferenceDetail,
      } : {}),
      character_ref_paths: charPaths.length > 0 ? charPaths : undefined,
      character_ref_labels: state.directorCharacterRefLabels.length > 0 ? state.directorCharacterRefLabels : undefined,
      location_ref_paths: locPaths.length > 0 ? locPaths : undefined,
      location_ref_labels: state.directorLocationRefLabels.length > 0 ? state.directorLocationRefLabels : undefined,
      planned_clips: directorPlannedClips,
      prepared_clip_plans: state.directorClipPlans.length > 0
        ? state.directorClipPlans : undefined,
      prepared_planned_clips: state.directorClipPlans.length > 0
        ? directorPlannedClips : undefined,
      prepared_clip_image_paths: preparedClipImagePaths,
      seamless: directorSeamless,
      shot_image_guidance: directorShotImageGuidance,
      director_resolution_preset: directorResolution,
      director_aspect_ratio: directorAspectRatio,
      // Only send the override when the user explicitly set a finite,
      // positive frame count. Spreading `undefined` is a no-op for
      // JSON.stringify so the field is omitted entirely from the request.
      // Background: a stale override from a previous model can survive a
      // model switch in localStorage and previously leaked into requests
      // for models that don't publish an architectural frame limit (LTX2,
      // Wan, etc) — backend rejected with 400 even though the user's
      // current intent was "Auto". See director_video_strategy.py for the
      // matching backend change.
      ...(Number.isFinite(directorMaxShotFrames) && (directorMaxShotFrames as number) > 0
        ? { director_max_shot_frames: directorMaxShotFrames }
        : {}),
      fps,
      frames_steps: directorVideoOptions?.frames_steps ?? 4,
      frames_minimum: directorVideoOptions?.frames_minimum ?? 5,

      // Director v2 flag — see prior callsites: ?? not || so explicit
      // user toggle-off is respected (legacy v1), only fall back to
      // true when the field is undefined.
      use_director_v2: state.servicesConfig?.use_director_v2 ?? true,

      // LLM
      llm_model_id: state.servicesConfig?.llm_model_id || state.llmStatus?.model_id,
      llm_device: state.servicesConfig?.llm_device || state.llmStatus?.device,
      llm_provider: state.servicesConfig?.llm_provider || 'local',
      lyrics: directorAnalysis?.lyrics || '',
      bpm: directorAnalysis?.bpm,
      speaker_mappings: directorSpeakerMappings,
      characters: shortFilmCharacters,
      target_duration: shortFilmTargetDuration,
      narrative_mode: shortFilmNarrative,

      // Image gen settings
      image_model: selectedImageModel,
      image_params: {
        ...imageModelDefaults,
        ...matchingImageParams,
        resolution: directorImageResolution,
      },
      image_loras: savedLoraPerMode.image || {},
      image_spatial_upsampling: directorImageSpatialUpsampling,
      image_film_grain_intensity: directorImageFilmGrainIntensity,
      image_film_grain_saturation: directorImageFilmGrainSaturation,

      // Video gen settings
      video_model: selectedVideoModel,
      video_params: {
        ...videoModelDefaults,
        ...matchingVideoParams,
        // Director owns this value. Studio's Advanced step count is separate
        // state and must not leak into a new Director project.
        num_inference_steps: directorVideoSteps,
        resolution: directorVideoResolution,
        minimax_h3_turbo_mode: directorTurboEnabled,
        minimax_h3_turbo_preset: directorTurboPreset?.id,
        override_attention: directorSlaEnabled
          ? 'sla'
          : directorVideoOptions?.sla_attention
            ? 'sdpa'
            : directorSolEnabled
              ? 'sol'
              : '',
        skip_steps_cache_type: directorFirstBlockCacheEnabled ? 'first_block' : '',
        skip_steps_multiplier: directorCacheMultiplier,
        skip_steps_start_step_perc: directorCacheWarmup,
        ...(directorFixedMediaStrength ? { input_video_strength: 1.0 } : {}),
      },
      video_loras: directorVideoOptions?.loras_disabled
        ? {
            activated_loras: [],
            loras_multipliers: '',
            loraWeights: {},
            availableLoras: [],
          }
        : savedLoraPerMode.video || {},
      video_spatial_upsampling: directorVideoSpatialUpsampling,
      video_film_grain_intensity: directorVideoFilmGrainIntensity,
      video_film_grain_saturation: directorVideoFilmGrainSaturation,
      video_self_refiner: directorVideoSelfRefiner,
      audio_scale: directorFixedMediaStrength ? 1.0 : get().directorAudioScale,

      // Voice identity: LTX uses the CelebVHQ ID-LoRA; H3 Omni maps the
      // same upload into each shot's native Ref2VA manifest.
      ...(supportsVoiceReference && voiceRefPath ? {
        voice_reference: voiceRefPath,
        ...(voiceReferenceMode === 'id_lora' ? {
          identity_guidance_scale: state.directorIdentityGuidanceScale,
        } : {}),
      } : {}),

      // Presentation/editor state is saved beside the immutable renderer
      // request so Open & Edit can restore everything the user sees without
      // rerunning analysis or planning.
      director_ui_snapshot: {
        snapshot_version: 1,
        directorSkill: state.directorSkill,
        directorStep: state.directorStep,
        directorSceneDescription: state.directorSceneDescription,
        directorAudioName: exactDriveReference?.filename
          || state.directorAudioFile?.name || null,
        directorAnalysis: state.directorAnalysis,
        directorPlannedClips: state.directorPlannedClips,
        directorEnergyBias: state.directorEnergyBias,
        directorClipPlans: state.directorClipPlans,
        directorSpeakers: state.directorSpeakers,
        directorSpeakerMappings: state.directorSpeakerMappings,
        directorAutoMode: state.directorAutoMode,
        directorSeamless: state.directorSeamless,
        directorShotImageGuidance: state.directorShotImageGuidance,
        directorLlmLog: state.directorLlmLog,
        directorResolution: state.directorResolution,
        directorAspectRatio: state.directorAspectRatio,
        directorCharacterRefLabels: state.directorCharacterRefLabels,
        directorLocationRefLabels: state.directorLocationRefLabels,
        directorH3ReferenceDetail: state.directorH3ReferenceDetail,
        directorVoiceRefName: state.directorVoiceRef?.name || null,
        directorIdentityGuidanceScale: state.directorIdentityGuidanceScale,
        directorMusicSource: state.directorMusicSource,
        directorMusicModel: state.directorMusicModel,
        directorSongDescription: state.directorSongDescription,
        directorSongInstrumental: state.directorSongInstrumental,
        directorSongStyle: state.directorSongStyle,
        directorSongLyrics: state.directorSongLyrics,
        directorSongDuration: state.directorSongDuration,
        directorVideoInferenceStepsByModel: state.directorVideoInferenceStepsByModel,
        directorVideoMaxShotFramesByModel: state.directorVideoMaxShotFramesByModel,
        directorH3TurboModeByModel: state.directorH3TurboModeByModel,
        directorH3TurboPresetByModel: state.directorH3TurboPresetByModel,
        directorH3SolModeByModel: state.directorH3SolModeByModel,
        directorH3FirstBlockCacheByModel: state.directorH3FirstBlockCacheByModel,
        directorH3FirstBlockCacheMultiplierByModel: state.directorH3FirstBlockCacheMultiplierByModel,
        directorH3FirstBlockCacheWarmupByModel: state.directorH3FirstBlockCacheWarmupByModel,
        directorImageSpatialUpsampling: state.directorImageSpatialUpsampling,
        directorImageFilmGrainIntensity: state.directorImageFilmGrainIntensity,
        directorImageFilmGrainSaturation: state.directorImageFilmGrainSaturation,
        directorVideoSpatialUpsampling: state.directorVideoSpatialUpsampling,
        directorVideoFilmGrainIntensity: state.directorVideoFilmGrainIntensity,
        directorVideoFilmGrainSaturation: state.directorVideoFilmGrainSaturation,
        directorVideoSelfRefiner: state.directorVideoSelfRefiner,
        directorAudioScale: state.directorAudioScale,
        shortFilmCharacters: state.shortFilmCharacters,
        shortFilmTargetDuration: state.shortFilmTargetDuration,
        shortFilmNarrative: state.shortFilmNarrative,
      },
    }

    try {
      if (mode === 'queue') {
        const queue = state.directorQueueEditingEntryId
          ? await api.updateDirectorQueueEntry(
              state.directorQueueEditingEntryId,
              pipelineParams,
            )
          : await api.enqueueDirectorPipeline(pipelineParams)
        set({
          directorQueue: queue,
          directorQueueLoading: false,
          directorQueueEditingEntryId: null,
          directorError: null,
        })
        void get().clearDirectorDraft()
        return
      }
      // If v2 plan already registered an official pipeline (e.g. via
      // directorPlanPrompts → register_only), continue that pipeline
      // instead of creating a second registry entry, so the Director does not
      // end up with two orphan pipelines for the same project.
      const existingPid = get().pipelineId
      const existingStatus = get().pipelineStatus?.status
      if (existingPid && existingStatus
          && !['completed', 'failed', 'cancelled'].includes(existingStatus)) {
        await api.continuePipeline(existingPid, undefined)
        void get().clearDirectorDraft()
        set({
          pipelinePolling: true,
          directorStep: 'plan',
          directorLoading: true,
          directorError: null,
        })
        get().pollPipelineStatus()
        return
      }
      const { pipeline_id } = await api.startPipeline(pipelineParams)
      void get().clearDirectorDraft()
      onAttach()
      set({
        pipelineId: pipeline_id,
        directorProjectId: state.directorProjectId || pipeline_id,
        directorSourcePipelineId: pipeline_id,
        pipelineStatus: null,
        pipelinePolling: true,
        directorStep: 'plan',
        directorLoading: true,
        directorError: null,
      })
      get().pollPipelineStatus()
    } catch (e) {
      // Backend rejected the start (typically HTTP 400 with a `detail` from
      // the Director pipeline validation, e.g. "Saved Director shot N
      // requires X frames, but Auto allows one Y-frame ..."). Without this
      // reset the frontend would stay stuck in `directorLoading: true` with
      // no pipelineId to poll, hiding the real reason behind a generic
      // spinner. Clear every bit of start state and surface the backend's
      // own error message so the user can act on it.
      const msg = e instanceof Error ? e.message : 'Pipeline failed to start'
      console.error('[Director] Pipeline start rejected:', e)
      set({
        directorError: msg,
        directorLoading: false,
        directorQueueLoading: false,
        directorActivityLabel: '',
        directorActivityFraction: 0,
        pipelinePolling: false,
        // Keep directorStep where the user was (style / review / …) so
        // they can edit + retry instead of being yanked back to upload.
      })
    }
}
