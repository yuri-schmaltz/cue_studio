import { useEffect } from 'react'
import { Palette, Cpu, Bell, Cable, HardDrive, Activity, CheckCircle2 } from 'lucide-react'
import { useStore } from '../../stores/useStore'
import { AppearanceSettingsPanel } from './AppearanceSettingsPanel'
import { SystemSettingsPanel } from './SystemSettingsPanel'
import { ServicesSettingsPanel } from './ServicesSettingsPanel'
import { NotificationSettingsPanel } from './NotificationSettingsPanel'
import { StorageSettingsPanel } from './StorageSettingsPanel'

const tabs = [
  { id: 'appearance', label: 'General & Appearance', icon: Palette },
  { id: 'performance', label: 'Hardware & Performance', icon: Cpu },
  { id: 'integrations', label: 'AI Models & Integrations', icon: Cable },
  { id: 'storage', label: 'Storage & Workspaces', icon: HardDrive },
  { id: 'notifications', label: 'Alerts & Notifications', icon: Bell },
] as const

export function SettingsDrawer() {
  const active = useStore(s => s.settingsTab)
  const select = useStore(s => s.setSettingsTab)
  const systemDetect = useStore(s => s.systemDetect)
  const loadSystemDetect = useStore(s => s.loadSystemDetect)

  useEffect(() => {
    if (!systemDetect) {
      void loadSystemDetect()
    }
  }, [systemDetect, loadSystemDetect])

  const hw = systemDetect?.hardware
  const rec = systemDetect?.recommended

  return (
    <div className="section-scroll">
      <div className="section-container section-container--wide">
        <div className="configurations-workspace">
          {/* Top Telemetry & Control Banner (Option B - Studio Workspace) */}
          <header className="configurations-top-header">
            <div className="configurations-telemetry-banner">
              <div className="configurations-telemetry-stats">
                <div className="configurations-telemetry-item">
                  <Activity size={14} className="text-amber-500" />
                  <span>GPU:</span>
                  <strong>{hw?.cuda_available ? (hw.gpu_name || 'NVIDIA GPU') : 'CPU Mode'}</strong>
                </div>
                {hw?.cuda_available && (
                  <>
                    <div className="configurations-telemetry-item">
                      <span>VRAM:</span>
                      <strong>{hw.gpu_vram_gb} GB</strong>
                    </div>
                    <div className="configurations-telemetry-item">
                      <span>RAM:</span>
                      <strong>{hw.ram_gb} GB</strong>
                    </div>
                  </>
                )}
                {rec && (
                  <div className="configurations-telemetry-item">
                    <CheckCircle2 size={13} className="text-indicator-success" />
                    <span>Profile:</span>
                    <strong>{rec._recommendation_label}</strong>
                  </div>
                )}
              </div>
              <div className="text-2xs text-text-muted">
                Cue Studio v2.5.2 · Studio Workspace Mode
              </div>
            </div>

            {/* Horizontal Sub-Navigation Tabs */}
            <nav className="configurations-top-nav" aria-label="Configuration categories">
              {tabs.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  data-section={id}
                  onClick={() => select(id)}
                  aria-current={active === id ? 'page' : undefined}
                  className={`configurations-top-nav-tab ${active === id ? 'is-active' : ''}`}
                >
                  <Icon size={15} />
                  <span>{label}</span>
                </button>
              ))}
            </nav>
          </header>

          {/* Active Configuration Content */}
          <div className="configurations-content">
            {active === 'appearance' && <AppearanceSettingsPanel />}
            {active === 'performance' && <SystemSettingsPanel />}
            {active === 'integrations' && <ServicesSettingsPanel />}
            {active === 'storage' && <StorageSettingsPanel />}
            {active === 'notifications' && <NotificationSettingsPanel />}
          </div>
        </div>
      </div>
    </div>
  )
}
