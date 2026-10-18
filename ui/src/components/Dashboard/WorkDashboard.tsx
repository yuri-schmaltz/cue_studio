import { useMemo } from 'react'
import { Clapperboard, FolderOpen, Image as ImageIcon, ListVideo, Music, Plus, Sparkles, Film } from 'lucide-react'
import { useStore } from '../../stores/useStore'
import { useWorkspaceSlice } from '../../stores/workspaceSelectors'
import { usePolling } from '../../lib/usePolling'
import { formatAge, formatEtaDuration } from '../../lib/format'
import { EmptyState } from '../shared/EmptyState'
import { StatusBadge, type StatusLevel } from '../shared/StatusBadge'
import { QUEUE_LABELS, type QueueState } from '../../queue/types'
import { buildDashboardSummary } from '../../dashboard/summary'

/**
 * Work dashboard summary (feature A11).
 *
 * Answers "where is my production and what do I do next" on top of the
 * pipeline-review Dashboard:
 *
 * - no production → "Create project" CTA + first-steps guide,
 * - with production → continue last project, summarized queue with
 *   state and action, and the latest outputs with thumbnails.
 *
 * Every block links straight to the right section (director / queue /
 * medias). Data comes from the store the app already refreshes; this
 * component only polls the (cheap) outputs listing while visible.
 */

const STATUS_LEVELS: Record<QueueState, StatusLevel> = {
  queued: 'info',
  preparing: 'busy',
  running: 'busy',
  awaiting_review: 'warning',
  done: 'ok',
  failed: 'error',
  cancelled: 'info',
}

export function WorkDashboard() {
  const workspaces = useWorkspaceSlice('workspaces')
  const activeWorkspace = useWorkspaceSlice('activeWorkspace')
  const jobs = useStore(s => s.jobs)
  const directorQueue = useStore(s => s.directorQueue)
  const outputs = useStore(s => s.outputs)
  const loadOutputs = useStore(s => s.loadOutputs)
  const loadWorkspaces = useStore(s => s.loadWorkspaces)
  const switchWorkspace = useStore(s => s.switchWorkspace)
  const setAppSection = useStore(s => s.setAppSection)

  // Keep the two cheap listings fresh while the dashboard is visible.
  // Both calls are no-ops while the tab is hidden (usePolling contract).
  usePolling(() => { void loadOutputs() }, 30000)
  usePolling(() => { void loadWorkspaces() }, 30000)

  const summary = useMemo(() => buildDashboardSummary({
    workspaces,
    activeWorkspace,
    jobs,
    directorEntries: directorQueue?.entries ?? [],
    outputs,
  }), [workspaces, activeWorkspace, jobs, directorQueue?.entries, outputs])

  const openProject = async (projectId: string, section: 'director' | 'medias') => {
    if (activeWorkspace !== projectId) await switchWorkspace(projectId)
    setAppSection(section)
  }

  const handleQueueAction = async (item: { id: string; action: { kind: string } | null }) => {
    const action = item.action
    if (!action) return
    if (action.kind === 'cancel') {
      if (item.id) useStore.getState().stopGeneration(item.id)
      return
    }
    if (action.kind === 'review') {
      // Review jumps into the Director for that entry — same path the
      // Queue page's "Open Director project" uses.
      const state = useStore.getState()
      const entry = state.directorQueue?.entries.find(e => e.id === item.id)
      if (entry?.status === 'awaiting_review' && entry.pipeline_id) {
        await state.reattachDirectorPipeline(entry.pipeline_id)
      } else {
        await state.loadDirectorQueueEntry(item.id)
        state.setSidebarOpen(true)
      }
      setAppSection('director')
      return
    }
    setAppSection('queue')
  }

  const hasProduction =
    summary.continueProject !== null
    || summary.queue.length > 0
    || summary.recentOutputs.length > 0

  return (
    <section aria-label="Work dashboard" data-testid="work-dashboard" className="space-y-5">
      {/* Header row — title + primary CTA always available. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-text-primary">
          <ListVideo size={16} className="text-accent-blue" aria-hidden="true" />
          In production
        </h2>
        <button
          type="button"
          onClick={() => setAppSection('projects')}
          className="shell-secondary-button"
        >
          <Plus size={14} /> Create project
        </button>
      </div>

      {!hasProduction && (
        <div className="space-y-4">
          <EmptyState
            title="No project in production"
            description="Create a project to plan scenes with the Director, or generate manual clips in the Studio."
            icon={<FolderOpen size={40} strokeWidth={1.5} />}
            action={{ label: 'Create project', onClick: () => setAppSection('projects') }}
          />
          {/* First steps — the spec's onboarding trio. */}
          <ol className="mx-auto grid max-w-2xl gap-2 sm:grid-cols-3" aria-label="First steps">
            {[
              { Icon: Plus, title: 'Create project', desc: 'Name + type + recommended preset', go: () => setAppSection('projects') },
              { Icon: Sparkles, title: 'Choose a model', desc: 'Adjust the models in the project setup', go: () => setAppSection('configurations') },
              { Icon: Clapperboard, title: 'Generate', desc: 'Plan scenes in the Director or hit Generate in the Studio', go: () => setAppSection('projects') },
            ].map(({ Icon, title, desc, go }, index) => (
              <li key={title}>
                <button
                  type="button"
                  onClick={go}
                  className="flex h-full w-full flex-col items-start gap-1.5 rounded-xl border border-border bg-bg-secondary p-3 text-left transition-colors hover:border-accent-blue/50"
                >
                  <span className="flex items-center gap-2 text-xs font-medium text-text-primary">
                    <Icon size={14} className="text-accent-blue" aria-hidden="true" />
                    {index + 1}. {title}
                  </span>
                  <span className="text-2xs text-text-muted">{desc}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}

      {hasProduction && (
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Continue last project */}
          {summary.continueProject && (
            <article className="rounded-xl border border-border bg-bg-secondary p-4" aria-label="Continue project">
              <h3 className="text-2xs uppercase tracking-wider text-text-muted">Continue</h3>
              <p className="mt-2 truncate text-sm font-medium text-text-primary" title={summary.continueProject.name}>
                {summary.continueProject.name}
              </p>
              <p className="mt-0.5 text-2xs text-text-muted">
                updated {formatAge(summary.continueProject.updatedAt)}
              </p>
              <button
                type="button"
                onClick={() => { void openProject(summary.continueProject!.id, 'director') }}
                className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent-blue px-3 py-1.5 text-xs font-medium text-white transition-all hover:brightness-110"
              >
                <Clapperboard size={13} aria-hidden="true" /> Open in Director
              </button>
            </article>
          )}

          {/* Generation queue */}
          <article className="rounded-xl border border-border bg-bg-secondary p-4" aria-label="Generation queue">
            <div className="flex items-center justify-between">
              <h3 className="text-2xs uppercase tracking-wider text-text-muted">Queue</h3>
              {summary.queue.length > 0 && (
                <button
                  type="button"
                  onClick={() => setAppSection('queue')}
                  className="text-2xs text-accent-blue hover:underline"
                >
                  View all
                </button>
              )}
            </div>
            {summary.queue.length === 0 ? (
              <p className="mt-3 text-2xs text-text-muted">Nothing generating right now.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {summary.queue.slice(0, 4).map(item => (
                  <li key={item.id} className="flex items-center gap-2">
                    <StatusBadge level={STATUS_LEVELS[item.status]} label={QUEUE_LABELS[item.status]} className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-2xs text-text-secondary" title={item.label}>{item.label}</span>
                    {item.action && (
                      <button
                        type="button"
                        onClick={() => { void handleQueueAction(item) }}
                        className="shrink-0 rounded border border-border px-1.5 py-0.5 text-2xs text-text-secondary transition-colors hover:border-accent-blue hover:text-text-primary"
                      >
                        {item.action.label}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {/* Duration feedback (A14): only when a real ETA exists. */}
            {jobs.some(j => j.status === 'running' && j.generationEtaSeconds != null) && (
              <p className="mt-3 text-2xs text-text-muted">
                Estimated time remaining:{' '}
                {formatEtaDuration(Math.min(...jobs
                  .filter(j => j.status === 'running' && j.generationEtaSeconds != null)
                  .map(j => j.generationEtaSeconds as number)))}
              </p>
            )}
          </article>

          {/* Recent outputs */}
          <article className="rounded-xl border border-border bg-bg-secondary p-4" aria-label="Recent outputs">
            <h3 className="text-2xs uppercase tracking-wider text-text-muted">Recent outputs</h3>
            {summary.recentOutputs.length === 0 ? (
              <p className="mt-3 text-2xs text-text-muted">No media generated yet.</p>
            ) : (
              <ul className="mt-2 grid grid-cols-4 gap-1.5">
                {summary.recentOutputs.map(output => (
                  <li key={output.id}>
                    <button
                      type="button"
                      onClick={() => { void openProject(output.projectId, 'medias') }}
                      className="block aspect-square w-full overflow-hidden rounded-lg border border-border bg-bg-tertiary transition-colors hover:border-accent-blue"
                      title={`Open ${output.id} in Media`}
                    >
                      {output.type === 'image' ? (
                        <img src={output.thumb} alt="" loading="lazy" className="h-full w-full object-cover" />
                      ) : output.type === 'video' ? (
                        <video src={`${output.thumb}#t=0.1`} muted playsInline preload="metadata" aria-label={output.id} className="h-full w-full object-cover" />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center text-text-muted">
                          {output.type === 'audio' ? <Music size={16} /> : <ImageIcon size={16} />}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {summary.recentOutputs.length > 0 && (
              <button
                type="button"
                onClick={() => setAppSection('medias')}
                className="mt-3 flex items-center gap-1.5 text-2xs text-accent-blue hover:underline"
              >
                <Film size={11} aria-hidden="true" /> View full gallery
              </button>
            )}
          </article>
        </div>
      )}
    </section>
  )
}
