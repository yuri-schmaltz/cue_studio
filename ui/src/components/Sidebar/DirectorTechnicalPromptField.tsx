import { useState } from 'react'
import { ChevronDown, ChevronRight, Wand2 } from 'lucide-react'
import { useStore } from '../../stores/useStore'
import { AutoResizeTextarea } from './DirectorBriefingColumn'

/**
 * The consolidated technical prompt, in its own field.
 *
 * A screenplay brief carries two different kinds of instruction:
 *
 * - the scenes, each tied to a moment of the track ("CENA 2: Entrada de
 *   Gary (0:11 - 0:28)"), and
 * - the technical direction that holds for the whole film (frame rate,
 *   material, lighting, camera technique, fade-out).
 *
 * Mixing them in one box forces the Director to guess which half applies
 * to a given shot. Splitting them makes the second one unambiguous: it
 * travels with every clip, while the scenes bind to the clip that owns
 * their time range.
 *
 * The field is collapsed by default because most briefs have no
 * technical block, and an empty 150 px textarea would only take space
 * away from the scene script.
 */
export function DirectorTechnicalPromptField() {
  const value = useStore(s => s.directorTechnicalPrompt)
  const setValue = useStore(s => s.directorSetTechnicalPrompt)
  const [open, setOpen] = useState(false)

  const hasContent = value.trim().length > 0

  return (
    <section
      className="shrink-0 rounded-lg border border-border bg-bg-tertiary overflow-hidden"
      data-testid="director-technical-prompt"
    >
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-1.5 px-3 py-2 text-left hover:bg-bg-secondary transition-colors"
        data-testid="director-technical-prompt-toggle"
      >
        {open ? <ChevronDown size={13} className="text-text-muted shrink-0" /> : <ChevronRight size={13} className="text-text-muted shrink-0" />}
        <Wand2 size={13} className="text-text-muted shrink-0" />
        <span className="text-xs text-text-muted uppercase tracking-wider font-semibold truncate">
          Prompt técnico
        </span>
        {hasContent && !open && (
          <span className="text-2xs text-accent-blue font-normal truncate ml-1">
            {value.trim().slice(0, 40)}{value.trim().length > 40 ? '…' : ''}
          </span>
        )}
        {!hasContent && !open && (
          <span className="text-2xs text-text-muted font-normal truncate ml-1 normal-case tracking-normal">
            fps, material, iluminação — vale para todas as cenas
          </span>
        )}
      </button>

      {open && (
        <div className="px-3 pb-3 flex flex-col gap-2">
          <p className="text-2xs text-text-muted leading-relaxed">
            A direção técnica do filme inteiro: taxa de quadros, material, iluminação,
            técnica de câmera, personagens e o fade final. Este bloco é aplicado a
            todos os clipes, enquanto as cenas ficam vinculadas ao trecho da música
            que descrevem.
          </p>
          <AutoResizeTextarea
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder={'A cinematic 12-15 fps stop-motion claymation video, hand-crafted plasticine aesthetic with visible fingerprints, warm studio lighting with dramatic chiaroscuro, natural camera shake, cinematic fade-out to black at the end.'}
            rows={4}
            minHeight={110}
            maxHeight={220}
            aria-label="Prompt técnico"
            data-testid="director-technical-prompt-input"
            className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:border-accent-blue transition-colors scrollbar-visible"
          />
        </div>
      )}
    </section>
  )
}
