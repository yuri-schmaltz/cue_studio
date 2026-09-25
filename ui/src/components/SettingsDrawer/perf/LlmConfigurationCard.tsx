/* eslint-disable react-refresh/only-export-components -- shared between the
   Integrations panel (legacy home) and the Performance panel (canonical
   home for runtime knobs). Keep the opts lists co-located so both
   surfaces stay in lockstep when a new provider / model is added. */
import { useState } from 'react'
import { RefreshCw, CheckCircle, AlertCircle } from 'lucide-react'
import { ApiKeyField } from './ApiKeyField'
import type { ServicesConfig, LlmStatus, LlmModelOption } from '../../../types'
import { testLlmConnection } from '../../../api/client'
import { PUBLIC_PROVIDERS } from './perfConstants'

/** LLM Configuration card: provider, model, device, remote URL +
 *  optional remote API key. Historically lived in the Integrations
 *  drawer ("Services"). Moved to the Performance panel because every
 *  control here is a runtime knob (which provider to run, which model
 *  weights to load, CPU vs CUDA) rather than an integration concern
 *  (API keys for cloud services). The Integrations drawer is now
 *  reserved for the Director v2 engine toggle and the providers' API
 *  keys (the secrets, not the runtime choices).
 *
 *  Kept as a standalone component so a future "Advanced" or
 *  Director-side embedded configuration can reuse the same body
 *  without copy-pasting the markup.
 */
export function LlmConfigurationCard({
  servicesConfig,
  updateConfig,
  loadLlmModels,
  llmStatus,
  llmModels,
}: {
  servicesConfig: ServicesConfig
  updateConfig: (patch: Partial<ServicesConfig>) => Promise<void>
  loadLlmModels: () => Promise<void>
  llmStatus: LlmStatus | null
  llmModels: LlmModelOption[]
}) {
  const provider = servicesConfig.llm_provider || 'local'
  const isRemote = provider === 'remote'
  const isOpenAI = provider === 'openai'
  const isLocal = provider === 'local'
  const isMiniMax = provider === 'minimax'
  const isOllama = provider === 'ollama'
  const [refreshing, setRefreshing] = useState(false)

  // Filter models by current provider (show local + remote of current provider)
  const filteredModels = llmModels.filter(m => {
    const mp = (m as { provider?: string }).provider || 'local'
    if (isLocal) return mp === 'local'
    return mp === 'local' || mp === provider
  })

  const handleRefreshModels = async () => {
    setRefreshing(true)
    await loadLlmModels()
    setRefreshing(false)
  }

  return (
    <div className="settings-card">
      {/* Status header — keeps the user oriented about what's loaded
          right now. Mirrors the previous in-place copy verbatim so
          no behavioural change is visible to the user. */}
      <div className="flex items-center justify-between">
        <div className="min-w-0 flex-1 mr-3">
          <div className="text-sm text-text-primary truncate">
            {llmStatus?.loaded ? llmStatus.model_id : 'Standby'}
          </div>
          <div className="text-2xs text-text-muted">
            {llmStatus?.loaded
              ? `Active on ${llmStatus.device} (${llmStatus.provider || 'local'})`
              : 'Auto-loads when needed'}
          </div>
        </div>
        <div className={`w-2 h-2 rounded-full shrink-0 ${llmStatus?.loaded ? 'bg-indicator-success' : 'bg-text-muted/30'}`} />
      </div>

      {/* Provider selector. Auto-disables NSFW when switching to a
          public provider so the user never accidentally sends
          explicit prompts upstream. */}
      <div>
        <label className="text-xs text-text-muted uppercase tracking-wider mb-1.5 block">
          LLM Provider
        </label>
        <select
          value={provider}
          onChange={e => {
            const newProvider = e.target.value
            const updates: Record<string, unknown> = { llm_provider: newProvider }
            if (PUBLIC_PROVIDERS.has(newProvider) && servicesConfig.nsfw_mode) {
              updates.nsfw_mode = false
            }
            void updateConfig(updates as Partial<ServicesConfig>)
            // Refresh model list for new provider
            setTimeout(() => { void loadLlmModels() }, 500)
          }}
          className="w-full bg-bg-tertiary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-blue"
        >
          <option value="local">Local (llama-server)</option>
          <option value="remote">Remote OpenAI-Compatible (LM Studio, etc.)</option>
          <option value="ollama">Ollama (local daemon)</option>
          <option value="openai">OpenAI API</option>
          <option value="anthropic">Anthropic API</option>
          <option value="minimax">MiniMax M3 (Anthropic-compatible)</option>
        </select>
      </div>

      {/* Remote URL (for remote/openai/ollama/MiniMax providers) */}
      {(isRemote || isOpenAI || isMiniMax || isOllama) && (
        <div className="space-y-3">
          <div>
            <label className="text-xs text-text-muted uppercase tracking-wider mb-1.5 block">
              {isRemote ? 'Server URL' : 'API Base URL'}
            </label>
            <input
              type="text"
              value={servicesConfig.llm_remote_url || ''}
              onChange={e => void updateConfig({ llm_remote_url: e.target.value })}
              placeholder={isRemote
                ? 'http://192.168.1.100:1234'
                : isOllama
                  ? 'http://localhost:11434'
                  : isMiniMax
                    ? 'https://api.minimax.com'
                    : 'https://api.openai.com'}
              className="w-full bg-bg-tertiary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-blue"
            />
            <p className="text-2xs text-text-muted mt-1">
              {isRemote
                ? 'URL of your LM Studio or other OpenAI-compatible server'
                : isOllama
                  ? 'Ollama daemon URL. Leave blank for default http://localhost:11434. Models are auto-detected from /api/tags.'
                  : isMiniMax
                    ? 'MiniMax M3 gateway URL. Leave blank for default https://api.minimax.com'
                    : 'Leave blank for default OpenAI endpoint'}
            </p>
          </div>

          {(isRemote || isOllama) && (
            <div>
              <ApiKeyField
                label="Server API Key"
                maskedValue={servicesConfig.llm_remote_api_key}
                isSet={servicesConfig.llm_remote_api_key_set}
                onSave={value => {
                  void updateConfig({ llm_remote_api_key: value }).then(() => loadLlmModels())
                }}
              />
              <p className="text-2xs text-text-muted mt-1">
                Optional. Ollama ignores this unless you set OLLAMA_AUTH or run it behind a reverse proxy that requires a key.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Model selector with refresh button (remote / API providers) */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs text-text-muted uppercase tracking-wider">
            LLM Model
          </label>
          {!isLocal && (
            <button
              onClick={handleRefreshModels}
              disabled={refreshing}
              className="text-2xs text-accent-blue hover:text-accent-blue-hover flex items-center gap-0.5 disabled:opacity-50"
            >
              <RefreshCw size={10} className={refreshing ? 'animate-spin' : ''} />
              Refresh
            </button>
          )}
        </div>
        <select
          value={servicesConfig.llm_model_id}
          onChange={e => void updateConfig({ llm_model_id: e.target.value })}
          className="w-full bg-bg-tertiary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-blue"
        >
          {filteredModels.map(m => (
            <option key={m.id} value={m.id}>
              {m.label} ({m.size_hint})
            </option>
          ))}
        </select>
        {isLocal && (
          <p className="text-2xs text-text-muted mt-1">
            Larger models produce more creative scene descriptions but use more RAM
          </p>
        )}
      </div>

      {/* Device selector (local llama-server only). Ollama manages
          its own CPU/GPU split so the dropdown would be misleading
          and is suppressed above. */}
      {isLocal && (
        <div>
          <label className="text-xs text-text-muted uppercase tracking-wider mb-1.5 block">
            LLM Device
          </label>
          <select
            value={servicesConfig.llm_device}
            onChange={e => void updateConfig({ llm_device: e.target.value })}
            className="w-full bg-bg-tertiary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-blue"
          >
            <option value="cpu">CPU (recommended)</option>
            <option value="cuda">CUDA (uses VRAM)</option>
          </select>
          <p className="text-2xs text-text-muted mt-1">
            CPU recommended to avoid conflicts with video generation
          </p>
        </div>
      )}
    </div>
  )
}

/** FlashVSR upscaling card: model variant (decoder choice), sparse
 *  attention top-K (quality vs speed slider), sparse attention
 *  backend (kernel selection). Every control here trades quality
 *  against speed / VRAM, which is the definition of a performance
 *  knob — moved from Integrations to the Performance panel for the
 *  same reason as LLM Configuration.
 */
export function FlashVsrCard({
  servicesConfig,
  updateConfig,
}: {
  servicesConfig: ServicesConfig
  updateConfig: (patch: Partial<ServicesConfig>) => Promise<void>
}) {
  return (
    <div className="settings-card">
      <div>
        <label className="text-xs text-text-muted uppercase tracking-wider mb-1.5 block">FlashVSR Model Variant</label>
        <select
          value={servicesConfig.flashvsr_mode ?? 1}
          onChange={e => updateConfig({ flashvsr_mode: Number(e.target.value) })}
          className="w-full bg-bg-tertiary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-blue"
        >
          <option value={1}>Tiny — fast, low VRAM (default)</option>
          <option value={2}>Full — best quality, more VRAM</option>
          <option value={3}>Tiny-Long — for long videos</option>
        </select>
        <p className="text-2xs text-text-muted mt-1">
          {servicesConfig.flashvsr_mode === 2
            ? 'Full uses the complete Wan2.1 VAE — sharpest detail and best temporal fidelity, highest VRAM.'
            : servicesConfig.flashvsr_mode === 3
              ? 'Tiny decoder tuned for long clips.'
              : 'Lightweight decoder — fastest, lowest VRAM. Good default alongside the main model on a 24 GB card.'}
        </p>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs text-text-muted uppercase tracking-wider">FlashVSR Sparse Attention Top-K</label>
          <span className="text-xs text-text-secondary">{(servicesConfig.flashvsr_topk_ratio ?? 0).toFixed(2)}</span>
        </div>
        <input
          type="range"
          min={0}
          max={4}
          step={0.25}
          value={servicesConfig.flashvsr_topk_ratio ?? 0}
          onChange={e => updateConfig({ flashvsr_topk_ratio: parseFloat(e.target.value) })}
        />
        <p className="text-2xs text-text-muted mt-1">
          Higher computes more attention → better motion fidelity, slower. 0 = sparsest (fastest).
        </p>
      </div>

      <div>
        <label className="text-xs text-text-muted uppercase tracking-wider mb-1.5 block">FlashVSR Sparse Attention Backend</label>
        <select
          value={servicesConfig.flashvsr_backend || 'auto'}
          onChange={e => updateConfig({ flashvsr_backend: e.target.value })}
          className="w-full bg-bg-tertiary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-blue"
        >
          <option value="auto">Auto (SpargeAttn if installed, else Triton)</option>
          <option value="triton_sparse">Triton Sparse (bundled)</option>
          <option value="sparge">SpargeAttn (best with motion — requires install)</option>
        </select>
        <p className="text-2xs text-text-muted mt-1">
          SpargeAttn gives the best quality when there's motion but needs a separate install. Auto uses the bundled Triton kernels otherwise.
        </p>
      </div>
    </div>
  )
}
