import { Suspense, useEffect } from 'react'
import { ApplicationHeader } from './components/Shell/ApplicationHeader'
import { HardwareStatusBar } from './components/Sidebar/HardwareStatusBar'
import { DirectorStatusPanel } from './components/Stages/DirectorStatusPanel'
import { MainContent } from './components/MainContent/MainContent'
import { RetakeDialog } from './components/RetakeDialog'
import { OomRecoveryBanner } from './components/OomRecoveryBanner'
import { DownloadStatusBanner } from './components/DownloadStatusBanner'
import { PreflightBanner } from './components/PreflightBanner'
import { WelcomeModal } from './components/WelcomeModal'
import { NotificationCoordinator } from './components/NotificationCoordinator'
import { NotificationToastHost } from './components/NotificationToastHost'
import { EditorRoundTripBanner } from './editor/EditorRoundTripBanner'
import {
  DirectorDashboard,
  DirectorPage,
  EditorWorkspace,
  LoraBrowser,
  ProjectsPage,
  QueuePage,
  RecipesOverlay,
  SettingsDrawer,
} from './lib/lazyComponents'
import { useStore } from './stores/useStore'

function App() {
  const loadModels = useStore(s => s.loadModels)
  const loadOutputs = useStore(s => s.loadOutputs)
  const loadWorkspaces = useStore(s => s.loadWorkspaces)
  const reconnectJobs = useStore(s => s.reconnectJobs)
  const loadSystemConfig = useStore(s => s.loadSystemConfig)
  const loadServicesConfig = useStore(s => s.loadServicesConfig)
  const loadLlmStatus = useStore(s => s.loadLlmStatus)
  const loadLlmModels = useStore(s => s.loadLlmModels)
  const loadPipelineList = useStore(s => s.loadPipelineList)
  const section = useStore(s => s.appSection)

  useEffect(() => {
    loadModels()
    loadWorkspaces()
    loadOutputs()
    loadSystemConfig()
    loadServicesConfig()
    loadLlmStatus()
    loadLlmModels()
    loadPipelineList()
    reconnectJobs()
  }, [loadModels, loadWorkspaces, loadOutputs, loadSystemConfig, loadServicesConfig, loadLlmStatus, loadLlmModels, loadPipelineList, reconnectJobs])

  // Poll LLM status to stay in sync with backend auto-load/unload
  useEffect(() => {
    const interval = setInterval(loadLlmStatus, 15000)
    return () => clearInterval(interval)
  }, [loadLlmStatus])

  return (
    <div className="application-shell">
      <ApplicationHeader />
      <div className="application-content" role="tabpanel" id={`panel-${section}`} aria-labelledby={`tab-${section}`} tabIndex={0}>
        <Suspense fallback={<RouteLoadingShell />}>
          {section === 'projects' && <ProjectsPage />}
          {section === 'queue' && <QueuePage />}
          {section === 'dashboard' && <DirectorDashboard embedded={true} />}
          {section === 'director' && <DirectorPage />}
          {section === 'editor' && <EditorWorkspace />}
          {section === 'medias' && <MainContent />}
          {section === 'configurations' && <SettingsDrawer />}
        </Suspense>
      </div>
      {/* The Director Planning/Studio toggle now lives inside
          DirectorPage itself (sub-header next to the Style Bibles
          button). The bottom status bar's leftSlot is reserved for
          the Director pipeline progress strip so GPU/VRAM/CPU/RAM and
          the per-step chips live on the same single row. */}
      <HardwareStatusBar leftSlot={<DirectorStatusPanel />} />
      <Suspense fallback={null}>
        <LoraBrowser />
        <DirectorDashboard embedded={false} />
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
