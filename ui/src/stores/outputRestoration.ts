/** Restore media sidecars on demand, without loading this workflow at boot. */
import type { StoreApi } from 'zustand'
import type { AppState, StudioModelDependencies, StudioModeDependencies } from './useStore'
import type { GenerateParams, StudioImageWorkflow, StudioVideoWorkflow, ModelOptions, AspectRatio, ResolutionPreset, RecastCharacterMapping, RepaintRegionMapping, H3WindowPlan, MultiClip } from '../types'
import { normalizeH3ClipFrameSchedule } from '../lib/h3Memory'
import * as api from '../api/client'
import { inferOutpaintAspect as _inferOutpaintAspect, OUTPAINT_ASPECT_RATIOS as _OUTPAINT_ASPECT_RATIOS, type OutpaintAspect } from './utils'

type Dependencies = Pick<StudioModelDependencies, '_normalizeStudioImageWorkflow' | '_normalizeStudioVideoWorkflow' | '_isOmniVideoModel' | 'sfxModelTypes'>
  & Pick<StudioModeDependencies, 'captureVideoSubModeStash' | 'DEFAULT_RECAST_MAPPING'>
  & {
    isMusicModelType: (modelType: string) => boolean
    findResolutionSelection: (resolution: string, options: ModelOptions | null) => { preset: ResolutionPreset; ratio: AspectRatio } | null
    getModelMode: (modelType: string, familyId: string) => AppState['generationMode']
  }

export async function restoreOutputSettings(
  set: StoreApi<AppState>['setState'],
  get: StoreApi<AppState>['getState'],
  dependencies: Dependencies,
): Promise<void> {
  const { _normalizeStudioImageWorkflow, _normalizeStudioVideoWorkflow, _isOmniVideoModel, captureVideoSubModeStash, sfxModelTypes, isMusicModelType, findResolutionSelection, DEFAULT_RECAST_MAPPING, getModelMode } = dependencies
    // Metadata is normally fetched in the background when an output is selected.
    // On a slow/high-latency link (e.g. the user is remote over VPN) that fetch
    // may not have landed — or may have failed — by the time "Load Settings" is
    // clicked, leaving selectedOutputMeta null and this a silent no-op. Re-fetch
    // on demand so the click is self-healing regardless of the background state.
    let selectedOutputMeta = get().selectedOutputMeta
    console.log('[LoadSettings] clicked — meta present:', !!selectedOutputMeta?.params,
                '| metadataLoading:', get().metadataLoading, '| selectedOutput idx:', get().selectedOutput)
    if (!selectedOutputMeta?.params) {
      const pendingOutput = get().filteredOutputs()[get().selectedOutput]
      console.log('[LoadSettings] no meta yet — on-demand fetch for:', pendingOutput?.name ?? '(no output at index)')
      if (pendingOutput) {
        await get().loadOutputMetadata(pendingOutput.name)
        selectedOutputMeta = get().selectedOutputMeta
        console.log('[LoadSettings] after on-demand fetch — params present:', !!selectedOutputMeta?.params,
                    '| source:', selectedOutputMeta?.source)
      }
    }
    if (selectedOutputMeta?.director_pipeline_id) {
      await get().loadDirectorFromPipeline(selectedOutputMeta.director_pipeline_id)
      return
    }
    if (!selectedOutputMeta?.params) {
      console.warn('[LoadSettings] ABORT — no params available after fetch attempt; button is a no-op')
      return
    }
    const { models } = get()
    const p = selectedOutputMeta.params as Record<string, unknown>
    const uploadFilenames = selectedOutputMeta.upload_filenames as Record<string, string | string[]> | undefined
    console.log('[LoadSettings] applying settings — model_type:', p.model_type, '| param keys:', Object.keys(p).length)

    // Editor exports have their own durable project document instead of a
    // model recipe. Reopen that project directly; treating `editor` as a
    // generation model used to dump the export into Studio Frames and lose
    // the whole timeline.
    if (p.model_type === 'editor' && typeof p.editor_project_id === 'string') {
      const workspace = typeof p.editor_workspace === 'string' && p.editor_workspace
        ? p.editor_workspace
        : get().activeWorkspace
      set({ appSection: 'editor', sidebarMode: 'editor' })
      const { useEditorStore } = await import('../editor/useEditorStore')
      const editor = useEditorStore.getState()
      if (editor.workspace !== workspace) await editor.initialize(workspace)
      await useEditorStore.getState().loadProject(p.editor_project_id)
      return
    }

    // Mixer is an ffmpeg workflow and deliberately has no selectable model.
    // Its sidecar carries the complete track recipe, so restore it before the
    // normal model lookup (which would reject the virtual audio_mixer id).
    if (
      p._audio_sub_mode === 'mixer'
      || (p.model_type === 'audio_mixer' && Array.isArray(p.audio_mixer_tracks))
    ) {
      set(s => ({
        appSection: 'director' as const, workspaceStage: 'studio' as const, sidebarMode: 'studio',
        generationMode: 'audio',
        audioSubMode: 'mixer',
        params: {
          ...s.params,
          model_type: '',
          prompt: '',
          _audio_sub_mode: 'mixer',
          audio_mixer_tracks: Array.isArray(p.audio_mixer_tracks)
            ? (p.audio_mixer_tracks as NonNullable<GenerateParams['audio_mixer_tracks']>)
                .map(track => ({ ...track }))
            : [],
        },
      }))
      return
    }

    // Standalone finishing sidecars intentionally use the virtual
    // `post_processing` model id. Restore them into the new grouped Studio
    // hierarchy rather than asking model discovery to resolve that id. Older
    // sidecars only carry edit_sub_mode; newer ones also carry top-level tool.
    const restoredTool = (
      selectedOutputMeta.tool === 'upscale'
      || selectedOutputMeta.tool === 'film_grain'
      || selectedOutputMeta.tool === 'revoice'
        ? selectedOutputMeta.tool
        : p.edit_sub_mode === 'upscale'
          || p.edit_sub_mode === 'film_grain'
          || p.edit_sub_mode === 'revoice'
          ? p.edit_sub_mode
          : null
    ) as 'upscale' | 'film_grain' | 'revoice' | null
    if (restoredTool) {
      const selectedOutput = get().filteredOutputs()[get().selectedOutput]
      const recordedSource = String(selectedOutputMeta.tool_source || '').trim()
      const sourceName = (
        recordedSource.replace(/\\/g, '/').split('/').pop()
        || selectedOutput?.name
        || ''
      )
      const sourceUrl = sourceName
        ? api.getFileUrl(sourceName)
        : selectedOutput?.url || null
      const restoredUpscaleMedia = selectedOutputMeta.tool_media_type === 'image'
        ? 'image'
        : 'video'
      const restoredRevoiceRefs = Array.isArray(p.voice_ref_paths)
        ? (p.voice_ref_paths as unknown[])
            .map(value => String(value || '').trim())
            .filter(Boolean)
            .slice(0, 2)
            .map(path => ({
              path,
              filename: path.replace(/\\/g, '/').split('/').pop() || path,
            }))
        : []
      set(restoredTool === 'upscale'
        ? {
            appSection: 'director' as const, workspaceStage: 'studio' as const, sidebarMode: 'studio',
            generationMode: 'tools',
            toolsTool: 'upscale',
            toolsUpscaleMedia: restoredUpscaleMedia,
            ...(restoredUpscaleMedia === 'image'
              ? { studioImageWorkflow: 'upscale' as StudioImageWorkflow }
              : { studioVideoWorkflow: 'upscale' as StudioVideoWorkflow }),
            toolsSourcePath: sourceName || null,
            toolsSourceName: sourceName || null,
            toolsSourceUrl: sourceUrl,
            toolsUpscaleMethod: String(p.method || 'flashvsr2'),
          }
        : restoredTool === 'film_grain'
          ? {
              appSection: 'director' as const, workspaceStage: 'studio' as const, sidebarMode: 'studio',
              generationMode: 'tools',
              toolsTool: 'film_grain',
              toolsUpscaleMedia: 'video',
              studioVideoWorkflow: 'film_grain' as StudioVideoWorkflow,
              toolsSourcePath: sourceName || null,
              toolsSourceName: sourceName || null,
              toolsSourceUrl: sourceUrl,
              filmGrainIntensity: Number(p.intensity ?? p.film_grain_intensity ?? 0.15),
              filmGrainSaturation: Number(p.saturation ?? p.film_grain_saturation ?? 0.5),
            }
          : {
              appSection: 'director' as const, workspaceStage: 'studio' as const, sidebarMode: 'studio',
              generationMode: 'tools',
              toolsTool: 'revoice',
              audioSubMode: 'revoice',
              toolsSourcePath: sourceName || null,
              toolsSourceName: sourceName || null,
              toolsSourceUrl: sourceUrl,
              toolsRevoiceMode: p.mode === 'two' ? 'two' : 'single',
              toolsRevoiceRefs: [
                restoredRevoiceRefs[0] || null,
                restoredRevoiceRefs[1] || null,
              ],
            })
      return
    }

    let modelType = (p.model_type as string) || ''
    if (!modelType) return

    // Migrate Recast sidecars made before the dedicated model existed. Those
    // jobs used the general I2V Fast accelerator with replacement conditioning;
    // loading them now should reproduce the corrected native-replacement recipe.
    const migratedLegacyRecast = p.edit_sub_mode === 'recast'
      && modelType === 'scail2_14B_fast'
      && models.some(m => m.model_type === 'scail2_14B_recast_fast')
    if (migratedLegacyRecast) modelType = 'scail2_14B_recast_fast'

    // SFX generations swap the virtual MMAudio model for a video carrier
    // at submit, so the sidecar records the carrier. Restore the virtual
    // id — resubmitting re-swaps it, and mode/sub-tab detection below
    // classifies it as audio/sfx instead of video.
    const sfxVirtual = p._sfx_virtual_model as string | undefined
    if ((p._audio_sub_mode === 'sfx' || p.sfx_mode) && sfxVirtual && models.some(m => m.model_type === sfxVirtual)) {
      modelType = sfxVirtual
    }

    // Per-sub-mode isolation: pencil-load may jump the sidebar to another
    // video sub-mode (or clobber the current one) by writing params
    // wholesale. Stash the active sub-mode's working set first so
    // in-progress work (e.g. a Frames setup) survives loading an Extend
    // clip's settings — switching back restores it.
    {
      const cur = get()
      if (cur.generationMode === 'video') {
        set({
          videoSubModeStash: {
            ...cur.videoSubModeStash,
            [(cur.params.image_mode as number) ?? 0]: captureVideoSubModeStash(cur),
          },
        })
      }
    }

    // Determine generation mode from model (respects per-model avatar overrides)
    const model = models.find(m => m.model_type === modelType)
    const restoredModelMode = model
      ? getModelMode(modelType, model.family)
      : null
    if (model) {
      const mode = restoredModelMode!
      set({ appSection: 'director' as const, workspaceStage: 'studio' as const, sidebarMode: 'studio', generationMode: mode })
      // Audio outputs restore the SUB-TAB too (Speech / Music / SFX) —
      // previously the pencil landed on the Audio tab but left whatever
      // sub-tab was last open. Newer sidecars record _audio_sub_mode;
      // older ones fall back to classifying the model. Direct set, NOT
      // setAudioSubMode — that would call selectModel and clobber the
      // params restored below.
      if (mode === 'audio') {
        const recordedSub = p._audio_sub_mode as import('../types').AudioSubMode | undefined
        const inferredSub: import('../types').AudioSubMode =
          sfxModelTypes.has(modelType) || p.sfx_mode ? 'sfx'
          : isMusicModelType(modelType) ? 'music'
          : 'speech'
        const subMode = (recordedSub === 'speech' || recordedSub === 'music' || recordedSub === 'sfx')
          ? recordedSub : inferredSub
        const restoredLyrics = (p._tts_original_prompt as string) || (p.prompt as string) || ''
        set(s => ({
          audioSubMode: subMode,
          selectedModelPerAudioSubMode: { ...s.selectedModelPerAudioSubMode, [subMode]: modelType },
          // Music: restore the song-writer inputs alongside the fields.
          // Older sidecars lack _music_description — clear rather than
          // leave a stale description that didn't produce this song
          // (instrumental still infers from the lyrics sentinel).
          ...(subMode === 'music' ? {
            musicDescription: (p._music_description as string) || '',
            musicInstrumental: !!p._music_instrumental
              || restoredLyrics.trim().toLowerCase() === '[instrumental]',
          } : {}),
        }))
      }
    }

    // Load model capabilities BEFORE applying the restored params.
    // loadModelOptions merges model-default steps/guidance into params when
    // its fetch resolves; it used to be fired at the END of this restore,
    // so the defaults landed after the sidecar values and silently reverted
    // num_inference_steps / guidance_scale on every pencil click. Awaiting
    // it here means defaults land first and the restored values win — and
    // modelOptions matches the restored model before rerollGeneration
    // submits (stale capabilities used to strip stg_scale/perturbation_*
    // from the request, which then poisoned the next sidecar with zeros).
    // (Virtual SFX models have no LoRAs/options endpoints — same guard
    // as boot.)
    if (!sfxModelTypes.has(modelType)) {
      get().loadLoras(modelType)
      await get().loadModelOptions(modelType)
    }
    const restoredModelOptions = get().modelOptions?.model_type === modelType
      ? get().modelOptions
      : null
    const restoredIsH3 = String(
      restoredModelOptions?.architecture || modelType,
    ).startsWith('minimax_h3')

    // Detect I2V: if image_start was used or image_prompt_type contains "S"
    const hadStartImage = !!(p.image_start || (p.image_prompt_type as string || '').includes('S'))
    const hadEndImage = !!(p.image_end || (p.image_prompt_type as string || '').includes('E'))

    const restoredH3WindowPlan = (
      p.h3_window_plan
      && typeof p.h3_window_plan === 'object'
      && Array.isArray((p.h3_window_plan as Record<string, unknown>).windows)
    ) ? p.h3_window_plan as unknown as H3WindowPlan : null
    const restoredH3WindowPrompts = Array.isArray(p.h3_window_prompts)
      ? p.h3_window_prompts
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map(item => item.trim())
      : []
    const savedRuntimePrompt = typeof p.prompt === 'string' ? p.prompt.trim() : ''
    const savedSourcePrompt = restoredH3WindowPlan?.source_prompt?.trim() || ''
    const serializedH3Prompt = restoredH3WindowPrompts.join('\n---CLIP_BOUNDARY---\n')
    const restoredH3SourcePrompt = savedSourcePrompt && (
      savedRuntimePrompt === savedSourcePrompt
      || savedRuntimePrompt === serializedH3Prompt
      || (restoredH3WindowPrompts.length === 1
        && savedRuntimePrompt === restoredH3WindowPrompts[0])
    ) ? savedSourcePrompt : ''

    // First / Last sidecars created before the explicit prompt-mode field
    // used minimax_h3_window_storyboard as the UI's Auto/Manual switch.
    // Prefer the explicit field, while keeping those existing clips durable.
    const restoredH3SequencePromptMode: 'auto' | 'creative' | 'manual' | undefined = (
      p.minimax_h3_sequence_prompt_mode === 'manual'
        ? 'manual'
        : p.minimax_h3_sequence_prompt_mode === 'creative'
          ? 'creative'
        : p.minimax_h3_sequence_prompt_mode === 'auto'
          ? 'auto'
          : p.minimax_h3_multi_window === true
            ? (p.minimax_h3_window_storyboard === false ? 'manual' : 'auto')
            : undefined
    )

    const restoredTurboOption = restoredModelOptions?.minimax_h3_turbo
    const restoredTurboPresets = restoredTurboOption?.presets?.length
      ? restoredTurboOption.presets
      : restoredTurboOption
        ? [{
            id: restoredTurboOption.preset_id,
            filename: restoredTurboOption.filename,
          }]
        : []
    const savedTurboPreset = restoredTurboPresets.find(
      preset => preset.id === p.minimax_h3_turbo_preset,
    )
    const savedActivatedLoras = Array.isArray(p.activated_loras)
      ? (p.activated_loras as unknown[]).map(item => String(item))
      : []
    const activeTurboPreset = restoredTurboPresets.find(
      preset => savedActivatedLoras.some(
        filename => filename.replace(/\\/g, '/').split('/').pop()?.toLowerCase()
          === preset.filename.toLowerCase(),
      ),
    )
    const restoredTurboPreset = (
      savedTurboPreset
      || activeTurboPreset
      || restoredTurboPresets.find(
        preset => preset.id === restoredTurboOption?.preset_id,
      )
      || restoredTurboPresets[0]
    )
    const legacyTurboEnabled = (
      p.minimax_h3_turbo_mode == null
      && activeTurboPreset != null
    )
    const savedTextEncoder = p.minimax_h3_text_encoder
    const restoredTextEncoder = (
      savedTextEncoder === 'nvfp4_awq'
      || savedTextEncoder === 'gguf_q2_k'
      || savedTextEncoder === 'gguf_q4_k_m'
      || savedTextEncoder === 'int8'
      || savedTextEncoder === 'bf16'
    ) && restoredModelOptions?.minimax_h3_text_encoder_choices?.some(
      choice => choice.value === savedTextEncoder,
    ) ? savedTextEncoder : undefined
    const restoredLtx25VideoVae = restoredModelOptions?.ltx25_video_vae_choices
      ?.find(choice => choice.value === p.ltx25_video_vae)?.value

    // TTS restores names before Speaker 1/2 substitution. Edit workflows
    // restore the user's text rather than internal conditioning guidance.
    const originalPrompt = (p._tts_original_prompt as string) || (
      p.edit_sub_mode === 'recast' && typeof p.edit_recast_raw_prompt === 'string'
        ? p.edit_recast_raw_prompt as string
        : p.edit_sub_mode === 'outpaint' && typeof p.edit_outpaint_raw_prompt === 'string'
          ? p.edit_outpaint_raw_prompt as string
          : restoredH3SourcePrompt || p.prompt as string
    ) || ''

    // Build params from metadata
    // For image_mode: use 1 (I2V UI toggle) if start image was used, else 0
    const newParams: Partial<GenerateParams> = {
      prompt: originalPrompt,
      model_type: modelType,
      resolution: (p.resolution as string) || '1280x720',
      video_length: (p.video_length as number) || 81,
      num_inference_steps: migratedLegacyRecast ? 8 : (p.num_inference_steps as number) || 20,
      guidance_scale: migratedLegacyRecast ? 1 : (p.guidance_scale as number) || 5.0,
      seed: (p.seed as number) ?? -1,
      // Restore the ACTUAL saved output mode (0 = video, 1 = image). The old
      // `hadStartImage ? 1 : 0` was wrong: an I2V *video* clip has a start image
      // but image_mode 0 — inferring 1 from the start image put the UI in image-
      // output mode, so a later T2V (after clearing the start image) emitted a PNG.
      image_mode: (p.image_mode as number) ?? 0,
      negative_prompt: (p.negative_prompt as string) || '',
      repeat_generation: Math.max(1, Math.min(10, Number(p.repeat_generation) || 1)),
      activated_loras: (p.activated_loras as string[]) || [],
      loras_multipliers: (p.loras_multipliers as string) || '',
      // A single-output load must explicitly clear a previously open legacy
      // multi-clip recipe. Leaving this undefined while merging into the
      // store caused an unrelated output to inherit multi_prompts_gen_type=3.
      multi_prompts_gen_type: Number(p.multi_prompts_gen_type) || 0,
      per_clip_frames: Array.isArray(p.per_clip_frames)
        ? (p.per_clip_frames as number[])
        : undefined,
      minimax_h3_references: Array.isArray(p.minimax_h3_references)
        ? (p.minimax_h3_references as GenerateParams['minimax_h3_references'])?.filter(
            reference => !(
              reference as { _cue_studio_generated_continuity?: boolean }
            )._cue_studio_generated_continuity,
          )
        : undefined,
      minimax_h3_reference_detail: (
        p.minimax_h3_reference_detail === 'max'
          ? 'max'
          : (p.minimax_h3_reference_detail === 'match' ? 'match' : undefined)
      ),
      settings_version: p.settings_version as number,
    }

    // Copy optional fields — explicitly clear when absent to prevent stale values leaking
    newParams.sliding_window_size = (p.sliding_window_size as number) ?? undefined
    newParams.sliding_window_overlap = (p.sliding_window_overlap as number) ?? undefined
    newParams.sliding_window_discard_last_frames = (
      p.sliding_window_discard_last_frames as number
    ) ?? undefined
    newParams.sliding_window_memory_override = p.sliding_window_memory_override === true
    newParams.guidance_phases = (p.guidance_phases as number) ?? undefined
    newParams.video_prompt_type = (p.video_prompt_type as string) || ''
    newParams.audio_prompt_type = (p.audio_prompt_type as string) || ''
    newParams.image_prompt_type = (p.image_prompt_type as string) || ''
    newParams.input_video_strength = (p.input_video_strength as number) ?? undefined
    newParams.flow_shift = migratedLegacyRecast ? 1 : (p.flow_shift as number) ?? undefined
    newParams.self_refiner_setting = (p.self_refiner_setting as number) ?? undefined
    newParams.audio_guide = (p.audio_guide as string) || ''
    newParams.audio_scale = (p.audio_scale as number) ?? undefined
    newParams.voice_reference = (p.voice_reference as string) || undefined
    newParams.identity_guidance_scale = (p.identity_guidance_scale as number) ?? undefined
    newParams.audio_guide2 = (p.audio_guide2 as string) || ''
    newParams.audio_guide3 = (p.audio_guide3 as string) || ''
    newParams.audio_guide4 = (p.audio_guide4 as string) || ''
    newParams.audio_guide5 = (p.audio_guide5 as string) || ''
    newParams.audio_guide6 = (p.audio_guide6 as string) || ''
    // Style / Music Caption (ACE-Step). Was never copied here, so the
    // pencil restored only the lyrics — clear when absent so a stale
    // caption can't leak into an unrelated restore.
    newParams.alt_prompt = (p.alt_prompt as string) || ''
    newParams.video_guide = (p.video_guide as string) || ''
    newParams.video_mask = (p.video_mask as string) || ''
    newParams.image_guide = (p.image_guide as string) || ''
    newParams.image_mask = (p.image_mask as string) || ''
    newParams.denoising_strength = (p.denoising_strength as number) ?? undefined
    newParams.masking_strength = (p.masking_strength as number) ?? undefined
    newParams.minimax_h3_control_visual_mode = (
      p.minimax_h3_control_visual_mode === 'prompt'
      || p.minimax_h3_control_visual_mode === 'whole'
      || p.minimax_h3_control_visual_mode === 'inside'
      || p.minimax_h3_control_visual_mode === 'outside'
    ) ? p.minimax_h3_control_visual_mode : (
      String(p.video_prompt_type || '').includes('A')
        ? (String(p.video_prompt_type || '').includes('N') ? 'outside' : 'inside')
        : Number(p.denoising_strength ?? 1) < 1
          ? 'whole'
          : 'prompt'
    )
    newParams.image_refs = Array.isArray(p.image_refs) ? (p.image_refs as string[]) : []
    newParams.frames_positions = (p.frames_positions as string) || ''
    newParams.injection_strength = (p.injection_strength as number) ?? undefined
    newParams.remove_background_images_ref = (p.remove_background_images_ref as number) ?? 0
    newParams.video_source = (p.video_source as string) || undefined
    newParams.video_guide_outpainting = (p.video_guide_outpainting as string) || undefined
    newParams.duration_seconds = (p.duration_seconds as number) ?? undefined
    newParams.pause_seconds = (p.pause_seconds as number) ?? undefined
    newParams.tts_dynaudnorm = (p.tts_dynaudnorm as boolean) ?? undefined
    newParams.tts_comp_threshold = (p.tts_comp_threshold as number) ?? undefined
    newParams.tts_comp_attack = (p.tts_comp_attack as number) ?? undefined
    newParams.tts_comp_release = (p.tts_comp_release as number) ?? undefined
    newParams.tts_comp_makeup = (p.tts_comp_makeup as number) ?? undefined
    newParams.tts_voice_count = (p.tts_voice_count as number) ?? undefined
    newParams.voice_clone_enabled = p.voice_clone_enabled === true
    newParams.voice_clone_mode = p.voice_clone_mode === 'two' ? 'two' : 'single'
    newParams.voice_clone_refs = Array.isArray(p.voice_clone_refs)
      ? (p.voice_clone_refs as unknown[])
          .map(value => String(value || '').trim())
          .filter(Boolean)
      : []
    newParams.MMAudio_setting = (p.MMAudio_setting as number) ?? undefined
    newParams.MMAudio_prompt = (p.MMAudio_prompt as string) || undefined
    newParams.MMAudio_neg_prompt = (p.MMAudio_neg_prompt as string) || undefined
    newParams._audio_sub_mode = (
      p._audio_sub_mode === 'speech'
      || p._audio_sub_mode === 'music'
      || p._audio_sub_mode === 'sfx'
    ) ? p._audio_sub_mode : undefined
    newParams._duration_planning_mode = (
      p._duration_planning_mode === 'duration'
      || p._duration_planning_mode === 'windows'
      || p._duration_planning_mode === 'auto'
    ) ? p._duration_planning_mode : 'auto'

    // Keep advanced model controls that are intentionally loose in the API
    // schema. This list is explicit so disposable runtime paths and private
    // backend bookkeeping never leak back into a new request.
    for (const key of [
      'alt_guidance_scale', 'audio_flow_shift', 'embedded_guidance_scale',
      'force_fps', 'sample_solver', 'top_k', 'top_p',
      'spatial_upsampling_model', 'cfg_star_switch', 'apg_switch',
    ]) {
      if (p[key] !== undefined) {
        (newParams as unknown as Record<string, unknown>)[key] = p[key]
      }
    }

    // Progressive 3-stage pipeline settings
    if (p.progressive_pipeline) {
      (newParams as Record<string, unknown>).progressive_pipeline = true;
      (newParams as Record<string, unknown>).progressive_stage1_image_weight = (p.progressive_stage1_image_weight as number) ?? 0.7;
      (newParams as Record<string, unknown>).progressive_stage2_steps = (p.progressive_stage2_steps as number) ?? 8;
      (newParams as Record<string, unknown>).progressive_stage3_steps = (p.progressive_stage3_steps as number) ?? 3;
      (newParams as Record<string, unknown>).progressive_stage2_sigma = (p.progressive_stage2_sigma as number) ?? 1.0;
      (newParams as Record<string, unknown>).progressive_stage3_sigma = (p.progressive_stage3_sigma as number) ?? 0.85;
      (newParams as Record<string, unknown>).progressive_stage3_image_weight = (p.progressive_stage3_image_weight as number) ?? 0.7
    }
    // Single-stage distilled mode — mutually exclusive with progressive above
    if (p.single_stage_pipeline) {
      (newParams as Record<string, unknown>).single_stage_pipeline = true;
      (newParams as Record<string, unknown>).progressive_pipeline = false;
    }
    // Reference two-stage pipeline (10Eros) — restore so re-generating an
    // STG-era sidecar reproduces the pipeline that made it.
    (newParams as Record<string, unknown>).reference_pipeline = (p.reference_pipeline as boolean) ?? undefined;

    // Advanced pipeline settings
    (newParams as Record<string, unknown>).stage2_steps = (p.stage2_steps as number) ?? undefined;
    (newParams as Record<string, unknown>).stg_scale = (p.stg_scale as number) ?? undefined;
    // Perturbation config rides along with stg_scale so re-generating an STG
    // run is faithful. Old sidecars (pre-STG-wiring) simply lack these keys.
    (newParams as Record<string, unknown>).perturbation_switch = (p.perturbation_switch as number) ?? undefined;
    (newParams as Record<string, unknown>).perturbation_layers = Array.isArray(p.perturbation_layers) ? (p.perturbation_layers as number[]) : undefined;
    (newParams as Record<string, unknown>).perturbation_start_perc = (p.perturbation_start_perc as number) ?? undefined;
    (newParams as Record<string, unknown>).perturbation_end_perc = (p.perturbation_end_perc as number) ?? undefined;
    (newParams as Record<string, unknown>).cfg_rescale = (p.cfg_rescale as number) ?? undefined;
    (newParams as Record<string, unknown>).modality_scale = (p.modality_scale as number) ?? undefined;
    (newParams as Record<string, unknown>).use_gradient_estimation = (p.use_gradient_estimation as boolean) ?? undefined;
    (newParams as Record<string, unknown>).ge_gamma = (p.ge_gamma as number) ?? undefined;
    (newParams as Record<string, unknown>).ge_alpha = (p.ge_alpha as number) ?? undefined;
    (newParams as Record<string, unknown>).keyframe_conditioning_mode = (p.keyframe_conditioning_mode as string) ?? undefined;
    (newParams as Record<string, unknown>).keyframe_inject_mode = (p.keyframe_inject_mode as string) ?? undefined;
    (newParams as Record<string, unknown>).temperature = (p.temperature as number) ?? undefined;
    (newParams as Record<string, unknown>).audio_guidance_scale = (p.audio_guidance_scale as number) ?? undefined
    // H3 optimization controls are a cohesive saved recipe. Explicit off
    // values matter: undefined would retain the clip selected before this one.
    newParams.override_attention = (
      p.override_attention === 'sol'
      || p.override_attention === 'sla'
      || p.override_attention === 'sdpa'
    ) ? p.override_attention : ''
    newParams.skip_steps_cache_type = (
      p.skip_steps_cache_type === 'first_block' ? 'first_block' : ''
    )
    newParams.skip_steps_multiplier = Number.isFinite(Number(p.skip_steps_multiplier))
      ? Number(p.skip_steps_multiplier)
      : restoredModelOptions?.default_skip_steps_multiplier
    newParams.skip_steps_start_step_perc = Number.isFinite(
      Number(p.skip_steps_start_step_perc),
    )
      ? Math.max(0, Math.min(100, Number(p.skip_steps_start_step_perc)))
      : restoredModelOptions?.default_skip_steps_start_step_perc
    newParams.minimax_h3_turbo_mode = (
      p.minimax_h3_turbo_mode === true || legacyTurboEnabled
    )
    newParams.minimax_h3_turbo_preset = restoredTurboPreset?.id
    newParams.minimax_h3_text_encoder = restoredTextEncoder
    newParams.ltx25_video_vae = restoredLtx25VideoVae
    if (restoredModelOptions?.minimax_h3_fused_turbo) {
      const minSteps = Math.max(
        1,
        Math.round(Number(restoredModelOptions.inference_steps_min ?? 4)),
      )
      const maxSteps = Math.max(
        minSteps,
        Math.round(Number(restoredModelOptions.inference_steps_max ?? 8)),
      )
      const restoredSteps = Number(p.num_inference_steps)
      const defaultSteps = Number(
        restoredModelOptions.default_num_inference_steps ?? 4,
      )
      newParams.num_inference_steps = Math.max(
        minSteps,
        Math.min(
          maxSteps,
          Math.round(Number.isFinite(restoredSteps) ? restoredSteps : defaultSteps),
        ),
      )
      newParams.guidance_scale = restoredModelOptions.default_guidance_scale ?? 1
      newParams.activated_loras = []
      newParams.loras_multipliers = ''
      newParams.minimax_h3_turbo_mode = false
      newParams.minimax_h3_turbo_preset = undefined
      newParams.skip_steps_cache_type = ''
      newParams.override_attention = p.override_attention === 'sdpa' ? 'sdpa' : 'sla'
    }
    const restoredCustomSettings = (
      p.custom_settings
      && typeof p.custom_settings === 'object'
      && !Array.isArray(p.custom_settings)
    ) ? p.custom_settings as Record<string, unknown> : {}
    const restoredH3LongSequenceSettings = Object.fromEntries(
      [
        'h3_long_sequence_clean_tail',
        'h3_long_sequence_single_frame_after_three',
        'h3_long_sequence_vary_seed',
        'h3_long_sequence_periodic_reset',
        'h3_long_sequence_diagnostics',
      ]
        .filter(key => restoredCustomSettings[key] === true)
        .map(key => [key, true]),
    )
    newParams.custom_settings = Object.keys(
      restoredH3LongSequenceSettings,
    ).length > 0 ? restoredH3LongSequenceSettings : undefined
    newParams.minimax_h3_window_storyboard = (p.minimax_h3_window_storyboard as boolean) ?? undefined
    newParams.minimax_h3_multi_window = (p.minimax_h3_multi_window as boolean) ?? undefined
    const legacyLtxLongForm = (
      /^ltx(?:v|2)/i.test(String(p.model_type || ''))
      && Number(p.video_length || 0) > Number(p.sliding_window_size || 0)
    )
    newParams.ltx_multi_window = (p.ltx_multi_window as boolean)
      ?? (legacyLtxLongForm ? true : undefined)
    newParams.ltx_window_prompt_mode = (
      p.ltx_window_prompt_mode === 'manual'
        ? 'manual'
        : p.ltx_window_prompt_mode === 'creative'
          ? 'creative'
        : (p.ltx_window_prompt_mode === 'auto'
            ? 'auto'
            : (legacyLtxLongForm ? 'auto' : undefined))
    )
    newParams.ltx_window_prompts = Array.isArray(p.ltx_window_prompts)
      ? (p.ltx_window_prompts as string[]).filter(item => typeof item === 'string' && item.trim())
      : undefined
    newParams._ltx_original_prompt = (
      typeof p._ltx_original_prompt === 'string'
      && p._ltx_original_prompt.trim()
    ) ? p._ltx_original_prompt : undefined
    newParams.minimax_h3_reference_sequence = (p.minimax_h3_reference_sequence as boolean) ?? undefined
    newParams.minimax_h3_sequence_prompt_mode = restoredH3SequencePromptMode
    newParams.minimax_h3_sequence_continuity = (p.minimax_h3_sequence_continuity as boolean) ?? undefined
    newParams.minimax_h3_sequence_clip_frames = (
      p.minimax_h3_sequence_clip_frames as number
    ) ?? undefined
    newParams.minimax_h3_sequence_memory_override = (
      p.minimax_h3_sequence_memory_override as boolean
    ) ?? undefined
    newParams.minimax_h3_camera_coverage = (
      p.minimax_h3_camera_coverage === 'continuous'
      || p.minimax_h3_camera_coverage === 'multi_shot'
    ) ? p.minimax_h3_camera_coverage : 'auto'
    newParams._h3_original_prompt = (
      typeof p._h3_original_prompt === 'string'
      && p._h3_original_prompt.trim()
    ) ? p._h3_original_prompt : undefined
    // Restore (or explicitly clear) compiled H3 planning artifacts as one
    // unit. They are revalidated before submission, but stale prompts from
    // the previously selected gallery item must never hitchhike into a run.
    newParams.h3_window_prompts = restoredH3WindowPrompts.length > 0
      ? restoredH3WindowPrompts
      : undefined
    newParams.h3_window_plan_signature = typeof p.h3_window_plan_signature === 'string'
      ? p.h3_window_plan_signature
      : undefined
    newParams.h3_window_plan = restoredH3WindowPlan || undefined
    // Detect multi-clip output and reconstruct clips
    if (p.multi_prompts_gen_type === 3 && Array.isArray(p.image_start)) {
      // Director Mode joins per-clip prompts with `\n---CLIP_BOUNDARY---\n`
      // (see app/launch.py:7279). Studio Mode multi-shot joins with plain
      // `\n` (single-line prompts only). Split on the boundary token first
      // so Director prompts that contain their own newlines survive; fall
      // back to plain newline split for legacy Studio multi-clip sidecars
      // that don't carry the boundary marker.
      //
      // Before this fix: every internal `\n` in a Director clip prompt
      // became a clip break, doubling+ the clip count and leaving half of
      // them with the literal string `---CLIP_BOUNDARY---` as their prompt.
      // The visible symptom was "some prompts populate but others don't"
      // and start-image indices going to the wrong clips.
      const promptText = (p.prompt as string) || ''
      const CLIP_BOUNDARY = '\n---CLIP_BOUNDARY---\n'
      const promptLines = promptText.includes(CLIP_BOUNDARY)
        ? promptText.split(CLIP_BOUNDARY).map(s => s.trim()).filter(Boolean)
        : promptText.split('\n').map(s => s.trim()).filter(Boolean)
      const imagePaths = p.image_start as string[]
      // Per-clip durations (Director Mode populates this; Studio mode may not).
      // Saved by app/launch.py as part of raw_params before per-clip split;
      // survives onto the concat multiclip sidecar (see real sidecar example
      // in app/outputs/Testing04/...multiclip.meta.json line 13-26).
      const rawPerClipFrames = Array.isArray(p.per_clip_frames)
        ? (p.per_clip_frames as number[])
        : []
      const perClipFrames = restoredIsH3
        ? normalizeH3ClipFrameSchedule(
            rawPerClipFrames,
            restoredModelOptions?.frames_minimum ?? 124,
            restoredModelOptions?.frames_maximum ?? 345,
            restoredModelOptions?.frames_steps ?? 17,
          )
        : rawPerClipFrames
      if (perClipFrames.length > 0) {
        newParams.per_clip_frames = perClipFrames
        newParams.video_length = perClipFrames.reduce((total, value) => total + value, 0)
        newParams.sliding_window_size = Math.max(...perClipFrames)
      } else {
        newParams.per_clip_frames = undefined
      }
      // Per-clip keyframe images (Director Mode KFI feature). Array of arrays
      // — each inner array holds the keyframe paths for that clip. Studio
      // Mode multi-shot generations don't use this field today.
      const perClipKeyframes = Array.isArray(p.per_clip_keyframes) ? (p.per_clip_keyframes as string[][]) : []
      const clipCount = Math.max(promptLines.length, imagePaths.length, perClipFrames.length)
      const clips: MultiClip[] = []
      for (let i = 0; i < clipCount; i++) {
        clips.push({
          prompt: promptLines[i] || '',
          startImage: null,
          startImagePath: imagePaths[i] || null,
          endImage: null,
          endImagePath: null,
          durationFrames: perClipFrames[i] || undefined,
        })
      }
      set({ clips, singlePromptMode: false })
      newParams.image_mode = 2
      newParams.multi_prompts_gen_type = 3

      // Surface per-clip keyframes via image_refs + frames_positions so
      // ControlVideoSection's restore picks them up. NOTE: MultiClip's type
      // doesn't yet carry per-clip keyframes, so all clips' keyframes get
      // concatenated into a single image_refs array with "L" positions
      // (the same encoding launch.py uses at line 7353). Re-running the
      // generation will dispatch keyframes to clips by position order,
      // matching the original layout. Documented as a known limitation:
      // editing one clip's keyframes after restore affects the whole pool.
      if (perClipKeyframes.length > 0) {
        const flatRefs: string[] = []
        const flatPositions: string[] = []
        for (const clipKfs of perClipKeyframes) {
          if (Array.isArray(clipKfs)) {
            for (const kf of clipKfs) {
              if (kf) {
                flatRefs.push(kf)
                flatPositions.push('L')
              }
            }
          }
        }
        if (flatRefs.length > 0) {
          newParams.image_refs = flatRefs
          newParams.frames_positions = flatPositions.join(' ')
          // Ensure KFI is in video_prompt_type so ControlVideoSection
          // recognizes the inject-frame mode on restore.
          const vpt = newParams.video_prompt_type || ''
          if (!vpt.includes('KFI')) {
            newParams.video_prompt_type = vpt + 'KFI'
          }
        }
      }

      // Fetch clip images from upload URLs to show previews. Prefer
      // upload_filenames.image_start (already-extracted basenames) when
      // present; fall back to deriving basenames from params.image_start
      // paths so older sidecars without upload_filenames still restore.
      const uploadNames = Array.isArray(uploadFilenames?.image_start)
        ? uploadFilenames.image_start as string[]
        : imagePaths.map(p => (p || '').replace(/\\/g, '/').split('/').pop() || '')
      for (let i = 0; i < clipCount; i++) {
        const fname = uploadNames[i]
        if (fname) {
          const idx = i
          fetch(api.getFileUrl(fname))
            .then(r => r.ok ? r.blob() : null)
            .then(blob => {
              if (!blob) return
              const file = new File([blob], fname, { type: blob.type })
              get().setClipStartImage(idx, file)
            })
            .catch(() => {})
        }
      }
    } else {
      // Set or clear attachment paths from sidecar
      newParams.image_start = p.image_start ? (p.image_start as string) : ''
      set({ clips: [], singlePromptMode: false })
    }
    newParams.image_end = p.image_end ? (p.image_end as string) : ''

    // Rebuild lora weights from multipliers string
    const loraWeights: Record<string, number[]> = {}
    const loras = newParams.activated_loras || []
    const multParts = (newParams.loras_multipliers || '').split(' ').filter(Boolean)
    for (let i = 0; i < loras.length; i++) {
      const parts = (multParts[i] || '1.00').split(';').map(Number)
      loraWeights[loras[i]] = parts
    }

    // Restore duration from metadata
    const restoredDuration = Number(p.duration_seconds ?? p._duration_seconds ?? 0) || 0
    // Restore post-processing settings from metadata
    const restoredSpatialUpsampling = (p.spatial_upsampling as string) || ''
    const restoredFilmGrainIntensity = (p.film_grain_intensity as number) || 0
    const restoredFilmGrainSaturation = (p.film_grain_saturation as number) || 0.5
    const restoredImageWorkflow: StudioImageWorkflow = _normalizeStudioImageWorkflow(
      p._studio_image_workflow,
    ) ?? (
      Number(p.image_mode || 0) === 2
        ? (String(p.video_guide_outpainting || '').replace(/^#/, '').trim()
            ? 'outpaint'
            : 'inpaint')
        : 'generate'
    )
    const restoredVideoWorkflow: StudioVideoWorkflow = _normalizeStudioVideoWorkflow(
      p._studio_video_workflow,
      model,
    ) ?? (p.video_source ? 'extend' : _isOmniVideoModel(model) ? 'references' : 'frames')
    if (model && getModelMode(modelType, model.family) === 'image') {
      newParams._studio_image_workflow = restoredImageWorkflow
    }
    if (model && getModelMode(modelType, model.family) === 'video') {
      newParams._studio_video_workflow = restoredVideoWorkflow
      // Specialized workflows normalize image_mode for the renderer before
      // the sidecar is written. Reconstruct the UI routing value from the
      // durable workflow marker so Extend/Blend do not reopen as Frames.
      if (restoredVideoWorkflow === 'extend') newParams.image_mode = 3
      else if (restoredVideoWorkflow === 'blend') newParams.image_mode = 4
      else if (newParams.image_mode !== 2) newParams.image_mode = 0
    }
    // Restore audio guide filename from upload_filenames. Fall back to
    // deriving basename from params.audio_guide for sidecars that pre-date
    // the upload_filenames extraction code.
    const _deriveBase = (val: unknown): string | null => {
      if (typeof val !== 'string' || !val) return null
      const bn = val.replace(/\\/g, '/').split('/').pop()
      return bn || null
    }
    const restoredImageGuide = _deriveBase(p.image_guide)
    const restoredImageMask = _deriveBase(p.image_mask)
    const restoredAudioGuideFilename =
      (typeof uploadFilenames?.audio_guide === 'string' ? uploadFilenames.audio_guide : null)
      || _deriveBase(p.audio_guide)
    const restoredAudioGuide2Filename =
      (typeof uploadFilenames?.audio_guide2 === 'string' ? uploadFilenames.audio_guide2 : null)
      || _deriveBase(p.audio_guide2)
    const restoredContinuePath = restoredVideoWorkflow === 'extend'
      ? String(p.video_source || '')
      : ''
    const restoredContinueName = (
      typeof uploadFilenames?.video_source === 'string'
        ? uploadFilenames.video_source
        : null
    ) || _deriveBase(restoredContinuePath)
    const restoredBlendAPath = restoredVideoWorkflow === 'blend'
      ? String(p._blend_clip_a || '')
      : ''
    const restoredBlendBPath = restoredVideoWorkflow === 'blend'
      ? String(p._blend_clip_b || '')
      : ''
    const restoredBlendAName = (
      typeof uploadFilenames?._blend_clip_a === 'string'
        ? uploadFilenames._blend_clip_a
        : null
    ) || _deriveBase(restoredBlendAPath)
    const restoredBlendBName = (
      typeof uploadFilenames?._blend_clip_b === 'string'
        ? uploadFilenames._blend_clip_b
        : null
    ) || _deriveBase(restoredBlendBPath)
    const restoredImageOutpaintPadding = (() => {
      const values = String(p.video_guide_outpainting || '')
        .replace(/^#/, '')
        .trim()
        .split(/\s+/)
        .map(Number)
      if (values.length !== 4 || values.some(value => !Number.isFinite(value))) {
        return null
      }
      return {
        top: values[0],
        bottom: values[1],
        left: values[2],
        right: values[3],
      }
    })()
    const _placeholderMediaFile = (name: string | null): File | null => {
      if (!name) return null
      const extension = name.split('.').pop()?.toLowerCase() || ''
      const type = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'].includes(extension)
        ? `image/${extension === 'jpg' ? 'jpeg' : extension}`
        : extension === 'mov'
          ? 'video/quicktime'
          : 'video/mp4'
      // The backing server URL supplies the bytes. A zero-byte File retains
      // the original name/type for existing upload-card components without
      // downloading a multi-gigabyte source video into browser memory.
      return new File([], name, { type })
    }
    const restoredContinueFile = _placeholderMediaFile(restoredContinueName)
    const restoredBlendAFile = _placeholderMediaFile(restoredBlendAName)
    const restoredBlendBFile = _placeholderMediaFile(restoredBlendBName)
    const restoredVoiceReferencePath = String(p.voice_reference || '')
    const restoredVoiceReferenceName = (
      typeof uploadFilenames?.voice_reference === 'string'
        ? uploadFilenames.voice_reference
        : null
    ) || _deriveBase(restoredVoiceReferencePath)
    const restoredVoiceCloneRefs = (newParams.voice_clone_refs || []).map(
      (path, index) => ({
        path,
        filename: (
          Array.isArray(uploadFilenames?.voice_clone_refs)
            ? uploadFilenames.voice_clone_refs[index]
            : null
        ) || _deriveBase(path) || path,
      }),
    )
    // Restore TTS speaker names (1-6)
    const restoredSpeakerName1 = (p._tts_speaker_name1 as string) || ''
    const restoredSpeakerName2 = (p._tts_speaker_name2 as string) || ''
    const hasTtsRestoreState = (
      p._tts_voice_count !== undefined
      || typeof p._tts_original_prompt === 'string'
    )
    let inferredVoiceCount = 0
    if (hasTtsRestoreState) {
      for (let i = 1; i <= 6; i++) {
        const guideKey = i === 1 ? 'audio_guide' : `audio_guide${i}`
        if (String(p[`_tts_speaker_name${i}`] || '').trim() || String(p[guideKey] || '').trim()) {
          inferredVoiceCount = i
        }
      }
    }
    const restoredVoiceCount = hasTtsRestoreState
      ? Math.max(0, Math.min(6, Number(p._tts_voice_count) || inferredVoiceCount))
      : 0
    const restoredVoices: { name: string; filename: string | null; path: string | null }[] = []
    for (let i = 0; i < Math.max(restoredVoiceCount, hasTtsRestoreState ? 2 : 0); i++) {
      const name = (p[`_tts_speaker_name${i + 1}`] as string) || ''
      const guideKey = i === 0 ? 'audio_guide' : `audio_guide${i + 1}`
      const path = typeof p[guideKey] === 'string' && p[guideKey]
        ? String(p[guideKey])
        : null
      const filename = (
        typeof uploadFilenames?.[guideKey] === 'string'
          ? uploadFilenames[guideKey] as string
          : null
      ) || _deriveBase(path)
      if (name || i < restoredVoiceCount) {
        restoredVoices.push({ name, filename, path })
      }
    }

    set(s => ({
      appSection: 'director' as const, workspaceStage: 'studio' as const, sidebarMode: 'studio',
      ...(restoredModelMode ? { generationMode: restoredModelMode } : {}),
      ...(restoredModelMode ? {
        selectedModelPerMode: {
          ...s.selectedModelPerMode,
          [restoredModelMode]: modelType,
        },
      } : {}),
      params: { ...s.params, ...newParams },
      h3WindowPlan: restoredH3WindowPlan,
      loraWeights,
      startImage: null,
      endImage: null,
      imageRefs: [],  // Clear — will repopulate below if image_refs exist
      removeBackgroundRefs: Number(p.remove_background_images_ref || 0) > 0,
      ...(model && getModelMode(modelType, model.family) === 'image' ? {
        studioImageWorkflow: restoredImageWorkflow,
        imageWorkflowSourceFile: null,
        imageWorkflowSourcePath: String(p.image_guide || ''),
        imageWorkflowSourceUrl: restoredImageGuide
          ? api.getFileUrl(restoredImageGuide)
          : '',
        imageWorkflowMaskFile: null,
        imageWorkflowMaskPath: String(p.image_mask || ''),
        imageWorkflowMaskUrl: restoredImageMask
          ? api.getFileUrl(restoredImageMask)
          : '',
        ...(restoredImageOutpaintPadding
          ? { imageOutpaintPadding: restoredImageOutpaintPadding }
          : {}),
      } : {}),
      ...(model && getModelMode(modelType, model.family) === 'video' ? {
        studioVideoWorkflow: restoredVideoWorkflow,
      } : {}),
      // Clear source slots from the previously open workflow, then restore
      // the durable paths for Extend/Blend immediately. File blobs and media
      // dimensions are filled asynchronously below.
      continueVideo: restoredContinueFile,
      continueVideoPath: restoredContinuePath,
      continueVideoUrl: restoredContinueName
        ? api.getFileUrl(restoredContinueName)
        : '',
      continueVideoDuration: 0,
      blendClipA: restoredBlendAFile,
      blendClipAPath: restoredBlendAPath,
      blendClipAUrl: restoredBlendAName ? api.getFileUrl(restoredBlendAName) : '',
      blendClipADuration: 0,
      blendClipB: restoredBlendBFile,
      blendClipBPath: restoredBlendBPath,
      blendClipBUrl: restoredBlendBName ? api.getFileUrl(restoredBlendBName) : '',
      blendClipBDuration: 0,
      blendMode: p._blend_mode === 'insert' ? 'insert' : 'overlap',
      blendOverlapSec: Number(p._blend_overlap_sec ?? 3),
      blendTransitionSec: Number(p._blend_transition_sec ?? p._blend_overlap_sec ?? 5),
      blendMotionPrefixSec: Number(p._blend_motion_prefix_sec ?? 1),
      blendMotionSuffixSec: Number(p._blend_motion_suffix_sec ?? 1),
      blendAnchorStrength: Number(p._blend_anchor_strength ?? p.input_video_strength ?? 0.7),
      outputCount: newParams.repeat_generation || 1,
      ...(restoredDuration > 0 ? { durationSeconds: restoredDuration } : {}),
      spatialUpsampling: restoredSpatialUpsampling,
      filmGrainIntensity: restoredFilmGrainIntensity,
      filmGrainSaturation: restoredFilmGrainSaturation,
      audioGuideFilename: restoredAudioGuideFilename,
      audioGuide2Filename: restoredAudioGuide2Filename,
      directorVoiceRef: restoredVoiceReferenceName
        ? new File([], restoredVoiceReferenceName, { type: 'audio/wav' })
        : null,
      directorVoiceRefPath: restoredVoiceReferencePath || null,
      directorIdentityGuidanceScale: Number.isFinite(Number(p.identity_guidance_scale))
        ? Number(p.identity_guidance_scale)
        : 3,
      voiceCloneEnabled: newParams.voice_clone_enabled === true,
      voiceCloneMode: newParams.voice_clone_mode === 'two' ? 'two' : 'single',
      voiceCloneRefs: restoredVoiceCloneRefs,
      ...(restoredModelMode === 'audio' ? {
        selectedModelPerAudioSubMode: {
          ...s.selectedModelPerAudioSubMode,
          [(
            p._audio_sub_mode === 'music'
            || p._audio_sub_mode === 'sfx'
            || p._audio_sub_mode === 'speech'
              ? p._audio_sub_mode
              : isMusicModelType(modelType)
                ? 'music'
                : sfxModelTypes.has(modelType)
                  ? 'sfx'
                  : 'speech'
          )]: modelType,
        },
      } : {}),
      // TTS state
      ...(restoredSpeakerName1 || restoredSpeakerName2 || restoredVoiceCount > 0 ? {
        ttsSpeakerName1: restoredSpeakerName1,
        ttsSpeakerName2: restoredSpeakerName2,
        ttsSpeakerNamesManual: true,
        ttsVoiceCount: restoredVoiceCount,
        ttsVoices: restoredVoices,
      } : {}),
    }))

    const _probeRestoredVideo = (
      file: File | null,
      path: string,
      url: string,
      apply: (file: File, path: string, url: string, duration: number) => void,
    ) => {
      if (!file || !path || !url || !file.type.startsWith('video/')) return
      const video = document.createElement('video')
      video.preload = 'metadata'
      video.muted = true
      video.onloadedmetadata = () => {
        apply(
          file,
          path,
          url,
          Number.isFinite(video.duration) ? video.duration : 0,
        )
        video.removeAttribute('src')
        video.load()
      }
      video.onerror = () => {
        video.removeAttribute('src')
        video.load()
      }
      video.src = url
    }
    _probeRestoredVideo(
      restoredContinueFile,
      restoredContinuePath,
      restoredContinueName ? api.getFileUrl(restoredContinueName) : '',
      get().setContinueVideo,
    )
    _probeRestoredVideo(
      restoredBlendAFile,
      restoredBlendAPath,
      restoredBlendAName ? api.getFileUrl(restoredBlendAName) : '',
      get().setBlendClipA,
    )
    _probeRestoredVideo(
      restoredBlendBFile,
      restoredBlendBPath,
      restoredBlendBName ? api.getFileUrl(restoredBlendBName) : '',
      get().setBlendClipB,
    )

    // Restore image refs as File objects (for image mode reference images)
    // Skip if this is a KFI (frames injection) output — those refs are handled by ControlVideoSection
    const imageRefPaths = newParams.image_refs || []
    const isKFI = (newParams.video_prompt_type || '').includes('KFI')
    if (imageRefPaths.length > 0 && !isKFI) {
      // Set the ref type from saved params
      const vpt = newParams.video_prompt_type || ''
      const refType = vpt.includes('K') && vpt.includes('I') ? 'KI' : vpt.includes('I') ? 'I' : 'KI'
      set({ imageRefType: refType })

      // Fetch all ref images in parallel, then set in original order
      const refPromises = imageRefPaths.map(refPath => {
        const fname = refPath.replace(/\\/g, '/').split('/').pop() || ''
        if (!fname) return Promise.resolve(null)
        // /file searches active/all workspaces and uploads, so both generated
        // references and newly uploaded images restore correctly.
        const url = api.getFileUrl(fname)
        return fetch(url)
          .then(r => r.ok ? r.blob() : null)
          .then(blob => blob ? new File([blob], fname, { type: blob.type || 'image/png' }) : null)
          .catch(() => null)
      })
      Promise.all(refPromises).then(files => {
        const ordered = files.filter((f): f is File => f !== null)
        set({ imageRefs: ordered })
      })
    }

    // Prefer the explicit requested duration. Audio models commonly keep a
    // placeholder video_length of 0/81, and edit/control-fps workflows write
    // the authoritative seconds separately. Only derive from frames for old
    // video sidecars that predate those fields.
    const fps = model?.fps || 16
    const frames = newParams.video_length || 81
    if (restoredDuration > 0) {
      set({ durationSeconds: Math.round(restoredDuration * 10) / 10 })
    } else if (restoredModelMode === 'video' || restoredModelMode === 'avatar') {
      set({ durationSeconds: Math.round((frames / fps) * 10) / 10 })
    }
    const restoredNativePassFrames = newParams.minimax_h3_sequence_clip_frames
      ?? newParams.sliding_window_size
    if (restoredNativePassFrames) {
      set({
        slidingWindowSeconds: restoredNativePassFrames / fps,
        slidingWindowLocked: newParams.minimax_h3_reference_sequence === true
          ? newParams.minimax_h3_sequence_memory_override === true
          : newParams.sliding_window_memory_override === true,
      })
    }
    if (newParams.sliding_window_overlap != null) {
      set({ slidingWindowOverlap: newParams.sliding_window_overlap })
    }

    // Derive resolution preset and aspect ratio
    const res = newParams.resolution || '1280x720'
    const resolutionSelection = findResolutionSelection(res, get().modelOptions)
    if (resolutionSelection) {
      set({
        resolutionPreset: resolutionSelection.preset,
        aspectRatio: resolutionSelection.ratio,
      })
    }

    // Restore start/end images from upload URLs as File objects. Prefer
    // upload_filenames.image_{start,end} (basename); fall back to deriving
    // from the full path in params for sidecars missing upload_filenames.
    const startFile = (typeof uploadFilenames?.image_start === 'string'
      ? uploadFilenames.image_start
      : null) || _deriveBase(p.image_start)
    const endFile = (typeof uploadFilenames?.image_end === 'string'
      ? uploadFilenames.image_end
      : null) || _deriveBase(p.image_end)
    if (hadStartImage && startFile) {
      fetch(api.getFileUrl(startFile))
        .then(r => r.ok ? r.blob() : null)
        .then(blob => {
          if (!blob) return
          const file = new File([blob], startFile, { type: blob.type })
          set({ startImage: file })
        })
        .catch(() => {})
    }
    if (hadEndImage && endFile) {
      fetch(api.getFileUrl(endFile))
        .then(r => r.ok ? r.blob() : null)
        .then(blob => {
          if (!blob) return
          const file = new File([blob], endFile, { type: blob.type })
          set({ endImage: file })
        })
        .catch(() => {})
    }

    // ── Edit Mode restore ───────────────────────────────────────────────
    // If the sidecar carries edit_sub_mode, this output was made by the
    // Retake / Inpaint / Outpaint / Restyle / Edit Anything sub-modes.
    // Switch the sidebar into the matching mode and re-populate the
    // sub-mode-specific controls. The standard restore above already set
    // generationMode from the model family, so we override here when the
    // sidecar tag is authoritative.
    const editSubMode = (p.edit_sub_mode as string) || ''
    const validEditSubModes = new Set([
      'retake', 'inpaint', 'restyle', 'outpaint', 'edit_anything', 'recast',
    ])
    if (validEditSubModes.has(editSubMode)) {
      const restoredEditWorkflow: StudioVideoWorkflow | null = editSubMode === 'edit_anything'
        ? 'prompt_edit'
        : editSubMode === 'restyle'
          ? 'repaint'
          : editSubMode === 'inpaint'
            ? null
            : editSubMode as StudioVideoWorkflow
      set(s => ({
        appSection: 'director' as const, workspaceStage: 'studio' as const, sidebarMode: 'studio',
        generationMode: 'avatar',
        ...(restoredEditWorkflow ? { studioVideoWorkflow: restoredEditWorkflow } : {}),
        editSubMode: editSubMode as 'retake' | 'inpaint' | 'restyle' | 'outpaint' | 'edit_anything' | 'recast',
        selectedModelPerMode: {
          ...s.selectedModelPerMode,
          avatar: modelType,
        },
      }))

      // Re-link the source video. The sidecar stores either edit_video_path
      // (preferred — set by the new endpoints) or falls back to retake_video.
      // We fetch the file by URL so the EditVideoUpload UI shows the same
      // clip the user originally edited.
      const editVideoPath = (
        (p.edit_video_path as string)
        || (p.retake_video as string)
        || (p.video_guide as string)
        || ''
      )
      if (editVideoPath) {
        const fname = (
          typeof uploadFilenames?.edit_video_path === 'string'
            ? uploadFilenames.edit_video_path
            : null
        ) || _deriveBase(editVideoPath) || ''
        const url = api.getFileUrl(fname)
        // A lightweight named File keeps every edit upload card populated;
        // the source bytes continue streaming from /file rather than being
        // duplicated into browser memory.
        if (fname) {
          const file = _placeholderMediaFile(fname)
          if (file) get().setEditVideo(file, editVideoPath, url, 0, '')
          const video = document.createElement('video')
          video.preload = 'metadata'
          video.src = url
          video.muted = true
          video.onloadedmetadata = () => {
            const duration = video.duration && isFinite(video.duration) ? video.duration : 0
            const resolution = `${video.videoWidth}x${video.videoHeight}`
            if (file) get().setEditVideo(file, editVideoPath, url, duration, resolution)
            video.removeAttribute('src')
            video.load()
          }
          video.onerror = () => {
            video.removeAttribute('src')
            video.load()
          }
          // If metadata never loads (file moved/deleted), still set the path
          // so the user can re-attach manually.
          set({ editVideoPath, editVideoUrl: url })
        }
      }

      // Trim range — applies to retake, inpaint, edit_anything, outpaint.
      const trimStart = (p.edit_start_time as number) ?? (p.outpaint_trim_start as number)
      const trimEnd = (p.edit_end_time as number) ?? (p.outpaint_trim_end as number)
      if (trimStart != null && trimStart >= 0) {
        set({ editStartTime: trimStart })
        if (editSubMode === 'outpaint') set({ outpaintTrimStart: trimStart })
      }
      if (trimEnd != null && trimEnd > 0) {
        set({ editEndTime: trimEnd })
        if (editSubMode === 'outpaint') set({ outpaintTrimEnd: trimEnd })
      }

      // Sub-mode-specific knobs
      if (editSubMode === 'retake' || editSubMode === 'inpaint' || editSubMode === 'edit_anything') {
        if (p.retake_strength != null) set({ editRetakeStrength: p.retake_strength as number })
        if (p.retake_engine) set({ editRetakeEngine: p.retake_engine as 'native' | 'legacy' })
        if (p.regenerate_audio != null) set({ editRegenerateAudio: !!p.regenerate_audio })
        const promptStrength = Number(p.edit_prompt_strength ?? p.guidance_scale)
        if (Number.isFinite(promptStrength)) set({ editPromptStrength: promptStrength })
      }
      if (editSubMode === 'inpaint') {
        if (p.edit_target) set({ editDetectedTarget: p.edit_target as string })
        if (p.edit_sam_target || p.edit_target) {
          set({ editSamTarget: String(p.edit_sam_target || p.edit_target) })
        }
        if (p.edit_invert_mask != null) set({ editInvertMask: !!p.edit_invert_mask })
        if (p.retake_masks_path) set({ editMasksPath: p.retake_masks_path as string })
      }
      if (editSubMode === 'edit_anything') {
        if (p.edit_anything_lora_strength != null) {
          set({ editAnythingLoraStrength: p.edit_anything_lora_strength as number })
        }
        set({
          editAnythingStartAnchor: typeof p.retake_user_start_anchor === 'string' && p.retake_user_start_anchor
            ? p.retake_user_start_anchor
            : null,
          editAnythingEndAnchor: typeof p.retake_user_end_anchor === 'string' && p.retake_user_end_anchor
            ? p.retake_user_end_anchor
            : null,
        })
      }
      if (editSubMode === 'restyle') {
        const savedRepaintMappings = Array.isArray(p.edit_repaint_region_mappings)
          ? p.edit_repaint_region_mappings
            .slice(0, 5)
            .map((raw, index): RepaintRegionMapping | null => {
              if (!raw || typeof raw !== 'object') return null
              const mapping = raw as Record<string, unknown>
              const source = String(mapping.source || '').trim()
              const target = String(mapping.target || '').trim()
              if (!source || !target) return null
              return {
                id: String(mapping.id || `repaint-${index + 1}`),
                source,
                target,
              }
            })
            .filter((mapping): mapping is RepaintRegionMapping => mapping !== null)
          : []
        const repaintFrame = String(p.edit_repaint_target_frame || p.image_start || '')
        const repaintFrameName = repaintFrame.replace(/\\/g, '/').split('/').pop() || ''
        set({
          editRepaintMappings: savedRepaintMappings,
          editRepaintResolutionProfile: p.edit_repaint_resolution_profile === '704p'
            ? '704p'
            : p.edit_repaint_resolution_profile === '512p'
              ? '512p'
              : '480p',
          editRepaintFrameFile: null,
          editRepaintFramePath: repaintFrame,
          editRepaintFrameUrl: repaintFrameName ? api.getFileUrl(repaintFrameName) : '',
        })
        if (repaintFrame && repaintFrameName) {
          const repaintUrl = api.getFileUrl(repaintFrameName)
          fetch(repaintUrl)
            .then(r => r.ok ? r.blob() : null)
            .then(blob => {
              if (!blob) return
              get().setEditRepaintFrame(
                new File([blob], repaintFrameName, { type: blob.type || 'image/png' }),
                repaintFrame,
                URL.createObjectURL(blob),
              )
            })
            .catch(() => {})
        }
      }
      if (editSubMode === 'recast') {
        const savedMappings = p.edit_recast_character_mappings
        if (Array.isArray(savedMappings)) {
          const restoredMappings = savedMappings
            .slice(0, 5)
            .map((raw, index): RecastCharacterMapping | null => {
              if (!raw || typeof raw !== 'object') return null
              const mapping = raw as Record<string, unknown>
              const refPath = String(mapping.ref_image_path || '')
              const target = String(mapping.target || '').trim()
              if (!refPath || !target) return null
              const refName = refPath.replace(/\\/g, '/').split('/').pop() || ''
              const additionalPaths = Array.isArray(mapping.additional_ref_image_paths)
                ? mapping.additional_ref_image_paths.map(path => String(path || '')).filter(Boolean)
                : []
              return {
                id: String(mapping.id || `recast-${index + 1}`),
                target,
                refFile: null,
                refPath,
                refUrl: api.getFileUrl(refName),
                additionalRefs: additionalPaths.map(path => {
                  const name = path.replace(/\\/g, '/').split('/').pop() || ''
                  return { file: null, path, url: api.getFileUrl(name) }
                }),
                referenceAlignedToSource: mapping.reference_aligned_to_source === true,
              }
            })
            .filter((mapping): mapping is RecastCharacterMapping => mapping !== null)
          if (restoredMappings.length > 0) {
            set({
              editRecastMappings: restoredMappings,
              editRecastTarget: restoredMappings[0].target,
              editRecastPersonCount: restoredMappings.length,
              editRecastRefFile: null,
              editRecastRefPath: restoredMappings[0].refPath,
              editRecastRefUrl: restoredMappings[0].refUrl,
              editRecastRefAligned: restoredMappings[0].referenceAlignedToSource,
            })
          }
        }
        if (!Array.isArray(savedMappings) || savedMappings.length === 0) {
          set(s => ({
            editRecastMappings: [{
              ...(s.editRecastMappings[0] || DEFAULT_RECAST_MAPPING),
              target: String(p.edit_recast_target || 'person'),
              referenceAlignedToSource: p.edit_recast_ref_aligned === true,
            }],
          }))
        }
        if (p.edit_recast_target) set({ editRecastTarget: p.edit_recast_target as string })
        if (p.edit_recast_person_count != null) {
          const count = Number(p.edit_recast_person_count)
          set({ editRecastPersonCount: Math.min(5, Math.max(1, Number.isFinite(count) ? Math.round(count) : 1)) })
        }
        set({
          editRecastIsolateReference: p.edit_recast_isolate_reference !== false,
          editRecastAutoFaceDetail: p.edit_recast_auto_face_detail !== false,
          editRecastEnhancePrompt: p.edit_recast_enhance_prompt === true,
          editRecastProtectBystanders: p.edit_recast_protect_bystanders === true,
          editRecastPreserveBystanders: p.edit_recast_preserve_bystanders !== undefined
            ? p.edit_recast_preserve_bystanders === true
            : p.edit_recast_preserve_scene_reference !== undefined
              ? p.edit_recast_preserve_scene_reference === true
              : true,
          editRecastUseRelighting: p.edit_recast_use_relighting === true,
          editRecastResolutionProfile: p.edit_recast_resolution_profile === '704p'
            ? '704p'
            : p.edit_recast_resolution_profile === '512p'
              ? '512p'
              : '480p',
        })
        const recastRef = (p.edit_recast_ref_path as string) || ''
        if (recastRef) {
          const refName = recastRef.replace(/\\/g, '/').split('/').pop() || ''
          // Recast references can be either uploads or Image-mode outputs.
          const refUrl = api.getFileUrl(refName)
          fetch(refUrl)
            .then(r => r.ok ? r.blob() : null)
            .then(blob => {
              if (!blob) return
              const file = new File([blob], refName, { type: blob.type || 'image/png' })
              get().setEditRecastRef(
                file,
                recastRef,
                URL.createObjectURL(file),
                p.edit_recast_ref_aligned === true,
              )
            })
            .catch(() => {})
        }
      }
      if (editSubMode === 'outpaint') {
        // Padding (pixels) — preserved as-is; the OutpaintCanvas reads
        // outpaintAspect + outpaintVideoBox to compose, but we also mirror
        // the pixel pads to outpaintPadding so legacy code paths line up.
        const padTop = (p.outpaint_pad_top as number) ?? 0
        const padBottom = (p.outpaint_pad_bottom as number) ?? 0
        const padLeft = (p.outpaint_pad_left as number) ?? 0
        const padRight = (p.outpaint_pad_right as number) ?? 0
        set({ outpaintPadding: { top: padTop, bottom: padBottom, left: padLeft, right: padRight } })

        const canvasW = Number(p._outpaint_canvas_w ?? p.outpaint_canvas_w) || 0
        const canvasH = Number(p._outpaint_canvas_h ?? p.outpaint_canvas_h) || 0
        const savedAspect = String(p.outpaint_aspect || '') as OutpaintAspect
        const validSavedAspect = (
          savedAspect === 'source'
          || _OUTPAINT_ASPECT_RATIOS.some(([aspect]) => aspect === savedAspect)
        )
        let restoredAspect: OutpaintAspect | null = validSavedAspect ? savedAspect : null
        if (!restoredAspect) {
          let aspectW = canvasW
          let aspectH = canvasH
          if (aspectW <= 0 || aspectH <= 0) {
            const resolutionMatch = /^(\d+)x(\d+)$/i.exec(String(p.resolution || '').trim())
            if (resolutionMatch) {
              aspectW = Number(resolutionMatch[1])
              aspectH = Number(resolutionMatch[2])
            }
          }
          restoredAspect = _inferOutpaintAspect(aspectW, aspectH)
        }
        if (restoredAspect) set({ outpaintAspect: restoredAspect })
        if (p.outpaint_resolution_preset) {
          set({ outpaintResolutionPreset: p.outpaint_resolution_preset as 'auto' | '480p' | '540p' | '720p' | '1080p' })
        }
        if (p.outpaint_source_preservation != null) {
          set({ outpaintSourcePreservation: p.outpaint_source_preservation as number })
        }
        if (p.outpaint_lora_strength_ui != null) {
          set({ outpaintLoraStrength: p.outpaint_lora_strength_ui as number })
        }
        if (p.outpaint_mask_preserving != null) {
          set({ outpaintMaskPreserving: !!p.outpaint_mask_preserving })
        }
        const savedOutpaintWindow = Number(
          p.edit_outpaint_sliding_window_size ?? p.sliding_window_size,
        )
        if (Number.isFinite(savedOutpaintWindow) && savedOutpaintWindow > 0) {
          set({ outpaintWindowSize: Math.round(savedOutpaintWindow) })
        }
        const savedOutpaintOverlap = Number(p.sliding_window_overlap)
        if (Number.isFinite(savedOutpaintOverlap) && savedOutpaintOverlap >= 0) {
          set({ outpaintWindowOverlap: Math.round(savedOutpaintOverlap) })
        }

        // Recompute the canvas-relative video box from saved pad pixels +
        // saved canvas dimensions, so the OutpaintCanvas reproduces the
        // exact composition. Falls back to centered-fit if anything is
        // missing.
        if (canvasW > 0 && canvasH > 0) {
          const savedX = Number(p._outpaint_overlay_x ?? p.outpaint_overlay_x ?? padLeft)
          const savedY = Number(p._outpaint_overlay_y ?? p.outpaint_overlay_y ?? padTop)
          const srcW = Number(p._outpaint_overlay_w ?? p.outpaint_overlay_w)
            || (canvasW - padLeft - padRight)
          const srcH = Number(p._outpaint_overlay_h ?? p.outpaint_overlay_h)
            || (canvasH - padTop - padBottom)
          if (srcW > 0 && srcH > 0) {
            set({
              outpaintVideoBox: {
                x: savedX / canvasW,
                y: savedY / canvasH,
                w: srcW / canvasW,
                h: srcH / canvasH,
              },
            })
          }
        }

        // Audio/sync toggles
        if (p._outpaint_preserve_audio != null || p.outpaint_preserve_source_audio != null) {
          set({
            outpaintPreserveSourceAudio: !!(
              p._outpaint_preserve_audio ?? p.outpaint_preserve_source_audio
            ),
          })
        }
        if (p._outpaint_lock_source_pixels != null || p.outpaint_lock_source_pixels != null) {
          set({
            outpaintLockSourcePixels: !!(
              p._outpaint_lock_source_pixels ?? p.outpaint_lock_source_pixels
            ),
          })
        }
        if (p._outpaint_trim_smear != null || p.outpaint_trim_smear != null) {
          set({
            outpaintTrimSmear: !!(
              p._outpaint_trim_smear ?? p.outpaint_trim_smear
            ),
          })
        }
      }
    }
}
