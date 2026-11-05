import { useStore } from '../../stores/useStore'
import { ApiKeyField } from './perf/ApiKeyField'
import { ModelVisibilitySection } from './models/ModelVisibilitySection'

/* Integrations panel now owns:
 *   - Director v2 engine toggle + Prompt Polish mode (Director runtime)
 *   - The Providers card: API keys for Google / OpenAI / Anthropic /
 *     MiniMax / CivitAI / LLM remote / remote Ollama. Every entry
 *     here is a SECRET the user pastes once and never sees again.
 *   - The Models card: enabled / disabled model weights, download /
 *     delete affordances, and the Linked Model Folders footer
 *     (external Pinokio-app installs). Moved here from Performance
 *     because it's closer in spirit to a content registry than to
 *     per-take runtime knobs.
 *
 * Stuff that used to live here but moved out:
 *   - NSFW content-mode toggle → /components/NSFW/NsfwToggle.tsx
 *     (embedded in the project setup form).
 *   - LLM Configuration (provider / model / device / remote URL) →
 *     /SettingsDrawer/perf/LlmConfigurationCard.tsx, rendered inside
 *     the Performance panel. Every control there is a runtime knob,
 *     not an integration secret.
 *   - FlashVSR (variant / top-K / backend) → same perf module, same
 *     reason — quality-vs-speed tradeoffs belong with the other
 *     performance knobs. */

export function ServicesSettingsPanel() {
  const servicesConfig = useStore(s => s.servicesConfig)
  const servicesConfigLoading = useStore(s => s.servicesConfigLoading)
  const updateConfig = useStore(s => s.updateServicesConfig)

  if (servicesConfigLoading && !servicesConfig) {
    return <div className="text-xs text-text-muted py-4 text-center">Loading...</div>
  }
  if (!servicesConfig) {
    return <div className="text-xs text-text-muted py-4 text-center">Failed to load services settings</div>
  }

  return (
    <section className="settings-panel" aria-label="Integrations settings">
      {/* Compact 2-column layout for Integrations:
          Left column: Director v2 Engine card + Providers API Keys in 2-column compact grid
          Right column: Models catalog & linked folders */}
      <div className="settings-columns">
        <div className="settings-group">
          {/* Director v2 Engine */}
          <div className="settings-card">
            <label className="flex items-center justify-between cursor-pointer group">
              <div className="flex-1 mr-3">
                <div className="text-sm text-text-primary group-hover:text-accent-blue transition-colors">
                  Director v2 Engine <span className="text-2xs text-text-muted font-normal">(default)</span>
                </div>
                <div className="text-2xs text-text-muted mt-0.5">
                  Layered architecture with structured shot planning, mode-specific renderers, and prompt validation.
                </div>
              </div>
              <div
                onClick={() => updateConfig({ use_director_v2: !servicesConfig.use_director_v2 })}
                className={`w-9 h-5 rounded-full transition-colors relative shrink-0 ${
                  servicesConfig.use_director_v2 ? 'bg-accent-blue' : 'bg-bg-tertiary border border-border'
                }`}
              >
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white border border-border shadow transition-transform ${
                  servicesConfig.use_director_v2 ? 'translate-x-4' : 'translate-x-0.5'
                }`} />
              </div>
            </label>

            {/* Prompt Polish Mode */}
            <div>
              <label className="text-xs text-text-muted uppercase tracking-wider mb-1 block">
                Director Prompt Polish
              </label>
              <select
                value={servicesConfig.director_prompt_polish || 'third_pass'}
                onChange={e => updateConfig({ director_prompt_polish: e.target.value as 'off' | 'full_guide' | 'light_guide' | 'third_pass' })}
                className="w-full bg-bg-tertiary border border-border rounded-lg px-2.5 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent-blue"
              >
                <option value="third_pass">Third Pass (Model-aware) — recommended</option>
                <option value="light_guide">Lightweight Guide Inject (legacy)</option>
                <option value="full_guide">Full Guide Inject (legacy)</option>
                <option value="off">Off</option>
              </select>
            </div>
          </div>

          {/* Providers — compact 2-column grid for keys */}
          <div className="settings-card">
            <label className="text-xs text-text-muted uppercase tracking-wider mb-1 block">
              Cloud API Keys
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <ApiKeyField
                label="Google AI"
                maskedValue={servicesConfig.google_api_key}
                isSet={servicesConfig.google_api_key_set}
                onSave={val => updateConfig({ google_api_key: val })}
              />
              <ApiKeyField
                label="OpenAI"
                maskedValue={servicesConfig.openai_api_key}
                isSet={servicesConfig.openai_api_key_set}
                onSave={val => updateConfig({ openai_api_key: val })}
              />
              <ApiKeyField
                label="Anthropic"
                maskedValue={servicesConfig.anthropic_api_key}
                isSet={servicesConfig.anthropic_api_key_set}
                onSave={val => updateConfig({ anthropic_api_key: val })}
              />
              <ApiKeyField
                label="MiniMax"
                maskedValue={servicesConfig.minimax_api_key}
                isSet={servicesConfig.minimax_api_key_set}
                onSave={val => updateConfig({ minimax_api_key: val })}
              />
              <ApiKeyField
                label="OpenRouter"
                maskedValue={servicesConfig.openrouter_api_key}
                isSet={servicesConfig.openrouter_api_key_set}
                onSave={val => updateConfig({ openrouter_api_key: val })}
              />
              <ApiKeyField
                label="OpenCode"
                maskedValue={servicesConfig.opencode_api_key}
                isSet={servicesConfig.opencode_api_key_set}
                onSave={val => updateConfig({ opencode_api_key: val })}
              />
              <div className="md:col-span-2">
                <ApiKeyField
                  label="CivitAI Token"
                  maskedValue={servicesConfig.civitai_api_key}
                  isSet={servicesConfig.civitai_api_key_set}
                  onSave={val => updateConfig({ civitai_api_key: val })}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right column — Models card */}
        <div className="settings-group settings-group-stretch">
          <ModelVisibilitySection />
        </div>
      </div>
    </section>
  )
}
