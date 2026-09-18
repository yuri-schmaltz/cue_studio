import { useEffect, useState, type ReactNode } from 'react'
import {
  Bell,
  BellRing,
  Check,
  MonitorSpeaker,
  Volume2,
} from 'lucide-react'
import { useStore } from '../../stores/useStore'
import * as api from '../../api/client'
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

export function NotificationSettingsPanel() {
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
        // Keep foreground/browser notifications enabled even when an older
        // Maestro host has not installed the optional Web Push runtime yet.
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
      setMessage('Test sound sent to the Maestro host computer.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to play the host sound.')
    } finally {
      setTestingHost(false)
    }
  }

  return (
    <section className="settings-panel" aria-label="Notifications settings">
      <header className="settings-panel-header">
        <h2><Bell size={18} aria-hidden="true" /> Notifications</h2>
      </header>

      {/* Two-column layout: Browser alerts on the left (per-device),
          Host completion sound on the right (per-host computer).
          Previously these were stacked full-width; side-by-side
          halves the vertical scroll distance and surfaces the
          "this device vs the Maestro host" pairing visually. */}
      <div className="settings-feature-column">
        <div className="settings-group">
          <div className="settings-card">
            <div className="flex items-center gap-2">
              <Bell size={15} className="text-accent-blue" />
              <div>
                <div className="text-xs font-medium text-text-primary">Browser alerts</div>
                <div className="text-2xs text-text-muted">In-app toasts and optional OS notifications.</div>
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
          <div className={`rounded-md border px-2.5 py-2 text-2xs leading-relaxed ${
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
            <div className="mt-1">
              {pushState?.subscribed
                ? 'Maestro can alert this device after the page or iPhone Home Screen app is closed.'
                : (pushState?.reason || 'Background enrollment is still being prepared.')}
            </div>
          </div>
        )}

        <Toggle
          checked={preferences.onlyWhenHidden}
          onChange={checked => updateDevice({ onlyWhenHidden: checked })}
          label="Only notify when Maestro is in the background"
          description="In-app alerts still appear while Maestro is visible."
        />

        <div className="grid grid-cols-3 gap-1.5 border-y border-border/50 py-2.5">
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
          description="Works while this Maestro page is open, including mobile browsers."
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
            className="flex-1 rounded-md border border-border px-2 py-1.5 text-2xs text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            Test while open
          </button>
          <button
            type="button"
            onClick={() => void playDeviceNotificationChime('completion')}
            className="flex-1 rounded-md border border-border px-2 py-1.5 text-2xs text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
          >
            Test chime
          </button>
        </div>

        <button
          type="button"
          onClick={handleBackgroundTest}
          disabled={testingPush || !pushState?.subscribed}
          className="w-full rounded-md border border-border px-2 py-1.5 text-2xs text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          {testingPush ? 'Sending background push…' : 'Test closed-app notification'}
        </button>

        <p className="text-2xs leading-relaxed text-text-muted">
          iPhone/iPad: use Maestro through HTTPS, remove any older Maestro Home Screen shortcut, then add it to the Home Screen again and open that installed app. Safari and Chrome tabs cannot request notification permission on iOS.
        </p>

        {availability.ios && (
          <div className={`rounded-md border px-2.5 py-2 text-2xs leading-relaxed ${
            availability.secure && availability.standalone
              ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-200'
              : 'border-amber-500/30 bg-amber-500/5 text-amber-100'
          }`}>
            <div className="font-medium">iPhone notification check</div>
            <div className="mt-1">Secure HTTPS address: {availability.secure ? 'Yes' : 'No'}</div>
            <div>Opened from installed Home Screen app: {availability.standalone ? 'Yes' : 'No'}</div>
            {!availability.secure && (
              <div className="mt-1 break-all">
                Current address: {window.location.origin}. Apple blocks system notifications from local HTTP addresses.
              </div>
            )}
            {availability.secure && availability.standalone && (
              <div className="mt-1">This device is ready to request notification permission.</div>
            )}
          </div>
        )}

        <p className="text-2xs leading-relaxed text-text-muted">
          Closed-app delivery uses the browser vendor&apos;s standard encrypted Web Push service. Maestro&apos;s signing key and your device subscription remain on your Maestro computer; there is no Maestro cloud account or relay.
        </p>
      </div>
      </div>

      <div className="settings-group">
        <div className="settings-card">
          <div className="flex items-center gap-2">
            <MonitorSpeaker size={15} className="text-accent-blue" />
            <div>
              <div className="text-xs font-medium text-text-primary">Host completion sound</div>
              <div className="text-2xs text-text-muted">Rings once per Studio generation or complete Director project.</div>
            </div>
          </div>

        <Toggle
          checked={hostEnabled}
          onChange={checked => void updateSystemConfig({ host_notification_sound_enabled: checked })}
          label="Completion sound on host"
          description="Rings once per Studio generation or complete Director project—not once per internal clip."
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
          className="w-full rounded-md border border-border px-2 py-1.5 text-2xs text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          {testingHost ? 'Playing…' : 'Test host sound'}
        </button>
        </div>
        </div>
      </div>

      {message && (
        <div className="rounded-md border border-border bg-bg-primary px-2.5 py-2 text-2xs leading-relaxed text-text-secondary">
          {message}
        </div>
      )}
    </section>
  )
}
