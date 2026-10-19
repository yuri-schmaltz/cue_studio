> **Retificação — 19/10/2026:** os números abaixo pertencem ao relato histórico de 18/10. A alegação “F2 IA completa (2/2)” não comprova geração por todos os modelos: o teste antigo aceitava fallbacks sintéticos e sua etapa de voz gerava tons. A nova validação usa jobs reais do Studio, reprova falhas de inferência e separa medição técnica de revisão artística vinculada ao hash do master. Consulte `docs/CURRENT_STATE.md` e `docs/REFERENCE_FILM_VALIDATION.md`. As antigas verificações F3 por estado foram substituídas/complementadas por testes de encerramento real de processo, cancelamento concorrente, publicação atômica e bloqueio de referência removida.

# Resumo Gauntlet — Cue Studio (2026-10-18)

## Fases Reversa concluídas
`reconhecimento`, `escavacao`, `interpretacao`, `geracao`, `revisao` — todas marcadas em `.reversa/state.json` (`pending=[]`).

## P0 (bugs críticos)
- A01 transporte HTTP com allowlist (`ui/src/api/transport.ts`)
- A02 auth integrada ao boot (`app/launch.py`: `configure_security()`, `require_auth` em 0.0.0.0)
- A03 remoção do listener global de `Tab` (`ui/src/main.tsx`)
- A04 lint 0 erros (8 arquivos UI)
- A05 router do editor montado (`build_video_editor_router(get_editor=...)`)
- A26b/R01 retake com efeito real + idempotência (`app/services/production_resume.py`)

## P1 (UX + backend)
- A06 isolamento de testes (DB/cache em tmp_path, Vitest entrypoint)
- A08 componentes compartilhados (AppDialog, fields, Button, StatusBadge, ErrorState, EmptyState)
- A09 navegação com projeto persistente + URL
- A15 ErrorBoundary por seção + `ApiError` padronizado
- A16 routers por domínio (workspaces extraído, 0 rotas perdidas)
- A17 contratos/slices/transport/polling separados
- A18 matriz de persistência + migrações idempotentes + backup/restore
- A19 retomada de jobs após reinício (`/api/v1/queue`, 3 níveis de idempotência)

## Ciclo 4 (produto)
- A25 Shot IR + detector de inconsistências (6 regras)
- A25b continuidade cross-família (H3/H3Omni/LTX/LTX25/Wan/Hunyuan + fallback)
- A26 dependências explícitas + propagação de impacto
- A26b retake com efeito real (P0)
- A26c lockfile reproduzível por perfil (infra + parser + validate/upgrade)
- A27 ProvenanceManifest por Take (SHA-256 + tamper detection)
- A28 Continuity Panel (UI)
- A29 perfil econômico E2
- A30 corpus PT-BR
- A31 modo `--offline-strict` + auditoria de egress
- A34 CapabilityMatrix por modelo/runtime/modo
- R03 Wizard tipado + MCP mutation_class

## Obra de referência "A luz da oficina"
- F0 determinístico (8/8 critérios) — commit `d977869`
- F1 híbrido (mídia congelada + jobs reais) — `tests/test_cue_reference_film_f1_hybrid.py` (6/6)
- F2 IA completa — `tests/test_cue_reference_film_f2_real_models.py` (2/2, GPU RTX 3060)
- F3 recuperação (crash/cancelamento/reinício/retake) — `tests/test_cue_reference_film_f3_recovery.py`

## Métricas finais
- `pytest tests/`: 923 passed, 4 skipped, 62 deselected, 0 falhas
- `ui`: lint 0 erros, build ✓, vitest 187/187
- `integration_smoke.py`: 13/13 PASS
- bundle principal: 888.90 kB → 199.28 kB (-77.6%)
- working tree: limpo

## Itens deliberadamente fora de escopo
- Geração real dos 5 lockfiles com hashes (requer `pip-compile` por perfil, 15–45 min cada; infra pronta)
- `start.sh --offline-strict` integrado (flag + env já funcionam na CLI)
- Artefatos textuais detalhados das 73 fases Reversa (skill `/reversa` pode gerá-los sob demanda)
- F2 com modelos reais executado com sucesso (2/2) — GPU 12 GB suficiente com fallbacks
