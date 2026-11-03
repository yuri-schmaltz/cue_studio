import { useMemo, useEffect } from 'react'
import { FolderOpen, Clapperboard, Film, Images, SlidersHorizontal, Lock, ListVideo } from 'lucide-react'
import { useStore } from '../../stores/useStore'
import { useActiveProject } from '../../navigation/useUrlNavigation'
import { PROMPT_ENHANCEMENT_ACTIVITY } from '../../lib/promptEnhancementActivity'
import { TabStrip } from '../shared/TabStrip'
import type { AppSection } from '../../types'

const sections: ReadonlyArray<{
  id: AppSection
  label: string
  icon: typeof FolderOpen
  showCount?: boolean
}> = [
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
  const activeProject = useActiveProject()

  useEffect(() => {
    document.title = activeProject ? `Cue Studio - ${activeProject}` : 'Cue Studio'
  }, [activeProject])

  return (
    <header className="application-header" data-testid="application-header">
      <nav className="application-navigation" aria-label="Main navigation">
        <TabStrip
          variant="section"
          ariaLabel="Application sections"
          idPrefix="tab"
          controlsId={item => `panel-${item.id}`}
          items={sections.map(({ id, label, icon, showCount }) => ({
            id,
            label,
            icon,
            badge: showCount ? queueCount : null,
            ariaLabel: showCount ? `${label}, ${queueCount} ${queueCount === 1 ? 'item' : 'items'}` : undefined,
            disabled: projectGated.has(id) && !hasProject,
            title: projectGated.has(id) && !hasProject ? 'Create or open a project first' : undefined,
          }))}
          value={active}
          onChange={select}
          dataSectionKey={item => item.id}
          renderTrailing={item => (
            projectGated.has(item.id as AppSection) && !hasProject
              ? <Lock size={11} aria-hidden="true" className="application-tab-lock" />
              : null
          )}
        />
      </nav>
    </header>
  )
}
