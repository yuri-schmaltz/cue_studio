import { Palette, Cpu, Bell, Cable, HardDrive } from 'lucide-react'
import { useStore } from '../../stores/useStore'
import { AppearanceSettingsPanel } from './AppearanceSettingsPanel'
import { SystemSettingsPanel } from './SystemSettingsPanel'
import { ServicesSettingsPanel } from './ServicesSettingsPanel'
import { NotificationSettingsPanel } from './NotificationSettingsPanel'
import { StorageSettingsPanel } from './StorageSettingsPanel'

// Order matters — first entry ('appearance') becomes the default tab
// when the user opens Configurations. Put the most-frequently-tweaked
// category first so the common adjustment is one click away.
const tabs = [
  { id: 'appearance', label: 'Appearance', description: 'Theme and dark/light mode', icon: Palette },
  { id: 'performance', label: 'Performance', description: 'Auto-tune, models and codecs', icon: Cpu },
  { id: 'integrations', label: 'Integrations', description: 'LLM, content and external APIs', icon: Cable },
  { id: 'storage', label: 'Storage', description: 'Where new projects are created on disk', icon: HardDrive },
  { id: 'notifications', label: 'Notifications', description: 'Alerts, sounds and delivery', icon: Bell },
] as const

export function SettingsDrawer() {
  const active = useStore(s => s.settingsTab)
  const select = useStore(s => s.setSettingsTab)
  return (
    <div className="section-scroll">
      <div className="section-container">
        <div className="configurations-layout">
          <nav className="configurations-navigation" aria-label="Configuration categories">
            {tabs.map(({ id, label, description, icon: Icon }) => <button key={id} onClick={() => select(id)} aria-current={active === id ? 'page' : undefined} className={active === id ? 'is-active' : ''}><Icon size={17} /><span><strong>{label}</strong><small>{description}</small></span></button>)}
          </nav>
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
