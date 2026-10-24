import type { StateCreator } from 'zustand'
import type { AspectRatio, ResolutionPreset } from '../types'
import * as api from '../api/client'
import type { AppState, StudioModeDependencies } from './useStore'

export type StudioModeSlice = Pick<AppState,
  "generationMode" |
  "studioVideoCreateRoute" |
  "studioVideoEffectiveCreateRoute" |
  "studioVideoModelPerCreateRoute" |
  "studioVideoRouteNotice" |
  "setStudioVideoCreateRoute" |
  "reconcileStudioVideoCreateRoute" |
  "undoStudioVideoRoute" |
  "clearStudioVideoRouteNotice" |
  "selectStudioVideoModel" |
  "editSubMode" |
  "setEditSubMode" |
  "editVideoPath" |
  "editVideoUrl" |
  "editVideoFile" |
  "editVideoDuration" |
  "editVideoResolution" |
  "editStartTime" |
  "editEndTime" |
  "editRetakeStrength" |
  "editPromptStrength" |
  "editAnythingLoraStrength" |
  "editAnythingStartAnchor" |
  "editAnythingEndAnchor" |
  "editRepaintFrameFile" |
  "editRepaintFramePath" |
  "editRepaintFrameUrl" |
  "editRepaintMappings" |
  "editRepaintResolutionProfile" |
  "setEditRepaintFrame" |
  "setEditRepaintMappings" |
  "editRecastTarget" |
  "editRecastPersonCount" |
  "editRecastRefFile" |
  "editRecastRefPath" |
  "editRecastRefUrl" |
  "editRecastMappings" |
  "editRecastRefAligned" |
  "editRecastIsolateReference" |
  "editRecastAutoFaceDetail" |
  "editRecastEnhancePrompt" |
  "editRecastProtectBystanders" |
  "editRecastPreserveBystanders" |
  "editRecastUseRelighting" |
  "editRecastResolutionProfile" |
  "setEditRecastMappings" |
  "setEditRecastRef" |
  "editReturnTarget" |
  "setEditAnythingStartAnchor" |
  "setEditAnythingEndAnchor" |
  "sendFrameToImageMode" |
  "applyOutputAsAnchor" |
  "skipAnchorPhase" |
  "cancelAnchorReturn" |
  "editRetakeEngine" |
  "editRegenerateAudio" |
  "editSamTarget" |
  "editInvertMask" |
  "editMasksPath" |
  "editMaskPreview" |
  "editDetectedTarget" |
  "continueVideo" |
  "continueVideoPath" |
  "continueVideoUrl" |
  "continueVideoDuration" |
  "videoSubModeStash" |
  "setContinueVideo" |
  "clearContinueVideo" |
  "blendClipA" |
  "blendClipAPath" |
  "blendClipAUrl" |
  "blendClipADuration" |
  "blendClipB" |
  "blendClipBPath" |
  "blendClipBUrl" |
  "blendClipBDuration" |
  "blendTransitionSec" |
  "blendStrengthA" |
  "blendStrengthB" |
  "blendMotionPrefixSec" |
  "blendMotionSuffixSec" |
  "blendAnchorStrength" |
  "setBlendClipA" |
  "setBlendClipB" |
  "clearBlendClipA" |
  "clearBlendClipB" |
  "setBlendTransitionSec" |
  "setBlendStrengthA" |
  "setBlendStrengthB" |
  "setBlendMotionPrefixSec" |
  "setBlendMotionSuffixSec" |
  "setBlendAnchorStrength" |
  "blendMode" |
  "blendOverlapSec" |
  "setBlendMode" |
  "setBlendOverlapSec" |
  "outpaintPadding" |
  "setOutpaintPadding" |
  "outpaintResolutionPreset" |
  "setOutpaintResolutionPreset" |
  "outpaintAspect" |
  "setOutpaintAspect" |
  "outpaintVideoBox" |
  "setOutpaintVideoBox" |
  "outpaintTrimStart" |
  "outpaintTrimEnd" |
  "setOutpaintTrimStart" |
  "setOutpaintTrimEnd" |
  "outpaintSourcePreservation" |
  "setOutpaintSourcePreservation" |
  "outpaintLoraStrength" |
  "setOutpaintLoraStrength" |
  "outpaintMaskPreserving" |
  "setOutpaintMaskPreserving" |
  "outpaintPreserveSourceAudio" |
  "setOutpaintPreserveSourceAudio" |
  "outpaintLockSourcePixels" |
  "setOutpaintLockSourcePixels" |
  "outpaintTrimSmear" |
  "setOutpaintTrimSmear" |
  "outpaintWindowSize" |
  "setOutpaintWindowSize" |
  "outpaintWindowOverlap" |
  "setOutpaintWindowOverlap" |
  "setEditVideoPath" |
  "setEditVideo" |
  "clearEditVideo" |
  "musicDescription" |
  "setMusicDescription" |
  "musicInstrumental" |
  "setMusicInstrumental" |
  "audioSubMode" |
  "selectedModelPerAudioSubMode" |
  "h3OptimizationPreferences" |
  "setAudioSubMode" |
  "selectedModelPerMode" |
  "savedLoraPerMode" |
  "savedParamsPerMode" |
  "savedPromptPerMode" |
  "setGenerationMode" |
  "params" |
  "setParam" |
  "setParams"
>

/** Owns mode transitions, per-mode snapshots, editing inputs and generation parameters. */
export function createStudioModeSlice(
  set: Parameters<StateCreator<AppState>>[0],
  get: Parameters<StateCreator<AppState>>[1],
  dependencies: StudioModeDependencies,
): StudioModeSlice {
  const { _initialStudioVideoRoutePreferences, _saveStudioVideoRoutePreferences, _studioCreateInputState, _resolveStudioCreateModel, modelSupportsStudioVideoMediaIntent, getDefaultModelForMode, DEFAULT_RECAST_MAPPING, _persistStickyStudioPreferences, _snapshotModeParams, _saveSettings, _restoreModeParams, _normalizeStudioImageWorkflow, _normalizeStudioVideoWorkflow, defaultParams, sfxModelTypes, _applyModelDefaults, captureVideoSubModeStash, BLANK_VIDEO_INPUT_PARAMS } = dependencies
  let _preScail2AvatarModel = ''
  let _studioPromptSaveDebounce: ReturnType<typeof setTimeout> | null = null
  const STUDIO_PROMPT_DEBOUNCE_MS = 500
  return ({
  // Generation mode
  generationMode: 'video',
  studioVideoCreateRoute: 'auto',
  studioVideoEffectiveCreateRoute: 'generate',
  studioVideoModelPerCreateRoute: _initialStudioVideoRoutePreferences.models,
  studioVideoRouteNotice: null,
  setStudioVideoCreateRoute: () => {
    const before = get()
    const previousRoute = before.studioVideoEffectiveCreateRoute
    const previousModel = String(before.params.model_type || '')
    const modelPreferences = {
      ...before.studioVideoModelPerCreateRoute,
      ...(previousModel ? { [previousRoute]: previousModel } : {}),
    }
    set({
      studioVideoCreateRoute: 'auto',
      studioVideoModelPerCreateRoute: modelPreferences,
      studioVideoRouteNotice: null,
    })
    _saveStudioVideoRoutePreferences({ route: 'auto', models: modelPreferences })
    get().reconcileStudioVideoCreateRoute('Inputs changed')
  },
  reconcileStudioVideoCreateRoute: (reason = 'Inputs changed') => {
    const state = get()
    if (
      state.generationMode !== 'video'
      || (state.studioVideoWorkflow !== 'frames' && state.studioVideoWorkflow !== 'references')
      || Number(state.params.image_mode) !== 0
    ) return
    const inputState = _studioCreateInputState(state)
    const previousRoute = state.studioVideoEffectiveCreateRoute
    const previousModel = String(state.params.model_type || '')
    const routeChanged = inputState.desired !== previousRoute
    const modelPreferences = {
      ...state.studioVideoModelPerCreateRoute,
      ...(routeChanged && previousModel ? { [previousRoute]: previousModel } : {}),
    }
    set({
      studioVideoCreateRoute: 'auto',
      studioVideoEffectiveCreateRoute: inputState.desired,
      studioVideoModelPerCreateRoute: modelPreferences,
      studioVideoRouteNotice: inputState.conflict ? {
        message: `${reason}: fixed frame guidance and flexible references cannot be used in one generation. Remove one of those input roles to continue.`,
        previousRoute,
        previousModel,
        undoable: false,
      } : null,
    })
    _saveStudioVideoRoutePreferences({ route: 'auto', models: modelPreferences })
    const targetModel = _resolveStudioCreateModel(get(), inputState)
    if (targetModel && targetModel !== previousModel) get().selectModel(targetModel)
  },
  undoStudioVideoRoute: () => {
    const notice = get().studioVideoRouteNotice
    if (!notice) return
    const modelPreferences = {
      ...get().studioVideoModelPerCreateRoute,
      [notice.previousRoute]: notice.previousModel,
    }
    set({
      studioVideoCreateRoute: 'auto',
      studioVideoEffectiveCreateRoute: notice.previousRoute,
      studioVideoModelPerCreateRoute: modelPreferences,
      studioVideoRouteNotice: null,
    })
    _saveStudioVideoRoutePreferences({ route: 'auto', models: modelPreferences })
    if (
      notice.previousModel
      && get().enabledModels.has(notice.previousModel)
      && notice.previousModel !== get().params.model_type
    ) get().selectModel(notice.previousModel)
    get().reconcileStudioVideoCreateRoute('Inputs changed')
  },
  clearStudioVideoRouteNotice: () => set({ studioVideoRouteNotice: null }),
  selectStudioVideoModel: (modelType) => {
    const state = get()
    const model = state.models.find(candidate => candidate.model_type === modelType)
    const inputState = _studioCreateInputState(state)
    if (!modelSupportsStudioVideoMediaIntent(model, inputState)) return
    const route = inputState.desired
    const modelPreferences = {
      ...state.studioVideoModelPerCreateRoute,
      [route]: modelType,
    }
    set({
      studioVideoCreateRoute: 'auto',
      studioVideoEffectiveCreateRoute: route,
      studioVideoModelPerCreateRoute: modelPreferences,
      studioVideoRouteNotice: null,
    })
    _saveStudioVideoRoutePreferences({ route: 'auto', models: modelPreferences })
    get().selectModel(modelType)
  },
  editSubMode: 'retake' as import('../types').EditSubMode,
  setEditSubMode: (mode: import('../types').EditSubMode) => {
    const s = get()
    const prev = s.editSubMode
    set({ editSubMode: mode })
    if (mode === prev || s.generationMode !== 'avatar') return
    // Recast uses SCAIL-2 Replace; Repaint uses the proven SCAIL-2 Animate
    // path from Studio Video/Frames. Swap recipes when moving between those
    // modes and restore the previous LTX edit model when leaving both.
    const current = (s.params.model_type as string) || ''
    const isScail2 = (mt: string) => s.models.find(m => m.model_type === mt)?.architecture === 'scail2_14B'
    const enteringScail2Edit = mode === 'recast' || mode === 'restyle'
    const leavingScail2Edit = prev === 'recast' || prev === 'restyle'
    if (enteringScail2Edit) {
      const valid = mode === 'recast'
        ? current === 'scail2_14B_recast_fast' || current === 'scail2_14B'
        : current === 'scail2_14B_fast' || current === 'scail2_14B'
      if (!valid) {
        if (!leavingScail2Edit && !isScail2(current)) {
          _preScail2AvatarModel = current
        }
        const preferred = mode === 'recast'
          ? 'scail2_14B_recast_fast'
          : 'scail2_14B_fast'
        const target = s.models.some(m => m.model_type === preferred)
          ? preferred
          : s.models.some(m => m.model_type === 'scail2_14B')
            ? 'scail2_14B'
            : undefined
        if (target) get().selectModel(target)
      }
    } else if (leavingScail2Edit && isScail2(current)) {
      const restore = _preScail2AvatarModel && s.models.some(m => m.model_type === _preScail2AvatarModel)
        ? _preScail2AvatarModel
        : getDefaultModelForMode('avatar', s.families, s.models, s.enabledModels)
      if (restore) get().selectModel(restore)
    }
  },
  editVideoPath: '',
  editVideoUrl: '',
  editVideoFile: null,
  editVideoDuration: 0,
  editVideoResolution: '',
  editStartTime: 0,
  editEndTime: 5,
  editRetakeStrength: 0.85,
  editPromptStrength: 3.5,
  editAnythingLoraStrength: 1.0,
  editAnythingStartAnchor: null,
  editAnythingEndAnchor: null,
  editRepaintFrameFile: null,
  editRepaintFramePath: '',
  editRepaintFrameUrl: '',
  editRepaintMappings: [],
  editRepaintResolutionProfile: '480p',
  setEditRepaintFrame: (file, path, url) => set({
    editRepaintFrameFile: file,
    editRepaintFramePath: path,
    editRepaintFrameUrl: url,
  }),
  setEditRepaintMappings: mappings => set({
    editRepaintMappings: mappings.slice(0, 5),
  }),
  editRecastTarget: 'person',
  editRecastPersonCount: 1,
  editRecastRefFile: null,
  editRecastRefPath: '',
  editRecastRefUrl: '',
  editRecastMappings: [{ ...DEFAULT_RECAST_MAPPING }],
  editRecastRefAligned: false,
  editRecastIsolateReference: true,
  editRecastAutoFaceDetail: true,
  editRecastEnhancePrompt: false,
  editRecastProtectBystanders: false,
  editRecastPreserveBystanders: true,
  editRecastUseRelighting: false,
  editRecastResolutionProfile: '480p',
  setEditRecastMappings: mappings => set({
    editRecastMappings: mappings,
    editRecastTarget: mappings[0]?.target || 'person',
    editRecastPersonCount: Math.min(5, Math.max(1, mappings.length || 1)),
    editRecastRefFile: mappings[0]?.refFile || null,
    editRecastRefPath: mappings[0]?.refPath || '',
    editRecastRefUrl: mappings[0]?.refUrl || '',
    editRecastRefAligned: mappings[0]?.referenceAlignedToSource === true,
  }),
  setEditRecastRef: (file, path, url, aligned = false) => set(s => ({
    editRecastRefFile: file,
    editRecastRefPath: path,
    editRecastRefUrl: url,
    editRecastRefAligned: aligned,
    editRecastMappings: [
      {
        ...(s.editRecastMappings[0] || DEFAULT_RECAST_MAPPING),
        refFile: file,
        refPath: path,
        refUrl: url,
        referenceAlignedToSource: aligned,
      },
      ...s.editRecastMappings.slice(1),
    ],
  })),
  editReturnTarget: null,
  setEditAnythingStartAnchor: (path: string | null) => set({ editAnythingStartAnchor: path }),
  setEditAnythingEndAnchor: (path: string | null) => set({ editAnythingEndAnchor: path }),
  sendFrameToImageMode: async (which: 'start' | 'end' | 'recast' | 'repaint') => {
    const state = get()
    const clipPath = state.editVideoPath
    if (!clipPath) {
      console.error('Edit Anything: no source video loaded')
      return
    }
    const startTime = state.editStartTime || 0
    const endTime = state.editEndTime || state.editVideoDuration || 0
    if (endTime <= startTime) {
      console.error('Edit Anything: invalid trim range')
      return
    }

    // Snapshot user's current image-mode reference state BEFORE the
    // hijack so we can restore it on return / skip / cancel and not
    // disturb their non-Edit-Anything Image-mode workflow.
    const savedImageRefs = state.imageRefs
    const savedImageRefType = state.imageRefType

    // Decide which timestamp to grab. End frame is one frame INSIDE the
    // exclusive end (at -0.04s = ~one frame at 25fps) so it matches what
    // the retake pipeline will pin during inference.
    const tStart = which === 'end' ? Math.max(0, endTime - 0.04) : startTime
    try {
      let framePath = ''
      let frameUrl = ''
      // Repaint can refine its existing edited frame. The first trip starts
      // from the source trim frame; later trips start from the applied result.
      if (which === 'repaint' && state.editRepaintFramePath) {
        framePath = state.editRepaintFramePath
        const frameName = framePath.replace(/\\/g, '/').split('/').pop() || ''
        frameUrl = state.editRepaintFrameUrl || api.getFileUrl(frameName)
      } else {
        const res = await fetch('/api/v1/extract-frames', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            video_path: clipPath,
            ...(which === 'end' ? { end_time: tStart } : { start_time: tStart }),
          }),
        })
        if (!res.ok) throw new Error(`extract-frames failed: ${res.status}`)
        const data = await res.json()
        framePath = (which === 'end' ? data.end_path : data.start_path) as string
        frameUrl = (which === 'end' ? data.end_url : data.start_url) as string
      }

      // Use setGenerationMode rather than poking generationMode directly.
      // This is the proper switch — it picks the right model for image
      // mode (auto-restoring the user's last image-mode model or the
      // family default), reloads LoRAs, and resets image_mode + the
      // resolution/aspect presets that go with image generation. Without
      // this, the model stays on whatever LTX-2 video model was active.
      get().setGenerationMode('image')

      // Load the extracted frame into Image mode's REFERENCE images list
      // (the "Reference Images" drop zone in the sidebar). This is the
      // i2i / image-edit input slot — distinct from video mode's
      // image_start (which is i2v's "first frame"). ImageRefSection's
      // own useEffect picks the right imageRefType when imageRefs goes
      // from empty to populated; we leave that to it.
      const blob = await fetch(frameUrl).then(r => r.blob())
      const file = new File([blob], `${which}_frame.png`, { type: blob.type || 'image/png' })
      set(s => ({
        // Replace any pre-existing refs with just our extracted frame
        // for the duration of the round-trip. Restored from the
        // editReturnTarget snapshot when we return.
        imageRefs: [file],
        imageRefType: '',  // let ImageRefSection re-set the default for the new model
        // Make sure no stale i2v fields are populated — those would land
        // in video mode's i2v slot, which isn't what we want here.
        startImage: null,
        params: { ...s.params, image_start: '', image_mode: 1 },
        editReturnTarget: {
          anchor: which,
          framePath,
          clipPath,
          startTime,
          endTime,
          savedImageRefs,
          savedImageRefType,
        },
      }))
    } catch (e) {
      console.error('Failed to send frame to Image mode:', e)
    }
  },
  applyOutputAsAnchor: async () => {
    const state = get()
    const target = state.editReturnTarget
    if (!target) return
    // Find the latest image-mode output (newest first in the outputs list).
    const latestImage = state.outputs.find(o => o.type === 'image')
    if (!latestImage) {
      console.error('Edit Anything return: no image-mode output yet to apply')
      return
    }
    // The backend resolver in /api/v1/edit-anything will look in the
    // active workspace's outputs/ for a bare filename, so passing the
    // gallery name is enough.
    const outputPath = latestImage.name

    if (target.anchor === 'recast') {
      set(s => ({
        editRecastRefFile: null,
        editRecastRefPath: outputPath,
        editRecastRefUrl: latestImage.url,
        editRecastRefAligned: true,
        editRecastMappings: [
          {
            ...(s.editRecastMappings[0] || DEFAULT_RECAST_MAPPING),
            refFile: null,
            refPath: outputPath,
            refUrl: latestImage.url,
            referenceAlignedToSource: true,
          },
          ...s.editRecastMappings.slice(1),
        ],
      }))
    } else if (target.anchor === 'repaint') {
      set({
        editRepaintFrameFile: null,
        editRepaintFramePath: outputPath,
        editRepaintFrameUrl: latestImage.url,
      })
    } else if (target.anchor === 'start') {
      set({ editAnythingStartAnchor: outputPath })
    } else {
      set({ editAnythingEndAnchor: outputPath })
    }

    // Restore the user's pre-round-trip image-mode reference state and
    // switch back to Edit Anything. setGenerationMode handles the model
    // swap so they land back on their video model with the right LoRAs.
    get().setGenerationMode('avatar')
    set({
      editSubMode: target.anchor === 'recast'
        ? 'recast'
        : target.anchor === 'repaint'
          ? 'restyle'
          : 'edit_anything',
      editReturnTarget: null,
      imageRefs: target.savedImageRefs,
      imageRefType: target.savedImageRefType,
    })
  },
  skipAnchorPhase: () => {
    // Skip = return to Edit Anything without setting the anchor. Empty
    // slot → ltx2.py falls back to the source-extracted frame at
    // generation time (the morph-from-source default).
    const target = get().editReturnTarget
    get().setGenerationMode('avatar')
    set({
      editSubMode: target?.anchor === 'recast'
        ? 'recast'
        : target?.anchor === 'repaint'
          ? 'restyle'
          : 'edit_anything',
      editReturnTarget: null,
      ...(target ? { imageRefs: target.savedImageRefs, imageRefType: target.savedImageRefType } : {}),
    })
  },
  cancelAnchorReturn: () => {
    const target = get().editReturnTarget
    get().setGenerationMode('avatar')
    set({
      editSubMode: target?.anchor === 'recast'
        ? 'recast'
        : target?.anchor === 'repaint'
          ? 'restyle'
          : 'edit_anything',
      editReturnTarget: null,
      ...(target ? { imageRefs: target.savedImageRefs, imageRefType: target.savedImageRefType } : {}),
    })
  },
  editRetakeEngine: 'native' as const,
  editRegenerateAudio: true,
  editSamTarget: '',
  editInvertMask: false,
  editMasksPath: null,
  editMaskPreview: null,
  editDetectedTarget: '',
  continueVideo: null,
  continueVideoPath: '',
  continueVideoUrl: '',
  continueVideoDuration: 0,
  videoSubModeStash: {},
  setContinueVideo: (file, path, url, duration) => set({
    continueVideo: file, continueVideoPath: path, continueVideoUrl: url, continueVideoDuration: duration,
  }),
  clearContinueVideo: () => {
    // Also strip "V" from image_prompt_type — removing the source video
    // means the user is no longer in extend mode, so any leftover "V"
    // flag would cause the backend to demand a video_source we just
    // cleared. startGeneration has a defensive strip at submit time as
    // well, but cleaning state here keeps things consistent for any UI
    // that reads image_prompt_type directly.
    const currentParams = get().params
    const ipt = (currentParams.image_prompt_type as string) || ''
    set({
      continueVideo: null, continueVideoPath: '', continueVideoUrl: '', continueVideoDuration: 0,
      params: {
        ...currentParams,
        video_source: undefined,
        image_prompt_type: ipt.replace(/V/g, ''),
      },
    })
  },
  blendClipA: null, blendClipAPath: '', blendClipAUrl: '', blendClipADuration: 0,
  blendClipB: null, blendClipBPath: '', blendClipBUrl: '', blendClipBDuration: 0,
  blendTransitionSec: 5,
  blendStrengthA: 1.0,
  blendStrengthB: 0.7,
  blendMotionPrefixSec: 1.0,
  blendMotionSuffixSec: 1.0,
  blendAnchorStrength: 0.7,
  setBlendClipA: (file, path, url, duration) => set({
    blendClipA: file, blendClipAPath: path, blendClipAUrl: url, blendClipADuration: duration,
  }),
  setBlendClipB: (file, path, url, duration) => set({
    blendClipB: file, blendClipBPath: path, blendClipBUrl: url, blendClipBDuration: duration,
  }),
  clearBlendClipA: () => set({ blendClipA: null, blendClipAPath: '', blendClipAUrl: '', blendClipADuration: 0 }),
  clearBlendClipB: () => set({ blendClipB: null, blendClipBPath: '', blendClipBUrl: '', blendClipBDuration: 0 }),
  setBlendTransitionSec: (sec) => set({ blendTransitionSec: sec }),
  setBlendStrengthA: (v) => set({ blendStrengthA: v }),
  setBlendStrengthB: (v) => set({ blendStrengthB: v }),
  setBlendMotionPrefixSec: (v) => set({ blendMotionPrefixSec: v }),
  setBlendMotionSuffixSec: (v) => set({ blendMotionSuffixSec: v }),
  setBlendAnchorStrength: (v) => set({ blendAnchorStrength: v }),
  blendMode: 'overlap' as const,
  blendOverlapSec: 3,
  setBlendMode: (mode) => set({ blendMode: mode }),
  setBlendOverlapSec: (sec) => set({ blendOverlapSec: sec }),
  outpaintPadding: { top: 0, bottom: 0, left: 0, right: 0 },
  setOutpaintPadding: (padding) => set({ outpaintPadding: padding }),
  outpaintResolutionPreset: 'auto',
  setOutpaintResolutionPreset: (preset) => set({ outpaintResolutionPreset: preset }),
  // 'source' = canvas matches source aspect (no extension by default)
  outpaintAspect: 'source',
  setOutpaintAspect: (a) => set({ outpaintAspect: a }),
  // Default video box: full canvas (no padding). Will be re-fitted by the
  // OutpaintCanvas when the user picks a non-source aspect.
  outpaintVideoBox: { x: 0, y: 0, w: 1, h: 1 },
  setOutpaintVideoBox: (box) => set({ outpaintVideoBox: box }),
  outpaintTrimStart: 0,
  outpaintTrimEnd: 0,
  setOutpaintTrimStart: (t) => set({ outpaintTrimStart: t }),
  setOutpaintTrimEnd: (t) => set({ outpaintTrimEnd: t }),
  outpaintSourcePreservation: 1.0,
  setOutpaintSourcePreservation: (v) => set({ outpaintSourcePreservation: v }),
  outpaintLoraStrength: 1.0,
  setOutpaintLoraStrength: (v) => set({ outpaintLoraStrength: v }),
  outpaintMaskPreserving: true,
  setOutpaintMaskPreserving: (v) => set({ outpaintMaskPreserving: v }),
  outpaintPreserveSourceAudio: true,
  setOutpaintPreserveSourceAudio: (v) => set({ outpaintPreserveSourceAudio: v }),
  outpaintLockSourcePixels: false,  // default OFF — visible rectangle seam outweighs benefit
  setOutpaintLockSourcePixels: (v) => set({ outpaintLockSourcePixels: v }),
  outpaintTrimSmear: true,  // default ON — fixes the 9-frame stutter at window 1→2 boundary
  setOutpaintTrimSmear: (v) => set({ outpaintTrimSmear: v }),
  outpaintWindowSize: 241,  // LTX-2 default (~10s @ 24fps)
  setOutpaintWindowSize: (v) => set({ outpaintWindowSize: v }),
  outpaintWindowOverlap: 9,  // LTX-2 default
  setOutpaintWindowOverlap: (v) => set({ outpaintWindowOverlap: v }),
  setEditVideoPath: (path) => set({ editVideoPath: path }),
  setEditVideo: (file, path, url, duration, resolution) => set({
    editVideoFile: file, editVideoPath: path, editVideoUrl: url,
    editVideoDuration: duration, editVideoResolution: resolution,
    editEndTime: duration,
  }),
  clearEditVideo: () => set({
    editVideoFile: null, editVideoPath: '', editVideoUrl: '',
    editVideoDuration: 0, editVideoResolution: '', editStartTime: 0, editEndTime: 5,
    editMasksPath: null, editMaskPreview: null, editDetectedTarget: '',
  }),
  musicDescription: '',
  setMusicDescription: (s) => set({ musicDescription: s }),
  musicInstrumental: false,
  setMusicInstrumental: (b) => set({ musicInstrumental: b }),
  audioSubMode: 'speech' as import('../types').AudioSubMode,
  selectedModelPerAudioSubMode: {} as Partial<Record<import('../types').AudioSubMode, string>>,
  h3OptimizationPreferences: {
    override_attention: '',
    skip_steps_cache_type: '',
  },
  setAudioSubMode: (subMode) => {
    const { audioSubMode: prevSub, params, models } = get()
    if (subMode === prevSub) return
    // Save current model for the sub-mode we're leaving
    const savedModels = { ...get().selectedModelPerAudioSubMode, [prevSub]: params.model_type }
    // Determine model for target sub-mode
    const audioSubModeDefaults: Record<import('../types').AudioSubMode, string> = {
      speech: 'kugelaudio_0_open',
      // XL SFT LM_4B: the premium CFG variant + strongest LM — the
      // quality default. Turbo variants remain enabled for speed.
      music: 'ace_step_v1_5_xl_sft_lm_4b',
      sfx: 'mmaudio_v2',
      mixer: '',  // Mixer doesn't use a model — it's an ffmpeg-based tool
      revoice: '',  // Revoice is a SeedVC post-processing tool
    }
    const saved = savedModels[subMode]
    const targetModel = (saved && models.some(m => m.model_type === saved))
      ? saved
      : audioSubModeDefaults[subMode]
    set({ audioSubMode: subMode, selectedModelPerAudioSubMode: savedModels })
    if (targetModel && models.some(m => m.model_type === targetModel)) {
      get().selectModel(targetModel)
    }
    _persistStickyStudioPreferences(get())
  },
  selectedModelPerMode: {},
  savedLoraPerMode: {},
  savedParamsPerMode: {},
  savedPromptPerMode: {} as Partial<Record<string, string>>,

  setGenerationMode: (mode) => {
    // Tools is a non-generative post-processing area — it owns no model, so
    // skip the per-mode model/LoRA/params RESTORE machinery entirely. We still
    // SAVE the leaving mode's state (prompt / model / LoRAs / params snapshot)
    // so returning to it restores correctly, leave `params` untouched (no model
    // load, no defaults reset), and persist the *previous* real mode as the
    // landing mode so a reload doesn't drop into Tools with no model loaded.
    if (mode === 'tools') {
      const s = get()
      const prev = s.generationMode
      if (prev === 'tools') { set({ generationMode: 'tools' }); return }
      const paramsSnapshot = _snapshotModeParams(s.params)
      const savedModels = { ...s.selectedModelPerMode, [prev]: s.params.model_type }
      const savedParams = {
        ...s.savedParamsPerMode,
        [prev]: { ...paramsSnapshot, filmGrainIntensity: s.filmGrainIntensity, filmGrainSaturation: s.filmGrainSaturation, durationSeconds: s.durationSeconds },
      }
      const savedLoras = {
        ...s.savedLoraPerMode,
        [prev]: { activated_loras: s.params.activated_loras || [], loras_multipliers: s.params.loras_multipliers || '', loraWeights: s.loraWeights, availableLoras: s.availableLoras },
      }
      const savedPrompts = { ...s.savedPromptPerMode, [prev]: s.params.prompt }
      set({
        generationMode: 'tools',
        selectedModelPerMode: savedModels,
        savedParamsPerMode: savedParams,
        savedLoraPerMode: savedLoras,
        savedPromptPerMode: savedPrompts,
      })
      _saveSettings({ generationMode: prev, selectedModelPerMode: savedModels, savedParamsPerMode: savedParams, savedLoraPerMode: savedLoras, savedPromptPerMode: savedPrompts }, s.loraIdByFilename)
      _persistStickyStudioPreferences(get())
      return
    }
    const { families, models, enabledModels, generationMode: prevMode, params, selectedModelPerMode, savedLoraPerMode, savedParamsPerMode, loraWeights, availableLoras, savedPromptPerMode } = get()
    // Save prompt for the mode we're leaving
    const savedPrompts = { ...savedPromptPerMode, [prevMode]: params.prompt }
    // Save current model + LoRA + params state for the mode we're leaving
    const savedModels = { ...selectedModelPerMode, [prevMode]: params.model_type }
    const savedLoras = {
      ...savedLoraPerMode,
      [prevMode]: {
        activated_loras: params.activated_loras || [],
        loras_multipliers: params.loras_multipliers || '',
        loraWeights,
        availableLoras,
      },
    }
    // Save the FULL params snapshot for the leaving mode. Strip the
    // fields that are tracked separately in their own per-mode state
    // structures (model_type → selectedModelPerMode, prompt →
    // savedPromptPerMode, activated_loras / loras_multipliers →
    // savedLoraPerMode) to avoid double-bookkeeping. Everything else
    // — including repeat_generation, negative_prompt, video_prompt_type,
    // video_guide, image_refs, frames_positions, MMAudio_*, etc. — is
    // captured here so it survives a switch-and-return AND doesn't
    // leak into other modes.
    const paramsSnapshot = _snapshotModeParams(params)
    const savedParams = {
      ...savedParamsPerMode,
      [prevMode]: {
        ...paramsSnapshot,
        filmGrainIntensity: get().filmGrainIntensity,
        filmGrainSaturation: get().filmGrainSaturation,
        // Save durationSeconds per-mode so audio's 600/1800 (Kugel/Scenema
        // slider max) doesn't leak into video on mode-switch back. Audio
        // mode's loadModelOptions still overrides with the slider.max on
        // model select, so this only matters for video/image/avatar.
        durationSeconds: get().durationSeconds,
      },
    }
    // Restore saved model for target mode, or fall back to default
    const savedModel = savedModels[mode]
    const restoredModel = savedModel
      && enabledModels.has(savedModel)
      && models.some(m => m.model_type === savedModel)
      ? savedModel
      : getDefaultModelForMode(mode, families, models, enabledModels)
    const newModelType = restoredModel || params.model_type
    // Restore saved LoRA state for target mode (if same model)
    const restoredLora = savedLoras[mode]
    const sameModel = restoredLora && savedModel === newModelType
    // Restore the saved params snapshot for the target mode. If the
    // user never visited this mode before, fall back to defaultParams
    // (NOT the previous mode's params — that's what caused the leak).
    const restoredSnapshot = savedParams[mode]
    // Extract film grain from snapshot (top-level store state, not in params)
    const restoredFilmGrain = restoredSnapshot
      ? { filmGrainIntensity: restoredSnapshot.filmGrainIntensity ?? 0, filmGrainSaturation: restoredSnapshot.filmGrainSaturation ?? 0.5 }
      : { filmGrainIntensity: 0, filmGrainSaturation: 0.5 }
    // Restore durationSeconds for the target mode. Non-audio modes (video,
    // avatar, image) fall back to 5s on first visit. Audio mode's
    // durationSeconds gets overridden by loadModelOptions when it sees
    // audio_only && duration_slider, so the snapshot value is mostly
    // ignored there — it's still saved for symmetry.
    const restoredDuration = restoredSnapshot && typeof restoredSnapshot.durationSeconds === 'number'
      ? restoredSnapshot.durationSeconds as number
      : 5
    // Strip filmGrain + durationSeconds keys before applying — they don't belong in params
    const restoredParams = _restoreModeParams(restoredSnapshot)
    // Restore saved prompt for target mode (or empty for first visit)
    const restoredPrompt = savedPrompts[mode] ?? ''
    const restoredImageWorkflow = _normalizeStudioImageWorkflow(
      restoredParams._studio_image_workflow,
    ) ?? get().studioImageWorkflow
    const restoredVideoModel = get().models.find(model => model.model_type === newModelType)
    const restoredVideoWorkflow = _normalizeStudioVideoWorkflow(
      restoredParams._studio_video_workflow,
      restoredVideoModel,
    ) ?? get().studioVideoWorkflow

    set(() => ({
      generationMode: mode,
      selectedModelPerMode: savedModels,
      savedLoraPerMode: savedLoras,
      savedParamsPerMode: savedParams,
      savedPromptPerMode: savedPrompts,
      // Default to Auto resolution + aspect in image mode (matches reference image)
      ...(mode === 'image' ? { resolutionPreset: 'auto' as ResolutionPreset, aspectRatio: 'auto' as AspectRatio } : {}),
      ...(mode === 'image' ? { studioImageWorkflow: restoredImageWorkflow } : {}),
      ...(mode === 'video' ? { studioVideoWorkflow: restoredVideoWorkflow } : {}),
      ...restoredFilmGrain,
      durationSeconds: restoredDuration,
      // Build params from defaults + restored snapshot. We deliberately
      // do NOT spread `...s.params` here — that's the line that caused
      // every previous-mode field to leak into the new mode. Starting
      // from defaults ensures only the restored snapshot's fields (the
      // user's actual choices in this mode, or nothing on first visit)
      // are present. Then layer model_type / prompt / LoRAs from their
      // separate stores on top, plus the special image_mode logic.
      params: {
        ...defaultParams,
        ...restoredParams,
        // Sol / First Block are durable Video preferences, not project
        // inputs. Reapply them when returning from Audio/Image after a
        // restart even though general Advanced state starts clean.
        ...(mode === 'video' ? get().h3OptimizationPreferences : {}),
        model_type: newModelType,
        prompt: restoredPrompt,
        image_mode: mode === 'image'
          ? (restoredImageWorkflow === 'inpaint' || restoredImageWorkflow === 'outpaint' ? 2 : 1)
          : (restoredParams.image_mode ?? 0),
        ...(mode === 'image' ? { _studio_image_workflow: restoredImageWorkflow } : {}),
        ...(mode === 'video' ? { _studio_video_workflow: restoredVideoWorkflow } : {}),
        activated_loras: sameModel ? restoredLora.activated_loras : [],
        loras_multipliers: sameModel ? restoredLora.loras_multipliers : '',
      },
      h3WindowPlan: null,
      loraWeights: sameModel ? restoredLora.loraWeights : {},
      availableLoras: sameModel ? restoredLora.availableLoras : [],
    }))
    if (newModelType && !sfxModelTypes.has(newModelType)) {
      if (!sameModel) {
        get().loadLoras(newModelType)
      }
      get().loadModelOptions(newModelType)
      // Mode switch counts as a model selection too — apply the new
      // model's defaults so numeric primaries (steps, CFG, flow_shift,
      // sample_solver) match what that model expects rather than what
      // the previous mode's model was using. See _applyModelDefaults
      // for the field list and rationale.
      _applyModelDefaults(get, set, newModelType)
    }
    if (
      mode === 'video'
      && (get().studioVideoWorkflow === 'frames' || get().studioVideoWorkflow === 'references')
    ) {
      get().setStudioVideoCreateRoute(get().studioVideoCreateRoute)
    }
    // Persist to localStorage
    _saveSettings({
      generationMode: mode,
      selectedModelPerMode: savedModels,
      savedParamsPerMode: savedParams,
      savedLoraPerMode: savedLoras,
      savedPromptPerMode: savedPrompts,
    }, get().loraIdByFilename)
    _persistStickyStudioPreferences(get())
  },

  params: { ...defaultParams },
  setParam: (key, value) => {
    // Per-sub-mode isolation: remember the outgoing sub-mode BEFORE the
    // param write flips image_mode (see videoSubModeStash).
    const prevImageMode = key === 'image_mode' ? ((get().params.image_mode as number) ?? 0) : null
    const invalidatesH3Plan = [
      'prompt', 'model_type', 'resolution', 'image_start', 'image_end',
      'image_mode', 'image_refs', 'frames_positions', 'video_prompt_type',
      'minimax_h3_camera_coverage',
      'minimax_h3_multi_window',
      'minimax_h3_reference_sequence', 'minimax_h3_references',
      'minimax_h3_sequence_prompt_mode',
      'minimax_h3_sequence_continuity',
      'minimax_h3_sequence_clip_frames',
      'minimax_h3_sequence_memory_override',
    ].includes(String(key))
    set(s => {
      const nextParams = { ...s.params, [key]: value }
      if (key === 'prompt') {
        delete nextParams._h3_original_prompt
        const editedLines = typeof value === 'string'
          ? value.replace(/\r\n?/g, '\n').split('\n').map(line => line.trim()).filter(Boolean)
          : []
        const reviewedLtxPlan = (
          s.modelOptions?.multi_window_sequence_controls === true
          && s.params.ltx_multi_window === true
          && s.params.ltx_window_prompt_mode !== 'manual'
          && Array.isArray(s.params.ltx_window_prompts)
          && editedLines.length === s.params.ltx_window_prompts.length
        )
        if (reviewedLtxPlan) {
          nextParams.ltx_window_prompts = editedLines
        } else {
          delete nextParams._ltx_original_prompt
          delete nextParams.ltx_window_prompts
        }
      }
      if (
        key === 'ltx_multi_window'
        || key === 'ltx_window_prompt_mode'
        || key === 'model_type'
      ) {
        delete nextParams._ltx_original_prompt
        delete nextParams.ltx_window_prompts
      }
      return {
        params: nextParams,
        ...(invalidatesH3Plan ? { h3WindowPlan: null } : {}),
        ...(invalidatesH3Plan ? { promptEnhanceError: null } : {}),
      }
    })
    if (key === 'prompt' && typeof value === 'string') {
      const mode = get().generationMode
      const savedPrompts = { ...get().savedPromptPerMode, [mode]: value }
      set({ savedPromptPerMode: savedPrompts })
      if (_studioPromptSaveDebounce) clearTimeout(_studioPromptSaveDebounce)
      _studioPromptSaveDebounce = setTimeout(() => {
        _studioPromptSaveDebounce = null
        const curr = get()
        _saveSettings({
          generationMode: curr.generationMode,
          selectedModelPerMode: curr.selectedModelPerMode,
          savedParamsPerMode: curr.savedParamsPerMode,
          savedLoraPerMode: curr.savedLoraPerMode,
          savedPromptPerMode: curr.savedPromptPerMode,
        }, curr.loraIdByFilename)
      }, STUDIO_PROMPT_DEBOUNCE_MS)
    }
    // Auto-parse speaker names from prompt whenever audio mode has at least
    // one voice slot. Previously gated on audio_prompt_type.includes('B')
    // (multi-voice only), but the user expects single-voice ("Peter: hello")
    // to populate voice slot 1 too. Voice-count gate covers both cases —
    // ttsVoiceCount > 0 means at least one voice clone is active.
    if (key === 'prompt' && typeof value === 'string' && get().generationMode === 'audio' && get().ttsVoiceCount > 0) {
      get()._autoParseSpkeakerNames(value)
    }
    // Handle sub-mode transitions (Frames / Multi-Shot / Extend / Blend)
    if (key === 'image_mode') {
      // Each Studio Video sub-mode is an ISOLATED working set: stash the
      // outgoing sub-mode's full state (prompt, input tiles, settings)
      // and bring back the incoming one. A sub-mode visited for the
      // first time keeps the generic settings but starts with blank
      // inputs — so Extend opens clean while the Frames setup (injected
      // keyframes and all) survives the round-trip untouched.
      const s1 = get()
      if (s1.generationMode === 'video' && typeof value === 'number' && prevImageMode !== null && value !== prevImageMode) {
        const stash = { ...s1.videoSubModeStash, [prevImageMode]: captureVideoSubModeStash(s1) }
        const saved = stash[value]
        if (saved) {
          set({
            videoSubModeStash: stash,
            // Model + LoRA selection stay shared across sub-modes — keep
            // the live values, restore everything else.
            params: {
              ...saved.params,
              image_mode: value,
              model_type: s1.params.model_type,
              activated_loras: s1.params.activated_loras,
              loras_multipliers: s1.params.loras_multipliers,
            },
            startImage: saved.startImage,
            endImage: saved.endImage,
            continueVideo: saved.continueVideo,
            continueVideoPath: saved.continueVideoPath,
            continueVideoUrl: saved.continueVideoUrl,
            continueVideoDuration: saved.continueVideoDuration,
            audioGuideFilename: saved.audioGuideFilename,
            imageRefs: saved.imageRefs,
            imageRefType: saved.imageRefType,
            removeBackgroundRefs: saved.removeBackgroundRefs,
            durationSeconds: saved.durationSeconds,
            slidingWindowSeconds: saved.slidingWindowSeconds,
            slidingWindowOverlap: saved.slidingWindowOverlap,
            clips: saved.clips,
            singlePromptMode: saved.singlePromptMode,
          })
        } else {
          set(s => ({
            videoSubModeStash: stash,
            params: { ...s.params, ...BLANK_VIDEO_INPUT_PARAMS },
            startImage: null,
            endImage: null,
            continueVideo: null,
            continueVideoPath: '',
            continueVideoUrl: '',
            continueVideoDuration: 0,
            audioGuideFilename: null,
            imageRefs: [],
            imageRefType: '',
            removeBackgroundRefs: false,
            // durationSeconds + sliding window intentionally carry over:
            // they're settings, not inputs — they diverge per sub-mode
            // only after the user changes them there.
          }))
        }
      }
      // Multi-clip transitions (after the stash swap so syncClipCount
      // sees the restored duration/params).
      if (value === 2) {
        get().syncClipCount()
      } else {
        set({ clips: [], singlePromptMode: false })
      }
    }
    // Snapshot the changed param into the current mode's IN-MEMORY
    // record so it survives a mode switch + return within this session.
    // Skip keys that are tracked in their own per-mode structures
    // (model_type, prompt, LoRA fields) to avoid double-bookkeeping.
    // Everything else — repeat_generation, negative_prompt,
    // num_inference_steps, video_prompt_type, video_guide, image_refs,
    // frames_positions, MMAudio_*, etc. — gets snapshotted here.
    //
    // Deliberately NOT written to localStorage: a page refresh starts
    // the working state (prompt, seed, LoRA selection, Advanced values)
    // from the model's defaults. v1.2.0 persisted every edit across
    // refreshes and users found the stale text/seeds surprising —
    // in-session mode-switch persistence is the wanted behavior,
    // refresh is a clean slate (see loadModels).
    if (key !== 'model_type' && key !== 'prompt' && key !== 'activated_loras' && key !== 'loras_multipliers') {
      const s = get()
      const mode = s.generationMode
      const paramsSnapshot = _snapshotModeParams(s.params)
      const updatedSavedParams = {
        ...s.savedParamsPerMode,
        [mode]: {
          ...paramsSnapshot,
          filmGrainIntensity: s.filmGrainIntensity,
          filmGrainSaturation: s.filmGrainSaturation,
        },
      }
      set({ savedParamsPerMode: updatedSavedParams })
    }
    if (
      key === 'minimax_h3_references'
      || key === 'image_start'
      || key === 'image_end'
      || key === 'image_refs'
      || key === 'frames_positions'
      || key === 'audio_guide'
      || key === 'audio_prompt_type'
    ) {
      get().reconcileStudioVideoCreateRoute('Inputs changed')
    }
    if (
      key === 'override_attention'
      || key === 'skip_steps_cache_type'
      || key === 'skip_steps_multiplier'
      || key === 'skip_steps_start_step_perc'
    ) {
      set(s => ({
        h3OptimizationPreferences: {
          ...s.h3OptimizationPreferences,
          ...(key === 'override_attention' ? {
            override_attention: (
              value === 'sol' || value === 'sla' || value === 'sdpa'
                ? value
                : ''
            ) as '' | 'sol' | 'sla' | 'sdpa',
          } : {}),
          ...(key === 'skip_steps_cache_type' ? {
            skip_steps_cache_type: value === 'first_block' ? 'first_block' as const : '' as const,
          } : {}),
          ...(key === 'skip_steps_multiplier' && typeof value === 'number' ? {
            skip_steps_multiplier: value,
          } : {}),
          ...(key === 'skip_steps_start_step_perc' && typeof value === 'number' ? {
            skip_steps_start_step_perc: value,
          } : {}),
        },
      }))
      _persistStickyStudioPreferences(get())
    }
  },
  setParams: (partial) => {
    set(s => ({ params: { ...s.params, ...partial } }))
  }
  })
}
