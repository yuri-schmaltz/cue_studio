/**
 * Director additional-reference panels.
 *
 * Why this lives in its own file
 * ------------------------------
 * ``DirectorChat.tsx`` was originally a 3.9 kLOC monolith. The
 * character-refs / location-refs / voice-ref surface alone
 * accounted for ~580 lines of that file with no store reads
 * crossing the boundary from the orchestration logic in the rest
 * of the file. Splitting it out lets the parent ``DirectorChat``
 * keep a tight focus on pipeline orchestration (the dozens of
 * ``useStore`` selectors for analysis / planning / generation).
 *
 * Components exported
 * -------------------
 * * ``AdditionalRefsSection`` — the tabbed character / location
 *   ref panel plus the voice-ref + identity-scale row.
 * * ``DraggableRefRow`` — the row used by both Character and
 *   Location ref lists (label, remove, drag-handle, drop-target).
 *
 * ``DirectorReferenceInputs`` deliberately stays in
 * ``DirectorChat.tsx`` because it composes the file-local
 * ``ReferenceImageUpload`` component (which itself is bound to
 * ``AdditionalRefsSection`` via the ``imageOnly`` flag).
 */

import { useCallback, useState } from 'react'
import {
  X,
  MapPin,
  Users,
  Mic,
  Plus,
  ChevronDown,
  ChevronRight,
  ListVideo,
} from 'lucide-react'
import { useStore } from '../../stores/useStore'
import { DirectorActivityBadge } from './DirectorActivityBar'
import { SectionBadge, EnergyDot } from './DirectorChatBadges'

// Constants and helpers lifted from ``DirectorChat.tsx`` so the
// reference panel can stand on its own. The audio MIME accept list
// drives the file picker for voice references; ``formatTime``
// formats the per-section timestamp labels; ``sectionBarColors``
// maps a music section label to its bar colour.
const AUDIO_ACCEPT = '.wav,.mp3,.flac,.ogg,.m4a,.mp4,.mov,.mkv,.webm,.avi,.m4v'
const IMAGE_ACCEPT = '.png,.jpg,.jpeg,.webp,.bmp'

function formatTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

const sectionBarColors: Record<string, string> = {
  intro: 'bg-blue-500',
  verse: 'bg-green-500',
  chorus: 'bg-purple-500',
  bridge: 'bg-yellow-500',
  outro: 'bg-gray-500',
  instrumental: 'bg-cyan-500',
}

export function DraggableRefRow({ file, label, index, onRemove, onLabelChange, onReorder, placeholder }: {
  file: File; label: string; index: number
  onRemove: (i: number) => void
  onLabelChange: (i: number, v: string) => void
  onReorder: (from: number, to: number) => void
  placeholder: string
}) {
  const [dragOver, setDragOver] = useState(false)

  return (
    <div
      draggable
      onDragStart={e => { e.dataTransfer.setData('text/plain', String(index)); e.dataTransfer.effectAllowed = 'move' }}
      onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => {
        e.preventDefault(); setDragOver(false)
        const from = parseInt(e.dataTransfer.getData('text/plain'), 10)
        if (!isNaN(from) && from !== index) onReorder(from, index)
      }}
      /* Card layout in a 2-col grid: thumbnail on top, label input
         directly beneath. The thumbnail wrapper is fixed at a square
         aspect ratio so 16:9, 9:16 and 1:1 uploads all render with
         the same height — `object-contain` scales the longest edge
         into the box without cropping the subject (a character's
         face or a location's silhouette), and the neutral
         `bg-bg-tertiary` backdrop fills the unused edge. */
      className={`flex flex-col gap-1 group cursor-grab active:cursor-grabbing rounded border border-border bg-bg-secondary p-1 transition-colors ${
        dragOver ? 'border-accent-blue bg-accent-blue/10' : 'hover:border-border-light'
      }`}
    >
      <div className="relative aspect-square bg-bg-tertiary rounded border border-border overflow-hidden">
        <img src={URL.createObjectURL(file)} alt={`Ref ${index+1}`}
          className="absolute inset-0 w-full h-full object-contain pointer-events-none" />
        <button onClick={() => onRemove(index)}
          className="absolute -top-1 -right-1 bg-red-500 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity z-10">
          <X size={8} className="text-white" />
        </button>
        <span className="absolute bottom-0 left-0 bg-black/60 text-white text-2xs px-1 rounded-br rounded-tl pointer-events-none">
          {index + 1}
        </span>
      </div>
      <input
        type="text"
        value={label}
        onChange={e => onLabelChange(index, e.target.value)}
        placeholder={placeholder}
        className="w-full min-w-0 bg-bg-tertiary border border-border rounded px-1.5 py-0.5 text-2xs text-text-primary placeholder:text-text-muted focus:border-accent-blue outline-none"
      />
    </div>
  )
}

/** Square "add a reference" card used as the empty-state for the
 *  Character / Location / Voice reference tabs and as a trailing tile
 *  next to the grid when the list is already populated. Wraps a
 *  hidden file input so the entire card is the click target; keyboard
 *  activation (Space/Enter) opens the native file picker through the
 *  label-for pattern. The card stays square (aspect-square) so it
 *  reads as a tile in the grid (matching the populated DraggableRefRow
 *  footprint) and as a single big "tap to add" affordance when used
 *  as the empty-state. `disabled` paints the card in muted tones and
 *  blocks the file picker — used for the voice-ref unavailable
 *  state so the user sees an affordance shape that explains why the
 *  section is hidden without a verbose italic helper. */
function RefAddCard({
  testid,
  title,
  hint,
  onFiles,
  accept,
  disabled = false,
}: {
  testid: string
  title: string
  hint?: string
  onFiles: (files: FileList | null) => void
  accept: string
  disabled?: boolean
}) {
  const inputId = `${testid}-input`
  return (
    <label
      htmlFor={inputId}
      data-testid={testid}
      className={`aspect-square w-full rounded-lg border border-dashed flex flex-col items-center justify-center gap-1.5 p-3 text-center transition-colors ${
        disabled
          ? 'border-border bg-bg-tertiary/30 text-text-muted/60 cursor-not-allowed'
          : 'border-accent-blue/50 bg-accent-blue/5 hover:bg-accent-blue/10 hover:border-accent-blue text-text-secondary hover:text-text-primary cursor-pointer'
      }`}
    >
      <div className={`flex items-center justify-center h-7 w-7 rounded-full ${
        disabled ? 'bg-bg-tertiary' : 'bg-accent-blue/15 text-accent-blue'
      }`}>
        {disabled ? <Mic size={14} className="text-text-muted/60" /> : <Plus size={16} className="text-accent-blue" />}
      </div>
      <span className="text-2xs font-medium leading-tight">{title}</span>
      {hint && (
        <span className="text-[10px] text-text-muted/80 leading-tight line-clamp-3 px-1">
          {hint}
        </span>
      )}
      <input
        id={inputId}
        type="file"
        accept={accept}
        multiple={accept.startsWith('.png')}
        disabled={disabled}
        className="sr-only"
        onChange={e => {
          onFiles(e.target.files)
          e.target.value = ''
        }}
      />
    </label>
  )
}

export function AdditionalRefsSection() {
  const charRefs = useStore(s => s.directorCharacterRefs)
  const charLabels = useStore(s => s.directorCharacterRefLabels)
  const locRefs = useStore(s => s.directorLocationRefs)
  const locLabels = useStore(s => s.directorLocationRefLabels)
  const addCharRef = useStore(s => s.directorAddCharacterRef)
  const removeCharRef = useStore(s => s.directorRemoveCharacterRef)
  const setCharLabel = useStore(s => s.directorSetCharacterRefLabel)
  const reorderCharRefs = useStore(s => s.directorReorderCharacterRefs)
  const addLocRef = useStore(s => s.directorAddLocationRef)
  const removeLocRef = useStore(s => s.directorRemoveLocationRef)
  const setLocLabel = useStore(s => s.directorSetLocationRefLabel)
  const reorderLocRefs = useStore(s => s.directorReorderLocationRefs)
  const voiceRef = useStore(s => s.directorVoiceRef)
  const setVoiceRef = useStore(s => s.setDirectorVoiceRef)
  const identityScale = useStore(s => s.directorIdentityGuidanceScale)
  const setIdentityScale = useStore(s => s.setDirectorIdentityGuidanceScale)
  const voiceReferenceEnabled = useStore(s => s.servicesConfig?.voice_reference_enabled ?? false)
  const selectedVideoModel = useStore(s => s.selectedModelPerMode.video || 'ltx2_22B_distilled_1_1')
  const supportsVoiceReference = useStore(s => (
    s.models.find(model => model.model_type === selectedVideoModel)
      ?.director?.supports_voice_reference ?? false
  ))
  const voiceReferenceMode = useStore(s => (
    s.models.find(model => model.model_type === selectedVideoModel)
      ?.director?.voice_reference_mode ?? 'none'
  ))

  /* Two equal-width tabs (Character refs / Location refs) live at the
     top of the section. The active tab owns the panel below — clicking
     the inactive tab switches the visible ref list without losing the
     user's selections in the other tab. State is kept here (not in
     the store) because it's purely a UI affordance: the refs themselves
     remain in directorCharacterRefs / directorLocationRefs regardless
     of which tab is open. */
  const [activeRefTab, setActiveRefTab] = useState<'char' | 'loc'>('char')

  const handleFiles = useCallback((files: FileList | null, type: 'char' | 'loc') => {
    if (!files) return
    const add = type === 'char' ? addCharRef : addLocRef
    Array.from(files).forEach(f => { if (f.type.startsWith('image/')) add(f) })
    // Switch to the tab the user just dropped into so the new ref is
    // visible without a second click.
    setActiveRefTab(type)
  }, [addCharRef, addLocRef])

  const nativeVoiceReference = voiceReferenceMode === 'native_reference'
  const showVoiceReference = supportsVoiceReference
    && (nativeVoiceReference || voiceReferenceEnabled)

  const charCount = charRefs.length
  const locCount = locRefs.length

  return (
    /* The "Additional references" header (collapsible <button> with
       chevron + Users icon + count badge) used to gate the section
       behind a click. The user asked to drop the header entirely and
       keep the "Character refs" / "Location refs" surfaces always
       reachable — they now live as two equal-width tabs spanning the
       full width of the chat column, with the active tab's content
       rendered below in a single full-width panel. The local scroll
       wrapper is preserved so the section still respects the 40vh
       ceiling and shows the only visible scrollbar in the chat
       column. */
    <div className="mt-1.5 space-y-2 pl-1 max-h-[40vh] overflow-y-auto scrollbar-visible">
      {/* Two equal-width tabs styled as rounded buttons (matching the
          "Upload a track" / "References" pill aesthetic): each tab is
          a self-contained pill with border + rounded corners and a
          small `gap-2` separates them. Active tab fills with the
          accent colour border; inactive keeps the muted border so the
          boundary reads without relying on colour alone. */}
      <div role="tablist" aria-label="Reference images"
        className="flex w-full gap-2">
        <button
          type="button"
          role="tab"
          aria-selected={activeRefTab === 'char'}
          onClick={() => setActiveRefTab('char')}
          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
            activeRefTab === 'char'
              ? 'border-accent-blue text-text-primary bg-bg-tertiary'
              : 'border-border hover:border-border-light text-text-secondary hover:text-text-primary bg-bg-tertiary'
          }`}
        >
          <Users size={11} className={activeRefTab === 'char' ? 'text-accent-blue shrink-0' : 'text-text-muted shrink-0'} />
          <span>Character refs</span>
          {charCount > 0 && (
            <span className={`px-1.5 rounded-full text-[10px] leading-tight ${
              activeRefTab === 'char' ? 'bg-accent-blue/15 text-accent-blue' : 'bg-bg-secondary text-text-muted'
            }`}>{charCount}</span>
          )}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeRefTab === 'loc'}
          onClick={() => setActiveRefTab('loc')}
          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
            activeRefTab === 'loc'
              ? 'border-accent-blue text-text-primary bg-bg-tertiary'
              : 'border-border hover:border-border-light text-text-secondary hover:text-text-primary bg-bg-tertiary'
          }`}
        >
          <MapPin size={11} className={activeRefTab === 'loc' ? 'text-accent-blue shrink-0' : 'text-text-muted shrink-0'} />
          <span>Location refs</span>
          {locCount > 0 && (
            <span className={`px-1.5 rounded-full text-[10px] leading-tight ${
              activeRefTab === 'loc' ? 'bg-accent-blue/15 text-accent-blue' : 'bg-bg-secondary text-text-muted'
            }`}>{locCount}</span>
          )}
        </button>
      </div>

      {/* Active tab's content panel — full width below the tab strip.
          Each card stacks its reference photo on top and the label
          input directly below so the eye reads top-to-bottom per ref.
          When the active tab is empty we replace the verbose empty-
          state text with a single square "Add references" card so the
          eye reads the affordance at a glance — the card is a label
          wrapping a hidden file input, so clicking / keyboard-activating
          it opens the native file picker for the current tab's
          reference type (image for character / location, audio for
          voice). The + icon and the empty-state helper sit inside the
          card so the surface reads as "tap to add" without needing a
          separate Add button + caption combo. */}
      <div role="tabpanel" className="space-y-1.5">
        {activeRefTab === 'char' ? (
          <>
            {charRefs.length > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                {charRefs.map((f, i) => (
                  <DraggableRefRow key={`c${i}-${f.name}`} file={f} label={charLabels[i] || ''} index={i}
                    onRemove={removeCharRef} onLabelChange={setCharLabel} onReorder={reorderCharRefs}
                    placeholder="e.g. Thor - blonde, hammer" />
                ))}
                <RefAddCard
                  testid="ref-add-card-char"
                  title="Add character ref"
                  onFiles={files => handleFiles(files, 'char')}
                  accept={IMAGE_ACCEPT}
                />
              </div>
            ) : (
              <RefAddCard
                testid="ref-add-card-char"
                title="Add character ref"
                hint="Drop close-up portraits for best identity lock"
                onFiles={files => handleFiles(files, 'char')}
                accept={IMAGE_ACCEPT}
              />
            )}
          </>
        ) : (
          <>
            {locRefs.length > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                {locRefs.map((f, i) => (
                  <DraggableRefRow key={`l${i}-${f.name}`} file={f} label={locLabels[i] || ''} index={i}
                    onRemove={removeLocRef} onLabelChange={setLocLabel} onReorder={reorderLocRefs}
                    placeholder="e.g. backstage, leather couches" />
                ))}
                <RefAddCard
                  testid="ref-add-card-loc"
                  title="Add location ref"
                  onFiles={files => handleFiles(files, 'loc')}
                  accept={IMAGE_ACCEPT}
                />
              </div>
            ) : (
              <RefAddCard
                testid="ref-add-card-loc"
                title="Add location ref"
                hint="Lock the look of recurring environments"
                onFiles={files => handleFiles(files, 'loc')}
                accept={IMAGE_ACCEPT}
              />
            )}
          </>
        )}
      </div>

      {/* LTX uses an ID-LoRA; H3 Omni maps the sample as a native voice
          reference in each shot's Ref2VA manifest. */}
      {showVoiceReference && <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-2xs text-text-secondary inline-flex items-center gap-1"
            title="Voice reference: only available on models that support voice cloning (LTX, H3 Omni). Keeps the speaker's timbre consistent across clips.">
            <Mic size={9} className="text-accent-blue/70" />
            Voice ref
          </span>
          {!voiceRef ? (
            <label className="cursor-pointer text-2xs text-accent-blue hover:underline">
              + Add
              <input type="file" accept={AUDIO_ACCEPT} className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) setVoiceRef(f); e.target.value = '' }} />
            </label>
          ) : (
            <button onClick={() => setVoiceRef(null)} className="text-2xs text-red-400 hover:text-red-300">Remove</button>
          )}
        </div>
        {voiceRef ? (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 bg-bg-tertiary rounded px-1.5 py-1">
              <Mic size={10} className="text-accent-blue shrink-0" />
              <span className="text-2xs text-text-secondary truncate">{voiceRef.name}</span>
            </div>
            {!nativeVoiceReference && <div className="flex items-center gap-1.5">
              <span className="text-2xs text-text-muted whitespace-nowrap">Identity scale</span>
              <input type="range" min={0} max={10} step={0.5} value={identityScale}
                onChange={e => setIdentityScale(parseFloat(e.target.value))}
                className="flex-1 h-1 accent-accent-blue" />
              <span className="text-2xs text-text-muted w-5 text-right">{identityScale}</span>
            </div>}
          </div>
        ) : (
          <p className="text-2xs text-text-muted italic">
            {nativeVoiceReference
              ? 'Voice sample used by H3 Omni for the primary speaking character'
              : '~5 sec voice sample for consistent voice across clips'}
          </p>
        )}
      </div>}
      {/* Why Voice ref may be missing — only shown when the model does
          NOT support voice cloning so the user understands the section
          isn't broken, just hidden by their current video model. The
          previous italic helper line was replaced with a unified
          square add-card so the visual affordance matches the
          character / location tabs above: clicking it opens the native
          file picker for an audio file, and the disabled state makes it
          obvious the action would be a no-op for the current model. */}
      {!showVoiceReference && (
        <RefAddCard
          testid="ref-add-card-voice-disabled"
          title="Voice ref unavailable"
          hint="Current model doesn't support voice cloning — switch to LTX or H3 Omni in Generation Options to enable."
          onFiles={() => undefined}
          accept={AUDIO_ACCEPT}
          disabled
        />
      )}
    </div>
  )
}

export function AnalysisSummary({
  analysis, showDetails, setShowDetails, isShortFilm,
}: {
  analysis: NonNullable<ReturnType<typeof useStore.getState>['directorAnalysis']>
  showDetails: boolean
  setShowDetails: (v: boolean | ((p: boolean) => boolean)) => void
  speakerMappings?: ReturnType<typeof useStore.getState>['directorSpeakerMappings']
  isShortFilm?: boolean
}) {
  // Count unique speakers
  const speakerCount = new Set(
    (analysis.lyrics || []).map(l => l.speaker).filter(Boolean)
  ).size

  return (
    /* The "Analysis complete" / "Transcription complete" header used
       to render as a static paragraph above the stats toggle. The
       user asked to drop it because the toggle's own chips
       (duration, BPM, sections, lyric segments) already convey the
       same outcome — the prose paragraph was redundant. */
    <div className="space-y-1">
      <button
        onClick={() => setShowDetails(v => !v)}
        className="flex items-center gap-3 text-xs text-text-muted w-full hover:text-text-secondary transition-colors"
      >
        <ChevronDown size={10} className={`transition-transform ${showDetails ? '' : '-rotate-90'}`} />
        <span>{formatTime(analysis.duration)}</span>
        {!isShortFilm && <span>{analysis.bpm.toFixed(0)} BPM</span>}
        {isShortFilm && speakerCount > 0 && <span>{speakerCount} speaker{speakerCount > 1 ? 's' : ''}</span>}
        {!isShortFilm && <span>{analysis.sections.length} sections</span>}
        {analysis.lyrics && <span>{analysis.lyrics.length} {isShortFilm ? 'dialogue lines' : 'lyric segments'}</span>}
      </button>

      {showDetails && (
        // No inner scroll — chat panel handles scrolling.
        <div className="bg-bg-tertiary rounded-lg p-2 space-y-2 text-2xs">
          <div>
            <div className="text-text-muted uppercase tracking-wider mb-1 font-medium">Sections</div>
            <div className="space-y-0.5">
              {analysis.sections.map((sec, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-text-muted w-16 shrink-0">
                    {formatTime(sec.start)}-{formatTime(sec.end)}
                  </span>
                  <SectionBadge label={sec.label} />
                  <EnergyDot energy={sec.energy} />
                  <span className="text-text-muted">{(sec.energy * 100).toFixed(0)}%</span>
                </div>
              ))}
            </div>
          </div>

          {analysis.lyrics && analysis.lyrics.length > 0 && (
            <div>
              <div className="text-text-muted uppercase tracking-wider mb-1 font-medium">
                Lyrics {analysis.song_structure?.length ? '(LLM Structure)' : '(Whisper)'}
              </div>
              <div className="space-y-0.5">
                {analysis.song_structure && analysis.song_structure.length > 0 ? (
                  analysis.song_structure.map((section, si) => {
                    const nextStart = si < analysis.song_structure!.length - 1
                      ? analysis.song_structure![si + 1].start
                      : Infinity
                    const sectionLyrics = analysis.lyrics!.filter(
                      seg => seg.start >= section.start && seg.start < nextStart
                    )
                    return (
                      <div key={si} className="mb-1.5">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <SectionBadge label={section.label} />
                          <span className="text-text-muted">{formatTime(section.start)}</span>
                          <span className="text-text-secondary font-medium">[{section.display_label}]</span>
                        </div>
                        {sectionLyrics.map((seg, li) => (
                          <div key={li} className="flex gap-2 pl-2">
                            <span className="text-text-muted w-14 shrink-0 text-right">
                              {formatTime(seg.start)}
                            </span>
                            <span className="text-text-secondary">
                              {seg.speaker && (
                                <span className="text-accent-blue text-2xs mr-1">[{seg.speaker}]</span>
                              )}
                              {seg.text}
                            </span>
                          </div>
                        ))}
                        {sectionLyrics.length === 0 && (
                          <div className="pl-2 text-text-muted italic">(instrumental)</div>
                        )}
                      </div>
                    )
                  })
                ) : (
                  analysis.lyrics.map((seg, i) => (
                    <div key={i} className="flex gap-2">
                      <span className="text-text-muted w-16 shrink-0">
                        {formatTime(seg.start)}-{formatTime(seg.end)}
                      </span>
                      <span className="text-text-secondary">
                        {seg.speaker && (
                          <span className="text-accent-blue text-2xs mr-1">[{seg.speaker}]</span>
                        )}
                        {seg.text}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function StructureView({
  plannedClips, energyBias, localBias, setLocalBias, sliderRef, setEnergyBias,
  loading, totalClipDuration, beatDistribution, confirmStructure, isActive, isShortFilm,
}: {
  plannedClips: ReturnType<typeof useStore.getState>['directorPlannedClips']
  energyBias: number
  localBias: number | null
  setLocalBias: (v: number | null) => void
  sliderRef: React.MutableRefObject<number | null>
  setEnergyBias: (bias: number) => Promise<void>
  loading: boolean
  totalClipDuration: number
  beatDistribution: string
  confirmStructure: () => void
  isActive: boolean
  isShortFilm?: boolean
}) {
  return (
    <div className="space-y-3">
      {/* The old "Here's the clip structure based on the audio analysis.
          Adjust the cut speed if needed." paragraph was redundant with the
          CLIP STRUCTURE header above and the slider label below. The user
          asked to drop it from the audio-analysis card so the structure
          preview reads as a clean visual block without instructional prose. */}

      {isActive && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs text-text-muted uppercase tracking-wider">{isShortFilm ? 'Scene Pacing' : 'Cut Speed'}</label>
            <span className="text-xs text-text-secondary">
              {(localBias ?? energyBias) > 0 ? '+' : ''}{localBias ?? energyBias}
            </span>
          </div>
          <input
            type="range"
            min={-2}
            max={2}
            step={1}
            value={localBias ?? energyBias}
            onChange={e => {
              const v = Number(e.target.value)
              setLocalBias(v)
              sliderRef.current = v
            }}
            onMouseUp={() => {
              if (sliderRef.current !== null && sliderRef.current !== energyBias) {
                setEnergyBias(sliderRef.current)
              }
              setLocalBias(null)
              sliderRef.current = null
            }}
            onTouchEnd={() => {
              if (sliderRef.current !== null && sliderRef.current !== energyBias) {
                setEnergyBias(sliderRef.current)
              }
              setLocalBias(null)
              sliderRef.current = null
            }}
            className="w-full"
          />
          <div className="flex items-center justify-between mt-1 text-2xs text-text-muted">
            <span>{isShortFilm ? 'Longer scenes' : 'Slower cuts'}</span>
            <span>{isShortFilm ? 'Shorter scenes' : 'Faster cuts'}</span>
          </div>
        </div>
      )}

      <div className="bg-bg-tertiary rounded-lg p-2 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-text-secondary font-medium">{plannedClips.length} {isShortFilm ? 'scenes' : 'clips'}</span>
          <span className="text-text-muted">{formatTime(totalClipDuration)} total</span>
        </div>

        {loading ? (
          /* Live activity badge — replaces the hard-coded
             "Recalculating..." string that used to sit here. Reads
             directorActivityLabel from the store (derived from the
             live pipeline status) so the label reflects the actual
             phase (Planning with LLM…, Polishing prompts…,
             Generating start image 3/13…). Cancel button reuses
             cancelDirectorV2Plan() which aborts the HTTP request
             AND tells the backend to short-circuit the worker
             thread. */
          <DirectorActivityBadge cancelTitle="Stop the Director run" />
        ) : plannedClips.length === 0 ? (
          /* Empty state — shown when the structure step is reached but
             no clips have been generated yet (e.g. the user attached
             a script that reset the analysis but never re-ran Send,
             or opened an existing project where the analysis was
             never persisted). Replaces the previous misleading "0
             clips / 0:00 total" that looked like an empty result
             instead of an uninitialised state. */
          <div className="flex items-start gap-2 py-1 text-2xs text-text-muted">
            <ListVideo size={12} className="shrink-0 mt-px text-text-muted" />
            <span className="leading-snug">
              No {isShortFilm ? 'scenes' : 'clips'} planned yet.
              {isActive
                ? ` Press Send in the composer below to generate the ${isShortFilm ? 'scene' : 'clip'} structure.`
                : ` Send a brief with a scene description to plan the ${isShortFilm ? 'scenes' : 'clip structure'}.`}
            </span>
          </div>
        ) : (
          <>
            <div className="flex gap-px h-8 rounded overflow-hidden">
              {plannedClips.map((clip, i) => {
                const clipDur = clip.end - clip.start
                const totalDur = plannedClips.reduce((s, c) => s + (c.end - c.start), 0)
                const widthPct = isShortFilm
                  ? Math.max((clipDur / totalDur) * 100, 1.5)
                  : Math.max((clip.beat_count / plannedClips.reduce((s, c) => s + c.beat_count, 0)) * 100, 1.5)
                const barColor = sectionBarColors[clip.section_label] || 'bg-gray-500'
                const tooltipLabel = isShortFilm
                  ? `Scene ${i + 1}: ${clip.section_label} (${clipDur.toFixed(1)}s)`
                  : `Clip ${i + 1}: ${clip.section_label}, ${clip.beat_count} beats (${clipDur.toFixed(1)}s)`
                return (
                  <div
                    key={i}
                    className={`${barColor} opacity-70 hover:opacity-100 transition-opacity relative group cursor-default`}
                    style={{ width: `${widthPct}%` }}
                    title={tooltipLabel}
                  >
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block z-10 pointer-events-none">
                      <div className="bg-bg-primary border border-border rounded px-1.5 py-1 text-2xs text-text-secondary whitespace-nowrap shadow-lg">
                        {tooltipLabel}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="text-2xs text-text-muted space-y-1">
              {!isShortFilm && <div>{beatDistribution}</div>}
              <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                {Object.entries(sectionBarColors).map(([label, color]) => {
                  const count = plannedClips.filter(c => c.section_label === label).length
                  if (count === 0) return null
                  return (
                    <div key={label} className="flex items-center gap-1">
                      <span className={`w-2 h-2 rounded-sm ${color}`} />
                      <span>{label} ({count})</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </>
        )}
      </div>

      {isActive && (
        <button
          onClick={confirmStructure}
          disabled={loading || plannedClips.length === 0}
          className="w-full py-2 rounded-lg bg-accent-blue text-white text-xs font-medium hover:bg-accent-blue-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
        >
          <ChevronRight size={12} /> Continue
        </button>
      )}
    </div>
  )
}

/**
 * DirectorAdvancedAccordion — collapsed-by-default panel exposing Director's
 * model-specific generation controls and post-processing knobs. It sits in
 * the chat sidebar alongside the LoRA accordion so per-shoot tweaks are
 * co-located with the rest of the per-shoot setup.
 *
 * Defaults are intentionally "off" for all controls so a user who
 * never opens this accordion gets clean unprocessed output. Each
 * control has a one-line description making clear what it does and
 * what it costs (e.g. "may introduce artifacts" for the refiner)
 * rather than implying a quality hierarchy.
 *
 * No "Quality" preset bundling — the three controls are independent
 * with distinct purposes (resolution change vs aesthetic vs
 * experimental). See the design discussion captured in commit notes.
 */