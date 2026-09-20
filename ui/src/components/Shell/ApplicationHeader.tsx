import { useMemo } from 'react'
import { FolderOpen, Clapperboard, Film, Images, SlidersHorizontal, Lock, ListVideo, LayoutDashboard } from 'lucide-react'
import { useStore } from '../../stores/useStore'
import { PROMPT_ENHANCEMENT_ACTIVITY } from '../../lib/promptEnhancementActivity'
import type { AppSection } from '../../types'

const sections: ReadonlyArray<{
  id: AppSection
  label: string
  icon: typeof FolderOpen
  showCount?: boolean
}> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'projects', label: 'Projects', icon: FolderOpen },
  { id: 'director', label: 'Director', icon: Clapperboard },
  { id: 'studio', label: 'Studio', icon: SlidersHorizontal },
  { id: 'editor', label: 'Editor', icon: Film },
  { id: 'medias', label: 'Medias', icon: Images },
  { id: 'queue', label: 'Queue', icon: ListVideo, showCount: true },
  { id: 'configurations', label: 'Configurations', icon: SlidersHorizontal },
]

// Project-scoped sections are gated behind having a real (non-default)
// workspace selected. Configurations and Queue stay accessible — model/
// theme/storage tuning is global, and the queue tracks global jobs.
const projectGated = new Set<AppSection>(['director', 'editor', 'medias'])

const ACTIVE_JOB_STATUSES = new Set(['held', 'queued', 'running', 'awaiting_review'])
const ACTIVE_DIRECTOR_STATUSES = new Set(['held', 'queued', 'running', 'awaiting_review'])
const ACTIVE_PIPELINE_STATUSES = new Set(['queued', 'running', 'paused'])

export function ApplicationHeader() {
  const active = useStore(s => s.appSection)
  const navigate = useStore(s => s.setAppSection)
  const hasProject = useStore(s => s.activeWorkspace !== 'default')

  // Live count of items currently in the generation queue (Studio +
  // Director). Drives the badge on the Queue tab — same logic the old
  // `GlobalQueuePopover` used to show in its corner badge.
  const jobs = useStore(s => s.jobs)
  const isEnhancing = useStore(s => s.isEnhancing)
  const directorQueue = useStore(s => s.directorQueue)
  const pipelineId = useStore(s => s.pipelineId)
  const pipelineStatus = useStore(s => s.pipelineStatus)

  const queueCount = useMemo(() => {
    const activeJobs = jobs.filter(job => ACTIVE_JOB_STATUSES.has(job.status))
    const studioJobs = isEnhancing ? [PROMPT_ENHANCEMENT_ACTIVITY, ...activeJobs] : activeJobs
    const directorEntries = directorQueue?.entries || []
    const pendingDirectorCount = directorEntries.filter(entry => (
      ACTIVE_DIRECTOR_STATUSES.has(entry.status)
    )).length
    const activePipeline = Boolean(
      pipelineId && pipelineStatus && ACTIVE_PIPELINE_STATUSES.has(pipelineStatus.status),
    )
    const activePipelineIsQueued = Boolean(
      activePipeline && directorEntries.some(entry => (
        (entry.status === 'running' || entry.status === 'awaiting_review')
        && (!entry.pipeline_id || entry.pipeline_id === pipelineId)
      )),
    )
    return studioJobs.length
      + pendingDirectorCount
      + (activePipeline && !activePipelineIsQueued ? 1 : 0)
  }, [jobs, isEnhancing, directorQueue?.entries, pipelineId, pipelineStatus])

  const select = (id: AppSection) => navigate(id)
  return (
    <header className="application-header" data-testid="application-header">
      <nav className="application-navigation" aria-label="Main navigation">
        <div role="tablist" aria-label="Application sections" className="application-tabs">
          {sections.map(({ id, label, icon: Icon, showCount }, index) => {
            const locked = projectGated.has(id) && !hasProject
            const count = showCount ? queueCount : 0
            return (
              <button key={id} id={`tab-${id}`} type="button" role="tab"
                aria-selected={active === id} aria-controls={`panel-${id}`} tabIndex={active === id ? 0 : -1}
                aria-disabled={locked || undefined}
                aria-label={showCount ? `${label}, ${count} ${count === 1 ? 'item' : 'items'}` : label}
                title={locked ? 'Create or open a project first' : undefined}
                data-section={id}
                className={`application-tab ${active === id ? 'is-active' : ''} ${locked ? 'is-locked' : ''}`}
                onClick={() => select(id)}
                onKeyDown={event => {
                  const next = event.key === 'ArrowRight' ? (index + 1) % sections.length
                    : event.key === 'ArrowLeft' ? (index + sections.length - 1) % sections.length
                      : event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1 : -1
                  if (next < 0) return
                  event.preventDefault()
                  select(sections[next].id)
                  document.getElementById(`tab-${sections[next].id}`)?.focus()
                }}>
                <Icon size={16} aria-hidden="true" />
                <span>{label}</span>
                {showCount && count > 0 && (
                  <span className="application-tab-count" aria-hidden="true">{count > 99 ? '99+' : count}</span>
                )}
                {locked && <Lock size={11} aria-hidden="true" className="application-tab-lock" />}
              </button>
            )
          })}
        </div>
      </nav>
    </header>
  )
}
