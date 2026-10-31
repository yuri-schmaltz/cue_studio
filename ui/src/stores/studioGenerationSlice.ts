/** Studio validation, immutable request preparation, submission and job tracking.
 * Composed synchronously: clicking Generate captures the same state as before
 * extraction, without an async module-load gap before snapshotting inputs.
 */
import type { StoreApi } from 'zustand'
import type { AppState, StudioGenerationDependencies } from './useStore'
import type { GenerationJob, MiniMaxH3Reference } from '../types'
import * as api from '../api/client'
import { reviewSnapshot } from '../lib/reviewSnapshot'
import { buildGenerationPlan, resolvedGenerationPlan } from '../lib/generationPlan'
import { addPromptToHistory } from '../lib/promptHistory'
import { continuationFirstWindowFrames, durationWindowPlan } from '../lib/durationPlanning'
import { effectiveH3OmniSequenceFrames, normalizeH3ClipFrames, recommendedH3PassProfile, h3SlidingWindowCount, h3OmniSequenceWindowCount } from '../lib/h3Memory'

export function createStudioGenerationSlice(
  set: StoreApi<AppState>['setState'],
  get: StoreApi<AppState>['getState'],
  dependencies: StudioGenerationDependencies,
): Pick<AppState, 'startGeneration'> {
  const { sfxModelTypes, _studioCreateInputState, modelSupportsStudioVideoMediaIntent, _isOmniVideoModel, _isStudioLtxVideoModel, _omniEnhanceInventory, _normalizeSlidingWindowOverlap, _adaptiveEtaJobFields } = dependencies
  return {
  startGeneration: async (submissionMode = 'now', snapshot, prepareReview = false) => {
    const reviewToken = dependencies.getReviewToken()
    let state = snapshot || get()
    if (state.params?.prompt && !prepareReview) {
      addPromptToHistory(state.generationMode, String(state.params.prompt))
    }
    const primaryStudioCreate = (
      state.generationMode === 'video'
      && (state.studioVideoWorkflow === 'frames' || state.studioVideoWorkflow === 'references')
      && Number(state.params.image_mode) === 0
    )
    if (primaryStudioCreate && !snapshot) {
      state.reconcileStudioVideoCreateRoute('Inputs changed')
      state = get()
    }

    // Auto routing changes model_type synchronously, while its model-options
    // request completes in the background. If Generate is clicked immediately
    // after adding a frame or character, wait for the matching options instead
    // of submitting the new model with the previous model's frame/VRAM rules.
    const selectedModelType = String(state.params.model_type || '')
    if (
      !snapshot
      && selectedModelType
      && state.modelOptions?.model_type !== selectedModelType
      && !sfxModelTypes.has(selectedModelType)
    ) {
      await state.loadModelOptions(selectedModelType)
      state = get()
      if (state.modelOptions?.model_type !== selectedModelType) {
        set({ promptEnhanceError: 'The selected video model is still loading. Try Generate again in a moment.' })
        return
      }
    }

    const selectedModelDefinition = state.models.find(
      model => model.model_type === state.params.model_type,
    )
    const activeCreateInput = primaryStudioCreate
      ? _studioCreateInputState(state)
      : null
    const activeCreateRoute = primaryStudioCreate
      ? state.studioVideoEffectiveCreateRoute
      : null
    if (
      activeCreateInput
      && !modelSupportsStudioVideoMediaIntent(selectedModelDefinition, activeCreateInput)
    ) {
      set({
        promptEnhanceError: activeCreateInput.conflict
          ? 'Fixed start/end/keyframes cannot be combined with Omni references. Remove one of those input roles to continue.'
          : `No enabled model can use the current ${activeCreateRoute === 'omni' ? 'reference' : activeCreateRoute === 'guided' ? 'frame-guided' : activeCreateRoute === 'audio' ? 'audio-driven' : 'text'} inputs.`,
      })
      return
    }

    const hasGuidedCreateInput = Boolean(
      state.startImage
      || state.endImage
      || state.params.image_start
      || state.params.image_end
      || state.imageRefs.length
      || (
        Array.isArray(state.params.image_refs)
        && state.params.image_refs.length
        && state.params.frames_positions
      )
    )
    if (activeCreateRoute === 'guided' && !hasGuidedCreateInput) {
      set({ promptEnhanceError: 'Guided video needs a start frame, end frame, or timed frame.' })
      return
    }
    const omniReferences = state.params.minimax_h3_references ?? []
    if (
      activeCreateRoute === 'omni'
      && omniReferences.length === 0
    ) {
      set({ promptEnhanceError: 'Omni needs at least one character, image, video, or audio reference.' })
      return
    }

    const selectedModelIsOmni = _isOmniVideoModel(selectedModelDefinition)
    const architecture = String(
      state.modelOptions?.architecture
      || selectedModelDefinition?.architecture
      || '',
    )
    const isH3PromptModel = architecture.startsWith('minimax_h3')
    const isLtxPromptModel = state.modelOptions?.multi_window_sequence_controls === true
    const isOmniPromptModel = isH3PromptModel && (
      activeCreateRoute === 'omni'
      || state.modelOptions?.omni_reference === true
      || selectedModelIsOmni
    )
    const promptMode = isLtxPromptModel
      ? state.params.ltx_window_prompt_mode
      : state.params.minimax_h3_sequence_prompt_mode
    const multiWindowEnabled = isLtxPromptModel
      ? state.params.ltx_multi_window === true
      : isOmniPromptModel
        ? state.params.minimax_h3_reference_sequence === true
        : state.params.minimax_h3_multi_window === true
    const promptFps = state.modelOptions?.fps ?? 16
    const promptSlidingDefaults = state.modelOptions?.sliding_window_defaults
    const promptOverlapSeconds = state.slidingWindowOverlap / promptFps
    const promptDiscardSeconds = (
      promptSlidingDefaults?.discard_last_frames ?? 0
    ) / promptFps
    const promptFirstWindowSeconds = (
      state.studioVideoWorkflow === 'extend'
      && state.modelOptions?.sliding_window === true
    )
      ? continuationFirstWindowFrames(
          Math.round(state.slidingWindowSeconds * promptFps),
          state.slidingWindowOverlap,
        ) / promptFps
      : state.slidingWindowSeconds
    const usesMultiplePasses = (
      multiWindowEnabled
      && durationWindowPlan(
        state.durationSeconds,
        state.slidingWindowSeconds,
        promptOverlapSeconds,
        promptDiscardSeconds,
        promptFirstWindowSeconds,
      ).windowCount > 1
    )
    const alreadyEnhanced = isLtxPromptModel
      ? Boolean(
          typeof state.params._ltx_original_prompt === 'string'
          && state.params._ltx_original_prompt.trim(),
        )
      : Boolean(
          typeof state.params._h3_original_prompt === 'string'
          && state.params._h3_original_prompt.trim(),
        )

    const automaticSinglePromptEnhance = (
      !snapshot
      && state.generationMode === 'video'
      && (isH3PromptModel || isLtxPromptModel)
      && (promptMode === 'auto' || promptMode === 'creative')
      && !usesMultiplePasses
      && !alreadyEnhanced
      && String(state.params.prompt || '').trim()
    )
    let generationWorkInFlight = (
      state.isGenerating
      || state.jobs.some(job => job.status === 'running' || job.status === 'queued')
    )
    if (
      automaticSinglePromptEnhance
      && submissionMode !== 'queue'
      && !generationWorkInFlight
    ) {
      try {
        const active = await api.fetchActiveJobs()
        generationWorkInFlight = active.jobs.some(job => (
          job.status === 'running' || job.status === 'queued'
        ))
      } catch { /* reconnect polling remains the normal source of truth */ }
    }
    const deferAutoEnhance = Boolean(
      automaticSinglePromptEnhance
      && (submissionMode === 'queue' || generationWorkInFlight)
    )

    // Interactive Generate on an idle GPU still enhances first so the result
    // is visible in Studio. Held queue entries, and Generate clicks made while
    // another render is active, freeze the raw idea now and carry an enhancer
    // request inside the job instead. The backend executes it only after that
    // job owns the generation lock, avoiding an LLM/diffusion VRAM collision.
    if (automaticSinglePromptEnhance && !deferAutoEnhance) {
      await state.enhancePrompt()
      state = get()
      if (state.isEnhancing || state.promptEnhanceError) return
    }

    state = reviewSnapshot(state)

    // Freeze the Studio configuration at click time. This matters for the
    // split Add to Queue action: later UI edits must belong to a new job.
    const holdForQueue = submissionMode === 'queue'
    const queueSupported = (
      state.generationMode !== 'avatar'
      && !(
        state.generationMode === 'video'
        && Number(state.params.image_mode) === 4
      )
    )
    if (holdForQueue && !queueSupported && !prepareReview) {
      console.warn('Add to Queue is not available for this specialized edit workflow yet.')
      return
    }

    // A held job does not touch the GPU, so keep the prompt LLM resident for
    // enhancing the next queued prompt. It will be unloaded when the queue is
    // explicitly started, just like Generate Now.
    if (!prepareReview && !holdForQueue && state.llmStatus?.loaded) {
      try {
        await api.unloadLlm()
        set({ llmStatus: { loaded: false, model_id: null, device: null, provider: '' } })
      } catch { /* best-effort */ }
    }

    // Validate: i2v-only models require a start image — Video mode only.
    // Edit sub-modes supply their own source media and validate in their
    // own branches (Recast runs the i2v-only SCAIL-2 against a source
    // video + reference image; this guard silently ate its clicks).
    const isI2vOnly = selectedModelDefinition
      ? selectedModelDefinition.is_i2v && !selectedModelDefinition.is_t2v
      : state.modelOptions?.i2v_class && !state.modelOptions?.t2v_class
    const isOmniReference = isOmniPromptModel
    const isH3Model = architecture.startsWith('minimax_h3')
    const isLtxSequenceModel = state.modelOptions?.multi_window_sequence_controls === true
    const hasStartImage = state.startImage || state.params.image_start
    const hasMultiClipImages = state.clips.some(c => c.startImage || c.startImagePath)
    if (state.generationMode === 'video' && isI2vOnly && !isOmniReference && !hasStartImage && !hasMultiClipImages) {
      console.error('This model requires a start image')
      // Could show a toast/notification here in the future
      return
    }
    if (
      state.generationMode === 'video'
      && isOmniReference
      && !omniReferences.some(reference => reference.type === 'image' || reference.type === 'video')
    ) {
      console.error('MiniMax H3 Omni Reference needs at least one image or video reference')
      return
    }

    const specialized = state.generationMode === 'avatar'
      || (state.generationMode === 'video' && Number(state.params.image_mode) === 4)
    if (prepareReview && specialized) {
      dependencies.setReviewSnapshot(state)
      const plan = buildGenerationPlan(state)
      plan.warnings.push('This specialized operation uses a frozen configuration; its renderer resolves final geometry at execution.')
      set({ reviewPlan: plan })
      return
    }

    // ── Video mode: Blend ──────────────────────────────────────────
    if (state.generationMode === 'video' && (state.params.image_mode as number) === 4) {
      if (!state.blendClipAPath || !state.blendClipBPath) return
      const prompt = (state.params.prompt as string || '').trim()

      const newJob: GenerationJob = {
        id: '', status: 'queued', progress: 0, step: 0, totalSteps: 0,
        phase: '', message: 'Submitting blend...', outputFiles: [], error: null, oomInfo: null,
      }
      set(s => ({ isGenerating: true, jobs: [newJob, ...s.jobs] }))

      try {
        const result = await api.submitBlend({
          clip_a_path: state.blendClipAPath,
          clip_b_path: state.blendClipBPath,
          prompt: prompt || 'smooth natural transition between the two clips',
          model_type: state.params.model_type as string,
          blend_mode: state.blendMode,
          overlap_sec: state.blendOverlapSec,
          // Blend-specific tuning knobs (exposed in BlendControls sliders)
          motion_prefix_sec: state.blendMotionPrefixSec,
          motion_suffix_sec: state.blendMotionSuffixSec,
          input_video_strength: state.blendAnchorStrength,
          seed: (state.params.seed as number) ?? -1,
          activated_loras: (state.params.activated_loras as string[]) || [],
          loras_multipliers: (state.params.loras_multipliers as string) || '',
          workspace: state.activeWorkspace,
          // Pass the full Studio params so the backend can inherit the user's
          // progressive_pipeline / num_inference_steps / guidance_scale /
          // negative_prompt settings, matching what a manual SE generation
          // would have used. Blend-specific fields (image_start/end, video_length,
          // resolution, image_prompt_type) are overridden server-side.
          base_params: state.params as unknown as Record<string, unknown>,
        })

        set(s => ({
          jobs: s.jobs.map(j => j === newJob ? { ...j, id: result.job_id, status: 'running', message: 'Blending...' } : j),
        }))

        const pollInterval = setInterval(async () => {
          if (!get().jobs.find(j => j.id === result.job_id)) { clearInterval(pollInterval); return }
          try {
            const status = await api.fetchJobStatus(result.job_id)
            set(s => ({
              jobs: s.jobs.map(j => j.id !== result.job_id ? j : {
                ...j, status: status.status, progress: status.progress / 100,
                step: status.step, totalSteps: status.total_steps,
                phase: status.phase, message: status.message,
                outputFiles: status.output_files, error: status.error, oomInfo: status.oom_info ?? null,
              }),
            }))
            if (status.status === 'running') get().refreshOutputs()
            if (status.status === 'completed') {
              clearInterval(pollInterval)
              set(s => {
                const remaining = s.jobs.filter(j => j.id !== result.job_id)
                return {
                  jobs: remaining,
                  isGenerating: remaining.some(j => j.status === 'running' || j.status === 'queued'),
                }
              })
              get().loadOutputs()
            } else if (status.status === 'failed' || status.status === 'cancelled') {
              clearInterval(pollInterval)
              // Keep the failed/cancelled job in the queue so its placeholder
              // stays visible with the error message — user dismisses via X.
              set(s => ({
                isGenerating: s.jobs.some(j => j.id !== result.job_id && (j.status === 'running' || j.status === 'queued')),
              }))
            }
          } catch { /* ignore poll errors */ }
        }, 2000)
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Blend failed'
        // Submit itself failed (pre-queue). Convert the placeholder to a
        // failed state in place so the user sees what went wrong instead of
        // the tile silently disappearing.
        set(s => ({
          jobs: s.jobs.map(j => j === newJob ? { ...j, id: j.id || `submit-fail-${Date.now()}`, status: 'failed', message: msg, error: msg } : j),
          isGenerating: s.jobs.some(j => j !== newJob && (j.status === 'running' || j.status === 'queued')),
        }))
        console.error('Blend failed:', msg)
      }
      return
    }

    // ── Edit mode: Outpaint ────────────────────────────────────────
    if (state.generationMode === 'avatar' && state.editSubMode === 'outpaint') {
      if (!state.editVideoPath) return
      const prompt = (state.params.prompt as string || '').trim()

      // Resolve source pixel dimensions from the loaded video metadata.
      // We need them to convert the canvas-relative video box into absolute
      // pad_top/bottom/left/right pixel values that the server expects.
      const srcRes = state.editVideoResolution || ''
      const [srcWStr, srcHStr] = srcRes.split('x')
      const srcW = parseInt(srcWStr) || 0
      const srcH = parseInt(srcHStr) || 0
      if (srcW <= 0 || srcH <= 0) {
        console.error('Outpaint: source dimensions unknown')
        return
      }

      // Resolve canvas dimensions in source-pixel-space from the chosen aspect.
      // Canvas is grown so the source fits inside without cropping; pure
      // letterbox math.
      const aspect = state.outpaintAspect
      let canvasW = srcW, canvasH = srcH
      if (aspect !== 'source') {
        const [aw, ah] = aspect.split(':').map(Number)
        const target = aw / ah
        const srcRatio = srcW / srcH
        if (srcRatio > target) {
          canvasW = srcW
          canvasH = Math.round(srcW / target)
        } else {
          canvasH = srcH
          canvasW = Math.round(srcH * target)
        }
      }

      // The video box is canvas-relative (0–1). Convert to pixel pads.
      const box = state.outpaintVideoBox
      const videoX = Math.round(box.x * canvasW)
      const videoY = Math.round(box.y * canvasH)
      const videoW = Math.round(box.w * canvasW)
      const videoH = Math.round(box.h * canvasH)
      const padTop = Math.max(0, videoY)
      const padLeft = Math.max(0, videoX)
      const padBottom = Math.max(0, canvasH - videoY - videoH)
      const padRight = Math.max(0, canvasW - videoX - videoW)
      const totalPad = padTop + padBottom + padLeft + padRight
      if (totalPad === 0) return

      // Mirror the computed pads to outpaintPadding so metadata sidecars
      // and any older read paths still see the values.
      set({ outpaintPadding: { top: padTop, bottom: padBottom, left: padLeft, right: padRight } })

      // Optional film-strip trim: only send if user picked a non-trivial range.
      const trimStart = state.outpaintTrimStart || 0
      const trimEnd = state.outpaintTrimEnd || 0
      const sendTrim = trimEnd > trimStart && trimEnd > 0.05

      const newJob: GenerationJob = {
        id: '', status: 'queued', progress: 0, step: 0, totalSteps: 0,
        phase: '', message: 'Submitting outpaint...', outputFiles: [], error: null, oomInfo: null,
      }
      set(s => ({ isGenerating: true, jobs: [newJob, ...s.jobs] }))

      // Sliding window size: the Advanced Settings slider stores seconds.
      // Convert to frames using the loaded model's fps so the same value
      // round-trips between video and outpaint modes. Falls back to 25
      // (LTX-2 22B's native rate) if modelOptions hasn't loaded yet.
      const fps = (state.modelOptions?.fps as number) || 25
      const windowFrames = Math.max(1, Math.round(state.slidingWindowSeconds * fps))
      const overlapFrames = state.slidingWindowOverlap || 9

      try {
        const result = await api.submitOutpaint({
          video_path: state.editVideoPath,
          prompt: prompt || 'extend the scene naturally',
          model_type: state.params.model_type as string,
          pad_top: padTop,
          pad_bottom: padBottom,
          pad_left: padLeft,
          pad_right: padRight,
          outpaint_aspect: state.outpaintAspect,
          resolution_preset: state.outpaintResolutionPreset,
          source_preservation: 1.0,
          outpaint_lora_strength: 1.0,
          mask_preserving_outpaint: state.outpaintMaskPreserving,
          preserve_source_audio: state.outpaintPreserveSourceAudio,
          lock_source_pixels: false,
          trim_window_smear: state.outpaintTrimSmear,
          sliding_window_size: windowFrames,
          sliding_window_overlap: overlapFrames,
          ...(sendTrim ? { start_time: trimStart, end_time: trimEnd } : {}),
          num_inference_steps: (state.params.num_inference_steps as number) ?? undefined,
          guidance_scale: (state.params.guidance_scale as number) ?? undefined,
          negative_prompt: (state.params.negative_prompt as string) || undefined,
          seed: (state.params.seed as number) ?? -1,
          activated_loras: (state.params.activated_loras as string[]) || [],
          loras_multipliers: (state.params.loras_multipliers as string) || '',
          workspace: state.activeWorkspace,
        })

        set(s => ({
          jobs: s.jobs.map(j => j === newJob ? { ...j, id: result.job_id, status: 'running', message: 'Outpainting...' } : j),
        }))

        const pollInterval = setInterval(async () => {
          if (!get().jobs.find(j => j.id === result.job_id)) { clearInterval(pollInterval); return }
          try {
            const status = await api.fetchJobStatus(result.job_id)
            set(s => ({
              jobs: s.jobs.map(j => j.id !== result.job_id ? j : {
                ...j, status: status.status, progress: status.progress / 100,
                step: status.step, totalSteps: status.total_steps,
                phase: status.phase, message: status.message,
                outputFiles: status.output_files, error: status.error, oomInfo: status.oom_info ?? null,
              }),
            }))
            if (status.status === 'running') get().refreshOutputs()
            if (status.status === 'completed') {
              clearInterval(pollInterval)
              set(s => {
                const remaining = s.jobs.filter(j => j.id !== result.job_id)
                return {
                  jobs: remaining,
                  isGenerating: remaining.some(j => j.status === 'running' || j.status === 'queued'),
                }
              })
              get().loadOutputs()
            } else if (status.status === 'failed' || status.status === 'cancelled') {
              clearInterval(pollInterval)
              // Keep the failed/cancelled job in the queue so its placeholder
              // stays visible with the error message — user dismisses via X.
              set(s => ({
                isGenerating: s.jobs.some(j => j.id !== result.job_id && (j.status === 'running' || j.status === 'queued')),
              }))
            }
          } catch { /* ignore poll errors */ }
        }, 2000)
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Outpaint failed'
        // Submit itself failed (pre-queue). Convert the placeholder to a
        // failed state in place so the user sees what went wrong instead of
        // the tile silently disappearing.
        set(s => ({
          jobs: s.jobs.map(j => j === newJob ? { ...j, id: j.id || `submit-fail-${Date.now()}`, status: 'failed', message: msg, error: msg } : j),
          isGenerating: s.jobs.some(j => j !== newJob && (j.status === 'running' || j.status === 'queued')),
        }))
        console.error('Outpaint failed:', msg)
      }
      return
    }

    // ── Edit mode: Recast (SCAIL-2 Replace) ─────────────────────
    // Standalone branch: the prompt is OPTIONAL here (the server has a
    // sensible default), unlike the shared edit block below which
    // hard-requires one.
    // Repaint is the easy front door to the proven Studio Video/Frames
    // SCAIL-2 Animate path: an edited first frame defines the finished look
    // while the source video supplies motion and camera movement.
    if (state.generationMode === 'avatar' && state.editSubMode === 'restyle') {
      if (!state.editVideoPath || !state.editRepaintFramePath) return
      const repaintMappings = state.editRepaintMappings.slice(0, 5)
      if (repaintMappings.some(mapping => !mapping.source.trim() || !mapping.target.trim())) return
      const promptText = ((state.params.prompt as string) || '').trim()
      const newJob: GenerationJob = {
        id: '', status: 'queued', progress: 0, step: 0, totalSteps: 0,
        phase: '', message: 'Submitting repaint...', outputFiles: [], error: null, oomInfo: null,
      }
      set(s => ({ isGenerating: true, jobs: [newJob, ...s.jobs] }))

      try {
        const repaintModel = (state.params.model_type as string) || ''
        const repaintIsScail2 = repaintModel === 'scail2_14B_fast' || repaintModel === 'scail2_14B'
        const result = await api.submitRepaint({
          video_path: state.editVideoPath,
          target_frame_path: state.editRepaintFramePath,
          region_mappings: repaintMappings.map(mapping => ({
            id: mapping.id,
            source: mapping.source.trim(),
            target: mapping.target.trim(),
          })),
          ...(promptText ? { prompt: promptText } : {}),
          resolution_profile: state.editRepaintResolutionProfile,
          ...(repaintIsScail2 ? {
            model_type: repaintModel,
            num_inference_steps: (state.params.num_inference_steps as number) ?? undefined,
            ...(repaintModel === 'scail2_14B' ? {
              guidance_scale: (state.params.guidance_scale as number) ?? undefined,
            } : {}),
          } : {}),
          start_time: state.editStartTime,
          end_time: state.editEndTime,
          seed: (state.params.seed as number) ?? -1,
          negative_prompt: (state.params.negative_prompt as string) || '',
          activated_loras: (state.params.activated_loras as string[]) || [],
          loras_multipliers: (state.params.loras_multipliers as string) || '',
          workspace: state.activeWorkspace,
        })

        set(s => ({
          jobs: s.jobs.map(j => j === newJob
            ? { ...j, id: result.job_id, status: 'running', message: 'Queued...' }
            : j),
        }))

        const pollInterval = setInterval(async () => {
          if (!get().jobs.find(j => j.id === result.job_id)) {
            clearInterval(pollInterval)
            return
          }
          try {
            const status = await api.fetchJobStatus(result.job_id)
            set(s => ({
              jobs: s.jobs.map(j => j.id !== result.job_id ? j : {
                ...j,
                status: status.status,
                progress: status.progress / 100,
                step: status.step,
                totalSteps: status.total_steps,
                phase: status.phase,
                message: status.message,
                outputFiles: status.output_files,
                error: status.error,
                oomInfo: status.oom_info ?? null,
              }),
            }))
            if (status.status === 'running') get().refreshOutputs()
            if (status.status === 'completed') {
              clearInterval(pollInterval)
              set(s => {
                const remaining = s.jobs.filter(j => j.id !== result.job_id)
                return {
                  jobs: remaining,
                  isGenerating: remaining.some(j => j.status === 'running' || j.status === 'queued'),
                }
              })
              get().loadOutputs()
            } else if (status.status === 'failed' || status.status === 'cancelled') {
              clearInterval(pollInterval)
              set(s => ({
                isGenerating: s.jobs.some(j => j.id !== result.job_id && (j.status === 'running' || j.status === 'queued')),
              }))
            }
          } catch { /* ignore poll errors */ }
        }, 2000)
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Repaint failed'
        set(s => ({
          jobs: s.jobs.map(j => j === newJob
            ? { ...j, id: j.id || `submit-fail-${Date.now()}`, status: 'failed', message: msg, error: msg }
            : j),
          isGenerating: s.jobs.some(j => j !== newJob && (j.status === 'running' || j.status === 'queued')),
        }))
        console.error('Repaint failed:', msg)
      }
      return
    }

    if (state.generationMode === 'avatar' && state.editSubMode === 'recast') {
      const recastMappings = state.editRecastMappings.slice(0, 5)
      if (
        !state.editVideoPath
        || recastMappings.length === 0
        || recastMappings.some(mapping => !mapping.target.trim() || !mapping.refPath)
      ) return
      const promptText = ((state.params.prompt as string) || '').trim()

      const newJob: GenerationJob = {
        id: '', status: 'queued', progress: 0, step: 0, totalSteps: 0,
        phase: '', message: 'Submitting recast...', outputFiles: [], error: null, oomInfo: null,
      }
      set(s => ({ isGenerating: true, jobs: [newJob, ...s.jobs] }))

      try {
        // Honor the selector's Recast SCAIL-2 choice (dedicated Fast vs
        // native base). Guard on
        // architecture so a stale LTX model_type can never reach the
        // recast endpoint — the server then falls back to Fast.
        const recastModel = (state.params.model_type as string) || ''
        const recastIsScail2 = state.models.find(m => m.model_type === recastModel)?.architecture === 'scail2_14B'
        const result = await api.submitRecast({
          video_path: state.editVideoPath,
          // Legacy fields remain populated for old sidecars/API clients, while
          // the explicit cards provide deterministic target/color assignment.
          ref_image_path: recastMappings[0].refPath,
          target: recastMappings[0].target || 'person',
          person_count: recastMappings.length,
          reference_aligned_to_source: recastMappings[0].referenceAlignedToSource,
          character_mappings: recastMappings.map(mapping => ({
            id: mapping.id,
            target: mapping.target.trim(),
            ref_image_path: mapping.refPath,
            additional_ref_image_paths: mapping.additionalRefs
              .map(reference => reference.path)
              .filter(Boolean),
            reference_aligned_to_source: mapping.referenceAlignedToSource,
          })),
          // Simplified Recast recipe: identity preparation and native
          // bystander preservation are automatic; prompt rewriting and the
          // seam-prone post-composite remain off. The backend still accepts
          // all legacy fields for saved/API callers.
          isolate_reference: true,
          auto_face_detail: true,
          enhance_prompt: false,
          protect_bystanders: false,
          preserve_bystanders: true,
          use_relighting: state.editRecastUseRelighting,
          resolution_profile: state.editRecastResolutionProfile,
          ...(promptText ? { prompt: promptText } : {}),
          ...(recastIsScail2 ? {
            model_type: recastModel,
            num_inference_steps: (state.params.num_inference_steps as number) ?? undefined,
            ...(recastModel === 'scail2_14B' ? {
              guidance_scale: (state.params.guidance_scale as number) ?? undefined,
            } : {}),
          } : {}),
          start_time: state.editStartTime,
          end_time: state.editEndTime,
          seed: (state.params.seed as number) ?? -1,
          negative_prompt: (state.params.negative_prompt as string) || '',
          activated_loras: (state.params.activated_loras as string[]) || [],
          loras_multipliers: (state.params.loras_multipliers as string) || '',
          workspace: state.activeWorkspace,
        })

        set(s => ({
          jobs: s.jobs.map(j => j === newJob ? { ...j, id: result.job_id, status: 'running', message: 'Queued...' } : j),
        }))

        const pollInterval = setInterval(async () => {
          if (!get().jobs.find(j => j.id === result.job_id)) { clearInterval(pollInterval); return }
          try {
            const status = await api.fetchJobStatus(result.job_id)
            set(s => ({
              jobs: s.jobs.map(j => j.id !== result.job_id ? j : {
                ...j, status: status.status, progress: status.progress / 100,
                step: status.step, totalSteps: status.total_steps,
                phase: status.phase, message: status.message,
                outputFiles: status.output_files, error: status.error, oomInfo: status.oom_info ?? null,
              }),
            }))
            if (status.status === 'running') get().refreshOutputs()
            if (status.status === 'completed') {
              clearInterval(pollInterval)
              set(s => {
                const remaining = s.jobs.filter(j => j.id !== result.job_id)
                return {
                  jobs: remaining,
                  isGenerating: remaining.some(j => j.status === 'running' || j.status === 'queued'),
                }
              })
              get().loadOutputs()
            } else if (status.status === 'failed' || status.status === 'cancelled') {
              clearInterval(pollInterval)
              set(s => ({
                isGenerating: s.jobs.some(j => j.id !== result.job_id && (j.status === 'running' || j.status === 'queued')),
              }))
            }
          } catch { /* ignore poll errors */ }
        }, 2000)
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Recast failed'
        set(s => ({
          jobs: s.jobs.map(j => j === newJob ? { ...j, id: j.id || `submit-fail-${Date.now()}`, status: 'failed', message: msg, error: msg } : j),
          isGenerating: s.jobs.some(j => j !== newJob && (j.status === 'running' || j.status === 'queued')),
        }))
        console.error('Recast failed:', msg)
      }
      return
    }

    // ── Edit mode: Retake / Inpaint / Edit Anything ─────────────
    if (state.generationMode === 'avatar' && (state.editSubMode === 'retake' || state.editSubMode === 'inpaint' || state.editSubMode === 'edit_anything')) {
      if (!state.editVideoPath) return
      const prompt = (state.params.prompt as string || '').trim()
      if (!prompt) return

      const newJob: GenerationJob = {
        id: '', status: 'queued', progress: 0, step: 0, totalSteps: 0,
        phase: '', message: 'Submitting...', outputFiles: [], error: null, oomInfo: null,
      }
      set(s => ({ isGenerating: true, jobs: [newJob, ...s.jobs] }))

      try {
        let result: { job_id: string }
        if (state.editSubMode === 'edit_anything') {
          result = await api.submitEditAnything({
            video_path: state.editVideoPath,
            prompt,
            model_type: state.params.model_type as string,
            start_time: state.editStartTime,
            end_time: state.editEndTime,
            lora_strength: state.editAnythingLoraStrength,
            retake_strength: state.editRetakeStrength,
            seed: (state.params.seed as number) ?? -1,
            // Edit Anything LoRA card: start with CFG=1 on distilled; raise
            // only if the edit is too weak. We route the user's global CFG
            // slider through so they can experiment.
            guidance_scale: (state.params.guidance_scale as number) ?? 1.0,
            num_inference_steps: (state.params.num_inference_steps as number) ?? 8,
            negative_prompt: (state.params.negative_prompt as string) || '',
            activated_loras: (state.params.activated_loras as string[]) || [],
            loras_multipliers: (state.params.loras_multipliers as string) || '',
            workspace: state.activeWorkspace,
            // Optional boundary anchors. Empty values mean "use source
            // frames" (today's auto-extract behavior); ltx2.py treats
            // missing/null/empty path as "fall back to source".
            ...(state.editAnythingStartAnchor ? { start_anchor_path: state.editAnythingStartAnchor } : {}),
            ...(state.editAnythingEndAnchor ? { end_anchor_path: state.editAnythingEndAnchor } : {}),
          })
        } else if (state.editSubMode === 'inpaint') {
          result = await api.submitInpaint({
            video_path: state.editVideoPath,
            description: prompt,
            sam_target: state.editSamTarget || undefined,
            invert_mask: state.editInvertMask || undefined,
            start_time: state.editStartTime,
            end_time: state.editEndTime,
            model_type: state.params.model_type as string,
            seed: (state.params.seed as number) ?? -1,
            // Inpaint needs CFG > 1.0 to make the prompt actually influence
            // the masked region. The edit-specific editPromptStrength slider
            // (default 3.5) drives this; the global params.guidance_scale is
            // fine for normal generation but would silently default to 1.0
            // and silently break inpaint.
            guidance_scale: state.editPromptStrength,
            retake_strength: state.editRetakeStrength,
            num_inference_steps: (state.params.num_inference_steps as number) ?? 8,
            negative_prompt: (state.params.negative_prompt as string) || '',
            resolution: (state.params.resolution as string) || '',
            activated_loras: (state.params.activated_loras as string[]) || [],
            loras_multipliers: (state.params.loras_multipliers as string) || '',
            masks_path: state.editMasksPath || undefined,
            workspace: state.activeWorkspace,
          })
        } else {
          result = await api.submitRetake({
            video_path: state.editVideoPath,
            start_time: state.editStartTime,
            end_time: state.editEndTime,
            prompt,
            model_type: state.params.model_type as string,
            retake_strength: state.editRetakeStrength,
            retake_engine: state.editRetakeEngine,
            regenerate_audio: state.editRegenerateAudio,
            seed: (state.params.seed as number) ?? -1,
            // Retake also benefits from CFG > 1.0 when the user provides a
            // prompt that should drive the regenerated region (e.g. new
            // outfit, different style). Previously stuck at 1.0 via
            // params.guidance_scale fallback — same silent bug as inpaint.
            guidance_scale: state.editPromptStrength,
            num_inference_steps: (state.params.num_inference_steps as number) ?? 8,
            negative_prompt: (state.params.negative_prompt as string) || '',
            resolution: (state.params.resolution as string) || '',
            activated_loras: (state.params.activated_loras as string[]) || [],
            loras_multipliers: (state.params.loras_multipliers as string) || '',
            workspace: state.activeWorkspace,
          })
        }

        set(s => ({
          jobs: s.jobs.map(j => j === newJob ? { ...j, id: result.job_id, status: 'running', message: 'Queued...' } : j),
        }))

        // Standard job polling (same as regular generation)
        const pollInterval = setInterval(async () => {
          if (!get().jobs.find(j => j.id === result.job_id)) { clearInterval(pollInterval); return }
          try {
            const status = await api.fetchJobStatus(result.job_id)
            set(s => ({
              jobs: s.jobs.map(j => j.id !== result.job_id ? j : {
                ...j, status: status.status, progress: status.progress / 100,
                step: status.step, totalSteps: status.total_steps,
                phase: status.phase, message: status.message,
                outputFiles: status.output_files, error: status.error, oomInfo: status.oom_info ?? null,
              }),
            }))
            if (status.status === 'running') get().refreshOutputs()
            if (status.status === 'completed') {
              clearInterval(pollInterval)
              set(s => {
                const remaining = s.jobs.filter(j => j.id !== result.job_id)
                return {
                  jobs: remaining,
                  isGenerating: remaining.some(j => j.status === 'running' || j.status === 'queued'),
                }
              })
              get().loadOutputs()
            } else if (status.status === 'failed' || status.status === 'cancelled') {
              clearInterval(pollInterval)
              // Keep the failed/cancelled job in the queue so its placeholder
              // stays visible with the error message — user dismisses via X.
              set(s => ({
                isGenerating: s.jobs.some(j => j.id !== result.job_id && (j.status === 'running' || j.status === 'queued')),
              }))
            }
          } catch { /* ignore poll errors */ }
        }, 2000)
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Generation failed'
        // Submit itself failed (pre-queue). Convert the placeholder to a
        // failed state in place so the user sees what went wrong instead of
        // the tile silently disappearing.
        set(s => ({
          jobs: s.jobs.map(j => j === newJob ? { ...j, id: j.id || `submit-fail-${Date.now()}`, status: 'failed', message: msg, error: msg } : j),
          isGenerating: s.jobs.some(j => j !== newJob && (j.status === 'running' || j.status === 'queued')),
        }))
        console.error('Edit generation failed:', msg)
      }
      return  // Don't fall through to normal generation
    }

    const params: Record<string, unknown> = { ...state.params, generation_mode: state.generationMode, workspace: state.activeWorkspace }
    if (state.generationMode === 'video') {
      params._studio_video_workflow = state.studioVideoWorkflow
    }
    const useStudioFrameInputs = !primaryStudioCreate || activeCreateRoute === 'guided'
    if (primaryStudioCreate && activeCreateRoute === 'generate') {
      // Generate is deliberately text-only. Preserve any hidden Guided inputs
      // in Studio state so switching back restores them, but never let those
      // paths or their letter flags leak into this submission.
      params.image_prompt_type = ''
      delete params.image_start
      delete params.image_end
      delete params.image_refs
      delete params.frames_positions
      const videoPromptType = String(params.video_prompt_type || '').replace(/KFI/g, '')
      if (videoPromptType) params.video_prompt_type = videoPromptType
      else delete params.video_prompt_type
    }
    // This is an ephemeral submit contract, never durable Studio state. It is
    // set again below only when the exact visible H3 window plan is included
    // in this submission.
    delete params._h3_window_plan_reviewed
    let effectiveH3SequenceClipFrames: number | null = null
    let h3ManualSequencePrompts: string[] | null = null
    let h3ManualFirstLastPrompts: string[] | null = null
    let continuationSourceContextFrames = 0

    if (
      state.generationMode === 'video'
      && state.modelOptions?.infer_audio_prompt_from_guide === true
      && params.audio_guide
      && (!params.video_guide || !String(params.video_prompt_type || '').includes('V'))
    ) {
      const audioPromptType = String(params.audio_prompt_type || '')
      if (![...'AK2'].some(letter => audioPromptType.includes(letter))) {
        // The visible soundtrack tile and its hidden mode must travel as one
        // contract. This also heals Load Settings from an affected sidecar.
        params.audio_prompt_type = `A${audioPromptType}`
      }
    }

    // H3 video-to-audio freezes the Control Video's pictures, so any
    // remembered V2V mask/edit controls are irrelevant. Normalize the request
    // copy here as a durable safety net for loaded sidecars and older saved UI
    // state; the user's friendly mode selection remains available in Studio.
    if (
      state.modelOptions?.video_to_video_inpaint === true
      && String(params.audio_prompt_type || '').includes('2')
    ) {
      params.video_prompt_type = 'GV'
      delete params.video_mask
      params.denoising_strength = 1.0
      params.masking_strength = 1.0
    }

    if (state.generationMode === 'video') {
      const fps = state.modelOptions?.fps ?? 16
      const supportsSlidingWindows = state.modelOptions?.sliding_window === true
      const minimumFrames = state.modelOptions?.frames_minimum ?? 1
      const maximumFrames = state.modelOptions?.frames_maximum ?? null
      const h3ReferenceSequenceRequested = (
        isOmniReference
        && params.minimax_h3_reference_sequence === true
      )
      const h3FirstLastMultiWindowRequested = (
        isH3Model
        && !isOmniReference
        && params.minimax_h3_multi_window === true
      )
      const ltxMultiWindowRequested = (
        isLtxSequenceModel
        && params.ltx_multi_window === true
      )
      const h3DirectOmniPass = (
        isOmniReference
        && !h3ReferenceSequenceRequested
      )
      const isVideoExtend = (
        state.studioVideoWorkflow === 'extend'
        && !isOmniReference
        && supportsSlidingWindows
      )
      continuationSourceContextFrames = isVideoExtend
        ? Math.max(0, state.slidingWindowOverlap - 1)
        : 0
      const requestedMinimumFrames = Math.max(
        1,
        minimumFrames - continuationSourceContextFrames,
      )
      const selectedWindowFrames = Math.max(
        minimumFrames,
        Math.round(state.slidingWindowSeconds * fps),
      )
      const selectedFirstWindowFrames = Math.max(
        requestedMinimumFrames,
        selectedWindowFrames - continuationSourceContextFrames,
      )
      effectiveH3SequenceClipFrames = maximumFrames
      if (h3ReferenceSequenceRequested && maximumFrames != null) {
        const sequenceBudget = effectiveH3OmniSequenceFrames({
          policy: state.modelOptions?.omni_sequence_memory_policy,
          resolution: String(params.resolution || ''),
          totalVramGb: state.systemStats?.gpu.vram_total_gb ?? 0,
          minimumFrames,
          maximumFrames,
          frameStep: state.modelOptions?.frames_steps ?? 17,
          selectedFrames: Math.round(state.slidingWindowSeconds * fps),
          manualOverride: state.slidingWindowLocked,
        })
        effectiveH3SequenceClipFrames = sequenceBudget.frames
        params.minimax_h3_sequence_clip_frames = effectiveH3SequenceClipFrames
        params.minimax_h3_sequence_memory_override = state.slidingWindowLocked
      } else {
        delete params.minimax_h3_sequence_clip_frames
        delete params.minimax_h3_sequence_memory_override
      }
      let requestedFrames = Math.max(
        requestedMinimumFrames,
        Math.round(state.durationSeconds * fps),
      )
      if (h3DirectOmniPass && maximumFrames != null) {
        // Ordinary Omni generation is one native pass. Duration is the
        // user's requested pass length; Window Length is only the VRAM-aware
        // default. Never silently shorten a visible Duration merely because
        // the saved/automatic window state is smaller.
        requestedFrames = Math.min(maximumFrames, requestedFrames)
      } else if (
        isH3Model
        && !isOmniReference
        && !h3FirstLastMultiWindowRequested
      ) {
        requestedFrames = Math.min(
          requestedFrames,
          selectedFirstWindowFrames,
        )
      } else if (isLtxSequenceModel && !ltxMultiWindowRequested) {
        requestedFrames = Math.min(
          requestedFrames,
          selectedFirstWindowFrames,
        )
      } else if (!supportsSlidingWindows && maximumFrames != null) {
        requestedFrames = Math.min(maximumFrames, requestedFrames)
      } else if (
        supportsSlidingWindows
        && maximumFrames != null
        && requestedFrames + continuationSourceContextFrames <= maximumFrames + 1
      ) {
        requestedFrames = Math.min(
          maximumFrames - continuationSourceContextFrames,
          requestedFrames,
        )
      }
      if (
        isH3Model
        && maximumFrames != null
        && requestedFrames + continuationSourceContextFrames <= maximumFrames + 1
      ) {
        // Uploaded audio/video and old sidecars describe ordinary seconds.
        // Convert values such as 5.0s = 120 frames to H3's first legal clip
        // (124), and do this after all single-pass clamps so an old 5.0s
        // window preference cannot reintroduce the invalid value.
        requestedFrames = normalizeH3ClipFrames(
          requestedFrames + continuationSourceContextFrames,
          minimumFrames,
          maximumFrames,
          state.modelOptions?.frames_steps ?? 17,
        ) - continuationSourceContextFrames
      }
      params.video_length = requestedFrames

      if (supportsSlidingWindows) {
        const swDefaults = state.modelOptions?.sliding_window_defaults
        let windowFrames = h3DirectOmniPass
          ? requestedFrames
          : Math.round(state.slidingWindowSeconds * fps)
        if (swDefaults) {
          const windowMinimum = swDefaults.window_min ?? 1
          const windowMaximum = swDefaults.window_max ?? windowFrames
          const windowStep = Math.max(1, swDefaults.window_step ?? 1)
          windowFrames = windowMinimum
            + Math.round((windowFrames - windowMinimum) / windowStep) * windowStep
          windowFrames = Math.max(
            windowMinimum,
            Math.min(windowMaximum, windowFrames),
          )
        }
        params.sliding_window_size = windowFrames
        params.sliding_window_overlap = _normalizeSlidingWindowOverlap(
          state.slidingWindowOverlap,
          swDefaults,
        )
        params.sliding_window_discard_last_frames = swDefaults?.discard_last_frames ?? 0
        if (isH3Model) {
          const nativeRecommendation = h3DirectOmniPass
            ? recommendedH3PassProfile(
                state.modelOptions?.omni_sequence_memory_policy,
                String(params.resolution || ''),
                state.systemStats?.gpu.vram_total_gb ?? 0,
              )
            : null
          const directOmniDurationOverride = h3DirectOmniPass && (
            state.slidingWindowLocked
            || nativeRecommendation?.supported === false
            || (
              nativeRecommendation?.frames != null
              && requestedFrames > nativeRecommendation.frames
            )
          )
          // Raising the visible one-pass Omni Duration above Auto's
          // recommendation is itself an intentional override. Derive this
          // again at submit time so model switches, loaded sidecars, or a
          // cached UI state cannot lose the user's selection.
          params.sliding_window_memory_override = (
            state.slidingWindowLocked || directOmniDurationOverride
          )
        } else if (state.modelOptions?.sliding_window_memory_policy?.manual_override) {
          params.sliding_window_memory_override = state.slidingWindowLocked
        } else {
          delete params.sliding_window_memory_override
        }
      } else {
        delete params.sliding_window_size
        delete params.sliding_window_overlap
        delete params.sliding_window_discard_last_frames
        delete params.sliding_window_memory_override
      }

      if (
        h3FirstLastMultiWindowRequested
        && params.minimax_h3_window_storyboard === false
        && requestedFrames + continuationSourceContextFrames > Number(params.sliding_window_size || 0)
      ) {
        h3ManualFirstLastPrompts = String(params.prompt || '')
          .replace(/\r\n?/g, '\n')
          .split('\n')
          .map(line => line.trim())
          .filter(Boolean)
        const expectedPromptCount = h3SlidingWindowCount({
          totalFrames: requestedFrames + continuationSourceContextFrames,
          windowFrames: Number(params.sliding_window_size || requestedFrames),
          overlapFrames: Number(params.sliding_window_overlap || 0),
          discardFrames: Number(params.sliding_window_discard_last_frames || 0),
        })
        if (h3ManualFirstLastPrompts.length !== expectedPromptCount) {
          set({
            promptEnhanceError: `Manual First / Last sequence needs exactly ${expectedPromptCount} non-empty prompt ${expectedPromptCount === 1 ? 'line' : 'lines'} (window 1 through window ${expectedPromptCount}); found ${h3ManualFirstLastPrompts.length}.`,
          })
          return
        }
        params.h3_window_prompts = h3ManualFirstLastPrompts
      }

      if (
        ltxMultiWindowRequested
        && params.ltx_window_prompt_mode === 'manual'
        && requestedFrames + continuationSourceContextFrames > Number(params.sliding_window_size || 0)
      ) {
        const ltxManualPrompts = String(params.prompt || '')
          .replace(/\r\n?/g, '\n')
          .split('\n')
          .map(line => line.trim())
          .filter(Boolean)
        const expectedPromptCount = h3SlidingWindowCount({
          totalFrames: requestedFrames,
          windowFrames: Number(params.sliding_window_size || requestedFrames),
          overlapFrames: Number(params.sliding_window_overlap || 0),
          discardFrames: Number(params.sliding_window_discard_last_frames || 0),
        })
        if (ltxManualPrompts.length !== expectedPromptCount) {
          set({
            promptEnhanceError: `Manual LTX sequence needs exactly ${expectedPromptCount} non-empty prompt ${expectedPromptCount === 1 ? 'line' : 'lines'} (window 1 through window ${expectedPromptCount}); found ${ltxManualPrompts.length}.`,
          })
          return
        }
        params.ltx_window_prompts = ltxManualPrompts
      }

      if (
        h3ReferenceSequenceRequested
        && params.minimax_h3_sequence_prompt_mode === 'manual'
        && effectiveH3SequenceClipFrames != null
      ) {
        h3ManualSequencePrompts = String(params.prompt || '')
          .replace(/\r\n?/g, '\n')
          .split('\n')
          .map(line => line.trim())
          .filter(Boolean)
        const nativeContinuation = params.minimax_h3_sequence_continuity !== false
        const expectedPromptCount = h3OmniSequenceWindowCount({
          totalFrames: requestedFrames,
          windowFrames: effectiveH3SequenceClipFrames,
          overlapFrames: Number(params.sliding_window_overlap || 0),
          nativeContinuation,
        })
        if (h3ManualSequencePrompts.length !== expectedPromptCount) {
          const unit = nativeContinuation ? 'window' : 'clip'
          set({
            promptEnhanceError: `Manual Omni sequence needs exactly ${expectedPromptCount} non-empty prompt ${expectedPromptCount === 1 ? 'line' : 'lines'} (${unit} 1 through ${unit} ${expectedPromptCount}); found ${h3ManualSequencePrompts.length}.`,
          })
          return
        }
        params.h3_window_prompts = h3ManualSequencePrompts
      }
    }

    if (isOmniReference) {
      // Ref2VA has its own ordered media manifest. Do not let a saved Frames,
      // Multi-Shot, Extend, or Blend state silently enter those pipelines.
      params.image_mode = 0
      params.image_prompt_type = ''
      delete params.image_start
      delete params.image_end
      delete params.image_refs
      delete params.frames_positions
      delete params.video_source
      const videoPromptType = String(params.video_prompt_type || '').replace(/KFI/g, '')
      if (videoPromptType) params.video_prompt_type = videoPromptType
      else delete params.video_prompt_type
    } else {
      // Keep Omni references in the model's in-memory working set, but do not
      // leak them into unrelated model requests or their saved sidecars.
      delete params.minimax_h3_references
      delete params.minimax_h3_reference_detail
      delete params.minimax_h3_reference_sequence
      delete params.minimax_h3_sequence_continuity
      delete params.minimax_h3_sequence_clip_frames
      delete params.minimax_h3_sequence_memory_override
    }
    if (!isH3Model) {
      delete params.minimax_h3_multi_window
      delete params.minimax_h3_sequence_prompt_mode
    }
    if (!isLtxSequenceModel) {
      delete params.ltx_multi_window
      delete params.ltx_window_prompt_mode
      delete params.ltx_window_prompts
      delete params._ltx_original_prompt
    }
    if (!state.modelOptions?.minimax_h3_text_encoder_choices?.length) {
      delete params.minimax_h3_text_encoder
    }
    if (state.modelOptions?.ltx25_video_vae_choices?.length) {
      const validLtx25VideoVae = state.modelOptions.ltx25_video_vae_choices.some(
        choice => choice.value === params.ltx25_video_vae
      )
      if (!validLtx25VideoVae) {
        params.ltx25_video_vae = (
          state.modelOptions.ltx25_video_vae_default
          || state.modelOptions.ltx25_video_vae_choices[0].value
        )
      }
    } else {
      delete params.ltx25_video_vae
    }
    if (state.modelOptions?.sla_attention) {
      // The fused recipe may request SLA before its first Triton compile.
      // Keep that intent even on unsupported hardware: the backend owns the
      // advertised safe dense fallback and records which path actually ran.
      params.override_attention = (
        params.override_attention === 'sdpa' ? 'sdpa' : 'sla'
      )
    } else if (
      state.modelOptions?.sol_attention
      && state.modelOptions.sol_attention_status?.supported
    ) {
      params.override_attention = params.override_attention === 'sol' ? 'sol' : ''
    } else {
      delete params.override_attention
    }
    if (state.modelOptions?.first_block_cache) {
      const allowedThresholds = (
        state.modelOptions.skip_steps_multiplier_choices || []
      ).map(choice => choice[1])
      const requestedThreshold = Number(
        params.skip_steps_multiplier
        ?? state.modelOptions.default_skip_steps_multiplier
        ?? 0.08
      )
      params.skip_steps_multiplier = allowedThresholds.includes(requestedThreshold)
        ? requestedThreshold
        : (allowedThresholds[0] ?? 0.08)
      params.skip_steps_start_step_perc = Math.max(
        0,
        Math.min(
          100,
          Number(
            params.skip_steps_start_step_perc
            ?? state.modelOptions.default_skip_steps_start_step_perc
            ?? 25
          ),
        ),
      )
      if (params.skip_steps_cache_type !== 'first_block') {
        params.skip_steps_cache_type = ''
      }
    } else {
      delete params.skip_steps_cache_type
      delete params.skip_steps_multiplier
      delete params.skip_steps_start_step_perc
    }

    // STG (Spatio-Temporal Guidance) wiring. The backend only runs STG when
    // perturbation_switch === 2 (skip-self-attention) — stg_scale alone is
    // inert. Derive the switch from the slider so an untouched slider keeps
    // the exact request shape from before this feature existed, and strip
    // all perturbation params for models without the capability so a stale
    // value can't leak across a model switch.
    if (state.modelOptions?.perturbation) {
      const stg = params.stg_scale as number | undefined
      if (stg !== undefined) {
        params.perturbation_switch = stg > 0 ? 2 : 0
      }
    } else {
      delete params.stg_scale
      delete params.perturbation_switch
      delete params.perturbation_layers
      delete params.perturbation_start_perc
      delete params.perturbation_end_perc
    }
    // Reference pipeline is a per-model capability — strip a stale toggle
    // value if the user switched to a model that doesn't support it.
    if (!(state.modelOptions as Record<string, unknown> | null)?.reference_pipeline) {
      delete params.reference_pipeline
    }

    // Tag avatar/edit-mode generations with their sub-mode so the gallery's
    // Edits filter and the loadSettingsFromOutput restore path can identify
    // them. Dedicated edit endpoints tag their jobs on the server; this is
    // retained for compatible generic edit submissions.
    if (state.generationMode === 'avatar' && state.editSubMode) {
      params.edit_sub_mode = state.editSubMode
    }

    // Default I2V / video-source strength. Distilled LTX-2 pipelines produce
    // noticeably better motion when the input anchor is at 0.7 instead of
    // tight-locked 1.0 — matches ComfyUI's reference distilled workflows
    // (stage 1 / single-stage both use 0.7). Dev and other families keep 1.0.
    // User can override via the slider; this only fires when the param isn't
    // already set.
    const _defaultIVS = (() => {
      const mt = (params.model_type as string) || ''
      return mt.includes('distilled') ? 0.7 : 1.0
    })()

    // force_fps="control" models (SCAIL-2 class) generate at the control
    // video's frame rate, but durationSeconds→video_length math uses the
    // model's nominal fps (16). Against a 25fps guide that under-counts
    // frames by a third: a "10s" request would cover only 6.4s of the
    // source performance. When the guide's real fps is known (probed at
    // upload), recompute the frame count at the rate the output will
    // actually play at.
    if (
      state.generationMode === 'video' &&
      params.video_guide &&
      params.force_fps === 'control' &&
      state.guideVideoFps && state.guideVideoFps > 0
    ) {
      // Cap at 30fps to match the server's follow-rate cap — a 60fps
      // guide would double the frame count (and sliding windows) for
      // no visible gain.
      const fpsUsed = Math.min(state.guideVideoFps, 30)
      params.video_length = Math.max(5, Math.round(state.durationSeconds * fpsUsed))
    }
    // Always tell the server what duration the user actually asked for.
    // For control-fps models the server recomputes video_length from
    // this at the guide's REAL frame rate — the durable fix for stale
    // restores (Load Settings from old sidecars carries frame counts
    // computed under the wrong fps) and for sessions where the guide's
    // fps never got probed. Underscore keys ride through harmlessly.
    if (state.generationMode === 'video' && params.video_guide) {
      ;(params as Record<string, unknown>)._duration_seconds = state.durationSeconds
    }

    // Smart multi-line prompt handling for video Frames mode:
    // When there's no sliding window (single window), send all lines as ONE prompt
    // with newlines preserved (LTX uses newlines as temporal markers within the clip).
    // When there IS sliding window, each line becomes a window prompt (mode 1).
    if (state.generationMode === 'video' && (isOmniReference || state.params.image_mode !== 2)) {
      const prompt = (params.prompt as string) || ''
      const h3WindowPromptRoutingEnabled = !isH3Model || (
        isOmniReference
          ? params.minimax_h3_reference_sequence === true
          : params.minimax_h3_multi_window === true
      )
      const ltxWindowPromptRoutingEnabled = (
        !isLtxSequenceModel
        || params.ltx_multi_window === true
      )
      const hasSlidingWindow = state.modelOptions?.sliding_window === true
        && h3WindowPromptRoutingEnabled
        && ltxWindowPromptRoutingEnabled
        && Number(params.video_length || 0) + continuationSourceContextFrames
          > Number(params.sliding_window_size || 0)
      if (
        hasSlidingWindow
        && (
          state.modelOptions?.sliding_window_auto_prompt_pacing === true
          || (
            isLtxSequenceModel
            && params.ltx_window_prompt_mode !== 'manual'
          )
        )
      ) {
        // Auto planners receive one complete story idea. The backend then
        // compiles exact H3 Context-IR or LTX prose for each native pass.
        params.multi_prompts_gen_type = 2
      } else if (hasSlidingWindow && prompt.includes('\n')) {
        // Sliding window: each line = one window prompt (rolling generation)
        params.multi_prompts_gen_type = 1
      } else if (!hasSlidingWindow && prompt.includes('\n')) {
        // No sliding window — send entire prompt as one (multi_prompts_gen_type=2 preserves newlines)
        params.multi_prompts_gen_type = 2
      }
    }

    // Post-processing settings
    if (state.spatialUpsampling) params.spatial_upsampling = state.spatialUpsampling
    if (state.sharpenAmount > 0) params.sharpen_amount = state.sharpenAmount
    if (state.filmGrainIntensity > 0) {
      params.film_grain_intensity = state.filmGrainIntensity
      params.film_grain_saturation = state.filmGrainSaturation
    }
    // Voice clone (SeedVC) — only send if the user explicitly enabled
    // it AND provided at least one reference. Backend defaults all three
    // params to falsy if absent (postprocessing step is a no-op).
    if (state.voiceCloneEnabled && state.voiceCloneRefs.length > 0) {
      const validRefs = state.voiceCloneRefs.filter(r => r && r.path)
      if (validRefs.length > 0) {
        params.voice_clone_enabled = true
        params.voice_clone_mode = state.voiceCloneMode
        // Pass server-side paths (already uploaded via /api/v1/upload-audio).
        params.voice_clone_refs = validRefs.map(r => r.path)
      }
    }

    // Image mode: force single frame + image output format
    // Backend uses image_mode > 0 to determine output as image (.jpg) vs video (.mp4)
    if (state.generationMode === 'image') {
      params.video_length = 1
      const workflow = state.studioImageWorkflow === 'upscale'
        ? 'generate'
        : state.studioImageWorkflow
      params._studio_image_workflow = workflow
      params.image_mode = workflow === 'inpaint' || workflow === 'outpaint' ? 2 : 1

      if (workflow === 'inpaint' || workflow === 'outpaint') {
        params.image_guide = state.imageWorkflowSourcePath
        params.image_mask = workflow === 'inpaint'
          ? state.imageWorkflowMaskPath
          : undefined
        params.video_prompt_type = state.modelOptions?.inpaint_video_prompt_type || 'VAG'
        params.video_guide_outpainting = workflow === 'outpaint'
          ? [
              state.imageOutpaintPadding.top,
              state.imageOutpaintPadding.bottom,
              state.imageOutpaintPadding.left,
              state.imageOutpaintPadding.right,
            ].join(' ')
          : ''
        delete params.image_refs
        params.remove_background_images_ref = 0
      } else {
        delete params.image_guide
        delete params.image_mask
        delete params.video_guide_outpainting
        if (workflow === 'generate' && state.imageRefs.length === 0) {
          delete params.image_refs
          params.remove_background_images_ref = 0
          params.video_prompt_type = ''
        }
      }
    }

    // Audio mode: branch by sub-mode (Speech/Music vs SFX)
    if (state.generationMode === 'audio') {
      // Record the active sub-tab in the request so it lands in the
      // .meta.json sidecar — Load Settings uses it to restore Speech /
      // Music / SFX, not just the Audio tab. Underscore keys ride
      // through generation untouched, same as _tts_*. Music also saves
      // its song-writer inputs (UI-only, not consumed by generation).
      params._audio_sub_mode = state.audioSubMode
      if (state.audioSubMode === 'music') {
        params._music_description = state.musicDescription || ''
        params._music_instrumental = !!state.musicInstrumental
      }
      if (state.audioSubMode === 'sfx') {
        // SFX mode: use MMAudio to generate sound effects
        // MMAudio runs as post-processing on a video model, so use a video model as carrier
        const sfxModel = params.model_type as string
        const isSfxVirtual = sfxModel.startsWith('mmaudio_')
        if (isSfxVirtual) {
          // Swap virtual MMAudio model for a real video model; backend uses MMAudio params
          params.model_type = 'ltx2_22B_distilled_1_1'
          // Keep the virtual id so Load Settings can restore the SFX tab's
          // model selection (the sidecar otherwise records only the carrier).
          params._sfx_virtual_model = sfxModel
        }
        params.MMAudio_setting = 1
        // Always set MMAudio variant explicitly so backend doesn't fall back to server config
        params._mmaudio_variant = sfxModel === 'mmaudio_nsfw' ? 'nsfw' : 'v2'
        // Copy MMAudio prompt into main prompt field (for API validation & metadata)
        if (!params.prompt && params.MMAudio_prompt) {
          params.prompt = params.MMAudio_prompt
        }
        params.sfx_mode = true
        params.duration_seconds = state.durationSeconds
        // Generate a minimal video if no video_guide uploaded (1 frame), then run MMAudio
        if (!params.video_guide) {
          params.video_length = 17  // Minimum viable video for MMAudio (~1s)
          params.num_inference_steps = 4
        } else {
          params.video_length = 0  // No video gen needed — just run MMAudio on uploaded video
        }
        params.image_mode = 0
        // Clear video-specific params
        delete params.sliding_window_size
        delete params.sliding_window_overlap
        delete params.sliding_window_discard_last_frames
      } else {
        // Speech/Music TTS mode
        params.video_length = 0
        params.image_mode = 0
        params.multi_prompts_gen_type = 2  // Preserve full text as one prompt (don't split by newlines)
        // Save original prompt + speaker names before swap (for load settings)
        params._tts_original_prompt = params.prompt
        params._tts_speaker_name1 = state.ttsSpeakerName1 || ''
        params._tts_speaker_name2 = state.ttsSpeakerName2 || ''
        // Save all voice names for metadata
        for (let i = 0; i < state.ttsVoices.length; i++) {
          (params as Record<string, unknown>)[`_tts_speaker_name${i + 1}`] = state.ttsVoices[i]?.name || ''
        }
        params._tts_voice_count = state.ttsVoiceCount
        // Swap character names → Speaker N: for TTS multi-voice mode
        const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        let text = params.prompt as string
        for (let i = 0; i < state.ttsVoices.length; i++) {
          const name = state.ttsVoices[i]?.name
          if (name) {
            text = text.replace(new RegExp(escapeRegex(name) + '\\s*:', 'gi'), `Speaker ${i + 1}:`)
          }
        }
        params.prompt = text
        // Set audio_guide paths for each voice (audio_guide, audio_guide2, audio_guide3, etc.)
        for (let i = 0; i < state.ttsVoices.length; i++) {
          const voice = state.ttsVoices[i]
          if (voice?.path) {
            const key = i === 0 ? 'audio_guide' : `audio_guide${i + 1}`
            params[key as keyof typeof params] = voice.path as never
          }
        }
        // TTS duration (max duration for the model to generate)
        if (state.modelOptions?.audio_only) {
          // Prefer the slider's `default` (some TTS models — e.g. DramaBox —
          // set default=0 to mean "auto-derive duration from prompt"); fall
          // back to `max` then 600.
          const ds = state.modelOptions.duration_slider
          const sliderDefault = ds?.default ?? ds?.max ?? 600
          params.duration_seconds = state.durationSeconds < 30 ? sliderDefault : state.durationSeconds
        }
        // Let the TTS model use its own defaults for steps/guidance if ours are video defaults
        if ((params.num_inference_steps as number) > 0 && state.modelOptions?.default_num_inference_steps == null) {
          params.num_inference_steps = 0
        }
        // Clear video-specific params
        delete params.sliding_window_size
        delete params.sliding_window_overlap
        delete params.sliding_window_discard_last_frames
      }
    }

    // Defensive cleanup: strip stale "V" (Source Video / extend) flag from
    // image_prompt_type when we're NOT entering the extend/continue path.
    //
    // The leak: when the user does a video extend (image_mode=3 +
    // continueVideoPath) and submits, the continue-mode branch below sets
    // params.image_prompt_type = "V". That mutation is on the local params
    // copy and shouldn't persist, BUT load-settings (loadSettingsFromOutput
    // at line 5284) DOES restore image_prompt_type from sidecar metadata
    // into state.params.image_prompt_type. So after extending a video and
    // then switching back to Frames mode via ModeToggle (which only flips
    // image_mode 3 -> 0, leaving image_prompt_type untouched), the next
    // generation carries forward image_prompt_type="V" from state.
    //
    // The single-clip and end-image handlers below only APPEND flags
    // (e.g. "S" + "V" -> "SV"), they never strip stale ones. So the "V"
    // survives, the backend (wgp.py:941-943) sees it and demands
    // video_source — but the user is in Frames mode with no source video.
    //
    // Symptom user reported: "I did a video extend and it worked. then I
    // switched to normal video mode and it keeps telling me to load a
    // source video. even after I refresh the page and try a new generation."
    //
    // Fix: strip "V" up-front unless we're going to re-add it in the
    // continue/extend branch below. The continue branch (image_mode === 3
    // + continueVideoPath) re-sets image_prompt_type = "V" wholesale, so
    // stripping here is safe — that branch puts it back.
    const willEnterContinueBranch = state.generationMode === 'video'
      && (params.image_mode === 3 || state.params.image_mode === 3)
      && !!state.continueVideoPath
    if (!willEnterContinueBranch) {
      const ipt = (params.image_prompt_type as string) || ''
      if (ipt.includes('V')) {
        params.image_prompt_type = ipt.replace(/V/g, '')
      }
      // Same stale-flag defense for the "T" temporal-alignment flag the
      // continue branch adds to video_prompt_type (see below). Without a
      // source video it's a backend no-op (alignment shift = 0 frames),
      // but stripping keeps restored-from-sidecar state from carrying it
      // into unrelated generations. Only the TRAILING "T" is that flag — an
      // internal "T" is the depth_temporal control letter (PTVG/TVG/TEVG),
      // and a global strip turned "Motion + Temporal Depth" (PTVG) into plain
      // "Transfer Human Motion" (PVG) at submit time, so use /T$/.
      const vptClean = (params.video_prompt_type as string) || ''
      if (vptClean.endsWith('T')) {
        params.video_prompt_type = vptClean.replace(/T$/, '')
      }
    }

    // Multi-clip path
    if (
      state.generationMode === 'video'
      && !isOmniReference
      && state.params.image_mode === 2
    ) {
      const clips = state.clips
      const imagePaths: string[] = []
      const endImagePaths: string[] = []
      let hasAnyEndImage = false

      for (const clip of clips) {
        if (clip.startImage) {
          try {
            const result = await api.uploadImage(clip.startImage)
            imagePaths.push(result.path)
          } catch (e) {
            console.error('Failed to upload clip image:', e)
            imagePaths.push('')
          }
        } else if (clip.startImagePath) {
          imagePaths.push(clip.startImagePath)
        } else {
          imagePaths.push('')
        }

        // Upload end images (seamless mode)
        if (clip.endImage) {
          try {
            const result = await api.uploadImage(clip.endImage)
            endImagePaths.push(result.path)
            hasAnyEndImage = true
          } catch (e) {
            console.error('Failed to upload clip end image:', e)
            endImagePaths.push('')
          }
        } else if (clip.endImagePath) {
          endImagePaths.push(clip.endImagePath)
          hasAnyEndImage = true
        } else {
          endImagePaths.push('')
        }
      }

      let promptLines: string[]
      if (state.singlePromptMode) {
        const p: string = clips[0]?.prompt || (params.prompt as string) || ''
        promptLines = clips.map(() => p)
      } else {
        promptLines = clips.map(c => c.prompt || '')
      }

      params.prompt = promptLines.join('\n')
      params.image_start = imagePaths
      if (hasAnyEndImage) {
        params.image_end = endImagePaths
      }
      params.multi_prompts_gen_type = 3
      params.image_mode = 0
      params.image_prompt_type = hasAnyEndImage ? 'SE' : 'S'
      if (params.input_video_strength == null) params.input_video_strength = _defaultIVS
    }
    // Single I2V path: Upload images if present (new File upload takes priority)
    // Skip in image mode — startImage is for video I2V, not image generation
    else if (!isOmniReference && useStudioFrameInputs && state.startImage && state.generationMode !== 'image') {
      try {
        const result = await api.uploadImage(state.startImage)
        params.image_start = result.path
        params.image_mode = 0
        const ipt = (params.image_prompt_type as string) || ''
        if (!ipt.includes('S')) params.image_prompt_type = 'S' + ipt
        if (params.input_video_strength == null) params.input_video_strength = _defaultIVS
      } catch (e) {
        console.error('Failed to upload start image:', e)
      }
    } else if (!isOmniReference && useStudioFrameInputs && params.image_start && state.generationMode !== 'image') {
      // Re-roll case: image_start is already an absolute path from sidecar metadata
      params.image_mode = 0
      const ipt = (params.image_prompt_type as string) || ''
      if (!ipt.includes('S')) params.image_prompt_type = 'S' + ipt
      if (params.input_video_strength == null) params.input_video_strength = _defaultIVS
    }
    if (!isOmniReference && useStudioFrameInputs && state.endImage) {
      try {
        const result = await api.uploadImage(state.endImage)
        params.image_end = result.path
        const ipt = (params.image_prompt_type as string) || ''
        if (!ipt.includes('E')) params.image_prompt_type = ipt + 'E'
      } catch (e) {
        console.error('Failed to upload end image:', e)
      }
    } else if (!isOmniReference && useStudioFrameInputs && params.image_end) {
      const ipt = (params.image_prompt_type as string) || ''
      if (!ipt.includes('E')) params.image_prompt_type = ipt + 'E'
    }

    // Continue mode: set video_source and image_prompt_type="V"
    if (!isOmniReference && state.generationMode === 'video' && params.image_mode === 3 && state.continueVideoPath) {
      params.video_source = state.continueVideoPath
      params.image_prompt_type = 'V'
      params.image_mode = 0
      if (params.input_video_strength == null) params.input_video_strength = _defaultIVS
      // Temporal alignment: the UI scopes EVERYTHING to the new content —
      // durationSeconds is the extend length, and ControlVideoSection's
      // injected-frame positions are computed against that timeline. The
      // backend, however, defaults to interpreting frames_positions (and
      // control video / control audio alignment) against the FULL timeline
      // including the source clip (wgp.py: reset_control_aligment = "T" in
      // video_prompt_type; alignment_shift = source frames only when "T").
      // Without "T", a frame injected at "end of the new 20s" of a 10s clip
      // lands at the 20s mark of the 30s output — 10s early; on longer
      // sources the position can fall entirely INSIDE the source span and
      // visibly never happen. "T" = upstream's "Aligned to the beginning of
      // the First Window of the new Video Sample", which matches the UI.
      // Append the alignment flag as a TRAILING "T". Guard on endsWith, not
      // includes: a control value with an internal "T" is depth_temporal
      // (PTVG/TVG/TEVG), and an includes() guard would skip the append for
      // those — silently dropping temporal alignment on an extend that uses a
      // Temporal-Depth control video. endsWith adds the flag while leaving the
      // process letter intact; the display/persist/submit strips remove only
      // this trailing "T" again.
      const vptExtend = (params.video_prompt_type as string) || ''
      if (!vptExtend.endsWith('T')) {
        params.video_prompt_type = vptExtend + 'T'
      }
      // Duration is the amount of NEW content requested by the user. The
      // backend adds the source-tail overlap only to the model's first pass;
      // it is conditioning context and must not be subtracted here. If that
      // context pushes the request beyond one safe H3 pass, native sliding
      // windows are the correct behavior and preserve the requested length.
    }

    // Safety net: Studio Video mode ALWAYS produces video. The sub-mode
    // branches above translate image_mode 2/3 (Multi-Shot/Extend) to 0 + other
    // flags, but a plain T2V gen (no start image) hits none of them — so a
    // stale non-zero image_mode (e.g. an I2V clip's settings loaded via the
    // pencil, or Extend mode left without a source video) would leak through
    // and the backend (is_image = image_mode > 0) would emit a single PNG
    // instead of a video. Force video output here, after the sub-mode branches
    // have already read image_mode.
    if (state.generationMode === 'video') {
      params.image_mode = 0
    }

    // Image references (from ImageRefSection)
    const imageReferenceWorkflowActive = (
      state.generationMode !== 'video'
      || useStudioFrameInputs
    ) && (
      state.generationMode !== 'image'
      || state.studioImageWorkflow === 'generate'
    )
    const imageReferenceChoices = state.modelOptions?.image_ref_choices?.choices ?? []
    const effectiveImageRefType = state.imageRefType || (
      imageReferenceChoices.some(([, value]) => value.includes('K'))
        ? 'KI'
        : imageReferenceChoices.some(([, value]) => value === 'I')
          ? 'I'
          : imageReferenceChoices[0]?.[1] || ''
    )
    if (imageReferenceWorkflowActive && effectiveImageRefType && state.imageRefs.length > 0) {
      const refPaths: string[] = []
      for (const file of state.imageRefs) {
        try {
          const result = await api.uploadImage(file)
          refPaths.push(result.path)
        } catch (e) {
          console.error('Failed to upload reference image:', e)
        }
      }
      if (refPaths.length > 0) {
        params.image_refs = refPaths
        params.remove_background_images_ref = state.removeBackgroundRefs ? 1 : 0
        // Merge image ref letter codes into video_prompt_type
        let vpt = (params.video_prompt_type as string) || ''
        for (const letter of effectiveImageRefType) {
          if (!vpt.includes(letter)) vpt += letter
        }
        params.video_prompt_type = vpt
      }
    } else if (useStudioFrameInputs && params.image_refs && (params.image_refs as string[]).length > 0) {
      // Re-roll case: image_refs already populated from sidecar metadata
      params.remove_background_images_ref = params.remove_background_images_ref ?? 0
    } else {
      // No reference images attached for this submission. Strip any
      // image-ref letter codes from video_prompt_type that may have
      // persisted from an earlier task — without this, a user who
      // generates with refs once and then clears them gets stuck with
      // "I" (or other ref-letter codes) baked into the saved per-mode
      // params snapshot, which the backend rejects with "You must
      // provide at least one Reference Image". The backend has a
      // safety net that catches this too, but cleaning at the source
      // keeps the snapshot itself sensible.
      const vpt = (params.video_prompt_type as string) || ''
      if (vpt) {
        // Default ref letters used by Maestro when image refs are
        // present. If imageRefType is configured we trust that;
        // otherwise fall back to the conservative "I" — the most common
        // and the one we've actually observed leaking.
        const refLetters = state.imageRefType || 'I'
        let cleaned = vpt
        for (const letter of refLetters) {
          cleaned = cleaned.split(letter).join('')
        }
        if (cleaned !== vpt) {
          params.video_prompt_type = cleaned
        }
      }
      // Make sure no stale image_refs path list rides along either.
      if (params.image_refs !== undefined && (!params.image_refs || (params.image_refs as string[]).length === 0)) {
        delete params.image_refs
      }
    }

    // Optional LTX ID-LoRA voice reference. H3 Omni audio references use
    // their native References manifest and must never leak through here.
    const selectedStudioModel = state.models.find(
      model => model.model_type === state.params.model_type,
    )
    const useLtxVoiceReference = useStudioFrameInputs
      && state.studioVideoWorkflow === 'frames'
      && _isStudioLtxVideoModel(selectedStudioModel)
      && state.servicesConfig?.voice_reference_enabled === true
    if (useLtxVoiceReference && state.directorVoiceRef) {
      let vrPath = state.directorVoiceRefPath
      if (!vrPath) {
        try {
          const uploaded = await api.uploadAudio(state.directorVoiceRef)
          vrPath = uploaded.path
          set({ directorVoiceRefPath: vrPath })
        } catch { /* skip */ }
      }
      if (vrPath) {
        params.voice_reference = vrPath
        params.identity_guidance_scale = state.directorIdentityGuidanceScale
      }
    } else {
      delete params.voice_reference
      delete params.identity_guidance_scale
    }

    if (deferAutoEnhance) {
      // Deferred H3 enhancement replaces this one-line idea with one
      // multiline Context-IR document. Mark it atomic before submission too;
      // the backend repeats this normalization after enhancement for cached
      // web assets and direct API callers.
      if (isH3Model && !usesMultiplePasses) {
        params.multi_prompts_gen_type = 2
      }
      let deferredImagePaths: string[] = []
      let deferredReferenceContext: string | undefined
      if (isOmniReference) {
        const inventory = _omniEnhanceInventory(
          (params.minimax_h3_references as MiniMaxH3Reference[] | undefined) ?? [],
        )
        deferredImagePaths = inventory.imagePaths
        deferredReferenceContext = inventory.referenceContext
      } else {
        const appendPaths = (value: unknown) => {
          if (typeof value === 'string' && value.trim()) deferredImagePaths.push(value)
          else if (Array.isArray(value)) {
            deferredImagePaths.push(...value.filter(
              (item): item is string => typeof item === 'string' && Boolean(item.trim()),
            ))
          }
        }
        appendPaths(params.image_start)

        if (isH3Model) {
          const hasStart = deferredImagePaths.length > 0
          const beforeEnd = deferredImagePaths.length
          appendPaths(params.image_end)
          const hasEnd = deferredImagePaths.length > beforeEnd
          const injectedPositions = String(params.frames_positions || '')
            .split(/[\s,]+/)
            .filter(Boolean)
          const injectedPaths = (
            String(params.video_prompt_type || '').includes('KFI')
            && Array.isArray(params.image_refs)
          ) ? (params.image_refs as unknown[])
              .map((path, index) => ({
                path: typeof path === 'string' ? path : '',
                position: injectedPositions[index] || '',
              }))
              .filter(item => Boolean(item.path && item.position))
            : []
          deferredImagePaths.push(...injectedPaths.map(item => item.path))

          let pictureIndex = 0
          const alignmentLines: string[] = []
          const fps = state.modelOptions?.fps ?? 24
          const duration = Number(params.video_length || 0) / fps
          if (hasStart) {
            alignmentLines.push(`For the target video, at 0.00 seconds into the target video, <Picture ${++pictureIndex}> (from [Shot 1]) is fully referenced.`)
          }
          if (hasEnd) {
            alignmentLines.push(`At ${duration.toFixed(2)} seconds, <Picture ${++pictureIndex}> is the required final-frame destination.`)
          }
          for (const keyframe of injectedPaths) {
            const match = /^W1:(\d{1,3})$/i.exec(keyframe.position)
            let localSeconds: number | null = null
            if (match) localSeconds = duration * Math.min(100, Number(match[1])) / 100
            else if (/^\d+$/.test(keyframe.position)) localSeconds = Math.max(0, Number(keyframe.position) - 1) / fps
            else if (/^l$/i.test(keyframe.position)) localSeconds = duration
            const timing = localSeconds == null
              ? `at timeline position ${keyframe.position}`
              : `at ${localSeconds.toFixed(2)} seconds into the target video`
            alignmentLines.push(`${timing}, <Picture ${++pictureIndex}> is fully referenced as an exact injected frame; reach it naturally and continue from it.`)
          }
          deferredReferenceContext = alignmentLines.join('\n') || undefined
        }
      }

      params._deferred_prompt_enhance = {
        prompt: String(params.prompt || ''),
        mode: state.generationMode,
        model_type: String(params.model_type || ''),
        image_paths: deferredImagePaths.length > 0 ? deferredImagePaths : undefined,
        duration_seconds: state.durationSeconds,
        window_count: 1,
        window_size_seconds: state.slidingWindowSeconds,
        activated_loras: Array.isArray(params.activated_loras) && params.activated_loras.length > 0
          ? params.activated_loras
          : undefined,
        reference_context: deferredReferenceContext,
      }
    }

    const continuationRuntimeFrames = (
      Number(params.video_length || 0) + continuationSourceContextFrames
    )
    const h3WindowStoryboardActive = (
      state.generationMode === 'video'
      && state.modelOptions?.sliding_window_auto_prompt_pacing === true
      && params.minimax_h3_multi_window === true
      && params.minimax_h3_window_storyboard !== false
      && state.params.image_mode !== 2
      && continuationRuntimeFrames > Number(params.sliding_window_size || 0)
    )
    const h3ReferenceSequenceActive = (
      state.generationMode === 'video'
      && isOmniReference
      && params.minimax_h3_reference_sequence === true
      && Number(params.video_length || 0) > Number(
        effectiveH3SequenceClipFrames
        || state.modelOptions?.frames_maximum
        || 0,
      )
    )
    const h3ManualReferenceSequence = (
      state.generationMode === 'video'
      && isOmniReference
      && params.minimax_h3_reference_sequence === true
      && params.minimax_h3_sequence_prompt_mode === 'manual'
    )
    const h3ManualFirstLastSequence = (
      state.generationMode === 'video'
      && isH3Model
      && !isOmniReference
      && params.minimax_h3_multi_window === true
      && params.minimax_h3_window_storyboard === false
      && continuationRuntimeFrames > Number(params.sliding_window_size || 0)
    )
    const ltxWindowSequenceActive = (
      state.generationMode === 'video'
      && isLtxSequenceModel
      && params.ltx_multi_window === true
      && continuationRuntimeFrames > Number(params.sliding_window_size || 0)
    )
    const ltxAutoPlanActive = (
      ltxWindowSequenceActive
      && params.ltx_window_prompt_mode !== 'manual'
    )
    const h3PlanActive = h3WindowStoryboardActive || (
      h3ReferenceSequenceActive && !h3ManualReferenceSequence
    )
    if (h3ManualFirstLastSequence) {
      params.minimax_h3_window_storyboard = false
      params.h3_window_prompts = h3ManualFirstLastPrompts ?? []
      delete params.h3_window_plan_signature
      delete params.h3_window_plan
    } else if (h3ManualReferenceSequence) {
      delete params.minimax_h3_window_storyboard
      params.h3_window_prompts = h3ManualSequencePrompts ?? []
      delete params.h3_window_plan_signature
      delete params.h3_window_plan
    } else if (state.modelOptions?.sliding_window_auto_prompt_pacing === true) {
      params.minimax_h3_window_storyboard = h3WindowStoryboardActive
      if (h3WindowStoryboardActive && state.h3WindowPlan) {
        params.h3_window_prompts = state.h3WindowPlan.windows.map(window => window.prompt)
        params.h3_window_plan_signature = state.h3WindowPlan.signature
        params.h3_window_plan = state.h3WindowPlan
        params._h3_window_plan_reviewed = true
      } else {
        delete params.h3_window_prompts
        delete params.h3_window_plan_signature
        delete params.h3_window_plan
      }
    } else if (h3ReferenceSequenceActive) {
      delete params.minimax_h3_window_storyboard
      if (state.h3WindowPlan?.plan_kind === 'reference_sequence') {
        params.h3_window_prompts = state.h3WindowPlan.windows.map(window => window.prompt)
        params.h3_window_plan_signature = state.h3WindowPlan.signature
        params.h3_window_plan = state.h3WindowPlan
        params._h3_window_plan_reviewed = true
      } else {
        delete params.h3_window_prompts
        delete params.h3_window_plan_signature
        delete params.h3_window_plan
      }
    } else {
      delete params.minimax_h3_window_storyboard
      delete params.h3_window_prompts
      delete params.h3_window_plan_signature
      delete params.h3_window_plan
    }

    if (prepareReview) {
      const token = reviewToken
      if (token !== dependencies.getReviewToken()) return
      params._review_ui = {
        generationMode: state.generationMode, studioVideoWorkflow: state.studioVideoWorkflow,
        studioVideoEffectiveCreateRoute: state.studioVideoEffectiveCreateRoute,
        studioImageWorkflow: state.studioImageWorkflow, resolutionPreset: state.resolutionPreset,
        aspectRatio: state.aspectRatio, durationSeconds: state.durationSeconds,
        slidingWindowSeconds: state.slidingWindowSeconds, slidingWindowOverlap: state.slidingWindowOverlap,
        outputCount: state.outputCount, modelOptions: state.modelOptions,
      }
      params._review_original_prompt = state.params._h3_original_prompt || state.params._ltx_original_prompt || state.params.prompt
      const created = await api.prepareGenerationReview(params)
      if (token !== dependencies.getReviewToken()) return
      localStorage.setItem('cue-studio-pending-generation-review', created.id)
      let resolved = created
      while (resolved.status === 'planning') {
        await new Promise(resolve => setTimeout(resolve, 1000))
        resolved = await api.fetchGenerationReview(created.id)
        if (token !== dependencies.getReviewToken()) return
      }
      if (resolved.status !== 'ready' || !resolved.prepared) {
        throw new Error(resolved.error || 'Generation plan is not ready')
      }
      dependencies.setReviewSnapshot(state)
      set({ reviewPlan: resolvedGenerationPlan(state, { id: resolved.id, prepared: resolved.prepared }) })
      return
    }

    const clientSubmissionId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const pendingJobId = `pending-${clientSubmissionId}`
    params._client_submission_id = clientSubmissionId
    const newJob: GenerationJob = {
      id: pendingJobId,
      showInGallery: !holdForQueue,
      status: holdForQueue ? 'held' : 'queued',
      progress: 0,
      step: 0,
      totalSteps: 0,
      phase: '',
      message: holdForQueue
        ? 'Preparing queue entry...'
        : h3PlanActive
        ? `Planning H3 ${h3ReferenceSequenceActive ? 'reference sequence' : 'windows'}...`
        : ltxAutoPlanActive
          ? 'Planning LTX windows...'
        : h3ManualReferenceSequence
          ? 'Preparing H3 manual sequence...'
          : 'Submitting...',
      outputFiles: [],
      error: null,
      oomInfo: null,
    }

    set(s => ({
      isGenerating: holdForQueue ? s.isGenerating : true,
      jobs: [newJob, ...s.jobs],
    }))

    try {
      const {
        job_id,
        status: submittedStatus,
        h3_window_plan,
        ltx_window_plan,
      } = await api.submitGeneration(params, holdForQueue)

      if (h3_window_plan) {
        const planFps = state.modelOptions?.fps ?? 24
        const effectiveWindowFrames = h3_window_plan.effective_window_frames
          || h3_window_plan.window_frames
        if (h3_window_plan.plan_kind === 'reference_sequence') {
          set(s => ({
            h3WindowPlan: h3_window_plan,
            slidingWindowSeconds: effectiveWindowFrames / planFps,
            params: {
              ...s.params,
              minimax_h3_sequence_clip_frames: effectiveWindowFrames,
            },
          }))
        } else {
          set(s => ({
            h3WindowPlan: h3_window_plan,
            slidingWindowSeconds: effectiveWindowFrames / planFps,
            params: { ...s.params, sliding_window_size: effectiveWindowFrames },
          }))
        }
      }
      if (ltx_window_plan) {
        const isManualPlan = ltx_window_plan.planned_by === 'manual'
        set(s => ({
          params: {
            ...s.params,
            prompt: ltx_window_plan.window_prompts.join('\n'),
            ltx_window_prompts: ltx_window_plan.window_prompts,
            _ltx_original_prompt: isManualPlan
              ? undefined
              : ltx_window_plan.source_prompt,
          },
        }))
      }

      // Update the job with its server-assigned ID
      set(s => ({
        jobs: s.jobs.map(j => j.id === pendingJobId ? {
          ...j,
          id: job_id,
          status: submittedStatus,
          message: submittedStatus === 'held'
            ? (deferAutoEnhance || h3PlanActive || ltxAutoPlanActive
                ? 'Ready - AI planning will run when queue starts'
                : 'Ready - waiting for Start Queue')
            : (h3PlanActive || ltxAutoPlanActive
                ? 'Queued - AI planning waits for generation resources'
                : 'Queued...'),
          h3WindowPlan: h3_window_plan ?? null,
        } : j),
      }))

      // Poll for status on this specific job
      const pollInterval = setInterval(async () => {
        // Check if this job was removed (stopped)
        if (!get().jobs.find(j => j.id === job_id)) {
          clearInterval(pollInterval)
          return
        }

        try {
          const status = await api.fetchJobStatus(job_id)

          set(s => ({
            jobs: s.jobs.map(j => j.id !== job_id ? j : {
              ...j,
              status: status.status,
              progress: status.progress / 100,
              step: status.step,
              totalSteps: status.total_steps,
              phase: status.phase,
              message: status.message,
              outputFiles: status.output_files,
              error: status.error,
              oomInfo: status.oom_info ?? null,
              h3WindowPlan: status.h3_window_plan ?? j.h3WindowPlan ?? null,
              ..._adaptiveEtaJobFields(status),
            }),
          }))

          // Refresh gallery during generation to show sliding window progress
          if (status.status === 'running') {
            get().refreshOutputs()
          }

          if (status.status === 'completed') {
            clearInterval(pollInterval)
            // Completed job — remove the placeholder, real output now in gallery
            set(s => {
              const remaining = s.jobs.filter(j => j.id !== job_id)
              return {
                jobs: remaining,
                isGenerating: remaining.some(j => j.status === 'running' || j.status === 'queued'),
              }
            })
            get().loadOutputs()
          } else if (status.status === 'failed' || status.status === 'cancelled') {
            clearInterval(pollInterval)
            // Keep the failed/cancelled job in the queue so its placeholder
            // card stays visible with the error message. User dismisses via
            // the X button on the tile.
            set(s => ({
              isGenerating: s.jobs.some(j => j.id !== job_id && (j.status === 'running' || j.status === 'queued')),
            }))
          }
        } catch (e) {
          console.error('Status poll error:', e)
        }
      }, 2000)

    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Generation failed'
      // A mobile connection can drop after the backend accepted
      // the request but before fetch receives its small JSON response. Recover
      // that exact job by the browser-generated submission ID instead of
      // showing a false failure while the real generation continues.
      set(s => ({
        jobs: s.jobs.map(job => job.id === pendingJobId ? {
          ...job,
          message: 'Connection interrupted - checking whether Maestro accepted the job...',
        } : job),
      }))
      for (const delayMs of [0, 400, 800, 1600]) {
        if (delayMs > 0) {
          await new Promise(resolve => window.setTimeout(resolve, delayMs))
        }
        try {
          const active = await api.fetchActiveJobs()
          const accepted = active.jobs.find(job => (
            job.client_submission_id === clientSubmissionId
          ))
          if (accepted) {
            set(s => ({
              jobs: s.jobs.filter(job => job.id !== pendingJobId),
            }))
            await get().reconnectJobs()
            return
          }
        } catch { /* retry transient browser disconnects */ }
      }
      // Submit itself failed (pre-queue). Convert the placeholder to a failed
      // state in place so the user sees what happened, rather than making the
      // tile disappear and leaving them to wonder.
      set(s => ({
        jobs: s.jobs.map(j => j.id === pendingJobId ? { ...j, status: 'failed', message: msg, error: msg } : j),
        isGenerating: s.jobs.some(j => j.id !== pendingJobId && (j.status === 'running' || j.status === 'queued')),
      }))
    }
  },

  }
}
