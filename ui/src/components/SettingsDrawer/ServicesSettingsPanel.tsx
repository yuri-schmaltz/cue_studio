import { Cable } from 'lucide-react'
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
      <header className="settings-panel-header">
        <h2><Cable size={18} aria-hidden="true" /> Integrations</h2>
      </header>

      {/* Two-column layout. Left column stacks Director v2 Engine
          on top of Providers — both are short, control-surface
          cards and they read as the "configuration" pair. Right
          column is the Models card (enabled / disabled weights +
          Linked Model Folders footer), which owns its own internal
          scroll pane so the long family list doesn't push the rest
          of the panel out of view. Using `.settings-columns` gives
          equal widths; `align-items: start` keeps the shorter left
          column from stretching the Models card to match. */}
      <div className="settings-columns">
        <div className="settings-group">
      {/* Director v2 Engine — stays on this panel because it is a
          "Director runtime" choice, not a performance knob. The
          toggle (v2 default vs v1 legacy) decides which planner /
          renderer pipeline Maestro uses; the prompt polish dropdown
          decides whether/how model-specific prompt guides are
          injected. Both are bound to the Director, not to model
          performance. */}
      <div className="settings-card">
        {/* Director v2 Engine toggle. v2 became the default 2026-05-03
            after weeks of real-world validation showed it's more
            reliable than v1 (v1 had a polish-pass failure mode where
            smaller LLMs would hallucinate dialogue into image_prompts).
            No longer behind the experimental gate — toggle is always
            visible so users who hit issues with v2 can revert to v1
            without first enabling experimental mode. */}
        <label className="flex items-center justify-between cursor-pointer group">
          <div className="flex-1 mr-3">
            <div className="text-sm text-text-primary group-hover:text-accent-blue transition-colors">
              Director v2 Engine <span className="text-2xs text-text-muted font-normal">(default)</span>
            </div>
            <div className="text-2xs text-text-muted mt-0.5">
              Layered architecture with structured shot planning, mode-specific renderers, and prompt validation.
              Supports Podcast and Viral Video skills. Turn off to use the legacy v1 engine.
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
          <label className="text-xs text-text-muted uppercase tracking-wider mb-1.5 block">
            Director Prompt Polish
          </label>
          <select
            value={servicesConfig.director_prompt_polish || 'third_pass'}
            onChange={e => updateConfig({ director_prompt_polish: e.target.value as 'off' | 'full_guide' | 'light_guide' | 'third_pass' })}
            className="w-full bg-bg-tertiary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-blue"
          >
            <option value="third_pass">Third Pass (Model-aware) — recommended</option>
            <option value="light_guide">Lightweight Guide Inject (legacy)</option>
            <option value="full_guide">Full Guide Inject (legacy)</option>
            <option value="off">Off</option>
          </select>
          <p className="text-2xs text-text-muted mt-1">
            {servicesConfig.director_prompt_polish === 'full_guide'
              ? 'Legacy: injects the complete model-specific prompt guide into the Director planner\'s system prompt.'
              : servicesConfig.director_prompt_polish === 'light_guide'
                ? 'Legacy: injects a lightweight dialect cheat sheet (~200 tokens) into the Director planner.'
                : servicesConfig.director_prompt_polish === 'off'
                  ? 'Director uses its built-in prompting rules only. No model-specific optimization.'
                  : 'Default and model-aware. H3 keeps its native video prompts while generated image prompts may still be polished; other models use their dialect-specific enhance pipeline.'}
          </p>
        </div>
      </div>

      {/* Providers — every API key the user might need to paste
          for the cloud providers Maestro talks to. The card label
          still scopes the card ("Providers") and each field carries
          its own provider name. Optional providers (CivitAI) keep
          a tail note explaining what the key unlocks. The remote
          server / Ollama URL + API key fields used to live in the
          LLM Configuration card; they were removed from this panel
          when that card moved to Performance, because URL +
          endpoint config are runtime knobs, not secrets. */}
      <div className="settings-card">
        <label className="text-xs text-text-muted uppercase tracking-wider mb-1.5 block">
          Providers
        </label>

        <ApiKeyField
          label="Google AI API Key"
          maskedValue={servicesConfig.google_api_key}
          isSet={servicesConfig.google_api_key_set}
          onSave={val => updateConfig({ google_api_key: val })}
        />

        <ApiKeyField
          label="OpenAI API Key"
          maskedValue={servicesConfig.openai_api_key}
          isSet={servicesConfig.openai_api_key_set}
          onSave={val => updateConfig({ openai_api_key: val })}
        />

        <ApiKeyField
          label="Anthropic API Key"
          maskedValue={servicesConfig.anthropic_api_key}
          isSet={servicesConfig.anthropic_api_key_set}
          onSave={val => updateConfig({ anthropic_api_key: val })}
        />

        <ApiKeyField
          label="MiniMax API Key"
          maskedValue={servicesConfig.minimax_api_key}
          isSet={servicesConfig.minimax_api_key_set}
          onSave={val => updateConfig({ minimax_api_key: val })}
        />

        <ApiKeyField
          label="CivitAI API Key"
          maskedValue={servicesConfig.civitai_api_key}
          isSet={servicesConfig.civitai_api_key_set}
          onSave={val => updateConfig({ civitai_api_key: val })}
        />
        <p className="text-2xs text-text-muted -mt-2">
          Optional. Increases rate limits and enables access to restricted models.
        </p>
      </div>
        </div>

        {/* Right column — Models card. Moved here from the
            Performance panel because it's closer in spirit to a
            content registry (enabled list, download / delete, linked
            folders) than to per-take runtime knobs. The card owns
            its own internal scroll pane (inner
            `<div className="flex-1 min-h-0 overflow-y-auto">`), so
            the long family list scrolls inside the card while the
            Director v2 + Providers column on the left stays
            statically visible.

            `settings-group-stretch` forces the right column to
            grow to match the height of the left column (Providers
            + Director v2). Without it the Models card sits at its
            natural content height — which is short because the
            four mode groups are collapsed — and the Linked Model
            Folders footer floats in the middle of the panel
            instead of aligning with the Providers bottom. The
            `flex: 1` on the inner .settings-card (see index.css)
            then consumes the leftover height and pins the footer
            to the bottom of the card. */}
        <div className="settings-group settings-group-stretch">
          <ModelVisibilitySection />
        </div>
      </div>
    </section>
  )
}
