import { Sliders, Cpu, HardDrive } from 'lucide-react'
import { useStore } from '../../stores/useStore'
import { GeneralSettingsPanel } from './GeneralSettingsPanel'
import { SystemSettingsPanel } from './SystemSettingsPanel'
import { StorageSettingsPanel } from './StorageSettingsPanel'

// Short tab labels (audit C-01) — the old labels ("Hardware, AI &
// Performance") truncated on narrow screens. Each tab's own panel
// already lists its full contents, so the tab only needs the category.
const tabs = [
  { id: 'appearance', label: 'General', icon: Sliders },
  { id: 'performance', label: 'Hardware', icon: Cpu },
  { id: 'storage', label: 'Storage', icon: HardDrive },
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
