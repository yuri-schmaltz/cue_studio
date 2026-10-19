import { Suspense, useEffect } from 'react'
import { ApplicationHeader } from './components/Shell/ApplicationHeader'
import { ErrorBoundary } from './components/ErrorBoundary'
import {
  DirectorPage,
  MainContent,
  RetakeDialog,
  OomRecoveryBanner,
  DownloadStatusBanner,
  PreflightBanner,
  WelcomeModal,
  NotificationCoordinator,
  NotificationToastHost,
  EditorRoundTripBanner,
  EditorWorkspace,
  LoraBrowser,
  ProjectsPage,
  QueuePage,
  RecipesOverlay,
  SettingsDrawer,
  StudioPage,
} from './lib/lazyComponents'
import { useStore } from './stores/useStore'
import { useUrlNavigation } from './navigation/useUrlNavigation'
import { usePolling } from './lib/usePolling'
import { emitTelemetry } from './lib/telemetry'

function App() {
  // Keep the URL and the store's navigation in lock-step (A09):
  // deep links restore project + section, Back walks real URLs.
  useUrlNavigation()
  useEffect(() => { void emitTelemetry('app_started', {}) }, [])
  const loadModels = useStore(s => s.loadModels)
  const loadOutputs = useStore(s => s.loadOutputs)
  const loadWorkspaces = useStore(s => s.loadWorkspaces)
  const reconnectJobs = useStore(s => s.reconnectJobs)
  const loadSystemConfig = useStore(s => s.loadSystemConfig)
  const loadServicesConfig = useStore(s => s.loadServicesConfig)
  const loadLlmStatus = useStore(s => s.loadLlmStatus)
  const loadLlmModels = useStore(s => s.loadLlmModels)
  const reconnectDirectorPipelines = useStore(s => s.reconnectDirectorPipelines)
  const loadSystemStats = useStore(s => s.loadSystemStats)
  const section = useStore(s => s.appSection)

  useEffect(() => {
    loadModels()
    loadWorkspaces()
    loadOutputs()
    loadSystemConfig()
    loadServicesConfig()
    loadLlmStatus()
    loadLlmModels()
    reconnectDirectorPipelines()
    reconnectJobs()
    loadSystemStats()
  }, [loadModels, loadWorkspaces, loadOutputs, loadSystemConfig, loadServicesConfig, loadLlmStatus, loadLlmModels, reconnectDirectorPipelines, reconnectJobs, loadSystemStats])

  // Poll LLM status to stay in sync with backend auto-load/unload.
  // Owned by App via usePolling (A17): the interval is cleared on
  // unmount and paused while the tab is hidden.
  usePolling(loadLlmStatus, 15000)

  return (
    <div className="application-shell">
      <div id="a11y-status" aria-live="polite" className="sr-only" />
      <ApplicationHeader />
      <div className="application-content" role="tabpanel" id={`panel-${section}`} aria-labelledby={`tab-${section}`} tabIndex={0}>
        <Suspense fallback={<RouteLoadingShell />}>
          {/* One <ErrorBoundary> per section (A15): a render crash in
              one screen must not take down the navigation shell or the
              other sections. Each conditional mount also remounts the
              boundary on section switches, so errors never leak across
              routes. */}
          {section === 'projects' && <ErrorBoundary section="Projects"><ProjectsPage /></ErrorBoundary>}
          {section === 'queue' && <ErrorBoundary section="Queue"><QueuePage /></ErrorBoundary>}
          {section === 'director' && <ErrorBoundary section="Director"><DirectorPage /></ErrorBoundary>}
          {section === 'studio' && <ErrorBoundary section="Studio"><StudioPage /></ErrorBoundary>}
          {section === 'editor' && <ErrorBoundary section="Editor"><EditorWorkspace /></ErrorBoundary>}
          {section === 'medias' && <ErrorBoundary section="Media"><MainContent /></ErrorBoundary>}
          {section === 'configurations' && <ErrorBoundary section="Configurations"><SettingsDrawer /></ErrorBoundary>}
        </Suspense>
      </div>
      <Suspense fallback={null}>
        <LoraBrowser />
        <RecipesOverlay />
      </Suspense>
      <RetakeDialog />
      {/* OomRecoveryBanner is a fixed-position overlay — renders nothing
          unless the latest job/pipeline failure has oom_info attached.
          Lives at the App root so it floats above whichever screen the
          user is looking at when their generation OOMs. */}
      <OomRecoveryBanner />
      {/* PreflightBanner — fixed top overlay shown once on startup if the
          environment is missing ffmpeg / CUDA or low on disk. Renders
          nothing when everything checks out. */}
      <PreflightBanner />
      {/* DownloadStatusBanner — fixed bottom-right overlay, polls
          /api/v1/downloads/active every 2s. Renders nothing unless
          a model file is being downloaded. Highlights stalled
          downloads in amber so users know the system is recovering
          rather than frozen. */}
      <DownloadStatusBanner />
      {/* WelcomeModal — one-time first-run orientation (localStorage-gated). */}
      <WelcomeModal />
      {/* One observer covers Studio, Director, and the universal queue.
          Toasts remain useful even when browser notifications are disabled. */}
      <NotificationCoordinator />
      <NotificationToastHost />
      <EditorRoundTripBanner />
    </div>
  )
}

/**
 * Lightweight fallback shown by the route-level <Suspense> while a
 * lazy chunk is being fetched. Reusing the same skeleton shape on
 * every route keeps the perceived navigation latency low — the user
 * sees a consistent loading frame rather than a blank panel.
 */
function RouteLoadingShell() {
  return (
    <div
      className="route-loading-shell"
      role="status"
      aria-live="polite"
      aria-label="Loading screen"
    >
      <div className="route-loading-shell__spinner" aria-hidden="true" />
    </div>
  )
}

export default App
