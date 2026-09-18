import { useState, useCallback, useEffect } from 'react'
import { Cpu, RefreshCw, Loader2 } from 'lucide-react'
import { useStore } from '../../stores/useStore'
import * as api from '../../api/client'
import { LlmConfigurationCard, FlashVsrCard } from './perf/LlmConfigurationCard'

const profileLabels: Record<string, string> = {
  '1': 'Profile 1: High RAM + High VRAM',
  '2': 'Profile 2: High RAM + Low VRAM',
  '3': 'Profile 3: Low RAM + High VRAM',
  '3.5': 'Profile 3.5: Very Low RAM + High VRAM',
  '4': 'Profile 4: Low RAM + Low VRAM',
  '4.5': 'Profile 4.5: Low RAM + Low VRAM (saves ~1GB)',
  '5': 'Profile 5: Very Low RAM + Low VRAM',
}

const quantizationOptions = [
  { value: 'int8', label: 'INT8' },
  { value: 'fp8', label: 'FP8' },
  { value: 'bf16', label: 'BF16' },
]

const vaeOptions = [
  { value: 0, label: 'Auto' },
  { value: 1, label: 'Full (Fast, High VRAM)' },
  { value: 2, label: 'Medium Tiling' },
  { value: 3, label: 'Aggressive Tiling (Low VRAM)' },
]

const compileOptions = [
  { value: '', label: 'None' },
  { value: 'transformer', label: 'Transformer' },
]

function SelectField({ label, value, options, onChange }: {
  label: string
  value: string | number
  options: { value: string | number; label: string }[]
  onChange: (val: string) => void
}) {
  return (
    <div>
      <label className="text-xs text-text-muted uppercase tracking-wider mb-1.5 block">
        {label}
      </label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full bg-bg-tertiary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-blue"
      >
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  )
}

/**
 * AutoPerformanceCard — top of the Performance section.
 *
 * Shows the user's detected hardware + the recommended profile in
 * plain English. The toggle controls whether the rest of the
 * Performance + Profiles fields are hidden under "Show advanced
 * settings" (auto on) or shown directly (auto off).
 *
 * State sources:
 *   - servicesConfig.auto_performance — the toggle's value
 *     (loaded once at app boot; updated optimistically on toggle)
 *   - GET /api/v1/system-detect — fetched on mount and on Re-detect
 *     click. Returns hardware + recommendation. Always succeeds; on
 *     systems without CUDA it returns a "no GPU detected" payload.
 *
 * Side effects:
 *   - Toggle ON  → POST /api/v1/system-detect/apply (writes recommended
 *                  values to wgp_config.json + sets auto_performance=true)
 *   - Toggle OFF → PUT  /api/v1/services-config { auto_performance: false }
 *                  (preserves current settings; user is now in manual mode)
 *   - Re-detect  → POST /api/v1/system-detect/apply (re-runs detection,
 *                  applies fresh recommendation. Only enabled when auto is on)
 */
function AutoPerformanceCard() {
  const servicesConfig = useStore(s => s.servicesConfig)
  const updateServicesConfig = useStore(s => s.updateServicesConfig)
  const loadServicesConfig = useStore(s => s.loadServicesConfig)
  const loadSystemConfig = useStore(s => s.loadSystemConfig)
  // Detect data lives in the store so the rest of the System panel
  // can read it too (e.g. the VRAM coefficient subtext that shows
  // "Max VRAM target: ~19 GB of 24 GB" using the actual VRAM size).
  const detect = useStore(s => s.systemDetect)
  const loadSystemDetect = useStore(s => s.loadSystemDetect)
  const [loading, setLoading] = useState(!detect)
  const [applying, setApplying] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const autoOn = !!servicesConfig?.auto_performance

  // Initial fetch on mount. We don't refetch when the toggle changes
  // because the hardware detection itself doesn't change — only the
  // applied config does, and that's reflected in systemConfig. If
  // another mount of the panel already loaded detect into the store,
  // skip the fetch.
  useEffect(() => {
    if (detect) {
      setLoading(false)
      return
    }
    let alive = true
    loadSystemDetect().finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [detect, loadSystemDetect])

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 4000)
  }

  // Toggle ON → call apply endpoint (writes recommendation + sets
  // services.auto_performance=true server-side). Refresh both configs
  // to pick up the new state.
  const handleToggleOn = useCallback(async () => {
    setApplying(true)
    try {
      const res = await api.applySystemDetect()
      await Promise.all([loadServicesConfig(), loadSystemConfig()])
      if (res.profile_changed) {
        showToast('Auto-tune applied — profile changes take effect on next model load')
      } else {
        showToast('Auto-tune applied')
      }
    } catch (e) {
      console.error('apply failed:', e)
      showToast('Failed to apply auto-tune')
    } finally {
      setApplying(false)
    }
  }, [loadServicesConfig, loadSystemConfig])

  // Toggle OFF → just flip the flag. Preserves current settings so
  // the user has the same config they were just running, just no
  // longer being auto-managed.
  const handleToggleOff = useCallback(async () => {
    setApplying(true)
    try {
      await updateServicesConfig({ auto_performance: false })
      showToast('Auto-tune disabled — settings unchanged, you can edit them manually now')
    } catch (e) {
      console.error('toggle off failed:', e)
    } finally {
      setApplying(false)
    }
  }, [updateServicesConfig])

  // Re-detect = same as toggle-on, just runs the apply again. Useful
  // after a hardware change (new GPU, more RAM) or driver update.
  const handleRedetect = useCallback(async () => {
    setApplying(true)
    try {
      const res = await api.applySystemDetect()
      // Refresh detect payload too via the store — hardware itself
      // may have changed (e.g. user upgraded GPU). Also refresh
      // services + system configs so the rest of the panel reflects
      // the newly-applied recommendation.
      await Promise.all([loadSystemDetect(), loadServicesConfig(), loadSystemConfig()])
      if (res.profile_changed) {
        showToast('Re-detected — profile changes take effect on next model load')
      } else {
        showToast('Re-detected — no settings changed')
      }
    } catch (e) {
      console.error('re-detect failed:', e)
      showToast('Failed to re-detect hardware')
    } finally {
      setApplying(false)
    }
  }, [loadServicesConfig, loadSystemConfig, loadSystemDetect])

  if (loading) {
    return (
      <div className="settings-card text-xs text-text-muted flex items-center gap-2">
        <Loader2 size={12} className="animate-spin" /> Detecting hardware...
      </div>
    )
  }

  const hw = detect?.hardware
  const rec = detect?.recommended
  const cudaOK = !!hw?.cuda_available

  return (
    <div className="settings-card">
        {/* Hardware readout — GPU name, VRAM, RAM */}
        <div className="flex items-start gap-2">
          <Cpu size={16} className="text-text-secondary shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="text-sm text-text-primary truncate" title={hw?.gpu_name || ''}>
              {cudaOK ? hw!.gpu_name : 'No CUDA GPU detected'}
            </div>
            <div className="text-xs text-text-muted">
              {cudaOK ? `${hw!.gpu_vram_gb} GB VRAM · ${hw!.ram_gb} GB RAM` : `${hw?.ram_gb ?? 0} GB RAM`}
            </div>
          </div>
        </div>

        {/* Profile readout — only meaningful when auto is on, but always
            visible so users can see what auto WOULD pick before flipping
            the toggle. */}
        {rec && (
          <div className="text-xs text-text-secondary leading-snug pl-6" title={rec._recommendation_reason}>
            {autoOn ? '✨ ' : ''}{rec._recommendation_label}
          </div>
        )}

        {/* Toggle + Re-detect button row */}
        <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-border/40">
          <div className="flex items-center gap-2">
            <button
              onClick={autoOn ? handleToggleOff : handleToggleOn}
              disabled={applying}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                autoOn ? 'bg-amber-500' : 'bg-bg-tertiary border border-border'
              } ${applying ? 'opacity-50 cursor-wait' : ''}`}
              title={autoOn ? 'Auto-tune is on — click to take manual control' : 'Auto-tune is off — click to enable'}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white border border-border transition-transform ${
                  autoOn ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </button>
            <span className="text-xs text-text-secondary">
              Auto-tune {autoOn ? 'on' : 'off'}
            </span>
          </div>
          {/* Re-detect only relevant in auto mode. In manual mode, a
              "Reset to auto-tune" affordance lives at the bottom of the
              advanced section instead, so it's not duplicated. */}
          {autoOn && cudaOK && (
            <button
              onClick={handleRedetect}
              disabled={applying}
              className="text-xs text-text-secondary hover:text-text-primary flex items-center gap-1 disabled:opacity-50"
              title="Re-run hardware detection (use after a hardware change or driver update)"
            >
              <RefreshCw size={11} className={applying ? 'animate-spin' : ''} /> Re-detect
            </button>
          )}
        </div>

        {/* Toast — feedback after toggle / re-detect */}
        {toast && (
          <div className="text-2xs text-indicator-warning bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1.5">
            {toast}
          </div>
        )}
      </div>
  )
}

export function SystemSettingsPanel() {
  const systemConfig = useStore(s => s.systemConfig)
  const systemConfigLoading = useStore(s => s.systemConfigLoading)
  const updateConfig = useStore(s => s.updateSystemConfig)
  const servicesConfig = useStore(s => s.servicesConfig)
  const updateServicesConfig = useStore(s => s.updateServicesConfig)
  const llmStatus = useStore(s => s.llmStatus)
  const llmModels = useStore(s => s.llmModels)
  const loadLlmModels = useStore(s => s.loadLlmModels)
  // Detected VRAM is used in the VRAM coefficient subtext (see below)
  // so the "Max VRAM target: ~X GB of Y GB" line shows real numbers
  // instead of a hardcoded 24 GB. AutoPerformanceCard populates this
  // on mount; if it hasn't fired yet (e.g. user opened Settings →
  // System extremely fast), we fall back to 24 GB.
  const systemDetect = useStore(s => s.systemDetect)

  if (systemConfigLoading && !systemConfig) {
    return <div className="text-xs text-text-muted py-4 text-center">Loading system settings...</div>
  }

  if (!systemConfig) {
    return <div className="text-xs text-text-muted py-4 text-center">Failed to load system settings</div>
  }

  const attentionOptions = (systemConfig.attention_modes_available || ['auto', 'sdpa']).map(m => ({
    value: m,
    label: m === 'auto' ? 'Auto' : m === 'sdpa' ? 'SDPA' : m.charAt(0).toUpperCase() + m.slice(1),
  }))

  const profileOptions = Object.entries(profileLabels).map(([k, label]) => ({
    value: k,
    label,
  }))

  const autoOn = !!servicesConfig?.auto_performance

  // Wraps updateConfig so that any change to a Performance / Profile
  // field while auto is ON automatically flips auto OFF. Otherwise
  // the user would think they're editing manually but the auto card
  // would keep claiming "auto-tuned" — confusing and a lie.
  // Auto stays on if the user is just toggling fields *while already
  // in manual mode* (autoOn === false), which is the normal case.
  const updateConfigWithAutoFlip = (partial: Partial<typeof systemConfig>) => {
    updateConfig(partial)
    if (autoOn) {
      updateServicesConfig({ auto_performance: false })
    }
  }

  // Render the Performance + Profiles fields. Used both inside the
  // advanced expander (when auto is on) and inline (when auto is off).
  // Sub-section labels are smaller than the group's own h3 to avoid
  // competing visually with "Advanced" in the settings-group-header.
  const renderAdvancedFields = () => (
    <>
      <div className="space-y-4">
        <SelectField
          label="Attention Mode"
          value={systemConfig.attention_mode}
          options={attentionOptions}
          onChange={val => updateConfigWithAutoFlip({ attention_mode: val })}
        />

        <div>
          <SelectField
            label="Transformer Quantization"
            value={systemConfig.transformer_quantization}
            options={quantizationOptions}
            onChange={val => updateConfigWithAutoFlip({ transformer_quantization: val })}
          />
          {/* FP8 footgun: many models ship only BF16 + INT8 files (no
              FP8 variant). Picking FP8 here silently falls back to
              INT8 for those models — UI says FP8 but you get INT8
              precision. The model name itself is the only place
              that tells you what's actually loaded — e.g. picking
              "LTX-2.3 Distilled FP8 22B" in the model selector loads
              FP8 regardless of this setting. Worth a hint so users
              don't think "I selected FP8 but performance/quality
              feels like INT8 — must be broken." */}
          {systemConfig.transformer_quantization === 'fp8' && (
            <p className="text-2xs text-indicator-warning mt-1">
              ⚠ Many models ship only BF16 + INT8 files. FP8 silently falls back to INT8 for those.
              For guaranteed FP8, pick a model with "FP8" in its name (e.g. "LTX-2.3 Distilled FP8 22B").
            </p>
          )}
        </div>

        <SelectField
          label="VAE Tiling"
          value={systemConfig.vae_config}
          options={vaeOptions}
          onChange={val => updateConfigWithAutoFlip({ vae_config: Number(val) })}
        />

        <SelectField
          label="Compile"
          value={systemConfig.compile}
          options={compileOptions}
          onChange={val => updateConfigWithAutoFlip({ compile: val })}
        />
      </div>

      <hr className="border-border" />

      <div className="space-y-4">
        <div className="text-2xs uppercase tracking-wider text-text-muted font-semibold">Profiles</div>

        <SelectField
          label="Video Profile"
          value={String(systemConfig.video_profile)}
          options={profileOptions}
          onChange={val => updateConfigWithAutoFlip({ video_profile: parseFloat(val) })}
        />

        <SelectField
          label="Image Profile"
          value={String(systemConfig.image_profile)}
          options={profileOptions}
          onChange={val => updateConfigWithAutoFlip({ image_profile: parseFloat(val) })}
        />

        <SelectField
          label="Audio Profile"
          value={String(systemConfig.audio_profile)}
          options={profileOptions}
          onChange={val => updateConfigWithAutoFlip({ audio_profile: parseFloat(val) })}
        />

        <p className="text-2xs text-text-muted">
          Profile changes take effect on next model load
        </p>

        {/* VRAM Safety Coefficient */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs text-text-muted uppercase tracking-wider">VRAM Safety Coefficient</label>
            <span className="text-xs text-text-secondary">{(systemConfig.vram_safety_coefficient ?? 0.8).toFixed(2)}</span>
          </div>
          <input
            type="range" min={0.5} max={0.95} step={0.05}
            value={systemConfig.vram_safety_coefficient ?? 0.8}
            onChange={e => updateConfigWithAutoFlip({ vram_safety_coefficient: parseFloat(e.target.value) })}
            className="w-full"
          />
          <div className="flex justify-between text-2xs text-text-muted mt-0.5 px-0.5">
            <span>0.50 (conservative)</span>
            <span>0.80 (default)</span>
            <span>0.95 (aggressive)</span>
          </div>
          <p className="text-2xs text-text-muted mt-1">
            {(() => {
              // Use detected VRAM when available so the math is honest.
              // Falls back to 24 GB if detection hasn't completed yet
              // — the auto card populates the store on mount.
              const totalVram = systemDetect?.hardware?.gpu_vram_gb ?? 24
              const coef = systemConfig.vram_safety_coefficient ?? 0.8
              return `Max VRAM target: ~${(totalVram * coef).toFixed(1)} GB of ${totalVram} GB.`
            })()} Lower = more headroom for spikes (long videos, VAE decode). Takes effect on next model load.
          </p>
        </div>
      </div>
    </>
  )

  return (
    <section className="settings-panel settings-panel-constrained" aria-label="Performance settings">
      <header className="settings-panel-header">
        <h2><Cpu size={18} aria-hidden="true" /> Performance</h2>
      </header>

      {/* Two-row layout. The TOP row hosts the runtime knobs — every
          control here is a setting the user adjusts to make the
          next generation faster / quieter / higher quality:

            [ LLM Configuration ]   [ FlashVSR upscaler ]
            provider · model ·     decoder variant · sparse
            device · remote URL    attention top-K · backend

          Both rows used to live in the Integrations drawer under
          "Services" but they're runtime knobs, not integration
          secrets, so they moved here next to Advanced and the
          auto-tune card.

          The BOTTOM row is the original 3-column dashboard:
          Advanced (attention mode, quantization, profile, VRAM
          headroom) and AutoPerformanceCard (hardware readout +
          auto-tune toggle). The Models card (enabled models +
          linked folders) used to live in the third column here but
          moved to Integrations to live next to the Providers card
          and the Director v2 engine — Models is closer in spirit
          to a content registry than to per-take runtime knobs.

          Output Codecs moved to the sidebar (OutputCodecs.tsx) —
          the sidebar groups it next to Post Processing as a
          per-output choice.

          The vertical layout stays a flex column with `flex: 1` on
          the inner row so the constrained panel keeps the same
          scroll behaviour — each row scrolls independently
          rather than growing the whole panel past the viewport. */}
      <div className="settings-panel-rows">
        <div className="settings-feature-column">
          <div className="settings-group">
            <LlmConfigurationCard
              servicesConfig={servicesConfig!}
              updateConfig={updateServicesConfig}
              loadLlmModels={loadLlmModels}
              llmStatus={llmStatus}
              llmModels={llmModels}
            />
          </div>
          <div className="settings-group">
            <FlashVsrCard
              servicesConfig={servicesConfig!}
              updateConfig={updateServicesConfig}
            />
          </div>
        </div>

        {/* Two-column bottom row: Advanced runtime tuning on the
            left, Auto-tune card on the right. Models used to sit
            here as the third column but moved to Integrations
            (see comment above). */}
        <div className="settings-feature-column">
          <div className="settings-group">
            <div className="settings-card">{renderAdvancedFields()}</div>
          </div>

          <div className="settings-group">
            <AutoPerformanceCard />
          </div>
        </div>
      </div>
    </section>
  )
}
