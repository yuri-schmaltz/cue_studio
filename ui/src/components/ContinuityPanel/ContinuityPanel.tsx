/* eslint-disable react-refresh/only-export-components */
import { useEffect, useState } from 'react'
import {
  Eye,
  Shirt,
  Hand,
  DoorOpen,
  CircleDot,
  Users,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react'
import { apiFetch } from '../../api/transport'
import { ensureOk } from '../../api/errors'

export interface ContinuityInconsistency {
  kind: string
  severity: 'info' | 'warning' | 'error'
  shot_id_a: string
  shot_id_b: string
  message: string
  evidence?: Record<string, unknown>
}

export interface ContinuityResponse {
  production_id: string
  shot_count: number
  inconsistencies: ContinuityInconsistency[]
  severity_counts: { info: number; warning: number; error: number }
}

export interface ContinuityPanelProps {
  productionId: string
  onNavigateToShot?: (shotId: string) => void
}

export const KIND_META: Record<string, { icon: typeof Eye; label: string; severity: 'info' | 'warning' | 'error' }> = {
  gaze_flip: { icon: Eye, label: 'Olhar virou 180° entre planos', severity: 'warning' },
  wardrobe_skip: { icon: Shirt, label: 'Figurino mudou sem registro', severity: 'warning' },
  object_hand_jump: { icon: Hand, label: 'Objeto trocou de mão', severity: 'info' },
  object_state_unsupported: { icon: DoorOpen, label: 'Estado de objeto sem ação', severity: 'warning' },
  action_orphan: { icon: CircleDot, label: 'Ação em progresso não concluída', severity: 'warning' },
  position_collision: { icon: Users, label: 'Colisão de posição no frame', severity: 'error' },
}

export const SEVERITY_COLOR: Record<string, string> = {
  info: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
  warning: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  error: 'text-red-400 bg-red-500/10 border-red-500/30',
}

export function severityLabel(severity: string): string {
  if (severity === 'error') return 'Erro'
  if (severity === 'warning') return 'Aviso'
  if (severity === 'info') return 'Info'
  return severity
}

export function ContinuityPanel({ productionId, onNavigateToShot }: ContinuityPanelProps) {
  const [data, setData] = useState<ContinuityResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(check: boolean) {
    if (!productionId) return
    setLoading(true)
    setError(null)
    try {
      const url = `/api/v1/director/productions/${encodeURIComponent(productionId)}/continuity${check ? '/check' : ''}`
      const res = await ensureOk(
        await apiFetch(url, check ? { method: 'POST' } : { method: 'GET' }),
      )
      const body = (await res.json()) as ContinuityResponse
      setData(body)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao carregar continuidade')
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void run(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productionId])

  const counts = data?.severity_counts ?? { info: 0, warning: 0, error: 0 }
  const hasError = (counts.error ?? 0) > 0

  return (
    <section
      className="settings-card"
      aria-label="Painel de continuidade"
      role="region"
    >
      <header className="flex items-center justify-between gap-2 mb-2">
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          <AlertTriangle size={16} aria-hidden="true" />
          Continuidade
        </h3>
        <button
          type="button"
          onClick={() => void run(true)}
          disabled={loading || !productionId}
          className="settings-button settings-button-ghost flex items-center gap-1"
          aria-label="Verificar continuidade"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
          Verificar
        </button>
      </header>

      {loading && <p className="text-xs text-text-muted">Carregando…</p>}
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}

      {!loading && !error && data && data.shot_count === 0 && (
        <p className="text-xs text-text-muted">
          Shot IR não gerado para esta produção — ative em Configurações → Produção.
        </p>
      )}

      {!loading && !error && data && data.shot_count > 0 && (
        <>
          <div className="flex items-center gap-2 mb-2 text-xs">
            <span className={`px-2 py-0.5 rounded border ${SEVERITY_COLOR.info}`}>Info {counts.info}</span>
            <span className={`px-2 py-0.5 rounded border ${SEVERITY_COLOR.warning}`}>Aviso {counts.warning}</span>
            <span className={`px-2 py-0.5 rounded border ${SEVERITY_COLOR.error}`}>Erro {counts.error}</span>
          </div>
          {hasError && (
            <div role="alert" className="mb-2 text-xs text-red-400">
              {counts.error} inconsistência(s) crítica(s) — bloqueia export
            </div>
          )}
          {data.inconsistencies.length === 0 ? (
            <p className="text-xs text-text-muted">Nenhuma inconsistência detectada.</p>
          ) : (
            <ul className="space-y-2">
              {data.inconsistencies.map((inc, idx) => {
                const meta = KIND_META[inc.kind]
                const Icon = meta?.icon ?? AlertTriangle
                const sev = inc.severity || meta?.severity || 'warning'
                return (
                  <li
                    key={`${inc.kind}-${inc.shot_id_a}-${inc.shot_id_b}-${idx}`}
                    className={`border rounded p-2 text-xs ${SEVERITY_COLOR[sev] ?? SEVERITY_COLOR.warning}`}
                  >
                    <div className="flex items-center gap-2 font-medium">
                      <Icon size={14} aria-hidden="true" />
                      <span>{meta?.label ?? inc.kind}</span>
                      <span className="ml-auto opacity-70">{severityLabel(sev)}</span>
                    </div>
                    <p className="mt-1 text-text-secondary">{inc.message}</p>
                    <div className="mt-1 flex items-center gap-2 text-text-muted">
                      <span>{inc.shot_id_a}</span>
                      {inc.shot_id_b && inc.shot_id_b !== inc.shot_id_a && <span>→ {inc.shot_id_b}</span>}
                      {onNavigateToShot && (
                        <button
                          type="button"
                          className="ml-auto underline"
                          onClick={() => onNavigateToShot(inc.shot_id_a)}
                          aria-label={`Abrir shot ${inc.shot_id_a}`}
                        >
                          Ver shot
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
