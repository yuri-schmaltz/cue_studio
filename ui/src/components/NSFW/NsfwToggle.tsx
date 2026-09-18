/* eslint-disable react-refresh/only-export-components -- NsfwDisclaimerModal
 * is consumed by NsfwToggle via composition and never by any other module;
 * co-locating the two keeps the legal text next to its only consumer. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ShieldAlert, ShieldCheck, Lock } from 'lucide-react'
import { useStore } from '../../stores/useStore'

/** LLM providers whose terms of service forbid NSFW generation. The
 *  toggle locks to OFF (and renders disabled) while one of these is
 *  selected so we never accidentally send explicit prompts upstream.
 *  Matches the set used by ServicesSettingsPanel and LoraBrowser. */
export const NSFW_PUBLIC_PROVIDERS = new Set(['openai', 'anthropic', 'minimax'])

/** Lightweight toggle row + matching disclaimer modal. Lives in its
 *  own module so it can be embedded in any surface (project setup
 *  form, a future Director gate, a dedicated NSFW admin card) while
 *  staying a single source of truth for the disclaimer text and
 *  public-provider lockout.
 *
 *  The toggle binds to the GLOBAL ``servicesConfig.nsfw_mode`` flag
 *  (read by LoRAs, model selectors, recipes, the Director LLM prompt,
 *  etc.) — it is not a per-project setting. Moving the *surface*
 *  where the user flips it does not change what the flag actually
 *  controls. If a future feature wants a per-project override, that
 *  should layer on top of this flag, not replace it.
 *
 *  Props:
 *    - ``disabled`` (optional): disables the click + renders a
 *    cursor-not-allowed state. Used by the project setup form so
 *    the Edit modal can lock every control.
 */
export function NsfwToggle({ disabled = false }: { disabled?: boolean }) {
  const servicesConfig = useStore(s => s.servicesConfig)
  const updateConfig = useStore(s => s.updateServicesConfig)
  const [showDisclaimer, setShowDisclaimer] = useState(false)

  if (!servicesConfig) return null

  const provider = servicesConfig.llm_provider || 'local'
  const isPublicProvider = NSFW_PUBLIC_PROVIDERS.has(provider)
  const nsfwEnabled = servicesConfig.nsfw_mode
  const hasAccepted = !!servicesConfig.nsfw_accepted_at
  const locked = isPublicProvider || disabled

  const handleToggle = () => {
    if (locked) return

    if (nsfwEnabled) {
      // Turning OFF — no confirmation needed.
      updateConfig({ nsfw_mode: false })
      return
    }

    // Turning ON — the first enable shows the disclaimer; afterwards
    // the toggle flips directly. All mature-mode guidance ships
    // version-controlled with the app — nothing to download.
    if (!hasAccepted) {
      setShowDisclaimer(true)
    } else {
      updateConfig({ nsfw_mode: true })
    }
  }

  const handleDisclaimerAccept = () => {
    setShowDisclaimer(false)
    updateConfig({
      nsfw_mode: true,
      nsfw_accepted_at: new Date().toISOString(),
    })
  }

  return (
    <>
      <div
        className={`flex items-center justify-between ${locked ? '' : 'cursor-pointer'} group`}
        onClick={handleToggle}
      >
        <div className="flex-1 mr-3">
          <div className={`text-sm flex items-center gap-1.5 ${
            locked ? 'text-text-muted' : 'text-text-primary group-hover:text-accent-blue transition-colors'
          }`}>
            {nsfwEnabled ? (
              <ShieldAlert size={14} className="text-red-400 shrink-0" />
            ) : (
              <ShieldCheck size={14} className="text-indicator-success shrink-0" />
            )}
            NSFW Mode
            {isPublicProvider && <Lock size={11} className="text-text-muted" />}
          </div>
          <div className="text-2xs text-text-muted mt-0.5">
            {disabled ? (
              <>Editing this field is locked in the current context.</>
            ) : isPublicProvider ? (
              <>NSFW is unavailable with public LLM providers ({provider}). Switch to a local or self-hosted model to enable.</>
            ) : nsfwEnabled ? (
              <>Adult content generation is enabled. LLM prompts include explicit content guidance. Use responsibly.</>
            ) : (
              <>Content safety guardrails active. Explicit content is blocked in all LLM outputs.</>
            )}
          </div>
        </div>
        <div
          className={`w-9 h-5 rounded-full transition-colors relative shrink-0 ${
            locked ? 'bg-bg-tertiary border border-border opacity-40 cursor-not-allowed'
              : nsfwEnabled ? 'bg-red-500' : 'bg-bg-tertiary border border-border'
          }`}
        >
          <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white border border-border shadow transition-transform ${
            nsfwEnabled && !locked ? 'translate-x-4' : 'translate-x-0.5'
          }`} />
        </div>
      </div>

      {showDisclaimer && (
        <NsfwDisclaimerModal
          onAccept={handleDisclaimerAccept}
          onDecline={() => setShowDisclaimer(false)}
        />
      )}
    </>
  )
}

/** Legal disclaimer shown the first time NSFW mode is enabled. The
 *  accept button only activates once the user has scrolled to the
 *  bottom of the legal copy (or the content is shorter than the
 *  viewport, which we detect on mount + resize). Same copy as the
 *  original ServicesSettingsPanel version — moved into its own
 *  module unchanged so users with an existing ``nsfw_accepted_at``
 *  are never re-prompted. */
function NsfwDisclaimerModal({
  onAccept,
  onDecline,
}: {
  onAccept: () => void
  onDecline: () => void
}) {
  const [scrolledToBottom, setScrolledToBottom] = useState(false)
  const scrollableRef = useRef<HTMLDivElement>(null)

  // If the modal opens on a window tall enough that all the legal
  // text fits without scrolling, the onScroll handler never fires
  // and the Accept button stays disabled forever. Detect "no scroll
  // needed" on mount + on every viewport resize so the user isn't
  // stuck.
  useEffect(() => {
    const checkScrollable = () => {
      const el = scrollableRef.current
      if (!el) return
      // Add a small buffer so off-by-one rounding doesn't break this.
      if (el.scrollHeight <= el.clientHeight + 2) {
        setScrolledToBottom(true)
      }
    }
    checkScrollable()
    window.addEventListener('resize', checkScrollable)
    return () => window.removeEventListener('resize', checkScrollable)
  }, [])

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 20) {
      setScrolledToBottom(true)
    }
  }, [])

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60" onClick={onDecline}>
      <div
        className="bg-bg-secondary border border-border rounded-xl shadow-2xl w-[480px] max-w-[92vw] max-h-[85vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-center gap-2.5">
          <ShieldAlert size={20} className="text-red-400 shrink-0" />
          <div>
            <h2 className="text-sm font-semibold text-text-primary">Enable Adult Content Mode</h2>
            <p className="text-2xs text-text-muted mt-0.5">Please read and accept before continuing</p>
          </div>
        </div>

        {/* Scrollable content */}
        <div
          ref={scrollableRef}
          className="flex-1 overflow-y-auto px-5 py-4 text-xs text-text-secondary leading-relaxed space-y-3"
          onScroll={handleScroll}
        >
          <p className="font-medium text-text-primary">
            By enabling NSFW mode, you acknowledge and agree to the following:
          </p>

          <div className="space-y-2">
            <p><span className="font-medium text-text-primary">1. Age Requirement.</span> You confirm that you are at least 18 years of age (or the age of majority in your jurisdiction, whichever is higher).</p>

            <p><span className="font-medium text-text-primary">2. Legal Responsibility.</span> You are solely responsible for ensuring that all content you generate complies with the laws of your jurisdiction. This includes but is not limited to laws governing obscenity, pornography, intellectual property, privacy, consent, and the depiction of real persons. Maestro and its developers do not monitor, review, or approve generated content.</p>

            <p><span className="font-medium text-text-primary">3. Prohibited Content.</span> You agree to NEVER use this software to generate child sexual abuse material (CSAM) or any content depicting minors in sexual or exploitative contexts. This is strictly prohibited regardless of jurisdiction and may constitute a criminal offense.</p>

            <p><span className="font-medium text-text-primary">4. No Real Person Exploitation.</span> You agree not to generate non-consensual intimate imagery of real, identifiable individuals. Creating realistic explicit content of someone without their consent may violate laws in your jurisdiction.</p>

            <p><span className="font-medium text-text-primary">5. Local Generation.</span> When using local models, all content is generated on your hardware and is never transmitted to external servers. You are responsible for the storage, distribution, and use of any content you create.</p>

            <p><span className="font-medium text-text-primary">6. Public API Providers.</span> NSFW mode is automatically disabled when using public LLM providers (OpenAI, Anthropic) as it violates their terms of service. NSFW mode is only available with local or self-hosted models.</p>

            <p><span className="font-medium text-text-primary">7. No Warranty.</span> This software is provided as-is. The developers assume no liability for content generated by users. You use this feature entirely at your own risk.</p>
          </div>

          {!scrolledToBottom && (
            <p className="text-text-muted pt-2">
              Scroll to the bottom to enable the accept button.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-3">
          <button
            onClick={onDecline}
            className="px-4 py-2 text-xs text-text-secondary hover:text-text-primary border border-border rounded-lg hover:border-border-light transition-colors"
          >
            Decline
          </button>
          <button
            onClick={onAccept}
            disabled={!scrolledToBottom}
            className="px-4 py-2 text-xs bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            I Accept — Enable NSFW
          </button>
        </div>
      </div>
    </div>
  )
}