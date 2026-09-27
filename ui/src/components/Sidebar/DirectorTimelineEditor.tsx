import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Wand2 } from 'lucide-react'
import { useStore } from '../../stores/useStore'
import { editDirectorTimeline, type SceneSlot, type TimelineEdit } from '../../lib/directorTimeline'

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
      className="w-full h-7 rounded border border-accent-blue/50 text-accent-blue hover:bg-accent-blue/10 flex items-center justify-center gap-1.5 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
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

/** Compact square icon-only variant of the timeline editor trigger.
 *  Lives in the top-right of the CLIP STRUCTURE card next to the
 *  "N clips · 2:33" counter. Renders a magic-wand glyph to evoke the
 *  "tweak the scene layout" affordance without consuming the row with
 *  the verbose label. */
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
  const [original] = useState(() => state.directorPlannedClips)
  const [slots, setSlots] = useState<SceneSlot[]>(() => original.map((clip, index) => ({ clip: { ...clip }, sources: [index] })))
  const [history, setHistory] = useState<SceneSlot[][]>([])
  const [seconds, setSeconds] = useState('6')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const edit = (action: TimelineEdit) => {
    try { const next = editDirectorTimeline(slots, action); setHistory(h => [...h, slots]); setSlots(next); setError('') }
    catch (e) { setError(e instanceof Error ? e.message : 'Invalid edit') }
  }
  const save = async () => {
    setSaving(true)
    try { await useStore.getState().directorApplyTimeline(slots, original); close() }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to save') }
    finally { setSaving(false) }
  }
  return <div className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-3" onKeyDown={e => {
      if (e.key === 'Escape' && !saving) close()
      if (e.key === 'Tab') {
        const controls = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')
        if (!controls?.length) return
        const first = controls[0], last = controls[controls.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }}>
    <section ref={dialog} role="dialog" aria-modal="true" aria-label="Edit scene timing" className="bg-bg-secondary border border-border rounded-xl p-4 w-full max-w-3xl max-h-[90vh] overflow-auto space-y-4">
      <h2 className="text-lg">Edit scene timing</h2>
      <p className="text-xs text-text-muted">Times are absolute seconds in the soundtrack. Moving a boundary resizes both adjacent scenes. Splits inherit the original prompt and image; merges keep the first image and combine video prompts. Review prompts after applying changes. Existing window timing and approvals are reset; this does not generate new images automatically.</p>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label>Maximum scene duration (s) <input autoFocus type="number" min="0.1" step="0.1" value={seconds} onChange={e => setSeconds(e.target.value)} className="w-20 p-2 bg-bg-tertiary border border-border" /></label>
        <button onClick={() => edit({ kind: 'subdivide', seconds: Number(seconds) })} className="underline">Subdivide all scenes</button>
        <button disabled={!history.length} onClick={() => { setSlots(history[history.length - 1]); setHistory(h => h.slice(0, -1)); setError('') }} className="underline disabled:opacity-40">Undo</button>
        <span>{slots.length} scenes · {slots[slots.length - 1].clip.end.toFixed(2)}s</span>
      </div>
      {slots.map((slot, index) => <TimingRow key={`${index}-${slot.clip.start}-${slot.clip.end}`} slot={slot} index={index} last={index === slots.length - 1} edit={edit} />)}
      {error && <p role="alert" className="text-red-400 text-sm">{error}</p>}
      <div className="flex gap-3 justify-end text-sm"><button disabled={saving} onClick={close}>Cancel</button><button disabled={saving} className="bg-accent-blue text-white rounded px-3 py-2 disabled:opacity-40" onClick={() => void save()}>{saving ? 'Saving…' : 'Apply scene timing'}</button></div>
    </section>
  </div>
}
function TimingRow({ slot, index, last, edit }: { slot: SceneSlot; index: number; last: boolean; edit: (edit: TimelineEdit) => void }) {
  const [cut, setCut] = useState(((slot.clip.start + slot.clip.end) / 2).toFixed(3))
  const [end, setEnd] = useState(slot.clip.end.toFixed(3))
  return <div className="rounded border border-border p-3 space-y-2 text-xs">
    <p>Scene {index + 1} · {slot.clip.start.toFixed(3)}–{slot.clip.end.toFixed(3)}s · {slot.clip.section_label}</p>
    <div className="flex flex-wrap gap-3 items-center">
      <label>Split at (s) <input aria-label={`Scene ${index + 1} split time`} type="number" step="0.001" value={cut} onChange={e => setCut(e.target.value)} className="bg-bg-tertiary border border-border p-1 w-24" /></label>
      <button className="underline" onClick={() => edit({ kind: 'split', index, time: Number(cut) })}>Split scene {index + 1}</button>
      {!last && <><label>End (s) <input aria-label={`Scene ${index + 1} end time`} type="number" step="0.001" value={end} onChange={e => setEnd(e.target.value)} className="bg-bg-tertiary border border-border p-1 w-24" /></label>
      <button className="underline" onClick={() => edit({ kind: 'boundary', index, time: Number(end) })}>Move boundary</button>
      <button className="underline" onClick={() => edit({ kind: 'merge', index })}>Merge with next</button></>}
    </div>
  </div>
}
