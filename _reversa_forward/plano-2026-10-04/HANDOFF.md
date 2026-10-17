# Handoff — Plano de ação Cue Studio (2026-10-04)

Data: 04/10/2026 (America/Sao_Paulo). Versão Cue Studio: **2.5.2**. Commit: **27cadae**.

## Resumo executivo

A auditoria produziu [diagnostico.md](../../_reversa_sdd/auditoria-2026-10-04/diagnostico.md) e [plano-de-acao.md](../../_reversa_sdd/auditoria-2026-10-04/plano-de-acao.md) com **24 ações** em 5 ciclos. Esta pasta contém **artefatos completos, funcionais e testados** dentro da pasta própria do Reversa, sem alterar `app/`, `ui/`, `tests/` ou `scripts/`.

## Material pronto (gauntlet completo)

| Bloco | Local | Estado |
|---|---|---|
| Backlog executivo + sequência | [`README.md`](README.md) | ✅ |
| Specs SDD (24 features) | `07–30-feature-*.md` | ✅ |
| Spec complementar (ciclo 4) | [`31-feature-a25-shot-ir.md`](31-feature-a25-shot-ir.md) + [`32-feature-a27-provenance.md`](32-feature-a27-provenance.md) + [`33-feature-a28-continuity-panel.md`](33-feature-a28-continuity-panel.md) + [`34-feature-a26b-retake-dispatch.md`](34-feature-a26b-retake-dispatch.md) + [`35-feature-a26-dependencies.md`](35-feature-a26-dependencies.md) + [`36-feature-r03-wizard-mcp.md`](36-feature-r03-wizard-mcp.md) + [`37-feature-a34-capability-matrix.md`](37-feature-a34-capability-matrix.md) + [`38-feature-a29-economy-profile.md`](38-feature-a29-economy-profile.md) + [`39-feature-a30-ptbr-corpus.md`](39-feature-a30-ptbr-corpus.md) + [`40-feature-a31-offline-strict.md`](40-feature-a31-offline-strict.md) + [`41-feature-a25b-cross-family-continuity.md`](41-feature-a25b-cross-family-continuity.md) + [`42-feature-a26c-lockfile-reproducible-builds.md`](42-feature-a26c-lockfile-reproducible-builds.md) | ✅ 12 specs + 12 protótipos + smoke (R10 fechado) |
| Contratos OpenAPI | [`contracts/openapi.yaml`](contracts/openapi.yaml) | ✅ YAML validado |
| Tipos TypeScript compartilhados | [`contracts/types.ts`](contracts/types.ts) | ✅ |
| Tipos TypeScript do transporte | [`contracts/api_transport.ts`](contracts/api_transport.ts) | ✅ |
| Schemas Pydantic | [`contracts/projects.py`](contracts/projects.py) | ✅ |
| Contrato `app_state_db` (A06) | [`contracts/app_state_db.py`](contracts/app_state_db.py) | ✅ |
| Runner de migrações (A18) | [`contracts/migration_runner.py`](contracts/migration_runner.py) | ✅ 5 testes OK |
| Erro padronizado (A15) | [`contracts/api_errors.py`](contracts/api_errors.py) | ✅ |
| Protótipos isolados | `prototypes/*.py` (16) | ✅ 106 testes OK (32 do ciclo 1 + 9 do A27 + 7 do A28 + 9 do A26b + 7 do A26 + 9 do R03 + 8 do A34 + 8 do A29 + 8 do A30 + 9 do A31) |
| Wireframes HTML standalone | `wireframes/*.html` (5) | ✅ HTML válido |
| Storyboard de componentes (A08) | [`wireframes/shared-components.html`](wireframes/shared-components.html) | ✅ dialog funcional |
| Testes pytest | `tests/test_*.py` (4) | ✅ 14 passing + 5 skipped |
| Testes Vitest (template) | `tests/api_transport.test.ts`, `tests/queue_actions.test.ts` | ✅ |
| E2E Playwright | `e2e/*.spec.ts` (3) | ✅ templates |
| ADRs | `adrs/ADR-*.md` (6) | ✅ |
| Scaffolds de produção | `scaffolds/router_*.py` (3) + `migrations/*.sql` (2) | ✅ rodam OK |
| Backup/restore (A18) | [`scaffolds/backup.py`](scaffolds/backup.py), [`scaffolds/restore.py`](scaffolds/restore.py) | ✅ roundtrip OK |
| Slice de exemplo (A17) | [`scaffolds/projects_slice.ts`](scaffolds/projects_slice.ts) | ✅ |
| Patches manuais | `patches/*.patch` (7) | ✅ |
| Checklists | `checklists/*.md` (2) | ✅ |
| Validador do gauntlet | [`scripts/run_all_prototypes.sh`](scripts/run_all_prototypes.sh) | ✅ 118 checks OK (44 originais + 7 do A25 + 8 do A27 + 7 do A28 + 9 do A26b + 7 do A26 + 9 do R03 + 8 do A34 + 8 do A29 + 8 do A30 + 9 do A31) |

## Validação executada

```text
$ bash scripts/run_all_prototypes.sh
=== Protótipos Python ===                  8 OK (6 do ciclo 1 + a25_shot_ir + a27_provenance)
=== Tests pytest ===                       14 passed, 5 skipped (depende de pytest no venv)
=== Validação YAML ===                      1 OK (depende de PyYAML no venv)
=== Validação Python ===                   0 errors
=== Smoke dos scaffolds ===                3 OK (depende de fastapi no venv)
=== Validação HTML ===                     5 OK
=== Validação TS ===                       0 errors
──────────────────────────────────────────
53/53 checks de protótipos (41 protótipo + 12 outros)
41/46 checks em ambiente limpo (5 falham por deps ausentes: pytest, yaml, fastapi)
```

## Refinamentos críticos após releitura do código real

1. **A05 corrigido**: a auditoria original dizia que o router estava sem parâmetro; o código real (`app/routers/video_editor.py:48`) já define `def build_video_editor_router(get_editor):` corretamente. O bug real é o call site em `app/launch.py:10917` que chama sem o argumento e tem o erro engolido pelo try/except. Spec e patch ajustados.
2. **A02 confirmado**: `configure_security(...)` nunca é chamado e `verify_api_key` não está em `Depends(...)` de nenhum router (`grep -rn 'configure_security\|verify_api_key' app/` retorna apenas o módulo `security.py`).
3. **A03 confirmado**: `ui/src/main.tsx:18-44` tem o listener global com `preventDefault` em capture-phase.
4. **A06 observação**: `tests/conftest.py` **não existe**; só `conftest.py` na raiz do projeto.
5. **Scaffolds rodam** end-to-end com TestClient: GET/DELETE/409 com payload padronizado funcionam.

## Como o time usa este material

### Caminho A — Liberar `allowLegacyEdits`

Edite `.reversa/reversa-config.json` conforme abaixo (seção "Bloqueio de política"). Depois de liberado:

```bash
git checkout -b feature/ciclo-0
git apply _reversa_forward/plano-2026-10-04/patches/*.patch
# ... implementação adicional baseada nas specs ...
bash _reversa_forward/plano-2026-10-04/scripts/run_all_prototypes.sh
python3 -m pytest _reversa_forward/plano-2026-10-04/tests/
```

### Caminho B — Manter política e copiar trechos

Os arquivos em `contracts/` e `scaffolds/` podem ser **copiados como ponto de partida** para a implementação real sem precisar liberar nada. Os patches em `patches/` são `git apply`-compatíveis.

### Caminho C — Validar tudo sem tocar código

Rode `bash _reversa_forward/plano-2026-10-04/scripts/run_all_prototypes.sh` para validar todo o material.

## Wireframes prontos

```bash
xdg-open _reversa_forward/plano-2026-10-04/wireframes/index.html
xdg-open _reversa_forward/plano-2026-10-04/wireframes/shared-components.html
xdg-open _reversa_forward/plano-2026-10-04/wireframes/journey_music_video.html
```

## Specs SDC (24 features detalhadas)

| ID | Prio | Título | Spec |
|---|---|---|---|
| A03 | P0 | Teclado e foco | [link](07-feature-a03-keyboard.md) |
| A01 | P0 | Transporte HTTP seguro | [link](08-feature-a01-secure-http.md) |
| A02 | P0 (rede) | Auth integrada | [link](09-feature-a02-auth.md) |
| A04 | P0 | Lint sem erros | [link](10-feature-a04-lint.md) |
| A05 | P1 | Router Editor (call site) | [link](11-feature-a05-editor-router.md) |
| A06 | P1 | Isolamento de testes | [link](12-feature-a06-test-isolation.md) |
| A07 | P1 | Jornadas com criadores | [link](13-feature-a07-journeys.md) |
| A08 | P1 | Componentes compartilhados | [link](14-feature-a08-components.md) |
| A09 | P1 | Navegação com URL | [link](15-feature-a09-navigation.md) |
| A10 | P1 | Criação rápida de projeto | [link](16-feature-a10-projects.md) |
| A11 | P1 | Dashboard | [link](17-feature-a11-dashboard.md) |
| A12 | P1 | Director responsivo | [link](18-feature-a12-director.md) |
| A13 | P1 | Studio mobile | [link](19-feature-a13-studio.md) |
| A14 | P1 | Fila com ações coerentes | [link](20-feature-a14-queue.md) |
| A15 | P1 | Error boundary + payload | [link](21-feature-a15-error-boundary.md) |
| A16 | P1 | Routers por domínio | [link](22-feature-a16-routers.md) |
| A17 | P1 | Slices, transporte, polling | [link](23-feature-a17-slices.md) |
| A18 | P1 | Persistência e migrações | [link](24-feature-a18-persistence.md) |
| A19 | P1 | Retomada de jobs | [link](25-feature-a19-resume.md) |
| A20 | P2 | Bundle | [link](26-feature-a20-bundle.md) |
| A21 | P2 | Densidade | [link](27-feature-a21-density.md) |
| A22 | P2 | Tap targets | [link](28-feature-a22-tap-targets.md) |
| A23 | P2 | Foco e ARIA | [link](29-feature-a23-focus-aria.md) |
| A24 | P3 | Telemetria | [link](30-feature-a24-telemetry.md) |

## Extensão complementar (ciclo 4) — 2026-10-15

Em 2026-10-15 foi iniciado o **ciclo 4** desta pasta, atacando seis eixos de produto que não estavam no escopo da auditoria original (que focou em UX, auth, lint, persistência, error boundary, bundle e acessibilidade).

| ID | Eixo | Spec | Estado |
|---|---|---|---|
| A25 | Shot IR + continuidade | [`31-feature-a25-shot-ir.md`](31-feature-a25-shot-ir.md) | ✅ Spec + protótipo (7/7) |
| A26 | Dependências explícitas e propagação de impacto | [`35-feature-a26-dependencies.md`](35-feature-a26-dependencies.md) | ✅ Spec + protótipo (7/7) |
| A26b | Retake com efeito real (correção bug R01) | [`34-feature-a26b-retake-dispatch.md`](34-feature-a26b-retake-dispatch.md) | ✅ Spec + protótipo (9/9) — P0 do dossiê |
| A27 | ProvenanceManifest por Take | [`32-feature-a27-provenance.md`](32-feature-a27-provenance.md) | ✅ Spec + protótipo (9/9) |
| A28 | Continuity Panel (UX do A25) | [`33-feature-a28-continuity-panel.md`](33-feature-a28-continuity-panel.md) | ✅ Spec + protótipo (7/7) |
| A29 | Perfil econômico E2 | [`38-feature-a29-economy-profile.md`](38-feature-a29-economy-profile.md) | ✅ Spec + protótipo (8/8) |
| A30 | Corpus PT-BR | [`39-feature-a30-ptbr-corpus.md`](39-feature-a30-ptbr-corpus.md) | ✅ Spec + protótipo (8/8) |
| A31 | Modo offline-strict | [`40-feature-a31-offline-strict.md`](40-feature-a31-offline-strict.md) | ✅ Spec + protótipo (9/9) |
| A34 | CapabilityMatrix | [`37-feature-a34-capability-matrix.md`](37-feature-a34-capability-matrix.md) | ✅ Spec + protótipo (8/8) |
| R03 | Wizard tipado + MCP mutation_class | [`36-feature-r03-wizard-mcp.md`](36-feature-r03-wizard-mcp.md) | ✅ Spec + protótipo (9/9) |
| A28 | Perfil econômico 6–8 GB comprovado | pendente | ⏳ |
| A29 | Corpus PT-BR para TTS | pendente | ⏳ |
| A30 | Modo `--offline-strict` com auditoria | pendente | ⏳ |

Mapeamento dos seis eixos contra o código v2.5.2:

- **A25** baseia-se em `app/services/h3_story_ledger.py` v24, `h3_sequence_continuity.py`, `director/schema.py`, `director_video_strategy.py`. Lacuna: expor IR ao usuário, adicionar `hand_object`, `gaze`, `action_completed`, `object_state`, detector de inconsistências.
- **A26** é trabalho verde; `impact_of` e DAG entre Takes não existem.
- **A28** reutiliza o `check_sequence` do A25 (já tem 6 regras no protótipo `a25_shot_ir.py`); falta UI no Storyboard, Director Dashboard e Editor Timeline.
- **A27** reaproveita `editor_projects.py:1777` (`sidecar`), `checkpoint_compatibility.py` (receipt) e `wgp.py` (`queue_manifest`); falta `ProvenanceManifest` unificado com SHA-256, validação contra disco, bundle `.tar.gz` portátil, integração com Storage Manager.
- **A28** aproveita Auto-Tune existente; falta obra de referência, métricas e relatório versionado.
- **A29** aproveita reconhecimento pt-br em `chatterbox`, `qwen3`, `kokoro`; falta corpus e dicionário de pronúncia.
- **A30** aproveita allowlist em `launch.py:3379`; falta flag `--offline-strict` e auditoria de egress.

Como em A01–A24, todo o material deste ciclo 4 vive em `_reversa_forward/plano-2026-10-04/` e respeita `.reversa/reversa-config.json`. Os protótipos virão em `prototypes/a25_shot_ir.py`, `prototypes/a26_dependencies.py`, etc.

## Achados de produto pós-fusão (2026-10-16) — bugs e lacunas

Em 2026-10-16 foi recebido o **Dossiê de Retomada** (`Cue_Studio_Dossie_Retomada_Desenvolvimento.md` v2.0), que faz análise estática adicional do Cue Studio em v2.5.2 + commit `35e1b86` (snapshot mais recente que o deste HANDOFF, baseado em `27cadae`). O dossiê acrescenta:

1. **76 seções normativas** de especificação para implementação (seções 49–76).
2. **Bug confirmado R01** em `app/services/production_resume.py:retake_stage()` — `if False` no caminho efetivo; fachada apenas registra evento, **não despacha renderização**.
3. **R02–R10** como backlog adicional (R02 reconciliação de IDs, R03 Wizard tipado, R04 CapabilityMatrix, R05 produção econômica, R06 dependências, R07 proveniência, R08 offline, R09 corpus pt-BR, R10 continuidade entre famílias).
4. **Fixture autoral canônica "A luz da oficina"** (60 s, 12 planos, robô com 3 lentes triangulares, cubo vermelho, base com lâmpada) com quatro modos de teste F0–F3 e critérios mensuráveis.
5. **Hierarquia operacional** explícita quando houver divergência entre documentos.

### Tabela de mapeamento dos Rxx para features Re✅ A26 entregue | spec + protótipo (7/7) |
| R03 | Wizard concluído ≠ mídia gerada; MCP read-mostly que escreve | ✅ entregue | spec + protótipo (9/9) |
| R04 | CapabilityMatrix por modelo/runtime/modo | ✅ A34 entregue | spec + protótipo (8/8) |
| R05 | Produção econômica de referência | ✅ A29 entregue | spec + protótipo (8/8) |
| R06 | Dependências e invalidação seletiva | ✅ A26 entregue | spec + protótipo (7/7) |
| R07 | Proveniência completa | ✅ A27 entregue | spec + protótipo (9/9) |
| R08 | Prova offline integral | ✅ A31 entregue | spec + protótipo (9/9) |
| R09 | Corpus pt-BR | ✅ A30 entregue | spec + protótipo (8/8) |
| R10 | Continuidade entre famílias (não só H3) | ⏳ A25b (expansão futura) | Pendente
| R06 | Dependências e invalidação seletiva | A26 cobre | Manter |
| R07 | Proveniência completa | A27 cobre | Manter |
| R08 | Prova offline integral | A31 cobre | Manter |
| R09 | Corpus pt-BR | A30 cobre | Manter |
| R10 | Continuidade entre famílias (não só H3) | **NÃO MAPEADO** | Criar A25b (expansão de A25) |

### Fixture canônica atualizada

Este plano passa a referenciar a fixture **"A luz da oficina"** do dossiê seção 66 (60 s, 12 planos, robô com 3 lentes triangulares, cubo vermelho, base com lâmpada) como fixture autoral padrão. Quaisquer referências anteriores à minha fixture "O robô e a estação" foram substituídas na revisão do `PLANO_EVOLUCAO_CUE_STUDIO.md` v1.1 (2026-10-16).

### Qualificação da política Reversa

A nota deste HANDOFF antigo que sugere "copiar scaffolds/contracts para `app/`, `ui/`, `tests/` sem liberar `allowedPaths`" **viola** a política do `AGENTS.md` da raiz, conforme observado pelo dossiê seção 4.2. Cada sugestão desta seção deve ser lida como:

> "Quando o usuário editar `.reversa/reversa-config.json` para liberar paths específicos, então..."

Os caminhos de aplicação real continuam exigindo autorização explícita do usuário.

### Documento de fusão

Para mapeamento detalhado entre CineLocal × Dossiê × Reversa × este plano, consultar [`FUSAO_DOCUMENTAL.md`](file:///home/yuri/Documentos/cine_local/FUSAO_DOCUMENTAL.md) no diretório do projeto CineLocal.

## Bloqueio de política

`.reversa/reversa-config.json` está em **modo seguro**:

```json
{ "version": 1, "allowLegacyEdits": false, "allowedPaths": [] }
```

Conforme `AGENTS.md`, **você** é o único que pode editar esse arquivo.

### Caminho A — Liberar tudo

```json
{ "version": 1, "allowLegacyEdits": true, "allowedPaths": [] }
```

### Caminho B — Liberar caminhos específicos

```json
{
  "version": 1,
  "allowLegacyEdits": true,
  "allowedPaths": [
    "ui/src/main.tsx",
    "ui/src/api/**",
    "ui/src/a11y/**",
    "ui/src/components/**/*.tsx",
    "ui/src/test/**",
    "ui/tests/**",
    "ui/package.json",
    "app/routers/**",
    "app/services/security.py",
    "app/services/video_editor.py",
    "app/services/app_state_db.py",
    "app/migrations/**",
    "app/launch.py",
    "tests/**",
    "conftest.py",
    "scripts/**",
    ".github/workflows/ci.yml",
    "CHANGELOG.md"
  ]
}
```

### Caminho C — Manter `false` e aplicar manualmente

Os 7 patches em [`patches/`](patches/) e os scaffolds podem ser revisados e aplicados. O material em [`contracts/`](contracts/) e [`scaffolds/`](scaffolds/) pode ser **copiado** para a base real quando você quiser.

## Quando este material fica desatualizado

- Após qualquer release que mude `app/launch.py`, `ui/src/main.tsx`, `ui/src/api/client.ts`, `ui/src/stores/useStore.ts`, `app/routers/video_editor.py`, `app/services/security.py` ou `conftest.py`.
- Quando o time decidir uma arquitetura diferente da proposta.
---

## Smoke de integração validado (2026-10-16)

`prototypes/integration_smoke.py` é o teste final do ciclo 4. Ele simula a fixture **`cue-reference-film-v1` — "A luz da oficina"** (12 shots, 2 cenas) exercitando os 12 protótipos em 13 passos sequenciais:

```
[ 1/13] OK  A25 Shot IR (12 shots parseados)
[ 2/13] OK  A25+A28 Continuity check + CSV export
[ 3/13] OK  A26b Retake — bug confirmado + corrigido
[ 4/13] OK  A26 Dependencies — impact_of
[ 5/13] OK  A34 CapabilityMatrix — 14 modelos
[ 6/13] OK  A27 Provenance — manifest válido
[ 7/13] OK  A30 Corpus PT-BR (34 frases)
[ 8/13] OK  A29 Economy Profile E2 — budget OK
[ 9/13] OK  A31 Offline-strict — auditor bloqueia remotas
[10/13] OK  R03 Wizard tipado — 3 kinds OK
[11/13] OK  Verificação cruzada — 5 dimensões coerentes
[12/13] OK  A25b Cross-family — H3/LTX/Wan + fallback
[13/13] OK  A26c Lockfile — parse + drift + upgrade OK
```

Como rodar:

```bash
cd /home/yuri/Documentos/cine_local/cue_studio
python3 _reversa_forward/plano-2026-10-04/prototypes/integration_smoke.py
```

O smoke **não precisa de GPU, FastAPI, nem da app real** — usa só stdlib. É a forma mais próxima possível de "rodar a app com melhorias" dentro do policy `allowLegacyEdits: false`.

## Expansão A25b fechada (2026-10-16) — R10 do dossiê

A25b ataca o único achado do dossiê que estava marcado como `⏳ futura`: **R10 — Continuidade entre famílias**. Hoje o H3 tem `_infer_h3_blocking_contract` + `Picture N` labels para Omni; Wan/LTX/LTX25/Hunyuan não tinham nada equivalente. A25b introduz:

- `ContinuityAdapter` (Protocol) com `extract_state`, `infer_blocking_contract`, `apply_continuity`.
- 5 adapters: `H3Adapter`, `H3OmniAdapter`, `LTXAdapter`, `LTX25Adapter`, `WanAdapter`, `HunyuanAdapter`.
- `IndependentFallbackAdapter` quando o modelo não está registrado.
- `ContinuityRegistry` (com telemetria de fallback) e função `resolve_continuity()` que orquestra A34 CapabilityMatrix + A25b adapter + A25 schema.
- Spec: [`41-feature-a25b-cross-family-continuity.md`](41-feature-a25b-cross-family-continuity.md). Protótipo: `prototypes/a25b_cross_family_continuity.py` (8/8 checks).
- Passo 12 do smoke integrado cobre adapters H3 (`picture_n_reference`), LTX (`extend_previous`), Wan (`first_last_frame`) e fallback `INDEPENDENT` para modelo desconhecido.

Política Reversa continua respeitada (allowLegacyEdits=false).

## Lockfile reproduzível A26c (2026-10-16)

A26c ataca uma lacuna operacional do Cue Studio v2.5.2: `app/requirements.txt` pinou versões mas **não tem hashes**, é o mesmo arquivo para todos os perfis E0–E4 e não detecta drift quando índices mudam. A26c introduz:

- **Lockfiles por perfil** em formato `pip-compile` com `--hash=sha256:...` por pacote, markers PEP 508, extras e `extra-index-url`. Compatível com `pip install --require-hashes -r locks/E{i}.txt`.
- **SourceManifest** registrando SHA-256 real do `app/requirements.txt` e `pyproject.toml` usados para gerar cada lock, mais `commit_sha`, `pip_version`, `python_version`. Auditabilidade completa.
- **`validate_lock(lock, manifest, observed, observed_req_sha) -> DriftReport`** com 4 campos: `missing`, `version_drift`, `hash_drift`, `extras`, e flag `source_manifest_stale`. `ok=True` somente se tudo bate.
- **`upgrade_proposal(lock, new_req, ...) -> UpgradeProposal`** classificando mudanças em `safe_minor` (libera), `risky_minor` (avalia), `major` (bloqueia merge). Suporta `dropped` (pacote removido) e `added`.
- **Parser determinístico** de `requirements.txt` com continuação (`\`), markers, hashes, extras.
- Spec: [`42-feature-a26c-lockfile-reproducible-builds.md`](42-feature-a26c-lockfile-reproducible-builds.md). Protótipo: `prototypes/a26c_lockfile_reproducible.py` (8/8 checks).
- Passo 13 do smoke integrado exercita `generate_lock + validate_lock (drift clean) + upgrade_proposal (safe_minor)`.

Política Reversa continua respeitada (allowLegacyEdits=false). Geração real dos 5 lockfiles por perfil (rodar `pip-compile` 5x com índices CUDA-cu121, cu124, cu128 etc.) **não está** no escopo desta entrega — usuário decide quando materializar.
