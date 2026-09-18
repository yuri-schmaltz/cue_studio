/* eslint-disable react-refresh/only-export-components -- LinkedModelFoldersSection
 * is consumed only via composition inside ModelVisibilitySection; no other
 * module imports it. Co-locating keeps the linked-folders state + helpers
 * next to the model list they share a card with. */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ChevronDown, ChevronRight, Check, Download, Trash2,
  RefreshCw, Loader2, FolderOpen, Plus, RotateCcw,
} from 'lucide-react'
import type { ModelFolderCandidate, GenerationMode } from '../../../types'
import { useStore, getFamiliesForMode, getModelsForFamily } from '../../../stores/useStore'
import * as api from '../../../api/client'

const MODE_LABELS: { mode: GenerationMode; label: string }[] = [
  { mode: 'image', label: 'Image' },
  { mode: 'video', label: 'Video' },
  { mode: 'audio', label: 'Audio' },
  { mode: 'avatar', label: 'Video Transforms' },
]

// Family collapse state persists so "collapse the families I never use"
// (issue #14) sticks across sessions — unlike the mode groups, which are
// navigational and reset each visit.
const COLLAPSED_FAMILIES_KEY = 'cue-studio-collapsed-model-families'

/** Models card: enable/disable which model weights Maestro loads,
 *  download missing checkpoints, delete downloaded ones, and link
 *  external Pinokio-app model folders so the user can reuse an
 *  existing Wan2GP / Forge / etc. install instead of re-downloading
 *  the same GBs of weights.
 *
 *  Originally lived on the Performance panel — moved to Integrations
 *  to live with the other "things Maestro talks to / loads" panels
 *  (LLM Configuration + FlashVSR stayed on Performance because they
 *  are pure runtime knobs; Models is closer in spirit to a content
 *  registry than a per-take control).
 */
export function ModelVisibilitySection() {
  const models = useStore(s => s.models)
  const families = useStore(s => s.families)
  const enabledModels = useStore(s => s.enabledModels)
  const toggleModelEnabled = useStore(s => s.toggleModelEnabled)
  const resetEnabledModels = useStore(s => s.resetEnabledModels)
  const setAllModelsEnabled = useStore(s => s.setAllModelsEnabled)
  const setModelsEnabled = useStore(s => s.setModelsEnabled)
  const loadModels = useStore(s => s.loadModels)
  // Mature Mode gate: nsfw_only models are hidden from this list when
  // Mature Mode is off. When the user enables Mature Mode (via the
  // Services panel), updateServicesConfig auto-adds them to
  // enabledModels — they appear here pre-checked and ready to use.
  const nsfwMode = useStore(s => s.servicesConfig?.nsfw_mode ?? false)
  const modelVisibilityFocus = useStore(s => s.modelVisibilityFocus)
  const clearModelVisibilityFocus = useStore(s => s.clearModelVisibilityFocus)
  // Mode groups (Image/Video/Audio/Video Transforms) start collapsed
  // to keep the list scannable.
  const [expandedModes, setExpandedModes] = useState<Set<GenerationMode>>(new Set())
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  // Model pre-downloads in flight (click on the download icon). Byte-level
  // progress shows in the global DownloadStatusBanner; this set only drives
  // the per-row spinner and the completion refresh.
  const [downloading, setDownloading] = useState<Set<string>>(new Set())
  const [downloadErrors, setDownloadErrors] = useState<Record<string, string>>({})
  const sectionRef = useRef<HTMLDivElement>(null)

  // Poll download status while any model download is in flight. Also runs
  // once on mount so a download started before the drawer was closed and
  // reopened picks its spinner back up.
  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        const { downloads } = await api.fetchModelDownloads()
        if (cancelled) return
        const active = new Set<string>()
        const errors: Record<string, string> = {}
        let anyCompleted = false
        for (const [mt, d] of Object.entries(downloads)) {
          if (d.status === 'downloading') active.add(mt)
          else if (d.status === 'failed' && d.error) errors[mt] = d.error
          else if (d.status === 'completed') anyCompleted = true
        }
        setDownloading(prev => {
          if (prev.size === active.size && [...prev].every(mt => active.has(mt))) return prev
          return active
        })
        setDownloadErrors(errors)
        // A download finished since the last poll — refresh so the row
        // flips to the downloaded check mark.
        if (anyCompleted && downloading.size > 0 && active.size < downloading.size) loadModels()
      } catch { /* endpoint unavailable — ignore */ }
    }
    tick()
    if (downloading.size === 0) return
    const interval = setInterval(tick, 2000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [downloading.size, loadModels])

  const handleDownload = useCallback(async (modelType: string) => {
    setDownloadErrors(prev => { const next = { ...prev }; delete next[modelType]; return next })
    setDownloading(prev => new Set(prev).add(modelType))
    try {
      await api.downloadModel(modelType)
    } catch (e) {
      console.error('Download start failed:', e)
      setDownloading(prev => { const next = new Set(prev); next.delete(modelType); return next })
      setDownloadErrors(prev => ({ ...prev, [modelType]: String(e) }))
    }
  }, [])

  // When the ModelSelector "+N more" hint fires, expand the requested
  // mode and scroll it into view — then clear the request. The section
  // is always visible now (the parent .settings-group-header owns the
  // collapse affordance for "Enabled Models" as a whole).
  useEffect(() => {
    if (!modelVisibilityFocus) return
    setExpandedModes(prev => new Set(prev).add(modelVisibilityFocus))
    requestAnimationFrame(() => sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    clearModelVisibilityFocus()
  }, [modelVisibilityFocus, clearModelVisibilityFocus])

  const toggleMode = (mode: GenerationMode) => {
    setExpandedModes(prev => {
      const next = new Set(prev)
      if (next.has(mode)) next.delete(mode)
      else next.add(mode)
      return next
    })
  }

  // Collapsed family groups, keyed "mode:familyId", persisted (issue #14).
  const [collapsedFamilies, setCollapsedFamilies] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(COLLAPSED_FAMILIES_KEY)
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
    } catch { return new Set() }
  })
  const toggleFamily = (key: string) => {
    setCollapsedFamilies(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      try { localStorage.setItem(COLLAPSED_FAMILIES_KEY, JSON.stringify([...next])) } catch { /* ignore */ }
      return next
    })
  }

  const handleDelete = useCallback(async (modelType: string) => {
    if (confirmDelete !== modelType) {
      setConfirmDelete(modelType)
      setTimeout(() => setConfirmDelete(null), 3000)
      return
    }
    setConfirmDelete(null)
    setDeleting(modelType)
    try {
      await api.deleteModel(modelType)
      // Refresh models to update download status
      await loadModels()
    } catch (e) {
      console.error('Delete failed:', e)
    } finally {
      setDeleting(null)
    }
  }, [confirmDelete, loadModels])

  // Group models by generation mode, hiding nsfw_only entries when
  // Mature Mode is off (they reappear instantly when the toggle flips).
  const visibleModels = models.filter(m => !m.nsfw_only || nsfwMode)
  const modelsByMode = new Map<GenerationMode, { familyId: string; familyLabel: string; models: { model_type: string; name: string; is_downloaded?: boolean; architecture?: string }[] }[]>()
  for (const { mode } of MODE_LABELS) {
    const modeFamilies = getFamiliesForMode(mode, families)
    const groups: { familyId: string; familyLabel: string; models: { model_type: string; name: string; is_downloaded?: boolean; architecture?: string }[] }[] = []
    for (const fam of modeFamilies) {
      const familyModels = getModelsForFamily(fam.id, visibleModels, mode)
      if (familyModels.length > 0) {
        groups.push({
          familyId: fam.id,
          familyLabel: fam.label,
          models: familyModels.map(m => ({ model_type: m.model_type, name: m.name, is_downloaded: m.is_downloaded, architecture: m.architecture })),
        })
      }
    }
    modelsByMode.set(mode, groups)
  }

  return (
    <div ref={sectionRef} className="settings-card scroll-mt-2 flex flex-col">
      {/* Single label — no collapse. The card is always open; per-mode
          chevrons still let the user collapse Image/Video/Audio/etc.
          individually for scannability. */}
      <div className="text-2xs uppercase tracking-wider text-text-muted font-semibold mb-3">Models</div>

      {/* flex-1 + overflow-hidden lets the inner scroll pane (mode
          list) take only the space between the header buttons and
          the Linked Model Folders footer. The card height is fixed
          by its grid row so the Linked Folders section always sits
          at the bottom and never scrolls off-screen. */}
      <div className="flex flex-col flex-1 min-h-0 gap-3">
        <div className="flex gap-2 shrink-0">
          <button
            onClick={resetEnabledModels}
            className="flex items-center gap-1 px-2 py-1 text-2xs border border-border rounded text-text-secondary hover:text-text-primary hover:border-border-light transition-colors"
          >
            <RotateCcw size={10} />
            Reset
          </button>
          <button
            onClick={() => setAllModelsEnabled(true)}
            className="px-2 py-1 text-2xs border border-border rounded text-text-secondary hover:text-text-primary hover:border-border-light transition-colors"
          >
            All
          </button>
          <button
            onClick={() => setAllModelsEnabled(false)}
            className="px-2 py-1 text-2xs border border-border rounded text-text-secondary hover:text-text-primary hover:border-border-light transition-colors"
          >
            None
          </button>
        </div>

        {/* Scrollable model list. flex-1 + min-h-0 + overflow-y-auto
            so the mode groups expand/collapse freely and only this
            pane scrolls — the header (Reset/All/None) and the Linked
            Model Folders footer stay pinned. */}
        <div className="flex-1 min-h-0 overflow-y-auto pr-1 -mr-1">
          {MODE_LABELS.map(({ mode, label }) => {
            const groups = modelsByMode.get(mode) ?? []
            const modeModels = groups.flatMap(g => g.models)
            const modeEnabled = modeModels.filter(m => enabledModels.has(m.model_type)).length
            const modeDownloaded = modeModels.filter(m => m.is_downloaded).length
            const isExpanded = expandedModes.has(mode)

            return (
              <div key={mode}>
                <button
                  onClick={() => toggleMode(mode)}
                  className="flex items-center gap-1.5 w-full text-left"
                >
                  {isExpanded ? <ChevronDown size={11} className="text-text-muted shrink-0" /> : <ChevronRight size={11} className="text-text-muted shrink-0" />}
                  <span className="text-xs text-text-primary font-medium">{label}</span>
                  <span className="text-2xs text-text-muted ml-auto">
                    {modeEnabled}/{modeModels.length}
                    {modeDownloaded > 0 && (
                      <span className="ml-1 text-indicator-success">
                        ({modeDownloaded} <Download size={8} className="inline -mt-0.5" />)
                      </span>
                    )}
                  </span>
                </button>

                {isExpanded && (
                  <div className="mt-1.5 ml-4 space-y-0.5">
                    {groups.map(group => {
                      const famKey = `${mode}:${group.familyId}`
                      const famCollapsed = collapsedFamilies.has(famKey)
                      const famEnabled = group.models.filter(m => enabledModels.has(m.model_type)).length
                      const famAllEnabled = famEnabled === group.models.length && group.models.length > 0
                      // Single-family modes render flat — a header would be noise.
                      const showFamilyHeader = groups.length > 1
                      return (
                        <div key={group.familyId}>
                          {showFamilyHeader && (
                            <div className="flex items-center gap-1.5 mt-2 mb-1">
                              {/* Tri-state family toggle: checked = all enabled,
                                  indeterminate = some. Click enables the rest,
                                  or disables the whole family when all are on. */}
                              <input
                                type="checkbox"
                                checked={famAllEnabled}
                                ref={el => { if (el) el.indeterminate = famEnabled > 0 && !famAllEnabled }}
                                onChange={() => setModelsEnabled(group.models.map(m => m.model_type), !famAllEnabled)}
                                className="w-3 h-3 rounded border-border bg-bg-tertiary accent-accent-blue shrink-0"
                                title={famAllEnabled ? `Disable all ${group.familyLabel} models` : `Enable all ${group.familyLabel} models`}
                              />
                              <button
                                onClick={() => toggleFamily(famKey)}
                                className="flex items-center gap-1 flex-1 min-w-0 text-left"
                              >
                                {famCollapsed
                                  ? <ChevronRight size={10} className="text-text-muted shrink-0" />
                                  : <ChevronDown size={10} className="text-text-muted shrink-0" />}
                                <span className="text-2xs text-text-muted uppercase tracking-wider truncate">{group.familyLabel}</span>
                                <span className="text-2xs text-text-muted ml-auto shrink-0 tabular-nums">{famEnabled}/{group.models.length}</span>
                              </button>
                            </div>
                          )}
                          {(!showFamilyHeader || !famCollapsed) && group.models.map(m => (
                            <div
                              key={m.model_type}
                              className="flex items-center gap-2 py-0.5 group"
                            >
                              <label className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={enabledModels.has(m.model_type)}
                                  onChange={() => toggleModelEnabled(m.model_type)}
                                  className="w-3.5 h-3.5 rounded border-border bg-bg-tertiary accent-accent-blue shrink-0"
                                />
                                {/* Download status / click-to-download. preventDefault
                                    keeps the label from forwarding the click to the
                                    enable checkbox. MMAudio rows are virtual entries
                                    with no backend model def, so no button there —
                                    their files fetch on first SFX generation. */}
                                {m.is_downloaded ? (
                                  <Check size={10} className="text-indicator-success shrink-0" />
                                ) : downloading.has(m.model_type) ? (
                                  <Loader2 size={10} className="text-accent-blue shrink-0 animate-spin" />
                                ) : m.architecture === 'mmaudio' ? (
                                  <Download size={10} className="text-text-muted shrink-0" />
                                ) : (
                                  <button
                                    onClick={e => { e.preventDefault(); e.stopPropagation(); handleDownload(m.model_type) }}
                                    className={`p-0.5 -m-0.5 rounded transition-colors shrink-0 ${
                                      downloadErrors[m.model_type]
                                        ? 'text-red-400 hover:text-red-300'
                                        : 'text-text-muted hover:text-accent-blue'
                                    }`}
                                    title={downloadErrors[m.model_type]
                                      ? `Download failed: ${downloadErrors[m.model_type]} — click to retry`
                                      : 'Download model files now'}
                                  >
                                    <Download size={10} />
                                  </button>
                                )}
                                <span className={`text-xs truncate ${
                                  m.is_downloaded
                                    ? 'text-text-primary'
                                    : 'text-text-muted group-hover:text-text-secondary'
                                }`}>
                                  {m.name}
                                </span>
                              </label>
                              {/* Delete button — only for downloaded models */}
                              {m.is_downloaded && (
                                <button
                                  onClick={() => handleDelete(m.model_type)}
                                  disabled={deleting === m.model_type}
                                  className={`p-0.5 rounded transition-colors shrink-0 ${
                                    confirmDelete === m.model_type
                                      ? 'bg-red-500/20 text-red-400'
                                      : deleting === m.model_type
                                        ? 'text-text-muted cursor-wait'
                                        : 'text-text-muted opacity-0 group-hover:opacity-100 hover:text-red-400'
                                  }`}
                                  title={confirmDelete === m.model_type ? 'Click again to confirm delete' : 'Delete model files'}
                                >
                                  <Trash2 size={11} />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Linked Model Folders — pinned to the bottom of the card
            (shrink-0) so it never scrolls off-screen, even when the
            model list above is long. It's a sibling concern about
            *where models come from*: the list above is what ships
            with Maestro, the linked folders below are external
            installs the user opted into. */}
        <div className="shrink-0 pt-3 border-t border-border/50">
          <LinkedModelFoldersSection />
        </div>
      </div>
    </div>
  )
}

function LinkedModelFoldersSection() {
  const systemConfig = useStore(s => s.systemConfig)
  const loadSystemConfig = useStore(s => s.loadSystemConfig)
  const loadModels = useStore(s => s.loadModels)
  const [candidates, setCandidates] = useState<ModelFolderCandidate[] | null>(null)
  const [scanning, setScanning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [manualPath, setManualPath] = useState('')
  const [error, setError] = useState<string | null>(null)

  const folders = systemConfig?.model_folders ?? []

  // Direct API call (not the store action) so backend validation errors
  // ("Folder does not exist: ...") surface here instead of being swallowed.
  // Returns success so callers can decide what to reset.
  const save = async (next: string[]): Promise<boolean> => {
    if (saving) return false
    setSaving(true)
    setError(null)
    try {
      await api.updateSystemConfig({ model_folders: next })
      await loadSystemConfig()
      // Applied live server-side — refresh so downloaded badges light up.
      await loadModels()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save folders')
      return false
    } finally {
      setSaving(false)
    }
  }

  const scan = async () => {
    setScanning(true)
    setError(null)
    try {
      const res = await api.scanModelFolders()
      setCandidates(res.candidates)
      if (res.candidates.length === 0) setError('No other Pinokio apps with a ckpts folder found')
    } catch {
      setError('Scan failed')
    } finally {
      setScanning(false)
    }
  }

  const addFolder = async (path: string) => {
    if (saving) return
    // Tolerate Windows Explorer "Copy as path" quoting.
    const p = path.trim().replace(/^["']+|["']+$/g, '').trim()
    if (!p || folders.includes(p)) return
    const ok = await save([...folders, p])
    // Keep the typed path visible on failure so the user can correct it.
    if (ok) setManualPath('')
  }

  return (
    <div className="space-y-3">
      {/* Compact summary — counts only. No collapse: this card is
          short enough that always-open reads better than the
          Show/Hide toggle the user has to click twice to peek at. */}
      <div className="text-2xs text-text-muted tabular-nums mb-3">
        {folders.length} linked
      </div>

      <div>
        <p className="text-2xs text-text-muted leading-relaxed">
          Search other apps&apos; model folders for checkpoints you already have — e.g. an existing
            Wan2GP install — instead of re-downloading them. Linked folders are read-only:
            new downloads always go to Maestro&apos;s own ckpts folder.
          </p>

          {folders.length > 0 && (
            <div className="space-y-1">
              {folders.map(f => (
                <div key={f} className="flex items-center gap-2 group">
                  <FolderOpen size={11} className="text-text-secondary shrink-0" />
                  <span className="flex-1 text-xs text-text-primary truncate" title={f}>{f}</span>
                  <button
                    onClick={() => save(folders.filter(x => x !== f))}
                    disabled={saving}
                    className="p-1 rounded text-text-muted opacity-0 group-hover:opacity-100 hover:text-red-400 transition-colors shrink-0"
                    title="Unlink folder (files are not deleted)"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {candidates && candidates.filter(c => !c.linked && !folders.includes(c.path)).length > 0 && (
            <div className="space-y-1">
              {candidates.filter(c => !c.linked && !folders.includes(c.path)).map(c => (
                <div key={c.path} className="flex items-center gap-2">
                  <button
                    onClick={() => addFolder(c.path)}
                    disabled={saving}
                    className="p-1 rounded text-accent-blue hover:text-accent-blue-hover shrink-0 disabled:opacity-50"
                    title={`Link ${c.path}`}
                  >
                    <Plus size={12} />
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-text-primary truncate">{c.app}</div>
                    <div className="text-2xs text-text-muted truncate" title={c.path}>
                      {c.files} files, {c.folders} folders{c.size_gb > 0 ? `, ~${c.size_gb} GB` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-1.5">
            <input
              type="text"
              value={manualPath}
              onChange={e => setManualPath(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addFolder(manualPath)}
              placeholder="Or paste a folder path..."
              className="flex-1 bg-bg-tertiary border border-border rounded px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent-blue"
            />
            <button
              onClick={() => addFolder(manualPath)}
              disabled={saving || !manualPath.trim()}
              className="px-2 py-1 text-2xs border border-border rounded text-text-secondary hover:text-text-primary hover:border-border-light transition-colors disabled:opacity-50"
            >
              Add
            </button>
            {/* Square icon button — moved inline next to "Add" so the
                scan affordance sits in the same row as the path
                input. Matches the input/Add button height and uses
                the same RefreshCw icon that used to label the
                standalone "Scan Pinokio apps" button. */}
            <button
              onClick={scan}
              disabled={scanning || saving}
              aria-label="Scan Pinokio apps for model folders"
              title="Scan Pinokio apps for model folders"
              className="flex items-center justify-center w-7 h-7 border border-border rounded text-text-secondary hover:text-text-primary hover:border-border-light transition-colors disabled:opacity-50 shrink-0"
            >
              {scanning ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            </button>
          </div>

          {error && <p className="text-2xs text-red-400">{error}</p>}
        </div>
    </div>
  )
}