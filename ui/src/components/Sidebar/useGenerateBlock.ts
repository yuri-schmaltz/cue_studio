import {
  modelSupportsImageWorkflow,
  modelSupportsStudioVideoMediaIntent,
  useStore,
} from '../../stores/useStore'

export interface GenerateBlock {
  /** Short chip shown on the disabled Generate button. */
  label: string
  /** One-line reason, shown inline next to the button. */
  reason: string
  /** Full explanation, kept as the button tooltip. */
  title: string
}

/**
 * Resolves why Studio's Generate action is currently blocked.
 *
 * Extracted from <GenerateButton> so the reason can also be surfaced inline
 * in the control column — previously it only lived in the disabled button's
 * `title` tooltip, which forced the user to hover to learn what was missing.
 */
export function useGenerateBlock(): GenerateBlock | null {
  const generationMode = useStore(s => s.generationMode)
  const studioVideoWorkflow = useStore(s => s.studioVideoWorkflow)
  const studioVideoEffectiveCreateRoute = useStore(s => s.studioVideoEffectiveCreateRoute)
  const currentModel = useStore(s => s.models.find(model => model.model_type === s.params.model_type))
  const modelOptions = useStore(s => s.modelOptions)
  const imageMode = useStore(s => Number(s.params.image_mode || 0))
  const editSubMode = useStore(s => s.editSubMode)
  const editVideoPath = useStore(s => s.editVideoPath)
  const outpaintVideoBox = useStore(s => s.outpaintVideoBox)
  const imageWorkflow = useStore(s => s.studioImageWorkflow)
  const imageSourcePath = useStore(s => s.imageWorkflowSourcePath)
  const imageMaskPath = useStore(s => s.imageWorkflowMaskPath)
  const imageRefs = useStore(s => s.imageRefs)
  const imagePadding = useStore(s => s.imageOutpaintPadding)
  const hasOmniReferences = useStore(s => (
    (s.params.minimax_h3_references?.length ?? 0) > 0
  ))
  const hasFlexibleOmniReferences = useStore(s => (
    s.params.minimax_h3_references?.some(reference => !(
      reference.type === 'audio' && reference.audio_intent === 'drive'
    )) === true
  ))
  const hasReferenceAudioDrive = useStore(s => Boolean(
    s.params.minimax_h3_references?.some(reference => (
      reference.type === 'audio' && reference.audio_intent === 'drive'
    )),
  ))
  const hasFrameAudioDrive = useStore(s => Boolean(s.params.audio_guide))
  const hasGuidedInput = useStore(s => Boolean(
    s.startImage
    || s.endImage
    || s.params.image_start
    || s.params.image_end
    || s.imageRefs.length
    || (
      Array.isArray(s.params.image_refs)
      && s.params.image_refs.length
      && s.params.frames_positions
    ),
  ))
  const hasStartImage = useStore(s => !!(s.startImage || s.params.image_start))

  // Check if i2v-only model needs a start image. Video mode only: edit
  // sub-modes supply their own source media (Recast runs the i2v-only
  // SCAIL-2 against a source video + reference image, no start image).
  const modelIsOmniReference = Boolean(
    currentModel?.omni_reference
    || currentModel?.director?.video_strategy === 'omni_reference'
    || currentModel?.model_type.toLowerCase().startsWith('minimax_h3_ref2va'),
  )
  const isOmniReference = modelIsOmniReference
  const isI2vOnly = currentModel
    ? currentModel.is_i2v && !currentModel.is_t2v
    : Boolean(modelOptions?.i2v_class && !modelOptions?.t2v_class)

  const isPrimaryCreate = generationMode === 'video'
    && (studioVideoWorkflow === 'frames' || studioVideoWorkflow === 'references')
    && imageMode === 0
  const createWorkflow = studioVideoWorkflow === 'references' ? 'references' : 'frames'
  const studioMediaIntent = {
    workflow: createWorkflow,
    hasFrameGuidance: createWorkflow === 'frames' && hasGuidedInput,
    hasOmniReferences: createWorkflow === 'references' && hasFlexibleOmniReferences,
    hasAudioDrive: createWorkflow === 'references' ? hasReferenceAudioDrive : hasFrameAudioDrive,
  } as const
  const routeModelCompatible = !isPrimaryCreate
    || modelSupportsStudioVideoMediaIntent(currentModel, studioMediaIntent)
  const needsCreateModel = isPrimaryCreate && !routeModelCompatible
  const needsGuidance = isPrimaryCreate
    && studioVideoEffectiveCreateRoute === 'guided'
    && !hasGuidedInput
  const needsImage = generationMode === 'video'
    && isI2vOnly
    && !isOmniReference
    && !hasStartImage
    && (!isPrimaryCreate || createWorkflow === 'frames')
  const needsReference = generationMode === 'video'
    && studioVideoWorkflow === 'references'
    && isOmniReference
    && !hasOmniReferences
    && !hasReferenceAudioDrive

  const isOutpaint = generationMode === 'avatar' && editSubMode === 'outpaint'
  const needsOutpaintSource = isOutpaint && !editVideoPath
  const hasOutpaintArea = (
    outpaintVideoBox.x > 0.0005
    || outpaintVideoBox.y > 0.0005
    || outpaintVideoBox.x + outpaintVideoBox.w < 0.9995
    || outpaintVideoBox.y + outpaintVideoBox.h < 0.9995
  )
  const needsOutpaintArea = isOutpaint && !!editVideoPath && !hasOutpaintArea

  const needsImageGenerateSource = generationMode === 'image'
    && imageWorkflow === 'generate'
    && currentModel?.requires_image_reference === true
    && imageRefs.length === 0
  const needsImageWorkflowSource = generationMode === 'image'
    && (imageWorkflow === 'inpaint' || imageWorkflow === 'outpaint')
    && !imageSourcePath
  const needsImageMask = generationMode === 'image'
    && imageWorkflow === 'inpaint'
    && !imageMaskPath
  const needsImageOutpaintArea = generationMode === 'image'
    && imageWorkflow === 'outpaint'
    && Object.values(imagePadding).every(value => value === 0)
  const incompatibleImageModel = generationMode === 'image'
    && !modelSupportsImageWorkflow(currentModel, imageWorkflow, imageRefs.length > 0)

  // Priority order mirrors the original <GenerateButton> branch exactly, so
  // the chip label and the disabled state never change meaning.
  if (needsCreateModel) {
    const route = studioVideoEffectiveCreateRoute === 'omni'
      ? 'reference'
      : studioVideoEffectiveCreateRoute === 'guided'
        ? 'frame-guided'
        : studioVideoEffectiveCreateRoute === 'audio'
          ? 'audio-driven'
          : 'text'
    return {
      label: 'Need model',
      reason: `Enable or select a model compatible with the current ${route} inputs.`,
      title: `Enable or select a video model compatible with the current ${route} inputs.`,
    }
  }
  if (needsGuidance) {
    return {
      label: 'Need frame',
      reason: 'Add a start frame, end frame, or timed frame.',
      title: 'Add a start frame, end frame, or timed frame.',
    }
  }
  if (needsImage) {
    return {
      label: 'Need image',
      reason: 'This image-to-video model needs a start image.',
      title: 'This image-to-video model needs a start image — upload one or pick a text-to-video model.',
    }
  }
  if (needsReference) {
    return {
      label: 'Need reference',
      reason: 'Add at least one character, image, video, or audio reference.',
      title: 'Add at least one character, image, video, or audio reference.',
    }
  }
  if (incompatibleImageModel) {
    return {
      label: 'Need model',
      reason: 'Enable or select a model compatible with this Image workflow.',
      title: 'Enable or select a model compatible with this Image workflow.',
    }
  }
  if (needsImageGenerateSource || needsImageWorkflowSource) {
    return {
      label: 'Need source',
      reason: 'Add the source image this workflow needs.',
      title: 'Add the source image this workflow needs.',
    }
  }
  if (needsImageMask) {
    return {
      label: 'Need mask',
      reason: 'Upload a black-and-white mask. White areas will be regenerated.',
      title: 'Upload a black-and-white mask. White areas will be regenerated.',
    }
  }
  if (needsImageOutpaintArea) {
    return {
      label: 'Choose canvas',
      reason: 'Expand at least one side of the source canvas.',
      title: 'Expand at least one side of the source canvas.',
    }
  }
  if (needsOutpaintSource) {
    return {
      label: 'Need source',
      reason: 'Upload the source video to outpaint.',
      title: 'Upload the source video to outpaint.',
    }
  }
  if (needsOutpaintArea) {
    return {
      label: 'Choose canvas',
      reason: 'Choose a larger output aspect so Outpaint has room to generate.',
      title: 'Choose a larger output aspect or resize the source to create an area for Outpaint to generate.',
    }
  }
  return null
}
