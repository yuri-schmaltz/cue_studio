import { Globe, BookMarked, BookOpen } from 'lucide-react'
import { useStore } from '../../stores/useStore'
import { GenerationModeSelector } from './GenerationModeSelector'
import { InputsPanel } from './InputsPanel'
import { OmniReferenceSection } from './OmniReferenceSection'
import { PromptInput } from './PromptInput'
import { ImageRefSection } from './ImageRefSection'
import { AudioModeSection } from './AudioModeSection'
import { MusicControls } from './MusicControls'
import { AudioSubModeToggle } from './AudioSubModeToggle'
import { SfxControls } from './SfxControls'
import { MixerControls } from './MixerControls'
import { DurationSlider } from './DurationSlider'
import { AudioDurationControl } from './AudioDurationControl'
import { AdvancedSettings } from './AdvancedSettings'
import { GenerateButton } from './GenerateButton'
import { ModelSelector } from './ModelSelector'
import { MultiClipEditor } from './MultiClipEditor'
import { RestyleControls } from './RestyleControls'
import { InpaintControls } from './InpaintControls'
import { OutpaintControls } from './OutpaintControls'
import { RetakeControls } from './RetakeControls'
import { EditAnythingControls } from './EditAnythingControls'
import { RecastControls } from './RecastControls'
import { BlendControls } from './BlendControls'
import { AnchorReturnBanner } from './AnchorReturnBanner'
import { VoiceRefSection } from './VoiceRefSection'
import { ToolsPanel } from './ToolsPanel'
import { MiniMaxH3Optimizations } from './MiniMaxH3Optimizations'
import { H3MultiWindowControls } from './H3MultiWindowControls'
import { VideoWorkflowSelector } from './VideoWorkflowSelector'
import { ImageWorkflowSelector } from './ImageWorkflowSelector'
import { ImageWorkflowControls } from './ImageWorkflowControls'

export function Sidebar({ onOpenStyleBibles }: { onOpenStyleBibles: () => void }) {
  const generationMode = useStore(s => s.generationMode)
  const imageMode = useStore(s => s.params.image_mode)
  const modelOptions = useStore(s => s.modelOptions)
  const editSubMode = useStore(s => s.editSubMode)
  const modelType = useStore(s => s.params.model_type)
  const selectedModel = useStore(s => s.models.find(model => model.model_type === s.params.model_type))
  const openLoraBrowser = useStore(s => s.setLoraBrowserOpen)

  const isVideo = generationMode === 'video'
  const isImage = generationMode === 'image'
  const isAudio = generationMode === 'audio'
  const audioSubMode = useStore(s => s.audioSubMode)
  const isEdit = generationMode === 'avatar'
  const isTools = generationMode === 'tools'
  const toolsTool = useStore(s => s.toolsTool)
  const toolsUpscaleMedia = useStore(s => s.toolsUpscaleMedia)
  const videoWorkflow = useStore(s => s.studioVideoWorkflow)
  const imageWorkflow = useStore(s => s.studioImageWorkflow)
  const isUpscale = isTools && toolsTool === 'upscale'
  const isImageUpscale = isUpscale && toolsUpscaleMedia === 'image'
  const isVideoUpscale = isUpscale && toolsUpscaleMedia === 'video'
  const isFilmGrain = isTools && toolsTool === 'film_grain'
  const isRevoice = (isTools && toolsTool === 'revoice') || (isAudio && audioSubMode === 'revoice')
  const isVideoWorkspace = isVideo || isEdit || isVideoUpscale || isFilmGrain
  const isImageWorkspace = isImage || isImageUpscale
  const isAudioWorkspace = isAudio || isRevoice
  const isStandaloneTool = isUpscale || isFilmGrain || isRevoice
  const isRetake = isEdit && editSubMode === 'retake'
  const isRestyle = isEdit && editSubMode === 'restyle'
  const isInpaint = isEdit && editSubMode === 'inpaint'
  const isOutpaint = isEdit && editSubMode === 'outpaint'
  const isEditAnything = isEdit && editSubMode === 'edit_anything'
  const isRecast = isEdit && editSubMode === 'recast'
  const isOmniReference = isVideo && Boolean(
    selectedModel?.omni_reference
    || selectedModel?.director?.video_strategy === 'omni_reference'
    || selectedModel?.model_type.toLowerCase().startsWith('minimax_h3_ref2va'),
  )
  const isFramesWorkflow = isVideo && Number(imageMode) === 0 && videoWorkflow === 'frames'
  const isReferencesWorkflow = isVideo && Number(imageMode) === 0 && videoWorkflow === 'references'
  const isMultiClip = isVideo && imageMode === 2
  const isContinue = isVideo && imageMode === 3
  const isBlend = isVideo && imageMode === 4
  const isI2vOnly = modelOptions?.i2v_class && !modelOptions?.t2v_class

  // Video Transform controls backed by the legacy edit-mode engines.
  const editControls = (
    <>
      {isRetake && (
        <>
          <RetakeControls />
          <PromptInput />
        </>
      )}
      {isInpaint && (
        <>
          <InpaintControls />
          <PromptInput />
        </>
      )}
      {isOutpaint && (
        <>
          <OutpaintControls />
          <PromptInput />
        </>
      )}
      {isRestyle && (
        <>
          <RestyleControls />
          <PromptInput />
        </>
      )}
      {isEditAnything && (
        <>
          <EditAnythingControls />
          <PromptInput />
        </>
      )}
      {isRecast && (
        <>
          <RecastControls />
          <PromptInput />
        </>
      )}
    </>
  )

  const studioControls = (
    <>
      {/* Prompt Edit/Recast → Image Mode round-trip banner. Visible while
          a boundary anchor or Recast reference is being edited; null otherwise. */}
      <AnchorReturnBanner />

      {/* [&>*]:shrink-0 — keep every section at its natural height and let
          the column SCROLL when space is tight (e.g. ID-LoRA voice section
          added + hardware bar expanded), instead of letting flex-shrink
          crush sections into each other. */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4 min-h-0 [&>*]:shrink-0">
        <GenerationModeSelector />

        {/* Studio's user-facing hierarchy is media first, workflow second.
            The workflow selectors route into the legacy video/avatar/tools
            engines so saved jobs and API behavior remain compatible. */}
        {isVideoWorkspace && <VideoWorkflowSelector />}
        {isImageWorkspace && <ImageWorkflowSelector />}
        {isAudioWorkspace && <AudioSubModeToggle />}

        {isAudio && audioSubMode !== 'sfx' && audioSubMode !== 'mixer' && audioSubMode !== 'revoice' && (
          <AudioDurationControl />
        )}

        {isUpscale ? (
          <ToolsPanel forcedTool="upscale" mediaKind={toolsUpscaleMedia} embedded />
        ) : isFilmGrain ? (
          <ToolsPanel forcedTool="film_grain" mediaKind="video" embedded />
        ) : isRevoice ? (
          <ToolsPanel forcedTool="revoice" embedded />
        ) : (
        <>
        {/* Video Transform workflows use the established Edit engines. */}
        {isEdit && editControls}

        {/* Blend mode manages its own duration (overlap_sec) and its own
            start/end anchors — so the generic Duration slider and
            start/end ImageUpload don't apply there. */}
        {isVideo && !isBlend && <DurationSlider />}
        {/* Frames (image_mode 0) AND Extend (image_mode 3) both use the unified
            InputsPanel. In Extend mode its first tile is the source video to
            continue from; otherwise it's the start frame. */}
        {isVideo && !isMultiClip && !isBlend && (isFramesWorkflow || isContinue) && (
          <div>
            {isI2vOnly && !isContinue && (
              <div className="text-2xs text-indicator-warning bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-1.5 mb-2">
                This model requires a start image to generate video.
              </div>
            )}
            <InputsPanel />
          </div>
        )}
        {isReferencesWorkflow && <OmniReferenceSection />}
        {isVideo && <MiniMaxH3Optimizations />}
        {isVideo && <H3MultiWindowControls />}
        {isBlend && <BlendControls />}

        {/* Image workflows expose only the inputs their native pipeline uses. */}
        {isImage && <ImageWorkflowControls />}
        {isImage && imageWorkflow === 'generate' && <ImageRefSection />}

        {/* Video/Image mode: audio controls (soundtrack, control video, etc.).
            In Frames mode (video, image_mode 0) the unified InputsPanel routes
            audio/control-video via tiles instead, so the dropdown is hidden
            there. Other video sub-modes + image mode keep AudioModeSection. */}
        {!isEdit && !isAudio && !(isVideo && (imageMode === 0 || imageMode === 3)) && modelOptions?.audio_prompt_type_sources && <AudioModeSection />}

        {/* Audio mode: workflow-specific controls */}
        {isAudio && audioSubMode === 'speech' && modelOptions?.audio_prompt_type_sources && <AudioModeSection />}
        {isAudio && audioSubMode === 'sfx' && <SfxControls />}
        {isAudio && audioSubMode === 'mixer' && <MixerControls />}
        {isAudio && audioSubMode === 'music' && <MusicControls />}

        {/* Prompt area (non-edit modes, skip for SFX/Mixer/Music which have their own UI) */}
        {!isEdit && !(isAudio && (audioSubMode === 'sfx' || audioSubMode === 'mixer' || audioSubMode === 'music')) && (isMultiClip ? <MultiClipEditor /> : <PromptInput />)}

        {/* Video: reference images below prompt. In Frames mode the InputsPanel
            renders them as ordered tiles instead. */}
        {isVideo && !isOmniReference && imageMode !== 0 && imageMode !== 3 && modelOptions?.image_ref_choices && <ImageRefSection />}

        {/* LTX Voice Reference (ID-LoRA) — gated by Video Frames →
            Advanced. VoiceRefSection also verifies the active LTX model. */}
        {isVideo && !isOmniReference && imageMode !== 0 && imageMode !== 3 && <VoiceRefSection />}
        </>
        )}
      </div>

      {/* Bottom Bar: Advanced + LoRA Browser + Recipes + Style Bibles + Model + Generate.

          The model selector sits on its own row: on one row the five controls
          packed into ~375px and the model name was truncated by 72px
          ("LTX-2.3 Distilled 1.1 22B" showed as "LTX-2.3 Disti…"). As its own
          row it gets the full sidebar width, and the action row keeps only
          the icons plus the Generate group.

          The Style Bibles shortcut lives here (as an icon, next to Recipes and
          the LoRA browser) instead of in the results-panel header — the
          results header is a media surface, while every other global
          shortcut (Advanced, Recipes, LoRA) already lives in this row.

          Standalone tool workflows (upscale / film grain / revoice) hide the
          model + Generate controls — ToolsPanel owns its own Run button and
          no model — but the Style Bibles icon stays so the shortcut never
          disappears from Studio. */}
      <div className="px-3 py-2.5 border-t border-border flex flex-col gap-2">
        {!isStandaloneTool && (
          <div className="w-full">
            <ModelSelector />
          </div>
        )}
        <div className="flex items-center gap-2">
          {!isStandaloneTool && <AdvancedSettings />}
          {!isStandaloneTool && (
            <button
              onClick={() => useStore.getState().setRecipesOpen(true)}
              className="p-2 rounded-lg bg-bg-tertiary border border-border hover:border-border-light text-text-secondary hover:text-accent-blue transition-colors shrink-0"
              title="Recipes — one-click presets"
              aria-label="Browse recipes"
            >
              <BookMarked size={14} />
            </button>
          )}
          {!isStandaloneTool && !isOutpaint && (
            <button
              onClick={() => openLoraBrowser(true, modelType)}
              className="p-2 rounded-lg bg-bg-tertiary border border-border hover:border-border-light text-text-secondary hover:text-accent-blue transition-colors shrink-0"
              title="Browse LoRAs on CivitAI"
              aria-label="Browse LoRAs on CivitAI"
            >
              <Globe size={14} />
            </button>
          )}
          <button
            onClick={onOpenStyleBibles}
            className="p-2 rounded-lg bg-bg-tertiary border border-border hover:border-border-light text-text-secondary hover:text-accent-blue transition-colors shrink-0"
            title="Style Bibles — character & environment anchors"
            aria-label="Manage Style Bibles"
            data-testid="studio-sidebar-style-bibles"
          >
            <BookOpen size={14} />
          </button>
          {!isStandaloneTool && (
            <div className="flex-1 min-w-0">
              <GenerateButton />
            </div>
          )}
        </div>
      </div>
    </>
  )

  return (
    <aside className="flex h-full min-h-0 w-full shrink-0 flex-col border-border bg-bg-secondary md:w-[400px] md:border-r xl:w-[440px]" aria-label="Manual generation controls">
      {studioControls}
    </aside>
  )
}
