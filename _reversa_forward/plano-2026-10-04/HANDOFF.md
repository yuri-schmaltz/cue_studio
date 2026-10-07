# Handoff — Plano de ação Cue Studio (2026-10-04)

Data: 04/10/2026 (America/Sao_Paulo). Versão Cue Studio: **2.5.2**. Commit: **27cadae**.

## Resumo executivo

A auditoria produziu [diagnostico.md](../../_reversa_sdd/auditoria-2026-10-04/diagnostico.md) e [plano-de-acao.md](../../_reversa_sdd/auditoria-2026-10-04/plano-de-acao.md) com **24 ações** em 5 ciclos. Esta pasta contém **artefatos completos, funcionais e testados** dentro da pasta própria do Reversa, sem alterar `app/`, `ui/`, `tests/` ou `scripts/`.

## Material pronto (gauntlet completo)

| Bloco | Local | Estado |
|---|---|---|
| Backlog executivo + sequência | [`README.md`](README.md) | ✅ |
| Specs SDD (24 features) | `07–30-feature-*.md` | ✅ |
| Contratos OpenAPI | [`contracts/openapi.yaml`](contracts/openapi.yaml) | ✅ YAML validado |
| Tipos TypeScript compartilhados | [`contracts/types.ts`](contracts/types.ts) | ✅ |
| Tipos TypeScript do transporte | [`contracts/api_transport.ts`](contracts/api_transport.ts) | ✅ |
| Schemas Pydantic | [`contracts/projects.py`](contracts/projects.py) | ✅ |
| Contrato `app_state_db` (A06) | [`contracts/app_state_db.py`](contracts/app_state_db.py) | ✅ |
| Runner de migrações (A18) | [`contracts/migration_runner.py`](contracts/migration_runner.py) | ✅ 5 testes OK |
| Erro padronizado (A15) | [`contracts/api_errors.py`](contracts/api_errors.py) | ✅ |
| Protótipos isolados | `prototypes/*.py` (6) | ✅ 25 testes OK |
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
| Validador do gauntlet | [`scripts/run_all_prototypes.sh`](scripts/run_all_prototypes.sh) | ✅ 44 checks OK |

## Validação executada

```text
$ bash scripts/run_all_prototypes.sh
=== Protótipos Python ===                  6 OK
=== Tests pytest ===                       14 passed, 5 skipped
=== Validação YAML ===                      1 OK
=== Validação Python ===                   0 errors
=== Smoke dos scaffolds ===                3 OK
=== Validação HTML ===                     5 OK
=== Validação TS ===                       0 errors
──────────────────────────────────────────
44/44 checks passaram
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