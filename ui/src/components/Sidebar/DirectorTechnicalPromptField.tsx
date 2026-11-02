import { Wand2 } from 'lucide-react'
import { useStore } from '../../stores/useStore'

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
 * The field is always visible and always the same size. It used to be
 * collapsible, which meant the direction that applies to the whole film
 * was hidden behind a chevron — easy to forget while writing the
 * scenes. It used to grow with its content too, which pushed the scene
 * script around as the user typed. Both are gone: the block is a fixed
 * presence above the script.
 */
export function DirectorTechnicalPromptField() {
  const value = useStore(s => s.directorTechnicalPrompt)
  const setValue = useStore(s => s.directorSetTechnicalPrompt)

  const hasContent = value.trim().length > 0

  return (
    <section
      className="shrink-0 rounded-lg border border-border bg-bg-tertiary overflow-hidden"
      data-testid="director-technical-prompt"
    >
      <header className="flex items-center gap-1.5 px-3 py-2">
        <Wand2 size={13} className="text-text-muted shrink-0" />
        <span className="text-xs text-text-muted uppercase tracking-wider font-semibold truncate">
          Prompt técnico
        </span>
        {!hasContent && (
          <span className="text-2xs text-text-muted font-normal truncate ml-1 normal-case tracking-normal">
            fps, material, iluminação — vale para todas as cenas
          </span>
        )}
      </header>

      <div className="px-3 pb-3 flex flex-col gap-2">
        <p className="text-2xs text-text-muted leading-relaxed">
          A direção técnica do filme inteiro: taxa de quadros, material, iluminação,
          técnica de câmera, personagens e o fade final. Este bloco é aplicado a
          todos os clipes, enquanto as cenas ficam vinculadas ao trecho da música
          que descrevem.
        </p>
        <textarea
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder={'A cinematic 12-15 fps stop-motion claymation video, hand-crafted plasticine aesthetic with visible fingerprints, warm studio lighting with dramatic chiaroscuro, natural camera shake, cinematic fade-out to black at the end.'}
          rows={4}
          aria-label="Prompt técnico"
          data-testid="director-technical-prompt-input"
          className="w-full h-[120px] shrink-0 bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:border-accent-blue transition-colors scrollbar-visible"
        />
      </div>
    </section>
  )
}
