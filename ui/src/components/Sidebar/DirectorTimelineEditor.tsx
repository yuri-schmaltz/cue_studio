import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Wand2,
  X,
  Play,
  Square,
  Scissors,
  Merge,
  Undo2,
  Clock,
  Sparkles,
} from 'lucide-react'
import { useStore } from '../../stores/useStore'
import { editDirectorTimeline, type SceneSlot, type TimelineEdit } from '../../lib/directorTimeline'

const SECTION_COLORS: Record<string, { bg: string; text: string; badge: string }> = {
  intro: { bg: 'bg-blue-500', text: 'text-blue-400', badge: 'bg-blue-500/20 text-blue-300 border-blue-500/40' },
  verse: { bg: 'bg-emerald-500', text: 'text-emerald-400', badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' },
  chorus: { bg: 'bg-purple-500', text: 'text-purple-400', badge: 'bg-purple-500/20 text-purple-300 border-purple-500/40' },
  bridge: { bg: 'bg-amber-500', text: 'text-amber-400', badge: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
  outro: { bg: 'bg-slate-500', text: 'text-slate-400', badge: 'bg-slate-500/20 text-slate-300 border-slate-500/40' },
  instrumental: { bg: 'bg-cyan-500', text: 'text-cyan-400', badge: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' },
}

function getSectionStyle(label?: string) {
  const key = (label || '').toLowerCase().trim()
  return SECTION_COLORS[key] || { bg: 'bg-zinc-500', text: 'text-zinc-400', badge: 'bg-zinc-500/20 text-zinc-300 border-zinc-500/40' }
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  const ms = Math.floor((sec % 1) * 10)
  return m > 0 ? `${m}m ${s}.${ms}s` : `${s}.${ms}s`
}

function formatTimecode(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** Shared hook for the timeline editor button + dialog. Both the
 *  full-width "Edit scene timing" button (legacy layout) and the
 *  compact icon button (header of the CLIP STRUCTURE card) drive the
 *  same dialog. Keeping the open-state here means a future "Open
 *  editor from elsewhere" trigger (e.g. a keyboard shortcut) only
 *  needs to flip this boolean. */
function useTimelineEditor() {
  const clips = useStore(s => s.directorPlannedClips)
  const loading = useStore(s => s.directorLoading)
  const status = useStore(s => s.pipelineStatus?.status)
  const [open, setOpen] = useState(false)
  const active = ['queued', 'running'].includes(status || '')
  const disabled = (loading && status !== 'paused') || active
  const disabledReason = active
    ? 'Stop the active production before changing its scene structure.'
    : 'Split, resize or merge scenes before generation'
  return {
    clips,
    open,
    setOpen,
    disabled,
    disabledReason,
  }
}

export function DirectorTimelineEditor() {
  const { clips, open, setOpen, disabled, disabledReason } = useTimelineEditor()
  if (!clips.length) return null
  return <>
    <button
      type="button"
      className="w-full h-8 rounded-lg border border-accent-blue/50 text-accent-blue hover:bg-accent-blue/10 flex items-center justify-center gap-2 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0 shadow-xs"
      disabled={disabled}
      title={disabledReason}
      onClick={() => setOpen(true)}
    >
      <Wand2 size={13} className="shrink-0" />
      <span>Dividir / editar clipes ({clips.length})</span>
    </button>
    {open && createPortal(<TimelineDialog close={() => setOpen(false)} />, document.body)}
  </>
}

export function DirectorTimelineIconButton() {
  const { clips, open, setOpen, disabled, disabledReason } = useTimelineEditor()
  if (!clips.length) return null
  return <>
    <button
      type="button"
      onClick={() => setOpen(true)}
      disabled={disabled}
      title={disabledReason}
      aria-label={`Edit scene timing · ${clips.length} scenes`}
      className="inline-flex items-center justify-center h-6 w-6 rounded border border-accent-blue/70 text-accent-blue hover:bg-accent-blue/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <Wand2 size={12} />
    </button>
    {open && createPortal(<TimelineDialog close={() => setOpen(false)} />, document.body)}
  </>
}

function TimelineDialog({ close }: { close: () => void }) {
  const dialog = useRef<HTMLElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    return () => previous?.focus()
  }, [])

  const state = useStore.getState()
  const audioFile = useStore(s => s.directorAudioFile)
  const [original] = useState(() => state.directorPlannedClips)
  const [slots, setSlots] = useState<SceneSlot[]>(() => original.map((clip, index) => ({ clip: { ...clip }, sources: [index] })))
  const [history, setHistory] = useState<SceneSlot[][]>([])
  const [seconds, setSeconds] = useState('6')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [playingIndex, setPlayingIndex] = useState<number | null>(null)
  const [activeHighlightIndex, setActiveHighlightIndex] = useState<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
    }
  }, [])

  const handleTogglePlay = useCallback((start: number, end: number, index: number) => {
    if (!audioFile) return
    if (playingIndex === index) {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
      setPlayingIndex(null)
      return
    }

    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }

    const url = URL.createObjectURL(audioFile)
    const audio = new Audio(url)
    audioRef.current = audio
    audio.currentTime = Math.max(0, start)

    const onTimeUpdate = () => {
      if (audio.currentTime >= end) {
        audio.pause()
        URL.revokeObjectURL(url)
        audioRef.current = null
        setPlayingIndex(null)
      }
    }
    const onEnded = () => {
      URL.revokeObjectURL(url)
      audioRef.current = null
      setPlayingIndex(null)
    }

    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('ended', onEnded)

    audio.play().then(() => {
      setPlayingIndex(index)
    }).catch(err => {
      console.warn('[TimelineDialog] audio error:', err)
      URL.revokeObjectURL(url)
      audioRef.current = null
      setPlayingIndex(null)
    })
  }, [audioFile, playingIndex])

  const edit = (action: TimelineEdit) => {
    try {
      const next = editDirectorTimeline(slots, action)
      setHistory(h => [...h, slots])
      setSlots(next)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid edit')
    }
  }

  const save = async () => {
    setSaving(true)
    try {
      await useStore.getState().directorApplyTimeline(slots, original)
      close()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to save')
    } finally {
      setSaving(false)
    }
  }

  const totalDuration = slots.length > 0 ? slots[slots.length - 1].clip.end : 0

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-xs flex items-center justify-center p-3 animate-fade-in"
      onKeyDown={e => {
        if (e.key === 'Escape' && !saving) close()
        if (e.key === 'Tab') {
          const controls = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')
          if (!controls?.length) return
          const first = controls[0], last = controls[controls.length - 1]
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
        }
      }}
    >
      <section
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Edit scene timing"
        className="bg-bg-secondary border border-border/80 rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <header className="px-5 py-4 border-b border-border/60 flex items-center justify-between shrink-0 bg-bg-tertiary/40">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-accent-blue/15 text-accent-blue flex items-center justify-center shrink-0">
              <Wand2 size={16} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-text-primary">Divisão e sincronia das cenas</h2>
              <p className="text-2xs text-text-muted">
                Ajuste os pontos de corte e duração de cada cena sincronizados com a música
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-2xs px-2.5 py-1 rounded-full bg-bg-tertiary border border-border">
              <span className="font-semibold text-text-primary">{slots.length} cenas</span>
              <span className="text-text-muted">·</span>
              <span className="text-text-secondary">{formatTimecode(totalDuration)} ({totalDuration.toFixed(1)}s)</span>
            </div>
            <button
              type="button"
              onClick={close}
              disabled={saving}
              className="h-7 w-7 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-hover flex items-center justify-center transition-colors"
            >
              <X size={15} />
            </button>
          </div>
        </header>

        {/* Interactive Top Timeline Strip */}
        <div className="px-5 pt-3 pb-2 border-b border-border/40 bg-bg-primary/50 shrink-0">
          <div className="flex items-center justify-between mb-1.5 text-2xs text-text-muted font-medium">
            <span>Linha do tempo (proporção visual das cenas)</span>
            <span>{slots.length} cenas detectadas</span>
          </div>
          <div className="relative flex gap-1 h-9 rounded-xl p-1 bg-bg-secondary border border-border overflow-hidden">
            {slots.map((slot, i) => {
              const dur = slot.clip.end - slot.clip.start
              const pct = totalDuration > 0 ? (dur / totalDuration) * 100 : 0
              const style = getSectionStyle(slot.clip.section_label)
              const isPlaying = playingIndex === i
              const isHovered = activeHighlightIndex === i
              return (
                <div
                  key={i}
                  onMouseEnter={() => setActiveHighlightIndex(i)}
                  onMouseLeave={() => setActiveHighlightIndex(null)}
                  onClick={() => handleTogglePlay(slot.clip.start, slot.clip.end, i)}
                  style={{ width: `${Math.max(pct, 1.5)}%` }}
                  title={`Cena ${i + 1}: ${slot.clip.section_label} (${dur.toFixed(1)}s) - Clique para ouvir`}
                  className={`${style.bg} ${
                    isPlaying
                      ? 'ring-2 ring-white ring-inset opacity-100 animate-pulse'
                      : isHovered
                        ? 'opacity-100 brightness-110 shadow-sm'
                        : 'opacity-75 hover:opacity-100'
                  } transition-all rounded-md cursor-pointer flex items-center justify-center relative group min-w-[20px]`}
                >
                  <span className="text-[10px] font-bold text-white drop-shadow-xs select-none">
                    {i + 1}
                  </span>
                  {isPlaying ? (
                    <Square size={8} className="absolute inset-0 m-auto text-white fill-white" />
                  ) : (
                    <Play size={8} className="absolute inset-0 m-auto text-white fill-white opacity-0 group-hover:opacity-90 transition-opacity" />
                  )}
                </div>
              )
            })}
          </div>
          {/* Quick presets row */}
          <div className="flex flex-wrap items-center justify-between gap-3 mt-3 text-2xs">
            <div className="flex items-center gap-2">
              <span className="text-text-muted font-medium flex items-center gap-1">
                <Sparkles size={11} className="text-accent-blue" />
                Subdividir em lote:
              </span>
              <div className="flex items-center gap-1 bg-bg-tertiary border border-border rounded-lg px-2 py-0.5">
                <span className="text-text-muted">Máx:</span>
                <input
                  type="number"
                  min="1"
                  max="30"
                  step="0.5"
                  value={seconds}
                  onChange={e => setSeconds(e.target.value)}
                  className="w-12 bg-transparent text-text-primary text-center font-medium outline-none"
                />
                <span className="text-text-muted">seg</span>
              </div>
              <button
                type="button"
                onClick={() => edit({ kind: 'subdivide', seconds: Number(seconds) })}
                className="px-2.5 py-1 rounded-lg bg-bg-tertiary border border-border hover:border-accent-blue/60 hover:text-accent-blue text-text-secondary font-medium transition-colors"
              >
                Aplicar corte a todas
              </button>
            </div>
            {history.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setSlots(history[history.length - 1])
                  setHistory(h => h.slice(0, -1))
                  setError('')
                }}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-bg-tertiary border border-border hover:text-text-primary text-text-muted transition-colors"
              >
                <Undo2 size={11} />
                <span>Desfazer última alteração</span>
              </button>
            )}
          </div>
        </div>

        {/* Scrollable List of Scene Cards */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-2.5 scrollbar-visible">
          {slots.map((slot, index) => (
            <TimingRow
              key={`${index}-${slot.clip.start}-${slot.clip.end}`}
              slot={slot}
              index={index}
              last={index === slots.length - 1}
              edit={edit}
              isPlaying={playingIndex === index}
              onTogglePlay={() => handleTogglePlay(slot.clip.start, slot.clip.end, index)}
              isHovered={activeHighlightIndex === index}
              onHover={setActiveHighlightIndex}
              audioAvailable={Boolean(audioFile)}
            />
          ))}
        </div>

        {error && (
          <div role="alert" className="px-5 py-2 bg-red-500/10 border-t border-red-500/30 text-red-400 text-xs flex items-center justify-between">
            <span>{error}</span>
            <button type="button" onClick={() => setError('')} className="text-2xs underline">Fechar</button>
          </div>
        )}

        {/* Footer */}
        <footer className="px-5 py-3.5 border-t border-border/60 bg-bg-tertiary/40 flex items-center justify-between shrink-0">
          <p className="text-2xs text-text-muted max-w-[480px]">
            As alterações recalculam o tempo das cenas sem refazer o áudio. As imagens e prompts serão ajustados para os novos limites.
          </p>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              disabled={saving}
              onClick={close}
              className="px-3 py-1.5 rounded-lg border border-border text-xs text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void save()}
              className="px-4 py-1.5 rounded-lg bg-accent-blue text-white text-xs font-medium hover:bg-accent-blue-hover transition-colors disabled:opacity-40 shadow-xs flex items-center gap-1.5"
            >
              {saving ? 'Salvando...' : 'Aplicar divisão de cenas'}
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}

function TimingRow({
  slot,
  index,
  last,
  edit,
  isPlaying,
  onTogglePlay,
  isHovered,
  onHover,
  audioAvailable,
}: {
  slot: SceneSlot
  index: number
  last: boolean
  edit: (edit: TimelineEdit) => void
  isPlaying: boolean
  onTogglePlay: () => void
  isHovered: boolean
  onHover: (idx: number | null) => void
  audioAvailable: boolean
}) {
  const duration = slot.clip.end - slot.clip.start
  const defaultCutTime = ((slot.clip.start + slot.clip.end) / 2).toFixed(2)
  const [cut, setCut] = useState(defaultCutTime)
  const [end, setEnd] = useState(slot.clip.end.toFixed(2))
  const [showAdjust, setShowAdjust] = useState(false)
  const style = getSectionStyle(slot.clip.section_label)

  return (
    <div
      onMouseEnter={() => onHover(index)}
      onMouseLeave={() => onHover(null)}
      className={`rounded-xl border transition-all p-3.5 ${
        isHovered
          ? 'border-accent-blue/70 bg-bg-tertiary/80 shadow-md'
          : isPlaying
            ? 'border-accent-blue bg-accent-blue/5'
            : 'border-border/80 bg-bg-tertiary/40 hover:border-border'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        {/* Left: Index + Section badge + Timestamp */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="h-6 w-6 rounded-md bg-bg-secondary border border-border flex items-center justify-center font-bold text-xs text-text-primary shrink-0">
            {index + 1}
          </div>
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border shrink-0 ${style.badge}`}>
            {slot.clip.section_label || 'Scene'}
          </span>
          <div className="flex items-center gap-1.5 text-xs text-text-secondary">
            <span className="font-mono text-text-primary font-medium">
              {slot.clip.start.toFixed(2)}s – {slot.clip.end.toFixed(2)}s
            </span>
            <span className="text-text-muted">·</span>
            <span className="text-text-muted flex items-center gap-1">
              <Clock size={10} />
              {formatDuration(duration)}
            </span>
            {slot.clip.beat_count > 0 && (
              <span className="text-2xs text-text-muted">
                ({slot.clip.beat_count} batidas)
              </span>
            )}
          </div>
        </div>

        {/* Right: Audio preview & Action buttons */}
        <div className="flex items-center gap-1.5 shrink-0">
          {audioAvailable && (
            <button
              type="button"
              onClick={onTogglePlay}
              className={`h-7 px-2.5 rounded-lg border text-2xs font-medium flex items-center gap-1.5 transition-colors ${
                isPlaying
                  ? 'border-accent-blue bg-accent-blue text-white animate-pulse'
                  : 'border-border hover:border-border-light bg-bg-secondary text-text-secondary hover:text-text-primary'
              }`}
              title={isPlaying ? 'Pausar áudio' : 'Ouvir trecho da cena'}
            >
              {isPlaying ? <Square size={10} className="fill-white" /> : <Play size={10} className="fill-current" />}
              <span>{isPlaying ? 'Parar' : 'Ouvir'}</span>
            </button>
          )}

          {/* Quick Split button */}
          <button
            type="button"
            onClick={() => edit({ kind: 'split', index, time: Number(cut) })}
            className="h-7 px-2.5 rounded-lg border border-border hover:border-accent-blue/60 bg-bg-secondary hover:bg-bg-hover text-text-secondary hover:text-text-primary text-2xs font-medium flex items-center gap-1.5 transition-colors"
            title={`Dividir cena ${index + 1} em ${cut}s`}
          >
            <Scissors size={11} className="text-accent-blue" />
            <span>Dividir em {cut}s</span>
          </button>

          {/* Merge button */}
          {!last && (
            <button
              type="button"
              onClick={() => edit({ kind: 'merge', index })}
              className="h-7 px-2 rounded-lg border border-border hover:border-border-light bg-bg-secondary hover:bg-bg-hover text-text-muted hover:text-text-primary text-2xs transition-colors flex items-center gap-1"
              title="Mesclar com a próxima cena"
            >
              <Merge size={11} />
              <span>Mesclar</span>
            </button>
          )}

          {/* Toggle fine adjustments */}
          <button
            type="button"
            onClick={() => setShowAdjust(v => !v)}
            className={`h-7 px-2 rounded-lg border text-2xs transition-colors ${
              showAdjust ? 'border-accent-blue/60 bg-accent-blue/10 text-accent-blue' : 'border-border text-text-muted hover:text-text-primary'
            }`}
          >
            {showAdjust ? 'Fechar' : 'Ajustar'}
          </button>
        </div>
      </div>

      {/* Expanded Fine-tuning controls */}
      {showAdjust && (
        <div className="mt-3 pt-3 border-t border-border/50 flex flex-wrap items-center gap-4 text-2xs bg-bg-secondary/40 rounded-lg p-2.5">
          <div className="flex items-center gap-2">
            <span className="text-text-muted font-medium">Ponto exato de divisão:</span>
            <input
              aria-label={`Ponto de corte da cena ${index + 1}`}
              type="number"
              min={slot.clip.start + 0.1}
              max={slot.clip.end - 0.1}
              step="0.05"
              value={cut}
              onChange={e => setCut(e.target.value)}
              className="bg-bg-tertiary border border-border rounded px-2 py-1 w-20 text-text-primary font-mono text-center outline-none focus:border-accent-blue"
            />
            <span className="text-text-muted">seg</span>
            <button
              type="button"
              onClick={() => setCut(((slot.clip.start + slot.clip.end) / 2).toFixed(2))}
              className="text-2xs text-accent-blue hover:underline ml-1"
            >
              Centralizar
            </button>
          </div>

          {!last && (
            <div className="flex items-center gap-2 pl-3 border-l border-border/60">
              <span className="text-text-muted font-medium">Mover limite final:</span>
              <input
                aria-label={`Fim da cena ${index + 1}`}
                type="number"
                step="0.05"
                value={end}
                onChange={e => setEnd(e.target.value)}
                className="bg-bg-tertiary border border-border rounded px-2 py-1 w-20 text-text-primary font-mono text-center outline-none focus:border-accent-blue"
              />
              <span className="text-text-muted">seg</span>
              <button
                type="button"
                onClick={() => edit({ kind: 'boundary', index, time: Number(end) })}
                className="px-2.5 py-1 rounded bg-bg-tertiary border border-border hover:border-border-light text-text-primary font-medium"
              >
                Aplicar limite
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

