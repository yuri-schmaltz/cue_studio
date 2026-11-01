import { useCallback, useEffect, useState } from 'react'
import { BookOpen, Check, ChevronDown, ChevronRight, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'
import * as api from '../../api/client'
import type { CharacterAnchor, EnvironmentAnchor, LoraConfig, StyleBible, StyleBibleSummary } from '../../api/client'

/**
 * StyleBiblesModal — global Style Bible editor surfaced from any
 * Director surface (header button). The editor itself is the same
 * surface that used to live in Configurations; it's now modal so the
 * user can manage their library without leaving the workflow that
 * actually consumes them.
 *
 * Bibles are global templates stored at app/settings/style_bibles/
 * — not per-project data — so the natural home for management is
 * wherever the Director is, not inside a project setup form.
 *
 * `initialBibleId` / `initialMode` let a caller open the manager
 * straight into the editor of a given bible (or into a blank one)
 * instead of the list. The Director's inline "Style Bibles" section
 * uses that to launch the wide editor from its compact list, so the
 * narrow column never has to host the full editor form.
 */
export function StyleBiblesModal({
  onClose,
  initialBibleId,
  initialMode = 'list',
}: {
  onClose: () => void
  initialBibleId?: string | null
  initialMode?: 'list' | 'create'
}) {
  const [bibles, setBibles] = useState<StyleBibleSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<StyleBible | null>(null)
  const [creating, setCreating] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const resp = await api.fetchStyleBibles()
      setBibles(resp.bibles)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load Style Bibles')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  // Escape closes the modal — matches the SaveRecipeDialog/RecipesOverlay
  // pattern so users get the same keyboard affordance everywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const openEditor = useCallback(async (id: string) => {
    setError(null)
    try {
      const bible = await api.fetchStyleBible(id)
      setEditing(bible)
      setCreating(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : `Unable to open ${id}`)
    }
  }, [])

  const startCreate = useCallback(() => {
    setEditing(_blankBible())
    setCreating(true)
  }, [])

  // Launch straight into the editor when the caller asks for a
  // specific bible (or a blank one). Cancel still returns to the
  // list, so the manager is never a dead end.
  useEffect(() => {
    if (initialMode === 'create') {
      setEditing(_blankBible())
      setCreating(true)
    } else if (initialBibleId) {
      void openEditor(initialBibleId)
    }
  }, [initialMode, initialBibleId, openEditor])

  const cancelEdit = useCallback(() => {
    setEditing(null)
    setCreating(false)
  }, [])

  const saveEdit = useCallback(async (bible: StyleBible) => {
    setBusyId(bible.metadata.id)
    setError(null)
    try {
      if (creating) {
        await api.createStyleBible(bible)
      } else {
        await api.updateStyleBible(bible.metadata.id, bible)
      }
      setEditing(null)
      setCreating(false)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusyId(null)
    }
  }, [creating, refresh])

  const remove = useCallback(async (id: string) => {
    if (!confirm(`Delete Style Bible "${id}"? This cannot be undone.`)) return
    setBusyId(id)
    setError(null)
    try {
      await api.deleteStyleBible(id)
      if (editing?.metadata.id === id) {
        setEditing(null)
        setCreating(false)
      }
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBusyId(null)
    }
  }, [editing, refresh])

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Style Bibles manager"
    >
      <div
        className="bg-bg-secondary border border-border rounded-xl shadow-2xl w-[860px] max-w-[96vw] max-h-[88vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            <BookOpen size={16} className="text-accent-blue shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-text-primary">Style Bibles</h2>
              <p className="text-2xs text-text-muted leading-snug">
                Global character / environment / LoRA anchors. Reusable across all projects.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={refresh}
              disabled={loading}
              className="text-xs px-2 py-1 rounded border border-border hover:bg-bg-tertiary disabled:opacity-40 flex items-center gap-1"
              aria-label="Refresh Style Bibles"
            >
              {loading ? <Loader2 className="animate-spin" size={11} /> : 'Refresh'}
            </button>
            <button
              type="button"
              onClick={startCreate}
              className="text-xs px-2 py-1 rounded bg-accent-blue text-white flex items-center gap-1"
            >
              <Plus size={11} /> New Bible
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-xs px-1.5 py-1 rounded border border-border hover:bg-bg-tertiary ml-1"
              aria-label="Close Style Bibles manager"
            >
              <X size={12} />
            </button>
          </div>
        </header>

        <div className="flex-1 min-h-0 overflow-auto px-5 py-4 space-y-3">
          {error && (
            <p role="alert" className="text-xs px-3 py-2 rounded border border-red-400/40 bg-red-400/10 text-red-400">
              {error}
            </p>
          )}

          {!editing && (
            <ul className="divide-y divide-border rounded border border-border">
              {bibles.length === 0 && !loading && (
                <li className="p-3 text-xs text-text-muted">
                  No Style Bibles yet. Click "New Bible" to create one.
                </li>
              )}
              {bibles.map(bible => (
                <li key={bible.id} className="p-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{bible.title}</div>
                    <div className="text-2xs text-text-muted truncate">
                      id: <span className="font-mono">{bible.id}</span>
                      {' · '}
                      chars={bible.characters_count} envs={bible.environments_count} loras={bible.loras_count}
                      {bible.tags.length > 0 && ` · ${bible.tags.join(', ')}`}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => void openEditor(bible.id)}
                      disabled={busyId === bible.id}
                      className="text-xs px-2 py-1 rounded border border-border hover:bg-bg-tertiary flex items-center gap-1 disabled:opacity-40"
                      aria-label={`Edit ${bible.id}`}
                    >
                      <Pencil size={11} /> Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(bible.id)}
                      disabled={busyId === bible.id}
                      className="text-xs px-2 py-1 rounded border border-red-400/60 text-red-400 hover:bg-red-400/10 flex items-center gap-1 disabled:opacity-40"
                      aria-label={`Delete ${bible.id}`}
                    >
                      <Trash2 size={11} /> Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}


          {editing && (
            <StyleBibleEditor
              bible={editing}
              isCreating={creating}
              onSave={saveEdit}
              onCancel={cancelEdit}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function StyleBibleEditor({ bible, isCreating, onSave, onCancel }: {
  bible: StyleBible
  isCreating: boolean
  onSave: (bible: StyleBible) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<StyleBible>(bible)
  const [openSection, setOpenSection] = useState<'characters' | 'environments' | 'loras' | 'global'>('characters')

  useEffect(() => { setDraft(bible) }, [bible])

  const setMeta = (patch: Partial<StyleBible['metadata']>) => {
    setDraft(d => ({ ...d, metadata: { ...d.metadata, ...patch } }))
  }
  const setGlobal = (patch: Partial<Pick<StyleBible, 'global_style' | 'global_negative'>>) => {
    setDraft(d => ({ ...d, ...patch }))
  }

  return (
    <div className="rounded border border-border p-3 space-y-3 bg-bg-tertiary/30">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          {isCreating ? 'New Style Bible' : `Edit "${draft.metadata.title || draft.metadata.id}"`}
        </h3>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => onSave(draft)}
            className="text-xs px-3 py-1 rounded bg-accent-blue text-white flex items-center gap-1"
          >
            <Check size={12} /> {isCreating ? 'Create' : 'Save'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="text-xs px-3 py-1 rounded border border-border hover:bg-bg-tertiary flex items-center gap-1"
          >
            <X size={12} /> Cancel
          </button>
        </div>
      </div>

      <fieldset className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
        <label className="block">
          <span className="text-text-muted">ID (required, used in filename)</span>
          <input
            type="text"
            value={draft.metadata.id}
            onChange={e => setMeta({ id: e.target.value })}
            disabled={!isCreating}
            className="mt-0.5 w-full rounded border border-border bg-bg-tertiary p-1.5 disabled:opacity-50 font-mono"
            aria-label="Bible id"
          />
        </label>
        <label className="block">
          <span className="text-text-muted">Title</span>
          <input
            type="text"
            value={draft.metadata.title}
            onChange={e => setMeta({ title: e.target.value })}
            className="mt-0.5 w-full rounded border border-border bg-bg-tertiary p-1.5"
            aria-label="Bible title"
          />
        </label>
        <label className="block md:col-span-2">
          <span className="text-text-muted">Description</span>
          <input
            type="text"
            value={draft.metadata.description}
            onChange={e => setMeta({ description: e.target.value })}
            className="mt-0.5 w-full rounded border border-border bg-bg-tertiary p-1.5"
            aria-label="Bible description"
          />
        </label>
        <label className="block">
          <span className="text-text-muted">Author</span>
          <input
            type="text"
            value={draft.metadata.author}
            onChange={e => setMeta({ author: e.target.value })}
            className="mt-0.5 w-full rounded border border-border bg-bg-tertiary p-1.5"
            aria-label="Bible author"
          />
        </label>
        <label className="block">
          <span className="text-text-muted">Tags (comma-separated)</span>
          <input
            type="text"
            value={draft.metadata.tags.join(', ')}
            onChange={e => setMeta({ tags: e.target.value.split(',').map(t => t.trim()).filter(Boolean) })}
            className="mt-0.5 w-full rounded border border-border bg-bg-tertiary p-1.5"
            aria-label="Bible tags"
          />
        </label>
      </fieldset>

      <EditorSection
        title={`Characters (${Object.keys(draft.characters).length})`}
        open={openSection === 'characters'}
        onToggle={() => setOpenSection(openSection === 'characters' ? null as never : 'characters')}
        actions={<button type="button" className="text-2xs px-2 py-0.5 rounded border border-border hover:bg-bg-tertiary" onClick={() => setDraft(d => ({ ...d, characters: { ...d.characters, '': _blankCharacter() } }))}>+ Add</button>}
      >
        <CharacterList
          characters={draft.characters}
          onChange={next => setDraft(d => ({ ...d, characters: next }))}
        />
      </EditorSection>

      <EditorSection
        title={`Environments (${Object.keys(draft.environments).length})`}
        open={openSection === 'environments'}
        onToggle={() => setOpenSection(openSection === 'environments' ? null as never : 'environments')}
        actions={<button type="button" className="text-2xs px-2 py-0.5 rounded border border-border hover:bg-bg-tertiary" onClick={() => setDraft(d => ({ ...d, environments: { ...d.environments, '': _blankEnvironment() } }))}>+ Add</button>}
      >
        <EnvironmentList
          environments={draft.environments}
          onChange={next => setDraft(d => ({ ...d, environments: next }))}
        />
      </EditorSection>

      <EditorSection
        title={`LoRAs (${Object.keys(draft.loras).length})`}
        open={openSection === 'loras'}
        onToggle={() => setOpenSection(openSection === 'loras' ? null as never : 'loras')}
        actions={<button type="button" className="text-2xs px-2 py-0.5 rounded border border-border hover:bg-bg-tertiary" onClick={() => setDraft(d => ({ ...d, loras: { ...d.loras, '': _blankLora() } }))}>+ Add</button>}
      >
        <LoraList loras={draft.loras} onChange={next => setDraft(d => ({ ...d, loras: next }))} />
      </EditorSection>

      <EditorSection
        title="Global style & negative"
        open={openSection === 'global'}
        onToggle={() => setOpenSection(openSection === 'global' ? null as never : 'global')}
      >
        <fieldset className="space-y-2 text-xs">
          <label className="block">
            <span className="text-text-muted">Global style (applied to every prompt)</span>
            <textarea
              rows={2}
              value={draft.global_style}
              onChange={e => setGlobal({ global_style: e.target.value })}
              className="mt-0.5 w-full rounded border border-border bg-bg-tertiary p-1.5"
              aria-label="Global style"
            />
          </label>
          <label className="block">
            <span className="text-text-muted">Global negative prompt</span>
            <textarea
              rows={2}
              value={draft.global_negative}
              onChange={e => setGlobal({ global_negative: e.target.value })}
              className="mt-0.5 w-full rounded border border-border bg-bg-tertiary p-1.5"
              aria-label="Global negative prompt"
            />
          </label>
        </fieldset>
      </EditorSection>
    </div>
  )
}

function EditorSection({ title, open, onToggle, actions, children }: {
  title: string
  open: boolean
  onToggle: () => void
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section>
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1 text-xs font-medium w-full text-left"
        aria-expanded={open}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {title}
        <span className="ml-auto" onClick={evt => evt.stopPropagation()}>{actions}</span>
      </button>
      {open && <div className="mt-2 space-y-2">{children}</div>}
    </section>
  )
}

function CharacterList({ characters, onChange }: {
  characters: Record<string, CharacterAnchor>
  onChange: (next: Record<string, CharacterAnchor>) => void
}) {
  return (
    <ul className="space-y-2">
      {Object.entries(characters).map(([key, ch]) => (
        <li key={key || '__new__'} className="rounded border border-border p-2 space-y-1">
          <div className="flex gap-1">
            <input
              type="text"
              value={ch.name}
              placeholder="Name"
              onChange={e => onChange({ ...characters, [key]: { ...ch, name: e.target.value } })}
              className="flex-1 rounded border border-border bg-bg-tertiary p-1 text-xs"
              aria-label="Character name"
            />
            <button
              type="button"
              onClick={() => {
                const next = { ...characters }
                delete next[key]
                onChange(next)
              }}
              className="text-xs px-2 py-0.5 rounded border border-red-400/60 text-red-400 hover:bg-red-400/10"
              aria-label="Remove character"
            >
              <Trash2 size={11} />
            </button>
          </div>
          <textarea
            rows={2}
            value={ch.physical_description}
            placeholder="Physical description (locks the character's look)"
            onChange={e => onChange({ ...characters, [key]: { ...ch, physical_description: e.target.value } })}
            className="w-full rounded border border-border bg-bg-tertiary p-1 text-xs"
            aria-label="Character physical description"
          />
          <input
            type="text"
            value={ch.wardrobe}
            placeholder="Wardrobe"
            onChange={e => onChange({ ...characters, [key]: { ...ch, wardrobe: e.target.value } })}
            className="w-full rounded border border-border bg-bg-tertiary p-1 text-xs"
            aria-label="Character wardrobe"
          />
          <input
            type="text"
            value={ch.color_palette.join(', ')}
            placeholder="Color palette (comma-separated)"
            onChange={e => onChange({ ...characters, [key]: { ...ch, color_palette: e.target.value.split(',').map(t => t.trim()).filter(Boolean) } })}
            className="w-full rounded border border-border bg-bg-tertiary p-1 text-xs"
            aria-label="Character color palette"
          />
        </li>
      ))}
    </ul>
  )
}

function EnvironmentList({ environments, onChange }: {
  environments: Record<string, EnvironmentAnchor>
  onChange: (next: Record<string, EnvironmentAnchor>) => void
}) {
  return (
    <ul className="space-y-2">
      {Object.entries(environments).map(([key, env]) => (
        <li key={key || '__new__'} className="rounded border border-border p-2 space-y-1">
          <div className="flex gap-1">
            <input
              type="text"
              value={env.name}
              placeholder="Name"
              onChange={e => onChange({ ...environments, [key]: { ...env, name: e.target.value } })}
              className="flex-1 rounded border border-border bg-bg-tertiary p-1 text-xs"
              aria-label="Environment name"
            />
            <button
              type="button"
              onClick={() => {
                const next = { ...environments }
                delete next[key]
                onChange(next)
              }}
              className="text-xs px-2 py-0.5 rounded border border-red-400/60 text-red-400 hover:bg-red-400/10"
              aria-label="Remove environment"
            >
              <Trash2 size={11} />
            </button>
          </div>
          <textarea
            rows={2}
            value={env.description}
            placeholder="Description (locks the environment's look)"
            onChange={e => onChange({ ...environments, [key]: { ...env, description: e.target.value } })}
            className="w-full rounded border border-border bg-bg-tertiary p-1 text-xs"
            aria-label="Environment description"
          />
          <input
            type="text"
            value={env.lighting}
            placeholder="Lighting"
            onChange={e => onChange({ ...environments, [key]: { ...env, lighting: e.target.value } })}
            className="w-full rounded border border-border bg-bg-tertiary p-1 text-xs"
            aria-label="Environment lighting"
          />
          <input
            type="text"
            value={env.color_palette.join(', ')}
            placeholder="Color palette (comma-separated)"
            onChange={e => onChange({ ...environments, [key]: { ...env, color_palette: e.target.value.split(',').map(t => t.trim()).filter(Boolean) } })}
            className="w-full rounded border border-border bg-bg-tertiary p-1 text-xs"
            aria-label="Environment color palette"
          />
        </li>
      ))}
    </ul>
  )
}

function LoraList({ loras, onChange }: {
  loras: Record<string, LoraConfig>
  onChange: (next: Record<string, LoraConfig>) => void
}) {
  return (
    <ul className="space-y-2">
      {Object.entries(loras).map(([key, lora]) => (
        <li key={key || '__new__'} className="rounded border border-border p-2 space-y-1">
          <div className="flex gap-1">
            <input
              type="text"
              value={lora.name}
              placeholder="Name"
              onChange={e => onChange({ ...loras, [key]: { ...lora, name: e.target.value } })}
              className="flex-1 rounded border border-border bg-bg-tertiary p-1 text-xs"
              aria-label="LoRA name"
            />
            <input
              type="number"
              step="0.05"
              min="0"
              max="2"
              value={lora.weight}
              onChange={e => onChange({ ...loras, [key]: { ...lora, weight: Number(e.target.value) } })}
              className="w-20 rounded border border-border bg-bg-tertiary p-1 text-xs"
              aria-label="LoRA weight"
            />
            <button
              type="button"
              onClick={() => {
                const next = { ...loras }
                delete next[key]
                onChange(next)
              }}
              className="text-xs px-2 py-0.5 rounded border border-red-400/60 text-red-400 hover:bg-red-400/10"
              aria-label="Remove LoRA"
            >
              <Trash2 size={11} />
            </button>
          </div>
          <input
            type="text"
            value={lora.file_path}
            placeholder="file path or url"
            onChange={e => onChange({ ...loras, [key]: { ...lora, file_path: e.target.value } })}
            className="w-full rounded border border-border bg-bg-tertiary p-1 text-xs font-mono"
            aria-label="LoRA file path"
          />
          <input
            type="text"
            value={lora.notes}
            placeholder="Notes"
            onChange={e => onChange({ ...loras, [key]: { ...lora, notes: e.target.value } })}
            className="w-full rounded border border-border bg-bg-tertiary p-1 text-xs"
            aria-label="LoRA notes"
          />
        </li>
      ))}
    </ul>
  )
}

function _blankBible(): StyleBible {
  return {
    metadata: {
      id: '',
      title: '',
      description: '',
      author: '',
      tags: [],
      created_at: '',
      updated_at: '',
    },
    characters: {},
    environments: {},
    loras: {},
    global_style: '',
    global_negative: '',
  }
}

function _blankCharacter(): CharacterAnchor {
  return { id: '', name: '', physical_description: '', wardrobe: '', color_palette: [] }
}

function _blankEnvironment(): EnvironmentAnchor {
  return { id: '', name: '', description: '', lighting: '', color_palette: [] }
}

function _blankLora(): LoraConfig {
  return { name: '', file_path: '', weight: 1, weight_min: 0, weight_max: 1, notes: '' }
}
