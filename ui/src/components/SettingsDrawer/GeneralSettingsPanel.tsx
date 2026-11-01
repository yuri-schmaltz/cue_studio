import { useEffect, useState, type ReactNode } from 'react'
import {
  Palette,
  Bell,
  BellRing,
  Check,
  MonitorSpeaker,
  Volume2,
} from 'lucide-react'
import { useStore } from '../../stores/useStore'
import * as api from '../../api/client'
import { FAMILIES, resolveVariant, onOsThemeChange, type FamilyId, type ThemeMode } from '../../lib/theme'
import {
  disableBackgroundPush,
  enableBackgroundPush,
  getBackgroundPushState,
  getBrowserNotificationAvailability,
  getDeviceNotificationPreferences,
  playDeviceNotificationChime,
  requestBrowserNotificationPermission,
  subscribeDeviceNotificationPreferences,
  syncBackgroundPush,
  testBackgroundPush,
  testBrowserNotification,
  updateDeviceNotificationPreferences,
  type BackgroundPushState,
  type BrowserNotificationAvailability,
  type DeviceNotificationPreferences,
} from '../../lib/notifications'

interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  description?: ReactNode
  disabled?: boolean
}

function Toggle({ checked, onChange, label, description, disabled = false }: ToggleProps) {
  return (
    <div className={`flex items-start justify-between gap-3 ${disabled ? 'opacity-50' : ''}`}>
      <div className="min-w-0 flex-1">
        <div className="text-xs text-text-primary">{label}</div>
        {description && (
          <div className="mt-0.5 text-2xs leading-relaxed text-text-muted">{description}</div>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          checked ? 'bg-accent-blue' : 'border border-border bg-bg-primary'
        } ${disabled ? 'cursor-not-allowed' : ''}`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full border border-border bg-white transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  )
}

function permissionLabel(availability: BrowserNotificationAvailability): string {
  if (!availability.supported) return 'Not supported by this browser'
  if (!availability.secure) return 'Requires HTTPS or localhost'
  if (availability.permission === 'granted') return 'Browser permission granted'
  if (availability.permission === 'denied') return 'Blocked in browser settings'
  return 'Permission will be requested when enabled'
}

/**
 * GeneralSettingsPanel - Merges General & Appearance with Alerts & Notifications.
 * Balanced 2-column layout to fit on-screen without page scrollbars.
 */
export function GeneralSettingsPanel() {
  // Theme & Appearance State
  const prefs = useStore(s => s.themePrefs)
  const setThemeMode = useStore(s => s.setThemeMode)
  const setThemeFamily = useStore(s => s.setThemeFamily)
  const density = useStore(s => s.density)
  const setDensity = useStore(s => s.setDensity)

  const [, setOsTick] = useState(0)
  useEffect(() => onOsThemeChange(() => setOsTick(n => n + 1)), [])

  const family = FAMILIES.find(f => f.id === prefs.family) ?? FAMILIES[0]
  const variant = resolveVariant(prefs)
  const swatch = family[variant].swatch
  const modes: { value: ThemeMode; label: string }[] = [
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' },
    { value: 'auto', label: 'Auto' },
  ]

  // Notifications State
  const systemConfig = useStore(state => state.systemConfig)
  const updateSystemConfig = useStore(state => state.updateSystemConfig)
  const [preferences, setPreferences] = useState<DeviceNotificationPreferences>(
    getDeviceNotificationPreferences,
  )
  const [availability, setAvailability] = useState(getBrowserNotificationAvailability)
  const [message, setMessage] = useState<string | null>(null)
  const [testingHost, setTestingHost] = useState(false)
  const [testingPush, setTestingPush] = useState(false)
  const [pushState, setPushState] = useState<BackgroundPushState | null>(null)

  useEffect(() => subscribeDeviceNotificationPreferences(setPreferences), [])

  useEffect(() => {
    let cancelled = false
    void getBackgroundPushState().then(nextPush => {
      if (cancelled) return
      setPushState(nextPush)
    }).catch(error => {
      if (!cancelled) {
        setMessage(error instanceof Error ? error.message : 'Background notification status is unavailable.')
      }
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const refreshAvailability = () => setAvailability(getBrowserNotificationAvailability())
    window.addEventListener('focus', refreshAvailability)
    document.addEventListener('visibilitychange', refreshAvailability)
    return () => {
      window.removeEventListener('focus', refreshAvailability)
      document.removeEventListener('visibilitychange', refreshAvailability)
    }
  }, [])

  const updateDevice = (partial: Partial<DeviceNotificationPreferences>) => {
    setMessage(null)
    const next = updateDeviceNotificationPreferences(partial)
    setPreferences(next)
    if (
      next.browserNotifications
      && (
        'onlyWhenHidden' in partial
        || 'notifyCompleted' in partial
        || 'notifyFailed' in partial
        || 'notifyQueue' in partial
      )
    ) {
      void syncBackgroundPush(next).then(setPushState).catch(error => {
        setMessage(error instanceof Error ? error.message : 'Could not update background notification preferences.')
      })
    }
  }

  const handleBrowserToggle = async (enabled: boolean) => {
    setMessage(null)
    if (!enabled) {
      updateDevice({ browserNotifications: false })
      try {
        setPushState(await disableBackgroundPush())
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Could not remove the background subscription.')
      }
      return
    }
    const permission = await requestBrowserNotificationPermission()
    const nextAvailability = getBrowserNotificationAvailability()
    setAvailability(nextAvailability)
    if (permission === 'granted') {
      const next = updateDeviceNotificationPreferences({ browserNotifications: true })
      setPreferences(next)
      try {
        setPushState(await enableBackgroundPush(next))
        setMessage('System and closed-app background notifications are enabled on this device.')
      } catch (error) {
        setMessage(
          `System notifications are enabled. ${
            error instanceof Error ? error.message : 'Background delivery could not be enrolled.'
          }`,
        )
      }
    } else {
      updateDevice({ browserNotifications: false })
      setMessage(nextAvailability.reason || 'Notification permission was not granted.')
    }
  }

  const handleBrowserTest = async () => {
    setMessage(null)
    const shown = await testBrowserNotification()
    setAvailability(getBrowserNotificationAvailability())
    setPreferences(getDeviceNotificationPreferences())
    setMessage(shown
      ? 'Foreground alert shown. Use Test closed-app notification to verify background delivery.'
      : 'The browser could not display a system notification. In-app alerts still work.')
  }

  const handleDeviceSoundToggle = async (enabled: boolean) => {
    updateDevice({ deviceSound: enabled })
    if (enabled) {
      const played = await playDeviceNotificationChime('completion')
      if (!played) setMessage('This browser could not start audio. Try Test chime after interacting with the page.')
    }
  }

  const handleBackgroundTest = async () => {
    setTestingPush(true)
    setMessage(null)
    try {
      const delivered = await testBackgroundPush()
      setMessage(delivered
        ? 'Background push sent. It may take a moment to appear.'
        : 'This device is not enrolled for background notifications.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Background push test failed.')
    } finally {
      setTestingPush(false)
      setPushState(await getBackgroundPushState())
    }
  }

  const hostEnabled = systemConfig?.host_notification_sound_enabled ?? false
  const hostVolume = systemConfig?.host_notification_sound_volume ?? 50

  const handleHostTest = async () => {
    setTestingHost(true)
    setMessage(null)
    try {
      await api.testHostNotificationSound(hostVolume)
      setMessage('Test sound sent to the host computer.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to play the host sound.')
    } finally {
      setTestingHost(false)
    }
  }

  return (
    <section className="settings-panel" aria-label="General and Notifications settings">
      <div className="settings-columns settings-columns--equal">
        {/* Column 1: Appearance & UI Customization */}
        <div className="settings-group">
          <div className="settings-card">
            <div className="flex items-center gap-2 mb-1">
              <Palette size={15} className="text-cyan-400" />
              <div>
                <div className="text-xs font-medium text-text-primary">Theme & Appearance</div>
                <div className="text-2xs text-text-muted">Color theme, dark/light mode and interface density.</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border/40">
              {/* Mode */}
              <div>
                <label className="text-2xs text-text-muted uppercase tracking-wider mb-1 block">
                  Mode
                </label>
                <div className="flex rounded-md border border-border overflow-hidden">
                  {modes.map(m => (
                    <button
                      key={m.value}
                      onClick={() => setThemeMode(m.value)}
                      className={`flex-1 px-2 py-1 text-2xs transition-colors ${
                        prefs.mode === m.value
                          ? 'bg-accent-blue text-white font-medium'
                          : 'bg-bg-tertiary text-text-secondary hover:bg-bg-hover'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Density */}
              <div>
                <label className="text-2xs text-text-muted uppercase tracking-wider mb-1 block">
                  Density
                </label>
                <div className="flex rounded-md border border-border overflow-hidden">
                  {(['comfortable', 'compact'] as const).map(d => (
                    <button
                      key={d}
                      onClick={() => setDensity(d)}
                      aria-pressed={density === d}
                      className={`flex-1 px-2 py-1 text-2xs transition-colors ${
                        density === d
                          ? 'bg-accent-blue text-white font-medium'
                          : 'bg-bg-tertiary text-text-secondary hover:bg-bg-hover'
                      }`}
                    >
                      {d === 'comfortable' ? 'Confortável' : 'Compacta'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Theme Select */}
            <div className="pt-2 border-t border-border/40">
              <label className="text-2xs text-text-muted uppercase tracking-wider mb-1 block">
                Theme Palette
              </label>
              <div className="flex items-center gap-2">
                <div className="flex shrink-0 rounded overflow-hidden border border-border">
                  <div className="w-3 h-6" style={{ background: swatch.bg }} />
                  <div className="w-3 h-6" style={{ background: swatch.surface }} />
                  <div className="w-3 h-6" style={{ background: swatch.accent }} />
                </div>
                <select
                  value={family.id}
                  onChange={e => setThemeFamily(e.target.value as FamilyId)}
                  className="flex-1 bg-bg-secondary border border-border rounded-md px-2.5 py-1 text-xs text-text-primary focus:outline-none focus:border-accent-blue"
                >
                  {FAMILIES.map(f => (
                    <option key={f.id} value={f.id}>{f.label}</option>
                  ))}
                </select>
              </div>
              <p className="text-2xs text-text-muted mt-1">
                {family.description}
              </p>
            </div>

            {/* Visual Preview */}
            <div
              className="p-2.5 rounded-lg border border-border flex items-center justify-between"
              style={{ background: swatch.bg }}
            >
              <div className="flex items-center gap-2">
                <div
                  className="w-3.5 h-3.5 rounded-full"
                  style={{ background: swatch.accent }}
                />
                <span className="text-2xs font-medium" style={{ color: swatch.accent }}>
                  {family.label} ({variant})
                </span>
              </div>
              <div
                className="px-2 py-0.5 text-2xs rounded font-medium border"
                style={{
                  background: swatch.surface,
                  borderColor: 'var(--color-border)',
                  color: 'var(--color-text-primary)',
                }}
              >
                Sample Component
              </div>
            </div>
          </div>

          {/* Host completion sound */}
          <div className="settings-card">
            <div className="flex items-center gap-2">
              <MonitorSpeaker size={15} className="text-accent-blue" />
              <div>
                <div className="text-xs font-medium text-text-primary">Host Audio Chime</div>
                <div className="text-2xs text-text-muted">Rings on completion on host machine.</div>
              </div>
            </div>

            <Toggle
              checked={hostEnabled}
              onChange={checked => void updateSystemConfig({ host_notification_sound_enabled: checked })}
              label="Completion sound on host"
              description="Rings once per Studio generation or complete Director project."
              disabled={!systemConfig}
            />

            <div className="space-y-1">
              <div className="flex items-center justify-between text-2xs text-text-muted">
                <span className="flex items-center gap-1"><BellRing size={11} /> Host volume</span>
                <span>{hostVolume}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={hostVolume}
                disabled={!systemConfig}
                onChange={event => void updateSystemConfig({
                  host_notification_sound_volume: Number(event.target.value),
                })}
                className="w-full disabled:opacity-40"
              />
            </div>

            <button
              type="button"
              onClick={handleHostTest}
              disabled={testingHost || !systemConfig}
              className="w-full rounded-md border border-border px-2 py-1 text-2xs text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              {testingHost ? 'Playing…' : 'Test host sound'}
            </button>
          </div>
        </div>

        {/* Column 2: Browser & System Notifications */}
        <div className="settings-group">
          <div className="settings-card">
            <div className="flex items-center gap-2">
              <Bell size={15} className="text-amber-400" />
              <div>
                <div className="text-xs font-medium text-text-primary">Browser & Device Alerts</div>
                <div className="text-2xs text-text-muted">In-app toasts, sound chimes and OS notifications.</div>
              </div>
            </div>

            <Toggle
              checked={preferences.browserNotifications}
              onChange={handleBrowserToggle}
              label="System notifications"
              disabled={!availability.supported || !availability.secure || availability.permission === 'denied'}
              description={availability.reason || permissionLabel(availability)}
            />

            {preferences.browserNotifications && (
              <div className={`rounded-md border px-2 py-1.5 text-2xs leading-relaxed ${
                pushState?.subscribed
                  ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-200'
                  : 'border-amber-500/30 bg-amber-500/5 text-amber-100'
              }`}>
                <div className="flex items-center gap-1.5 font-medium">
                  {pushState?.subscribed ? <Check size={11} /> : <Bell size={11} />}
                  {pushState?.subscribed
                    ? 'Background delivery active on this device'
                    : 'Foreground notifications active'}
                </div>
              </div>
            )}

            <Toggle
              checked={preferences.onlyWhenHidden}
              onChange={checked => updateDevice({ onlyWhenHidden: checked })}
              label="Only notify when Cue Studio is in the background"
              description="In-app alerts still appear while active."
            />

            <div className="grid grid-cols-3 gap-1.5 border-y border-border/50 py-2">
              {([
                ['notifyCompleted', 'Complete'],
                ['notifyFailed', 'Failed'],
                ['notifyQueue', 'Queue'],
              ] as const).map(([key, label]) => (
                <label key={key} className="flex cursor-pointer items-center gap-1.5 text-2xs text-text-secondary">
                  <input
                    type="checkbox"
                    checked={preferences[key]}
                    onChange={event => updateDevice({ [key]: event.target.checked })}
                    className="accent-blue-500"
                  />
                  {label}
                </label>
              ))}
            </div>

            <Toggle
              checked={preferences.deviceSound}
              onChange={handleDeviceSoundToggle}
              label="Chime on this device"
              description="Works while this page is open in browser."
            />

            <div className="space-y-1">
              <div className="flex items-center justify-between text-2xs text-text-muted">
                <span className="flex items-center gap-1"><Volume2 size={11} /> Device volume</span>
                <span>{preferences.deviceSoundVolume}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={preferences.deviceSoundVolume}
                onChange={event => updateDevice({ deviceSoundVolume: Number(event.target.value) })}
                className="w-full"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleBrowserTest}
                disabled={!availability.supported || !availability.secure || availability.permission === 'denied'}
                className="flex-1 rounded-md border border-border px-2 py-1 text-2xs text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                Test open
              </button>
              <button
                type="button"
                onClick={() => void playDeviceNotificationChime('completion')}
                className="flex-1 rounded-md border border-border px-2 py-1 text-2xs text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
              >
                Test chime
              </button>
              <button
                type="button"
                onClick={handleBackgroundTest}
                disabled={testingPush || !pushState?.subscribed}
                className="flex-1 rounded-md border border-border px-2 py-1 text-2xs text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                {testingPush ? 'Sending…' : 'Test closed-app'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {message && (
        <div className="rounded-md border border-border bg-bg-primary px-2.5 py-1.5 text-2xs leading-relaxed text-text-secondary">
          {message}
        </div>
      )}
    </section>
  )
}
