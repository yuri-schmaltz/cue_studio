# Plano de Migração — HocusPocus → Cue Studio

**Data:** 2026-09-28
**Origem:** `github.com/IAnMove/hocuspocus` (Pinokio clone em `~/Aplicativos/pinokio/api/hocuspocus.git/`, `VERSION=0.9.0`, branch `main`)
**Destino:** `github.com/yuri-schmaltz/cue_studio` (v2.1.4, branch `main`, HEAD `89e3cdf`)

> Escopo: portar **capacidades** (não código literal). Cada item abaixo indica o "delta funcional", a complexidade estimada e os pontos de contato já existentes no Cue Studio. Tudo é incremental, isolável em PRs e cada fase deve manter a build (`tsc -b && vite build`) verde e os testes (`pytest -q`) passando.

---

## 0. Princípios da migração

1. **Não copiar tudo.** Selecionar apenas o que cabe na filosofia do Cue Studio (hardening, Director maduro, runtime resiliente). Evitar bolha de features.
2. **Aproveitar overlaps.** Onde já temos código equivalente, portar **apenas o delta funcional** (ex.: MCP server já não precisa de implementação de tokens do zero — `services/security.py` já tem allowlist).
3. **MCP server próprio.** Implementação nossa, não dependência da lib `mcp` upstream (que ainda não está em `app/requirements.txt`). Streamable-HTTP + JSON-RPC manual é viável.
4. **Versionamento independente.** Cada PR é uma minor bump (2.2.0 → 2.3.0 → ...) com changelog próprio.
5. **Manter `install.sh` + Pinokio coexistindo.** Já temos o wrapper (`cue-studio-install-sh.md` na memória de usuário); não introduzir dependência exclusiva de Pinokio.
6. **Cobertura de testes obrigatória.** Toda feature portada traz testes (pytest + smoke do UI), seguindo o padrão dos 42 testes existentes em `tests/`.

---

## 1. Inventário HocusPocus vs Cue Studio (resumo)

| Domínio | HocusPocus (LOC) | Cue Studio (LOC) | Delta |
|---|---:|---:|---|
| Director pipeline | 13.925 | 8.151 | Produção persistente (production_run) |
| LLM service + router | ~3.000 (consolidado) | 7.423 + 318 | Wizard / MCP |
| Editor (Video Editor) | 652 | — | Não temos |
| World 3D / procedural | 25 + hunyuan3d/ + procedural_3d/ | — | Não temos |
| Character Kits | 302 (lib) + 7 arquivos | — | Não temos |
| Story / Series / Scenes | story 353 + series 100 + ~15 arquivos | — | Não temos |
| Wizard workflows | 283 + 3 arquivos | — | Não temos |
| MCP server | `routers/core_mcp.py` + `routers/wangp_mcp.py` + `mcp_access.py` (63) | — | **Não temos** |
| Job/task registry | `task_manager.py` 1.091 + `durable_generation_queue.py` 122 + `task_command_admission.py` | `job_lifecycle.py` 454 + `app_state_db.py` 452 | Cobertura parcial |
| Total UI TSX/TS | 175.419 (965 arquivos) | 66.573 (170 arquivos) | ~3× maior |

**Conclusão:** HocusPocus é um **fork de feature-complete**; Cue Studio é um **fork endurecido**. Migração focada = **pegar 4-5 capacidades** que casam com nossa direção.

---

## 2. Roadmap de migração (5 fases)

### Fase A — MCP Server (CURTO PRAZO, alto impacto) ⭐ prioridade 1

**Capacidade:** expor Director, gallery e generation a agentes externos (Cursor, Cline, Claude Code, scripts) via MCP streamable-HTTP + Bearer token.

**Origem HocusPocus:**
- `app/routers/core_mcp.py` (router FastAPI)
- `app/routers/wangp_mcp.py` (router FastAPI — alias legado)
- `app/services/mcp_access.py` (63 LOC, token + status)
- `app/services/lan_auth.py` (allowlist `/api/v1/mcp`)

**Cue Studio já tem:**
- `services/security.py` (allowlist de paths + Bearer token middleware — verificar)
- `services/llm_router.py` (multi-role, já roteia por capability)
- `services/director_pipeline.py` (entry point `POST /api/v1/director/pipeline/start`)

**Plano de implementação:**

| Etapa | Arquivo novo | LOC estimado | Teste |
|---|---|---:|---|
| A1. Auth + allowlist | `app/services/mcp_access.py` | ~80 (port direto + adaptar p/ `CUE_MCP_TOKEN`) | `tests/test_mcp_access.py` |
| A2. JSON-RPC dispatcher | `app/services/mcp_dispatcher.py` | ~200 (initialize, tools/list, tools/call, ping) | `tests/test_mcp_dispatcher.py` |
| A3. Tools registry | `app/services/mcp_tools.py` | ~300 (wrappers sobre Director, gallery, generation) | `tests/test_mcp_tools.py` |
| A4. Router FastAPI | `app/routers/mcp.py` | ~120 (POST/GET `/api/v1/mcp`) | `tests/test_mcp_router.py` |
| A5. Wire em `launch.py` | edit | +5 linhas (include_router + middleware) | smoke 200 no `/api/v1/mcp` |
| A6. UI settings toggle | `ui/src/components/SettingsDrawer/McpSettings.tsx` | ~150 | smoke UI |
| A7. `HOCUS_MCP_TOKEN` → `CUE_MCP_TOKEN` (env) + rotação | edit `services/mcp_access.py` | já previsto em A1 | coberto em A1 |
| A8. Documentação | `docs/MCP_SERVER.md` | ~100 | manual |

**Tools a expor (subset inicial):**
- `director_start_pipeline` → wrapper de `POST /api/v1/director/pipeline/start`
- `director_list_pipelines` → wrapper de `GET /api/v1/director/pipelines`
- `director_cancel_pipeline` → wrapper de `POST /api/v1/director/pipeline/{pid}/cancel`
- `gallery_list` → wrapper de `GET /api/v1/gallery`
- `llm_enhance_prompt` → wrapper de `POST /api/v1/llm/enhance-prompt`
- `llm_test_connection` → wrapper de `POST /api/v1/llm/test`
- `system_capabilities` → wrapper de `GET /api/v1/system-config` + `runtime-capabilities`

**Esforço:** ~1.000 LOC Python + ~150 LOC UI. **1-2 sprints pequenos.**
**Risco:** baixo — implementação autocontida; toggle off-by-default.
**Dependência:** nenhuma externa (stdlib + FastAPI). Não usar a lib `mcp` upstream.

---

### Fase B — Production Run state machine ⭐ prioridade 2

**Capacidade:** "Productions" — thread persistente do Director que sobrevive a crash do browser, permite retomar uma etapa falha sem reiniciar pipeline. HocusPocus: *"Productions keeps the whole thread so you can resume or retake one shot."*

**Origem HocusPocus:**
- `app/services/production_run.py` (163 LOC, read models — adapter legacy → novo)
- `app/services/task_manager.py` (1.091 LOC, SQLite registry)
- `app/services/durable_generation_queue.py` (122 LOC)
- `app/services/task_command_admission.py` (admission control)
- `app/services/operation_logging.py`

**Cue Studio já tem:**
- `services/job_lifecycle.py` (454 LOC, in-memory atomic state machine)
- `services/app_state_db.py` (452 LOC, SQLite)
- `services/director_pipeline.py` (já tem `_pipelines`, `_pipeline_threads`, repair path)
- feat 9ba6342 ("unify pipeline cancellation")

**Plano de implementação:**

| Etapa | Arquivo | LOC estimado | Teste |
|---|---|---:|---|
| B1. Schema SQLite Production/Run | `app/services/production_store.py` | ~250 (CRUD + schema_version) | `tests/test_production_store.py` |
| B2. Adapter legacy → production | `app/services/production_adapter.py` (port de `production_run.py`) | ~180 | `tests/test_production_adapter.py` |
| B3. Replay & resume | `app/services/production_resume.py` | ~400 (re-aplica plano, retoma da última stage completed) | `tests/test_production_resume.py` |
| B4. UI "Productions" tab | `ui/src/components/DirectorDashboard/Productions.tsx` | ~300 | smoke UI |
| B5. Wire em `director_pipeline.py` | edit | +200 (publish snapshots) | coberto pelos E2E |
| B6. Migrar `app_state_db.py` opcional | edit | +100 (link task ↔ production) | coberto |

**Esforço:** ~1.400 LOC Python + ~300 LOC UI. **2-3 sprints.**
**Risco:** médio — interação com `director_pipeline.py` existente precisa ser cuidadosa (não quebrar E2E `test_director_pipeline_e2e.py`).
**Dependência:** nenhuma externa. SQLite já temos.

---

### Fase C — Wizard / In-app LLM agent ⭐ prioridade 3

**Capacidade:** agente conversacional in-app que interpreta intenção, planeja ações suportadas e chama os mesmos endpoints que os botões.

**Origem HocusPocus:**
- `app/services/wizard_workflows.py` (283)
- `app/services/wizard_conversations.py`
- `app/services/wizard_workflow_executor.py`
- `app/services/wizard_workflow_supervisor.py`

**Cue Studio já tem:**
- `services/llm_router.py` (multi-role — exatamente o que o Wizard precisa)
- `services/llm_service.py` (stream + cancel via feat 6786a84)
- `services/llm_guides/` (grammars GBNF)
- UI Sidebar/DirectorChat (Composer)

**Plano de implementação:**

| Etapa | Arquivo | LOC estimado | Teste |
|---|---|---:|---|
| C1. Tool registry (subset Fase A) | `app/services/wizard_tools.py` | reuso de `mcp_tools.py` | coberto |
| C2. Conversation store | `app/services/wizard_conversations.py` | ~200 | `tests/test_wizard_conversations.py` |
| C3. Workflow supervisor | `app/services/wizard_supervisor.py` | ~250 | `tests/test_wizard_supervisor.py` |
| C4. DirectorChat → Wizard mode | edit `ui/src/components/Sidebar/DirectorChat.tsx` | +200 | smoke UI |
| C5. Endpoint `/api/v1/wizard/chat` | `app/routers/wizard.py` | ~150 | `tests/test_wizard_router.py` |

**Esforço:** ~800 LOC Python + ~200 LOC UI. **2 sprints.**
**Risco:** médio — alucinação do agente é o vetor principal; gramática GBNF por ferramenta atenua.

---

### Fase D — Video Editor (timeline multi-track) ⭐ prioridade 4

**Capacidade:** editor de timeline não-destrutivo (trim, split, reorder) com export FFmpeg.

**Origem HocusPocus:**
- `app/services/video_editor.py` (652)
- `app/services/video_editor_frames.py`
- `app/services/video_editor_time_cards.py`
- `app/services/core_editor.py`

**Cue Studio já tem:**
- feat e0947df ("full video export") — mas é só export, não editor
- Pipeline `director_pipeline.py` já monta clips finais

**Avaliação:** editor multi-track interativo é **grande em UI** (~2.000 LOC TSX). É o módulo que mais justificou o gap de UI (175k LOC HocusPocus vs 66k nosso). Recomendação: **NÃO migrar agora**. Documentar como Fase D2 se a demanda surgir.

**Plano (se aprovado):**

| Etapa | Arquivo | LOC estimado |
|---|---|---:|
| D1. Backend editor state | `app/services/video_editor.py` | ~700 (port direto) |
| D2. UI timeline component | `ui/src/components/Editor/VideoTimeline.tsx` | ~1.000 |
| D3. Multi-track clips | ... | ~800 |
| D4. Export FFmpeg | reuso de `services/director_pipeline.py` | +200 |

**Esforço:** ~2.700 LOC. **4-5 sprints.** Avaliar se queremos competir com Premiere/DaVinci.

---

### Fase E — Story / Series persistence (BAIXA prioridade) ⛔ fase 5+

**Capacidade:** Story Lab (world bible persistente) + Series Lab (episódios com continuidade cross-shot).

**Origem HocusPocus:** ~20 arquivos (`story_library`, `series_*`, `scene_*`, `character_*`).

**Avaliação:** massa crítica muito grande, requer rework do UI todo. **Recomendo NÃO migrar.** A filosofía do Cue Studio é "Director forte + Studio manual", não "world bible persistente". Se a demanda aparecer, avaliar separadamente como produto novo (Cue Studio Stories?).

---

## 3. Cronograma sugerido

| Fase | Duração estimada | PRs | Versão alvo |
|---|---|---|---|
| A — MCP Server | 1-2 sprints (2-4 semanas) | 4-6 PRs | v2.2.0 |
| B — Production Run | 2-3 sprints (4-6 semanas) | 6-8 PRs | v2.3.0 |
| C — Wizard | 2 sprints (4 semanas) | 4-5 PRs | v2.4.0 |
| D — Video Editor | 4-5 sprints (8-10 semanas) | 10-15 PRs | v3.0.0 |
| E — Story/Series | não recomendada | — | — |

**Total realista (A+B+C):** ~3 meses para um único contribuidor; ~1 mês para um time pequeno.

---

## 4. Critérios de aceitação por fase

### Fase A (MCP)
- [ ] `POST /api/v1/mcp` retorna 401 sem token e 200 com token válido
- [ ] `tools/list` retorna ≥7 tools (director_start, director_list, director_cancel, gallery_list, llm_enhance, llm_test, system_capabilities)
- [ ] Toggle off-by-default + UI no Settings
- [ ] Token rotação via UI sem precisar restart
- [ ] Smoke: agente externo (claude-code ou mcp-cli) consegue listar e cancelar pipeline em dev
- [ ] Sem dependência da lib `mcp` upstream
- [ ] Documentação `docs/MCP_SERVER.md` com exemplo curl + exemplo cliente Python

### Fase B (Production Run)
- [ ] Pipeline interrompido por `kill -9` do processo é retomável após restart
- [ ] UI Productions tab mostra pipeline com stages completed/failed/pending
- [ ] Retake de stage individual (sem rerun completo)
- [ ] `tests/test_director_pipeline_e2e.py` continua passando
- [ ] Schema SQLite versionado com migration script

### Fase C (Wizard)
- [ ] "Abrir cena de concerto" → wizard executa load + select layer + sem abortar compositor
- [ ] Cancela ação em flight sem stomp undo
- [ ] Cada tool tem GBNF grammar (reduz alucinação)
- [ ] UI DirectorChat modo Wizard vs Composer coexiste

---

## 5. Riscos e mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| MCP vira surface de ataque (Bearer leak) | Média | Alto | Token rotativo + log de chamadas + allowlist por tool |
| Production Run quebra Director existente | Média | Alto | Feature flag + testes E2E obrigatórios + adapter-only primeiro |
| Wizard alucina tools perigosas | Alta | Médio | GBNF por tool + dry-run mode + confirmation UI |
| Scope creep (fases D, E) | Alta | Alto | Bloquear D/E até A+B+C estabilizados em prod por 1 release |
| Perda de cobertura de testes | Baixa | Médio | Gate CI: pytest deve incluir novos testes |
| Incompatibilidade com `install.sh` wrapper | Baixa | Médio | `install.sh` instala deps stdlib-only; MCP server não exige nada extra |

---

## 6. Métricas de sucesso (3 meses após v2.2.0)

- [ ] Taxa de retomada bem-sucedida de Production Run >80%
- [ ] MCP server sendo usado por ≥3 integrações documentadas (claude-code, mcp-cli, custom script)
- [ ] Wizard reduzindo tempo médio de preparação de cena em 30%
- [ ] 0 regressões em `tests/` (42 testes existentes continuam passando)
- [ ] UI build <10s (atual ~6s — adicionar ~50 LOC deve manter)
- [ ] Documentação completa: `docs/MCP_SERVER.md`, `docs/PRODUCTION_RUN.md`, `docs/WIZARD.md`

---

## 7. Próximos passos imediatos

1. **Revisar este plano** e priorizar (recomendo confirmar Fase A → B → C).
2. **Criar branch `feat/mcp-server`** a partir de `origin/main`.
3. **PR #1**: `services/mcp_access.py` + allowlist (etapas A1 + A5).
4. **PR #2**: `services/mcp_dispatcher.py` + `services/mcp_tools.py` + tests (A2 + A3).
5. **PR #3**: `routers/mcp.py` + smoke 200 (A4).
6. **PR #4**: `McpSettings.tsx` + wiring launch.py (A5 + A6).
7. **PR #5**: `docs/MCP_SERVER.md` (A8).
8. **Tag `v2.2.0`** + atualizar `VERSION` + CHANGELOG.

Cada PR tem seu próprio commit, branch próprio e revertibilidade independente.

---

## 8. Referências

- HocusPocus repo: <https://github.com/IAnMove/hocuspocus>
- HocusPocus Pinokio post: <https://pinokio.coi/posts/01ln3hq3429imwv76rhxjql>
- HocusPocus clone local: `/home/yuri/Aplicativos/pinokio/api/hocuspocus.git/`
- MCP spec: <https://spec.modelcontextprotocol.io/> (transport streamable-HTTP, JSON-RPC 2.0)
- Memória de usuário: `cue-studio-branding-2026-09-22.md`, `cue-studio-install-sh.md`, `cue-studio-merge-policy-2026-09-23.md`
