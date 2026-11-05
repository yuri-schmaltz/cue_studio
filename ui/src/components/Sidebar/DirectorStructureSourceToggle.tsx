import type { ReactNode } from 'react'
import { Film, ListTree, Music4 } from 'lucide-react'
import { useStore } from '../../stores/useStore'

/**
 * Where the clip plan's cut points come from.
 *
 * The Director used to derive every shot boundary from the audio alone
 * (section changes and energy). A time-anchored briefing could then
 * only *decorate* that plan: writing twelve scenes for a 4:15 track
 * still produced a dozen long shots decided by the music, and the
 * script's own sub-segments — the moment-to-moment direction that
 * actually reads like a music video — never became cuts.
 *
 * This control lets the briefing drive the structure:
 *
 * - **Áudio** — the historic behaviour; the music decides the cuts.
 * - **Roteiro** — the briefing's timecodes decide the cuts. The audio
 *   still annotates each shot (section, energy, dominant speaker).
 *
 * Under "Roteiro" the granularity picks what one shot means:
 *
 * - **Cenas** — one shot per `CENA` block.
 * - **Passos** — one shot per sub-segment. This is the music-video
 *   rhythm: a track scripted with twelve scenes and twenty-five
 *   sub-segments yields twenty-five shots instead of twelve.
 *
 * The control is only offered when the briefing actually carries
 * timecodes; without them the script cannot place a cut.
 */
export function DirectorStructureSourceToggle({ children }: { children?: ReactNode }) {
  const source = useStore(s => s.directorStructureSource)
  const granularity = useStore(s => s.directorScriptGranularity)
  const setSource = useStore(s => s.directorSetStructureSource)
  const setGranularity = useStore(s => s.directorSetScriptGranularity)
  const reconciliation = useStore(s => s.directorScriptReconciliation)
  const description = useStore(s => s.directorSceneDescription)
  const loading = useStore(s => s.directorLoading)

  const anchoredScenes = reconciliation?.report.anchored_scene_count ?? 0
  const hasScript = description.trim().length > 0 && anchoredScenes > 0

  if (!hasScript) {
    return (
      <div className="flex flex-col gap-2">
      <p
        className="text-2xs text-text-muted leading-relaxed shrink-0"
        data-testid="director-structure-source-unavailable"
      >
        The cuts follow the audio. To let the script decide the cuts, add
        timecodes to the scenes (e.g. <span className="text-text-secondary">SCENE 1: Opening (0:00 - 0:11)</span>).
      </p>
      {children}
      </div>
    )
  }

  return (
    <div
      className="flex w-full items-center gap-1.5 shrink-0 min-w-0"
      data-testid="director-structure-source"
    >
      {!children && <span className="text-2xs text-text-muted font-medium shrink-0">Cuts:</span>}

      <div className={`flex rounded border border-border overflow-hidden shrink-0 ${children ? 'h-8' : ''}`}>
        <button
          type="button"
          disabled={loading}
          onClick={() => void setSource('audio')}
          className={`px-2 py-0.5 text-2xs font-medium transition-colors disabled:opacity-50 flex items-center gap-1 ${
            source === 'audio'
              ? 'bg-accent-blue text-white'
              : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'
          }`}
          title="The cuts follow the sections and the energy of the music"
          data-testid="director-structure-source-audio"
        >
          <Music4 size={10} />
          Audio
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={() => void setSource('script')}
          className={`px-2 py-0.5 text-2xs font-medium transition-colors disabled:opacity-50 flex items-center gap-1 border-l border-border ${
            source === 'script'
              ? 'bg-accent-blue text-white'
              : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'
          }`}
          title="The script timecodes decide where each cut happens"
          data-testid="director-structure-source-script"
        >
          <Film size={10} />
          Script
        </button>
      </div>

      {children && <div className="flex-1 min-w-0">{children}</div>}

      {source === 'script' && (
        <div className={`order-last ml-auto flex rounded border border-border overflow-hidden shrink-0 ${children ? 'h-8' : ''}`}>
          <button
            type="button"
            disabled={loading}
            onClick={() => void setGranularity('scene')}
            className={`px-2 py-0.5 text-2xs font-medium transition-colors disabled:opacity-50 ${
              granularity === 'scene'
                ? 'bg-accent-blue text-white'
                : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'
            }`}
            title="One cut per scene"
            data-testid="director-script-granularity-scene"
          >
            Scenes
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => void setGranularity('beat')}
            className={`px-2 py-0.5 text-2xs font-medium transition-colors disabled:opacity-50 flex items-center gap-1 border-l border-border ${
              granularity === 'beat'
                ? 'bg-accent-blue text-white'
                : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'
            }`}
            title="One cut per beat (sub-segment) — the music-video rhythm"
            data-testid="director-script-granularity-beat"
          >
            <ListTree size={10} />
            Beats
          </button>
        </div>
      )}

      <span className={children ? 'sr-only' : 'text-2xs text-text-muted flex-1 min-w-0 truncate'}>
        {source === 'script'
          ? `${anchoredScenes} ${anchoredScenes === 1 ? 'scene' : 'scenes'} with timecode`
          : `${anchoredScenes} ${anchoredScenes === 1 ? 'scene' : 'scenes'} in the script`}
      </span>
    </div>
  )
}
