import { Sliders, Cpu, HardDrive } from 'lucide-react'
import { useStore } from '../../stores/useStore'
import { GeneralSettingsPanel } from './GeneralSettingsPanel'
import { SystemSettingsPanel } from './SystemSettingsPanel'
import { StorageSettingsPanel } from './StorageSettingsPanel'

const tabs = [
  { id: 'appearance', label: 'General, Theme & Alerts', icon: Sliders },
  { id: 'performance', label: 'Hardware, AI & Performance', icon: Cpu },
  { id: 'storage', label: 'Storage & Workspaces', icon: HardDrive },
] as const

export function SettingsDrawer() {
  const active = useStore(s => s.settingsTab)
  const select = useStore(s => s.setSettingsTab)

  return (
    <div className="section-scroll">
      <div className="section-container section-container--wide">
        <div className="configurations-workspace">
          <header className="configurations-top-header">
            {/* Horizontal Sub-Navigation Tabs */}
            <nav className="configurations-top-nav" aria-label="Configuration categories">
              {tabs.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  data-section={id}
                  onClick={() => select(id)}
                  aria-current={(active === id || (id === 'appearance' && active === 'notifications')) ? 'page' : undefined}
                  className={`configurations-top-nav-tab ${(active === id || (id === 'appearance' && active === 'notifications')) ? 'is-active' : ''}`}
                >
                  <Icon size={15} />
                  <span>{label}</span>
                </button>
              ))}
            </nav>
          </header>

          {/* Active Configuration Content */}
          <div className="configurations-content">
            {(active === 'appearance' || active === 'notifications') && <GeneralSettingsPanel />}
            {active === 'performance' && <SystemSettingsPanel />}
            {active === 'storage' && <StorageSettingsPanel />}
          </div>
        </div>
      </div>
    </div>
  )
}
