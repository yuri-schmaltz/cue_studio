import { useEffect, useState } from 'react'
import { FolderOpen, RotateCcw, Save, AlertCircle, CheckCircle2 } from 'lucide-react'
import { useStore } from '../../stores/useStore'
import { StorageDashboardBody } from '../StorageDashboard/StorageDashboardBody'

/**
 * Storage settings: where new project workspaces are created on disk.
 *
 * Defaults to the OS-native user Videos folder (``~/Videos`` on Linux
 * and macOS, ``%USERPROFILE%\\Videos`` on Windows) so generated media
 * lands in the same place as the user's other videos, photos and
 * backups. A user can override the path here — Maestro validates that
 * the chosen folder exists and is writable before persisting.
 *
 * Empty input reverts to the default; the backend then falls back to
 * the OS-native Videos folder on the next call. The path is stored in
 * ``services.projects_root_path`` inside the Maestro server config.
 *
 * Layout: two-column via ``.settings-columns``. Left card carries the
 * Projects root label, path input and Default + Save actions plus the
 * error/success feedback. Right column renders the Storage Manager
 * dashboard inline (header + tiles + duplicates + Models / LoRAs /
 * Workspaces tables). The dashboard is always visible — there's no
 * "Open" / "Close" toggle, no full-screen overlay, no in-place
 * expansion. The `Close` button on the dashboard header is hidden
 * via the `hideClose` prop because there is nothing to close.
 */
export function StorageSettingsPanel() {
  const projectsRoot = useStore(s => s.projectsRoot)
  const loadProjectsRoot = useStore(s => s.loadProjectsRoot)
  const setProjectsRoot = useStore(s => s.setProjectsRoot)

  // Local draft of the path. Decoupled from the store so the user can
  // type freely without round-tripping every keystroke to the backend.
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  useEffect(() => {
    // Hydrate once on mount. The drawer may be opened and closed many
    // times without unmounting; the store keeps the previous value.
    if (projectsRoot === null) loadProjectsRoot()
  }, [projectsRoot, loadProjectsRoot])

  // Sync the local draft when the backend value resolves. Keying on
  // the configured string (not the whole object) keeps the user's
  // in-flight typing from being clobbered after they save.
  const configuredPath = projectsRoot?.configured_path
  useEffect(() => {
    if (configuredPath !== undefined) setDraft(configuredPath)
  }, [configuredPath])

  const isDirty = draft.trim() !== (projectsRoot?.configured_path ?? '')
  const isEmpty = !draft.trim()

  const onSave = async () => {
    setSaving(true)
    setError(null)
    try {
      await setProjectsRoot(draft.trim())
      setSavedAt(Date.now())
      setTimeout(() => setSavedAt(prev => prev === savedAt ? null : prev), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save projects root')
    } finally {
      setSaving(false)
    }
  }

  const onReset = () => {
    setDraft('')
    setError(null)
  }

  return (
    <section className="settings-panel" aria-label="Storage settings">
      <header className="settings-panel-header">
        <h2><FolderOpen size={18} aria-hidden="true" /> Storage</h2>
      </header>

      {/* Single full-width layout for storage:
          Top: Projects root bar (path configuration)
          Bottom: Storage Manager Dashboard occupying full width so tables and metrics have ample space */}
      <div className="flex flex-col gap-4">
        {/* ---- Section 1: Projects root (Full width bar) ---- */}
        <div className="settings-card">
          <div className="flex items-center gap-3 flex-wrap">
            <label
              htmlFor="projects-root-path"
              className="flex items-center gap-2 text-sm font-medium text-text-primary shrink-0"
            >
              <FolderOpen size={16} aria-hidden="true" className="text-text-muted" />
              Projects root
            </label>
            <input
              id="projects-root-path"
              type="text"
              className="settings-text-input flex-1 min-w-[280px]"
              value={draft}
              onChange={e => { setDraft(e.target.value); setError(null) }}
              placeholder={projectsRoot?.default_path ?? 'outputs'}
              spellCheck={false}
              autoComplete="off"
              aria-label="Projects root path"
            />
            <button
              type="button"
              className="settings-button settings-button-ghost shrink-0"
              onClick={onReset}
              disabled={saving || isEmpty}
              aria-label="Reset to default"
              title="Clear the custom path and use the OS-default folder"
            >
              <RotateCcw size={15} aria-hidden="true" /> Default
            </button>
            <button
              type="button"
              className="settings-button settings-button-primary shrink-0"
              onClick={onSave}
              disabled={saving || !isDirty}
              aria-label="Save projects folder"
            >
              <Save size={15} aria-hidden="true" /> {saving ? 'Saving…' : 'Save'}
            </button>
          </div>

          {error && (
            <p className="settings-feedback error" role="alert">
              <AlertCircle size={15} aria-hidden="true" /> {error}
            </p>
          )}

          {!error && savedAt && (
            <p className="settings-feedback success" role="status">
              <CheckCircle2 size={15} aria-hidden="true" /> Saved.
              New projects will be created under this folder.
            </p>
          )}
        </div>

        {/* ---- Section 2: Storage Manager Dashboard in full width ---- */}
        <div className="settings-card">
          <StorageDashboardBody hideClose onClose={() => { /* no-op — always-visible mount */ }} />
        </div>
      </div>
    </section>
  )
}
