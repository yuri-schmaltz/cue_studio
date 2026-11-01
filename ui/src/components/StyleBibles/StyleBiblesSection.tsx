import { useCallback, useEffect, useState } from 'react'
import { BookOpen, ChevronDown, ChevronRight, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import * as api from '../../api/client'
import type { StyleBibleSummary } from '../../api/client'
import { StyleBiblesModal } from './StyleBiblesModal'

/**
 * StyleBiblesSection — the compact, inline face of the Style Bible
 * library, used inside the Director's "Generation Options" column.
 *
 * Why inline instead of a third column tab
 * ----------------------------------------
 * The bibles are not an isolated feature: the Director already
 * consumes them. When the user hits "Auto from scene" on the
 * negative prompt, the first three bibles (name + description) are
 * sent to the backend to derive that prompt. So the library is an
 * input of the very controls that live in this panel (LoRAs, negative
 * prompt), and keeping it next to them explains the relationship
 * without a second navigation layer.
 *
 * Scope note: the bibles themselves are global templates (stored in
 * app/settings/style_bibles and reusable across projects), while the
 * rest of the panel is per-run. The section labels itself "global
 * library" so the difference is explicit.
 *
 * The full editor (metadata, character / environment / LoRA anchors,
 * global style & negative) is a wide, long form. It stays in the
 * existing modal — launched straight into the editor of the chosen
 * bible — so the narrow column only hosts the list.
 */
export function StyleBiblesSection() {
  const [bibles, setBibles] = useState<StyleBibleSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [open, setOpen] = useState(true)
  // null = closed; otherwise the modal is open in this mode.
  const [modal, setModal] = useState<{ mode: 'list' | 'create'; id?: string } | null>(null)

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

  const remove = useCallback(async (id: string) => {
    if (!confirm(`Delete Style Bible "${id}"? This cannot be undone.`)) return
    setBusyId(id)
    setError(null)
    try {
      await api.deleteStyleBible(id)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBusyId(null)
    }
  }, [refresh])

  return (
    <section
      className="rounded-lg border border-border/60 bg-bg-tertiary/30"
      data-testid="director-style-bibles"
    >
      <header className="flex items-center justify-between gap-2 px-2.5 py-2">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          className="flex items-center gap-1.5 text-xs font-medium text-text-primary hover:text-text-secondary"
          data-testid="director-style-bibles-toggle"
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <BookOpen size={12} className="text-accent-blue" aria-hidden="true" />
          Style Bibles
          <span className="text-2xs text-text-muted font-normal">
            {loading ? '· loading' : `· ${bibles.length}`}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setModal({ mode: 'create' })}
          className="text-2xs px-1.5 py-0.5 rounded border border-border hover:bg-bg-tertiary flex items-center gap-1 text-text-secondary"
          aria-label="New Style Bible"
          data-testid="director-style-bibles-new"
        >
          <Plus size={10} aria-hidden="true" />
          New
        </button>
      </header>

      {open && (
        <div className="px-2.5 pb-2.5 space-y-2">
          {error && (
            <p role="alert" className="text-2xs px-2 py-1.5 rounded border border-red-400/40 bg-red-400/10 text-red-400">
              {error}
            </p>
          )}

          {bibles.length === 0 && !loading && (
            <p className="text-2xs text-text-muted leading-snug">
              No Style Bibles yet — create one to reuse characters, environments and
              LoRAs across every project.
            </p>
          )}

          {bibles.length > 0 && (
            <ul className="divide-y divide-border rounded border border-border">
              {bibles.map(bible => (
                <li key={bible.id} className="px-2 py-1.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-2xs font-medium truncate">{bible.title || bible.id}</div>
                    <div className="text-3xs text-text-muted truncate">
                      chars={bible.characters_count} envs={bible.environments_count} loras={bible.loras_count}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => setModal({ mode: 'list', id: bible.id })}
                      disabled={busyId === bible.id}
                      className="text-2xs px-1.5 py-0.5 rounded border border-border hover:bg-bg-tertiary flex items-center gap-1 text-text-secondary disabled:opacity-40"
                      aria-label={`Edit ${bible.id}`}
                    >
                      <Pencil size={10} aria-hidden="true" />
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(bible.id)}
                      disabled={busyId === bible.id}
                      className="text-2xs px-1.5 py-0.5 rounded border border-red-400/60 text-red-400 hover:bg-red-400/10 flex items-center gap-1 disabled:opacity-40"
                      aria-label={`Delete ${bible.id}`}
                    >
                      {busyId === bible.id
                        ? <Loader2 size={10} className="animate-spin" aria-hidden="true" />
                        : <Trash2 size={10} aria-hidden="true" />}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {bibles.length > 0 && (
            <p className="text-3xs text-text-muted/80 leading-snug">
              Global library — the Director reads it when auto-deriving the negative
              prompt. The full editor opens in a wider window.
            </p>
          )}
        </div>
      )}

      {modal && (
        <StyleBiblesModal
          onClose={() => {
            setModal(null)
            void refresh()
          }}
          initialBibleId={modal.id ?? null}
          initialMode={modal.mode}
        />
      )}
    </section>
  )
}
