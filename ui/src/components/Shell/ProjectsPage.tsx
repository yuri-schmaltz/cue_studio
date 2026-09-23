import { useEffect, useMemo, useState } from 'react'
import { Check, Clapperboard, Copy, Film, FolderOpen, ImagePlus, Images, Loader2, Music, Pin, PinOff, Plus, Search, Settings, Trash2, X } from 'lucide-react'
import { useStore } from '../../stores/useStore'
import { useWorkspaceSlice } from '../../stores/workspaceSelectors'
import type { AppSection, ProjectSetupDefaults } from '../../types'
import { DEFAULT_PROJECT_SETUP } from '../../types'
import { saveWorkspaceSetup, uploadWorkspaceCover, deleteWorkspaceCover, workspaceCoverUrl, type Workspace } from '../../api/client'
import { ProjectSetupForm, ProjectSetupSummary, PROJECT_SETUP_TEMPLATES } from './ProjectSetupForm'
import { SkeletonGrid } from '../shared/Skeleton'

/**
 * Projects page — one-to-one with workspaces on the backend.
 *
 * Each project IS a workspace: a folder under `outputs/` that stores all
 * the generated media, Editor projects and Director productions scoped
 * to that project. Creating a project creates its workspace folder;
 * deleting a project removes the folder and everything inside.
 *
 * The implicit `default` workspace (the root `outputs/` directory) is
 * intentionally hidden — it exists on the backend for backward compat
 * with pre-projects generations, but it's not a user-facing concept.
 * Showing it would let users "open" a catch-all bucket and defeat the
 * per-project organization this page exists to enforce.
 *
 * Project setup (aspect ratio, resolution, models, workflow, audio,
 * LoRAs, advanced) lives in this page. The New project dialog collects
 * the choices up front so the Director opens with project defaults
 * already applied; the Edit setup affordance on each card edits the
 * stored setup.json for an existing project. Runtime overrides happen
 * inside the Director's right column and only flow into
 * `director_ui_snapshot` (per-take), keeping the project setup clean.
 */
function formatUpdated(timestamp?: number | null): string | null {
  if (!timestamp) return null
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - timestamp))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(timestamp * 1000).toLocaleDateString()
}

const COVER_FILE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'bmp']

/** Square cover picker shown next to the project name (New dialog) or
 *  the dialog title (Edit setup). Shows the stored cover or the pending
 *  file thumbnail; the file itself only uploads on save. */
function CoverSquareButton({ workspaceName, coverImage, pendingFile, pendingUrl, disabled, onPick, onClear }: {
  workspaceName: string | null
  coverImage: string
  pendingFile: File | null
  pendingUrl: string | null
  disabled?: boolean
  onPick: (file: File) => void
  onClear: () => void
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const src = pendingUrl || (coverImage && workspaceName ? workspaceCoverUrl(workspaceName, coverImage) : null)
  const failed = failedSrc !== null && failedSrc === src
  if (src && !failed) {
    return (
      <span className="relative shrink-0" title={pendingFile ? `${pendingFile.name} · uploads on save` : 'Project cover · click × to remove'}>
        <img src={src} alt="Project cover" className="block h-10 w-10 rounded-lg border border-border object-cover" onError={() => setFailedSrc(src)} />
        <button type="button" onClick={onClear} disabled={disabled} aria-label="Remove cover image" className="absolute -top-1.5 -right-1.5 rounded-full border border-border bg-bg-primary p-0.5 hover:bg-bg-hover transition-colors disabled:opacity-50">
          <X size={10} className="text-text-muted" />
        </button>
      </span>
    )
  }
  return (
    <label title="Upload a cover image (.png, .jpg, .webp, .bmp)" aria-label="Upload a cover image" className={`flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-dashed transition-colors ${disabled ? 'cursor-not-allowed opacity-50' : 'border-border hover:border-accent-blue'}`}>
      <ImagePlus size={16} className="text-text-muted" />
      <input type="file" accept=".png,.jpg,.jpeg,.webp,.bmp" className="hidden" disabled={disabled} onChange={e => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = '' }} />
    </label>
  )
}

export function ProjectsPage() {
  const workspaces = useWorkspaceSlice('workspaces')
  const active = useWorkspaceSlice('activeWorkspace')
  const workspacesLoading = useWorkspaceSlice('workspacesLoading')
  const createWorkspace = useStore(s => s.createWorkspace)
  const switchWorkspace = useStore(s => s.switchWorkspace)
  const deleteWorkspace = useStore(s => s.deleteWorkspace)
  const saveSetupAction = useStore(s => s.saveWorkspaceSetup)
  const navigate = useStore(s => s.setAppSection)
  const studioModels = useStore(s => s.selectedModelPerMode)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [setup, setSetup] = useState<ProjectSetupDefaults>(DEFAULT_PROJECT_SETUP)
  const [destination, setDestination] = useState<AppSection>('director')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  // Card armed for deletion — shows a small inline confirm popover
  // next to its trash button instead of a central modal.
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null)
  // Cover image picked in the dialog but not uploaded yet (the New
  // project workspace doesn't exist until submit). Uploaded as part of
  // create/saveEdit, then cleared.
  const [pendingCover, setPendingCover] = useState<File | null>(null)
  const [coverError, setCoverError] = useState('')
  const pendingCoverUrl = useMemo(() => pendingCover ? URL.createObjectURL(pendingCover) : null, [pendingCover])
  useEffect(() => () => { if (pendingCoverUrl) URL.revokeObjectURL(pendingCoverUrl) }, [pendingCoverUrl])
  const handlePickCover = (file: File) => {
    const ext = (file.name.split('.').pop() || '').toLowerCase()
    if (!COVER_FILE_EXTENSIONS.includes(ext)) {
      setCoverError('Cover must be a .png, .jpg, .jpeg, .webp or .bmp file.')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setCoverError('Cover image too large (max 10 MB).')
      return
    }
    setCoverError('')
    setPendingCover(file)
  }
  const handleClearCover = () => {
    setCoverError('')
    setPendingCover(null)
    setSetup(prev => (prev.cover_image ? { ...prev, cover_image: '' } : prev))
  }
  // Cover filename the dialog started with — used to detect a removal
  // that must also delete the stored file on save.
  const [initialCover, setInitialCover] = useState('')

  const userProjects = workspaces
    .filter(w => w.name !== 'default')
    .sort((a, b) => {
      const aPinned = Boolean(a.setup?.pinned), bPinned = Boolean(b.setup?.pinned)
      if (aPinned !== bPinned) return aPinned ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  const hasProjects = userProjects.length > 0
  const visible = userProjects.filter(w => w.name.toLowerCase().includes(query.toLowerCase()))

  const open = async (workspace: string, section: AppSection) => {
    setBusy(workspace); setError(null)
    try {
      await switchWorkspace(workspace)
      if (useStore.getState().activeWorkspace !== workspace) throw new Error('Could not open this project. Please try again.')
      navigate(section)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not open project.') }
    finally { setBusy(null) }
  }
  const create = async () => {
    const value = name.trim().replace(/\s+/g, '-')
    if (!value) return
    setBusy('new'); setError(null)
    try {
      // createWorkspace hits POST /api/v1/workspaces which creates the
      // folder under outputs/ AND sets it as the active workspace in a
      // single round-trip — same operation, two effects. We then route
      // the user to Director so the new project is immediately usable.
      // After the folder exists we persist the ProjectSetup; the form
      // values flow into Director fields via loadWorkspaceSetup on next
      // mount via the store. Done sequentially so a failed save never
      // strands a project on disk in an unexpected shape.
      await createWorkspace(value)
      // A picked cover can only be uploaded now that the folder
      // exists — merge the stored filename into the setup payload.
      let nextSetup = setup
      if (pendingCover) {
        const { cover_image } = await uploadWorkspaceCover(value, pendingCover)
        nextSetup = { ...nextSetup, cover_image }
      }
      await saveSetupAction(nextSetup)
      setCreating(false); setName('')
      setSetup(DEFAULT_PROJECT_SETUP)
      setPendingCover(null)
      setCoverError('')
      setInitialCover('')
      setDestination('director')
      navigate(destination)
    }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not create project.') }
    finally { setBusy(null) }
  }
  const openDuplicate = (workspace: Workspace) => {
    setError(null)
    // The duplicate gets a fresh folder without the original's cover
    // file, so the reference must not carry over either.
    setSetup({ ...DEFAULT_PROJECT_SETUP, ...(workspace.setup || {}), pinned: false, cover_image: '' })
    setPendingCover(null)
    setCoverError('')
    setInitialCover('')
    setName(`${workspace.name.trim().replace(/\s+/g, '-')}-copy`)
    setDestination('director')
    setCreating(true)
  }
  const remove = async (name: string) => {
    setBusy(name); setError(null)
    try {
      // deleteWorkspace hits DELETE /api/v1/workspaces/<name> which
      // removes the folder and all files inside. The backend also
      // auto-switches to 'default' if the deleted workspace was active;
      // the store handles that transition by routing back to Projects.
      await deleteWorkspace(name)
      setConfirmingDelete(null)
    }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not delete project.') }
    finally { setBusy(null) }
  }
  const saveEdit = async () => {
    if (!editing) return
    setBusy(editing); setError(null)
    try {
      // Edit setup mutates the workspace's setup.json without changing
      // its folder; useStore.saveWorkspaceSetup routes through
      // applyWorkspaceSetup too, which only runs when the active
      // workspace matches. Editing a non-active workspace still
      // persists; the change applies on the next switch.
      let nextSetup = setup
      if (pendingCover) {
        const { cover_image } = await uploadWorkspaceCover(editing, pendingCover)
        nextSetup = { ...nextSetup, cover_image }
      } else if (initialCover && !nextSetup.cover_image) {
        // Cover was removed in the dialog — delete the stored file too
        // (best-effort; the reference is already cleared above).
        await deleteWorkspaceCover(editing).catch(() => undefined)
      }
      if (editing === active) {
        await saveSetupAction(nextSetup)
      } else {
        await saveWorkspaceSetup(editing, nextSetup)
      }
      await useStore.getState().loadWorkspaces()
      setEditing(null)
      setPendingCover(null)
      setCoverError('')
      setInitialCover('')
    }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save project setup.') }
    finally { setBusy(null) }
  }
  const openEdit = (workspace: string) => {
    const card = workspaces.find(w => w.name === workspace)
    setSetup(card?.setup ?? DEFAULT_PROJECT_SETUP)
    setPendingCover(null)
    setCoverError('')
    setInitialCover(card?.setup?.cover_image || '')
    setEditing(workspace)
  }
  const togglePin = async (workspace: Workspace) => {
    const busyKey = `pin-${workspace.name}`
    setBusy(busyKey); setError(null)
    try {
      const next = { ...(workspace.setup || {}), pinned: !workspace.setup?.pinned }
      if (workspace.name === active) await saveSetupAction(next as ProjectSetupDefaults)
      else await saveWorkspaceSetup(workspace.name, next)
      await useStore.getState().loadWorkspaces()
    }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not update pin.') }
    finally { setBusy(null) }
  }
  const openCreate = () => {
    setError(null)
    setSetup(DEFAULT_PROJECT_SETUP)
    setPendingCover(null)
    setCoverError('')
    setInitialCover('')
    setName('')
    setDestination('director')
    setCreating(true)
  }

  return (
    <div className="section-scroll">
      <div className="section-container">
        <div className="projects-toolbar">
          <div className="projects-toolbar-searchzone">
            <button className="shell-primary-button shrink-0" onClick={openCreate}><Plus size={16} />New project</button>
            <label className="shell-search"><Search size={15} /><input aria-label="Search projects" placeholder="Search projects…" value={query} onChange={e => setQuery(e.target.value)} /></label>
          </div>
          <span className="projects-toolbar-count">{userProjects.length} {userProjects.length === 1 ? 'project' : 'projects'}</span>
        </div>
        {error && <p role="alert" className="my-4 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-400">{error}</p>}
        {workspacesLoading && userProjects.length === 0 && (
          <SkeletonGrid count={4} />
        )}
        {!hasProjects && !query && !workspacesLoading && (
          <div className="shell-empty">
            <FolderOpen size={40} strokeWidth={1.5} />
            <h2>Create your first project</h2>
            <p>Projects keep your media, edits and Director productions organized. Pick a name and the technical defaults — Director uses them for every scene and you can change them anytime from the Edit setup menu on each card.</p>
          </div>
        )}
        {hasProjects && visible.length === 0 && (
          <div className="shell-empty"><FolderOpen size={32} /><h2>No matching projects</h2><p>Try a different name.</p></div>
        )}
        <div className="projects-grid">
          {visible.map(workspace => {
            const skill = workspace.setup?.director_skill === 'short_film' ? 'short_film' : 'music_video'
            const SkillIcon = skill === 'short_film' ? Film : Music
            const summary = ProjectSetupSummary({ setup: workspace.setup })
            const files = workspace.file_count ?? 0
            const updated = formatUpdated(workspace.modified)
            const meta = `${summary} · ${files} ${files === 1 ? 'file' : 'files'}${updated ? ` · updated ${updated}` : ''}`
            return (
            <article
              key={workspace.name}
              className={`project-card ${workspace.name === active ? 'is-current' : ''} ${workspace.setup?.pinned ? 'is-pinned' : ''}`}
              onDoubleClick={() => { if (!busy) void open(workspace.name, 'director') }}
              title="Double-click to open in Director"
            >
              <div className={`project-banner ${skill === 'short_film' ? 'project-skill-film' : 'project-skill-music'}`}>
                {workspace.setup?.cover_image ? (
                  <img
                    src={workspaceCoverUrl(workspace.name, workspace.setup.cover_image)}
                    alt={`${workspace.name} cover`}
                    loading="lazy"
                    onError={e => { e.currentTarget.style.display = 'none' }}
                  />
                ) : (
                  <div className="project-placeholder" aria-hidden="true"><SkillIcon size={34} strokeWidth={1.25} /></div>
                )}
                <span className="project-name-chip" title={workspace.name}>{workspace.name}</span>
                <div className="project-banner-badges">
                  {workspace.setup?.pinned && <span className="project-pin-badge" title="Pinned project"><Pin size={12} /></span>}
                  {workspace.name === active && <span className="project-current"><Check size={12} />Active</span>}
                </div>
              </div>
              {workspace.setup?.description && (
                <p className="text-xs text-text-secondary leading-relaxed line-clamp-2">{workspace.setup.description}</p>
              )}
              <p className="project-card-meta" title={`${meta} · ${workspace.path}`}>{meta}</p>
              {workspace.setup?.tags && workspace.setup.tags.length > 0 && (
                <p className="flex flex-wrap gap-1">
                  {workspace.setup.tags.map(tag => (
                    <span key={tag} className="rounded bg-bg-tertiary px-1.5 py-0.5 text-2xs text-text-muted">{tag}</span>
                  ))}
                </p>
              )}
              <div className="project-card-actions">
                <button disabled={busy !== null} onClick={() => void open(workspace.name, 'director')} title="Open Director" aria-label={`Open ${workspace.name} in Director`} className="project-open-icon">
                  {busy === workspace.name ? <Loader2 size={15} className="animate-spin" /> : <Clapperboard size={15} />}
                </button>
                <button disabled={busy !== null} onClick={() => void open(workspace.name, 'editor')} title={`Edit ${workspace.name}`} aria-label={`Edit ${workspace.name}`} className="shell-icon-button"><Film size={15} /></button>
                <button disabled={busy !== null} onClick={() => void open(workspace.name, 'medias')} title={`Browse ${workspace.name}`} aria-label={`Browse ${workspace.name}`} className="shell-icon-button"><Images size={15} /></button>
                <button disabled={busy !== null} onClick={() => openDuplicate(workspace)} title={`Duplicate ${workspace.name} setup`} aria-label={`Duplicate ${workspace.name} setup`} className="shell-icon-button"><Copy size={14} /></button>
                <button disabled={busy !== null} onClick={() => void togglePin(workspace)} title={workspace.setup?.pinned ? 'Unpin project' : 'Pin project'} aria-label={workspace.setup?.pinned ? 'Unpin project' : 'Pin project'} className="shell-icon-button">{busy === `pin-${workspace.name}` ? <Loader2 size={14} className="animate-spin" /> : workspace.setup?.pinned ? <PinOff size={14} /> : <Pin size={14} />}</button>
                <button disabled={busy !== null} onClick={() => openEdit(workspace.name)} title={`Edit ${workspace.name} setup`} aria-label={`Edit ${workspace.name} setup`} className="shell-icon-button"><Settings size={14} /></button>
                <span className="relative ml-auto">
                  <button disabled={busy !== null} onClick={() => setConfirmingDelete(current => current === workspace.name ? null : workspace.name)} title={`Delete ${workspace.name}`} aria-label={`Delete ${workspace.name}`} aria-expanded={confirmingDelete === workspace.name} className="shell-icon-button project-danger"><Trash2 size={14} /></button>
                  {confirmingDelete === workspace.name && (
                    <span className="project-delete-pop" role="alertdialog" aria-label={`Delete ${workspace.name}?`}>
                      <span className="project-delete-pop-text">Delete?</span>
                      <button type="button" disabled={busy !== null} onClick={() => void remove(workspace.name)} className="project-delete-confirm">
                        {busy === workspace.name ? 'Deleting…' : 'Delete'}
                      </button>
                      <button type="button" aria-label="Cancel delete" title="Cancel" onClick={() => setConfirmingDelete(null)} className="project-delete-cancel"><X size={12} /></button>
                    </span>
                  )}
                </span>
              </div>
            </article>
            )
          })}
        </div>
      </div>
      {/* New project / Edit setup dialog. Each uses its own
          contextual content; the modal chrome stays shared so the
          keyboard escape and Tab trap logic isn't repeated. Delete
          confirmation is inline on the card (no modal). */}
      {(creating || editing) && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4" onClick={() => { if (!busy) { setCreating(false); setEditing(null) } }}>
          <form role="dialog" aria-modal="true" aria-labelledby="project-dialog-title" className="w-full max-w-xl max-h-[92vh] overflow-y-auto rounded-2xl border border-border bg-bg-secondary p-5 shadow-2xl" onClick={e => e.stopPropagation()} onSubmit={e => { e.preventDefault(); void (creating ? create() : saveEdit()) }} onKeyDown={e => {
              if (e.key === 'Escape' && !busy) { setCreating(false); setEditing(null) }
              if (e.key === 'Tab') {
                const controls = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('input:not(:disabled), select:not(:disabled), button:not(:disabled)'))
                const first = controls[0], last = controls[controls.length - 1]
                if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
                if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
              }
            }}>
            <div className="mb-2 flex items-center gap-2">
              <h2 id="project-dialog-title" className="text-lg font-semibold">
                {creating ? 'New project' : `Edit ${editing} setup`}
              </h2>
              {!creating && editing && (
                <CoverSquareButton workspaceName={editing} coverImage={setup.cover_image || ''} pendingFile={pendingCover} pendingUrl={pendingCoverUrl} disabled={busy !== null} onPick={handlePickCover} onClear={handleClearCover} />
              )}
            </div>
            {coverError && <p role="alert" className="mb-2 text-xs text-red-400">{coverError}</p>}
            {creating ? (
              <>
                <div className="flex items-end gap-2">
                  <label className="block flex-1 min-w-0 text-xs text-text-secondary">Project name<input autoFocus required value={name} onChange={e => setName(e.target.value)} className="mt-2 w-full rounded-lg border border-border bg-bg-primary px-3 py-2.5 text-sm text-text-primary" placeholder="my-new-film" /></label>
                  <CoverSquareButton workspaceName={null} coverImage={setup.cover_image || ''} pendingFile={pendingCover} pendingUrl={pendingCoverUrl} disabled={busy !== null} onPick={handlePickCover} onClear={handleClearCover} />
                </div>
                {coverError && <p role="alert" className="mt-1.5 text-xs text-red-400">{coverError}</p>}
                <p className="mt-2 text-xs text-text-muted">A new folder named <code className="text-text-secondary">{name.trim().replace(/\s+/g, '-') || 'project-name'}</code> will be created under <code className="text-text-secondary">outputs/</code>.</p>
                <div className="mt-4">
                  <span className="text-xs text-text-secondary block mb-1.5">Start from a template</span>
                  <div className="grid grid-cols-4 gap-1.5">
                    {PROJECT_SETUP_TEMPLATES.map(tmpl => {
                      const activeT = setup.aspect_ratio === tmpl.setup.aspect_ratio && setup.resolution === tmpl.setup.resolution
                        && (tmpl.setup.director_skill === undefined || (setup.director_skill || 'music_video') === tmpl.setup.director_skill)
                      return (
                        <button
                          key={tmpl.value}
                          type="button"
                          onClick={() => setSetup({ ...DEFAULT_PROJECT_SETUP, ...tmpl.setup })}
                          disabled={busy !== null}
                          className={`min-w-0 px-2 py-1.5 rounded-lg border text-xs text-center leading-tight transition-all ${
                            activeT
                              ? 'border-accent-blue bg-accent-blue/10 text-text-primary'
                              : 'border-border text-text-muted hover:border-border-light hover:text-text-secondary'
                          } disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                          <span className="font-medium block truncate">{tmpl.label}</span>
                          <span className="text-2xs opacity-60 block truncate">{tmpl.desc}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-1.5">
                  <span className="text-xs text-text-secondary col-span-3">Open in</span>
                  {([
                    { value: 'director', label: 'Director' },
                    { value: 'editor', label: 'Editor' },
                    { value: 'medias', label: 'Media' },
                  ] as const).map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={busy !== null}
                      onClick={() => setDestination(opt.value)}
                      className={`px-2.5 py-1 rounded-lg border text-xs text-center transition-all ${
                        destination === opt.value
                          ? 'border-accent-blue bg-accent-blue/10 text-text-primary'
                          : 'border-border text-text-muted hover:border-border-light hover:text-text-secondary'
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <div className="mt-4 border-t border-border/40 pt-3">
                  <ProjectSetupForm value={setup} onChange={setSetup} studioModels={{ video: studioModels?.video, image: studioModels?.image, audio: studioModels?.audio }} />
                </div>
              </>
            ) : (
              <>
                <div>
                  <ProjectSetupForm value={setup} onChange={setSetup} compact studioModels={{ video: studioModels?.video, image: studioModels?.image, audio: studioModels?.audio }} />
                </div>
              </>
            )}
            {error && <p role="alert" className="mt-3 text-sm text-red-400">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" disabled={busy !== null} className="shell-secondary-button" onClick={() => { setCreating(false); setEditing(null) }}>Cancel</button>
              <button disabled={busy !== null || (!creating && !editing) || (creating && !name.trim())} className="shell-primary-button">
                {busy ? 'Working…' : creating ? 'Create project' : 'Save setup'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

/* Re-exports intentionally not repeated here so ESLint's react-refresh
 * rule doesn't fire. Tests and sister files import `shortModelLabel`
 * directly from `./ProjectSetupForm`. */
