import { useEffect, useMemo, useState } from 'react'
import { Check, Clapperboard, Copy, Film, FolderOpen, Image as ImageIcon, Images, Loader2, Music, Pin, Plus, Search, Settings, Trash2, X } from 'lucide-react'
import { useStore } from '../../stores/useStore'
import { useWorkspaceSlice } from '../../stores/workspaceSelectors'
import type { AppSection, ProjectSetupDefaults } from '../../types'
import { DEFAULT_PROJECT_SETUP } from '../../types'
import type { ProjectType } from '../../types/projects'
import { saveWorkspaceSetup, uploadWorkspaceCover, deleteWorkspaceCover, workspaceCoverUrl, type Workspace } from '../../api/client'
import { applyPreset, presetById, presetForType, trackOverrides } from '../../projects/presets'
import { ProjectSetupForm, ProjectSetupSummary } from './ProjectSetupForm'
import { SkeletonGrid } from '../shared/Skeleton'
import { ActionMenu } from '../shared/ActionMenu'
import { AppDialog } from '../shared/AppDialog'
import { Button } from '../shared/Button'
import { TextField } from '../shared/TextField'
import { NsfwToggle } from '../NSFW/NsfwToggle'

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

/** Full-width cover dropzone shown at the top of the project dialogs.
 *  Accepts a click or a drag & drop of an image file; the file itself
 *  only uploads on save. Shows the stored cover (or the pending file
 *  thumbnail) as a preview once one is picked. */
function CoverDropzone({ workspaceName, coverImage, pendingFile, pendingUrl, disabled, onPick, onClear }: {
  workspaceName: string | null
  coverImage: string
  pendingFile: File | null
  pendingUrl: string | null
  disabled?: boolean
  onPick: (file: File) => void
  onClear: () => void
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const src = pendingUrl || (coverImage && workspaceName ? workspaceCoverUrl(workspaceName, coverImage) : null)
  const failed = failedSrc !== null && failedSrc === src

  if (src && !failed) {
    return (
      <div className="relative mx-auto w-full max-w-[400px] overflow-hidden rounded-lg border border-border">
        <img
          src={src}
          alt="Project cover"
          className="block aspect-[16/9] w-full object-cover"
          onError={() => setFailedSrc(src)}
        />
        <button
          type="button"
          onClick={onClear}
          disabled={disabled}
          aria-label="Remove cover image"
          title="Remove cover image"
          className="absolute top-1.5 right-1.5 rounded-full border border-border bg-bg-primary p-0.5 hover:bg-bg-hover transition-colors disabled:opacity-50"
        >
          <X size={10} className="text-text-muted" />
        </button>
        <span className="absolute bottom-1.5 left-1.5 rounded bg-black/50 px-1.5 py-0.5 text-2xs text-white/80">
          {pendingFile ? `${pendingFile.name} · uploads on save` : 'Project cover'}
        </span>
      </div>
    )
  }

  return (
    <label
      title="Upload a cover image (.png, .jpg, .webp, .bmp)"
      aria-label="Upload a cover image"
      onDragOver={e => { e.preventDefault(); if (!disabled) setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => {
        e.preventDefault()
        setDragOver(false)
        if (disabled) return
        const file = e.dataTransfer.files?.[0]
        if (file) onPick(file)
      }}
      className={`flex aspect-[16/9] w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-4 text-center transition-colors ${
        dragOver ? 'border-accent-blue bg-accent-blue/10' : 'border-border hover:border-border-light'
      } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
    >
      <ImageIcon size={26} className="text-accent-blue/60" />
      <span className="text-xs text-text-secondary">Drop an image or click to upload</span>
      <input
        type="file"
        accept=".png,.jpg,.jpeg,.webp,.bmp"
        className="hidden"
        disabled={disabled}
        onChange={e => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = '' }}
      />
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
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [setup, setSetup] = useState<ProjectSetupDefaults>(DEFAULT_PROJECT_SETUP)
  const [destination, setDestination] = useState<AppSection>('director')
  // Quick-create path: type drives the recommended preset; the
  // preset fills the technical defaults.
  const [projectType, setProjectType] = useState<ProjectType>('music-video')
  const [presetId, setPresetId] = useState<string>(presetForType('music-video').id)
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
      // A10 quick path: apply the chosen preset (any expanded-form
      // edits win over it and are recorded as `overrides`), then
      // persist the whole setup including preset_id + overrides.
      const preset = presetById(presetId) ?? presetForType(projectType)
      const diverged = trackOverrides(setup, preset)
      const patch = Object.fromEntries(diverged.map(f => [f, setup[f]]))
      const nextSetup = applyPreset(setup, preset, patch)
      setSetup(nextSetup)
      // A picked cover can only be uploaded now that the folder
      // exists — merge the stored filename into the setup payload.
      let finalSetup = nextSetup
      if (pendingCover) {
        const { cover_image } = await uploadWorkspaceCover(value, pendingCover)
        finalSetup = { ...nextSetup, cover_image }
      }
      await saveSetupAction(finalSetup)
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

  const openCreate = () => {
    setError(null)
    const type: ProjectType = 'music-video'
    const preset = presetForType(type)
    setProjectType(type)
    setPresetId(preset.id)
    setSetup(applyPreset(DEFAULT_PROJECT_SETUP, preset))
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
                {/* Three frequent actions stay on the card; the rest
                    moved into a labelled menu so the destructive one
                    no longer sits in the same row as the harmless
                    ones and every entry carries its own name. */}
                <button disabled={busy !== null} onClick={() => void open(workspace.name, 'director')} title="Open Director" aria-label={`Open ${workspace.name} in Director`} className="project-open-icon">
                  {busy === workspace.name ? <Loader2 size={15} className="animate-spin" /> : <Clapperboard size={15} />}
                </button>
                <button disabled={busy !== null} onClick={() => void open(workspace.name, 'editor')} title={`Edit ${workspace.name}`} aria-label={`Edit ${workspace.name}`} className="shell-icon-button"><Film size={15} /></button>
                <button disabled={busy !== null} onClick={() => void open(workspace.name, 'medias')} title={`Browse ${workspace.name}`} aria-label={`Browse ${workspace.name}`} className="shell-icon-button"><Images size={15} /></button>
                <span className="relative ml-auto">
                  <ActionMenu
                    disabled={busy !== null}
                    ariaLabel={`More actions for ${workspace.name}`}
                    items={[
                      { id: 'duplicate', label: 'Duplicate setup', icon: <Copy size={13} />, onSelect: () => openDuplicate(workspace) },

                      { id: 'settings', label: 'Project settings', icon: <Settings size={13} />, onSelect: () => openEdit(workspace.name) },
                      { id: 'delete', label: 'Delete project', icon: <Trash2 size={13} />, danger: true, onSelect: () => setConfirmingDelete(current => current === workspace.name ? null : workspace.name) },
                    ]}
                  />
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
      {/* New project / Edit setup dialog. Chrome (focus, Escape,
          backdrop, ARIA) comes from the shared <AppDialog>; the form
          content stays local. Delete confirmation is inline on the
          card (no modal). */}
      <AppDialog
        open={creating || Boolean(editing)}
        onClose={() => { if (!busy) { setCreating(false); setEditing(null) } }}
        title={creating ? 'New project' : `Edit ${editing} setup`}
      >
        <form onSubmit={e => { e.preventDefault(); void (creating ? create() : saveEdit()) }}>
          {!creating && editing && (
            <div className="mb-3">
              <CoverDropzone workspaceName={editing} coverImage={setup.cover_image || ''} pendingFile={pendingCover} pendingUrl={pendingCoverUrl} disabled={busy !== null} onPick={handlePickCover} onClear={handleClearCover} />
            </div>
          )}
          {coverError && <p role="alert" className="mb-2 text-xs text-red-400">{coverError}</p>}
          {creating ? (
            <>
              <div>
                <TextField
                  id="project-name"
                  label="Project name"
                  hideLabel
                  required
                  autoFocus
                  value={name}
                  onChange={setName}
                  placeholder="my-new-film"
                />
              </div>
              <div className="mt-3">
                <CoverDropzone workspaceName={null} coverImage={setup.cover_image || ''} pendingFile={pendingCover} pendingUrl={pendingCoverUrl} disabled={busy !== null} onPick={handlePickCover} onClear={handleClearCover} />
              </div>
              {/* Quick path: type drives the project defaults cleanly. */}
              <div className="mt-3">
                <span className="text-xs text-text-secondary">Type</span>
                <div className="mt-1 grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Project type">
                  {([
                    { value: 'music-video', label: 'Music Video' },
                    { value: 'short-film', label: 'Short Film' },
                    { value: 'custom', label: 'Custom' },
                  ] as const).map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={projectType === opt.value}
                      disabled={busy !== null}
                      onClick={() => {
                        setProjectType(opt.value)
                        const recommended = presetForType(opt.value)
                        setPresetId(recommended.id)
                        // Keep whatever the user already edited in this
                        // dialog as explicit overrides on the new preset.
                        setSetup(prev => {
                          const current = presetById(presetId)
                          const diverged = current ? trackOverrides(prev, current) : []
                          const patch = Object.fromEntries(diverged.map(f => [f, prev[f]]))
                          return applyPreset(prev, recommended, patch)
                        })
                      }}
                      className={`px-2.5 py-1.5 rounded-lg border text-xs text-center transition-all ${
                        projectType === opt.value
                          ? 'border-accent-blue bg-accent-blue/10 text-text-primary'
                          : 'border-border text-text-muted hover:border-border-light hover:text-text-secondary'
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                <span className="text-xs text-text-secondary col-span-full">Open in</span>
                {([
                  { value: 'wizard', label: 'Wizard' },
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
                <ProjectSetupForm
                  value={setup}
                  onChange={setSetup}
                  hideSkill
                />
              </div>
            </>
          ) : (
            <>
              {/* A10: show which preset the project was created with and
                  which fields diverge from it, so re-opening the setup
                  never loses that context. */}
              {(() => {
                const preset = presetById(setup.preset_id)
                if (!preset) return null
                const overridden = Array.isArray(setup.overrides) ? setup.overrides : []
                return (
                  <p className="mb-2 rounded-lg border border-border/60 bg-bg-tertiary/40 px-2.5 py-1.5 text-2xs text-text-muted">
                    Preset: <span className="text-text-secondary">{preset.label}</span>
                    {overridden.length > 0 && (
                      <> · overridden: <span className="text-text-secondary">{overridden.join(', ')}</span></>
                    )}
                  </p>
                )
              })()}
              <div>
                <ProjectSetupForm value={setup} onChange={setSetup} compact />
              </div>
            </>
          )}
          {error && <p role="alert" className="mt-3 text-sm text-red-400">{error}</p>}
          {/* Footer — the NSFW content-mode toggle rides along with the
              action buttons, on the far left of the same row. */}
          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="text-2xs uppercase tracking-wider text-text-muted shrink-0">Content mode</span>
              <NsfwToggle disabled={busy !== null} />
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="secondary" disabled={busy !== null} onClick={() => { setCreating(false); setEditing(null) }}>Cancel</Button>
              <Button type="submit" variant="primary" loading={busy !== null} disabled={!creating && !editing || (creating && !name.trim())}>
                {creating ? 'Create project' : 'Save setup'}
              </Button>
            </div>
          </div>
        </form>
      </AppDialog>
    </div>
  )
}

/* Re-exports intentionally not repeated here so ESLint's react-refresh
 * rule doesn't fire. Tests and sister files import `shortModelLabel`
 * directly from `./ProjectSetupForm`. */
