import { useEffect, useState } from 'react'
import { Palette } from 'lucide-react'
import { useStore } from '../../stores/useStore'
import { FAMILIES, resolveVariant, onOsThemeChange, type FamilyId, type ThemeMode } from '../../lib/theme'

/**
 * Appearance settings: theme family + dark/light/auto mode.
 *
 * Lifted out of the Performance tab as part of the Configurations
 * drawer reorganization (2026-09-15) — theme is a visual preference,
 * not a performance knob, so it deserves its own top-level entry in
 * the navigation. The cards here use the standard `.settings-card`
 * primitive so typography and spacing match every other tab.
 *
 * State sources:
 *   - themePrefs (zustand) — persisted to localStorage via applyThemePrefs
 *   - OS color-scheme subscription — forces a re-render when the user
 *     toggles the system appearance while in Auto mode, so the swatch
 *     preview and the "currently X" hint stay honest.
 */
export function AppearanceSettingsPanel() {
  const prefs = useStore(s => s.themePrefs)
  const setThemeMode = useStore(s => s.setThemeMode)
  const setThemeFamily = useStore(s => s.setThemeFamily)
  // Re-render when the OS flips its scheme while in auto mode so the
  // swatch and hint track the effective variant.
  const [, setOsTick] = useState(0)
  useEffect(() => onOsThemeChange(() => setOsTick(n => n + 1)), [])

  const family = FAMILIES.find(f => f.id === prefs.family) ?? FAMILIES[0]
  const variant = resolveVariant(prefs)
  // Swatch previews the variant the mode currently resolves to, so
  // toggling Dark/Light/Auto updates the preview immediately.
  const swatch = family[variant].swatch
  const modes: { value: ThemeMode; label: string }[] = [
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' },
    { value: 'auto', label: 'Auto' },
  ]

  return (
    <section className="settings-panel" aria-label="Appearance settings">
      <header className="settings-panel-header">
        <h2><Palette size={18} aria-hidden="true" /> Appearance</h2>
        <p>Theme family and dark / light / auto mode. Changes apply
          instantly to the whole app and persist in this browser.</p>
      </header>

      <div className="settings-group">
        <div className="settings-group-header">
          <h3>Mode</h3>
          <p>Auto follows your operating system preference.</p>
        </div>
        <div className="settings-card">
          <div>
            <label className="text-xs text-text-muted uppercase tracking-wider mb-1.5 block">
              Mode
            </label>
            <div className="flex rounded-lg border border-border overflow-hidden">
              {modes.map(m => (
                <button
                  key={m.value}
                  onClick={() => setThemeMode(m.value)}
                  className={`flex-1 px-3 py-1.5 text-xs transition-colors ${
                    prefs.mode === m.value
                      ? 'bg-accent-blue text-white'
                      : 'bg-bg-tertiary text-text-secondary hover:bg-bg-hover'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            {prefs.mode === 'auto' && (
              <p className="text-2xs text-text-muted mt-1.5">
                Follows your system's appearance — currently {variant}.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group-header">
          <h3>Theme</h3>
          <p>Color palette. Preview shows the variant currently in effect.</p>
        </div>
        <div className="settings-card">
          <div>
            <label className="text-xs text-text-muted uppercase tracking-wider mb-1.5 block">
              Theme
            </label>
            <div className="flex items-center gap-2">
              {/* Swatch — three colors stacked horizontally for a quick
                  preview of the bg / surface / accent palette of the
                  variant currently in effect. */}
              <div className="flex shrink-0 rounded-md overflow-hidden border border-border">
                <div className="w-3 h-7" style={{ background: swatch.bg }} />
                <div className="w-3 h-7" style={{ background: swatch.surface }} />
                <div className="w-3 h-7" style={{ background: swatch.accent }} />
              </div>
              <select
                value={family.id}
                onChange={e => setThemeFamily(e.target.value as FamilyId)}
                className="flex-1 bg-bg-tertiary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-blue"
              >
                {FAMILIES.map(f => (
                  <option key={f.id} value={f.id}>{f.label}</option>
                ))}
              </select>
            </div>
            <p className="text-2xs text-text-muted mt-1.5">
              {family.description}
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}