# Feature A28 — Continuity Panel: visualização das inconsistências detectadas

**Origem:** feature A25 (Shot IR + continuity check), apontamentos 7 e 8 do diagnóstico do usuário em 2026-10-16 ("Shot IR não é exposto ao usuário" + "Sem detector de inconsistência").
**Ciclo:** 4 (complementar a A25, A27).
**Prioridade:** P1 (UX imediato, sem dependência de GPU).
**Dependência:** A25 (Shot IR schema e `check_sequence(shots)` já implementados no protótipo).

## 1. Contexto

O Cue Studio já tem, internamente, quatro camadas de continuidade (estratégia por Shot, story bible, H3 story ledger, pipeline grouping). Mas o usuário não vê o resultado dessas camadas como uma **lista de inconsistências acionáveis** com severidade, evidência e localização. Hoje o pipeline evita problemas via LLM (3 passes + bible) e descarta o resto; o usuário só descobre quando o vídeo sai errado.

A spec **A25 (Shot IR + continuidade)** já define:

- Schema Pydantic com 6 campos relevantes para continuidade (`characters[].gaze`, `hands`, `wardrobe_version`; `environment.objects_state`; `action.completed_in_shot`, `action.in_progress`).
- `app/services/director/continuity_check.py` (a criar) com a função `check_sequence(shots) -> list[Inconsistency]`.
- 6 regras puras testáveis: `gaze_flip`, `wardrobe_skip`, `object_hand_jump`, `object_state_unsupported`, `action_orphan`, `position_collision`.
- 3 níveis de severidade: `info` (azul), `warning` (amarelo), `error` (vermelho).

**O que falta (lacuna concreta de UX)**:

1. **Não há UI que exiba as inconsistências** em nenhum dos três lugares onde o usuário toma decisão: Storyboard, Director Dashboard, Editor Timeline.
2. **Não há agregação por cena** que mostre "Cena 3 tem 4 inconsistências; Cena 5 tem 0".
3. **Não há ação de "ignorar"** para falsos positivos (irritaria o usuário e levaria a ignorar tudo).
4. **Não há ícone + texto** (atende `docs/WALKTHROUGH_PLANO_5_UI_UX.md` que pede mais de cor).
5. **Não há export CSV** das inconsistências para revisão manual off-app.

## 2. Requisitos

### 2.1 Comportamento esperado

- **Storyboard**: cada Shot card mostra um chip de severidade agregada (`0` ausente, `3 warn`, `1 error`) e, ao passar o mouse, uma tooltip com a lista resumida.
- **Director Dashboard**: nova seção "Continuidade" no painel existente, com tabela por cena: `cena | # info | # warning | # error | ação`. Botão "Ver detalhes" abre um modal com a lista completa.
- **Editor Timeline**: marcador no timeline (linha do tempo) com pontos coloridos onde cada inconsistência foi detectada.
- **Banner global**: quando há `error` em qualquer cena, um banner persistente no topo do Director avisa "1 inconsistência crítica em Cena 3 — bloqueia export".
- **Ações por inconsistência**:
  - `Editar Shot IR` — abre o Shot IR Editor (feature A25) pré-posicionado no shot com erro.
  - `Marcar como justificado` — adiciona nota livre e exclui da próxima execução do check (mantém histórico).
  - `Regenerar shot` — chama o pipeline de regeneração do Shot (já existe em `director_pipeline.py`).
  - `Ignorar` — apenas para `info`; some da lista até a próxima mudança.
- **Modal de detalhes** mostra: kind, severity, shot_id_a, shot_id_b, message, evidence (dict formatado), timestamp de detecção.
- **Export**: botão "Exportar CSV" gera arquivo com `scene_id, shot_id_a, shot_id_b, kind, severity, message` para revisão manual em planilha.
- **Persistência**: `status` (pendente / justificado / regenerado) e `note` persistidos por inconsistência em sidecar `<production>.continuity_overrides.json`.
- **Backward compatibility**: projetos sem Shot IR exibem painel vazio com mensagem "Shot IR não gerado para esta produção — ative em Configurações → Produção". Sem quebra.

### 2.2 Fora de escopo

- Reescrever `continuity_check.py` (já existe via A25).
- Inferir automaticamente o Shot IR a partir do prompt (feature A26 — fora de escopo).
- Bloquear geração por inconsistência (apenas avisar; modo `strict` pode entrar depois).
- Suportar 10+ regras novas nesta entrega (as 6 de A25 bastam).

## 3. Contrato

### 3.1 Modelo de dados do painel

```python
# app/services/director/continuity_panel.py
from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

class PanelStatus(str, Enum):
    PENDING = "pending"
    JUSTIFIED = "justified"
    REGENERATED = "regenerated"
    DISMISSED = "dismissed"   # só para info

@dataclass
class PanelEntry:
    inconsistency_id: str         # hash(kind + shot_a + shot_b)
    kind: str
    severity: str                 # info | warning | error
    shot_id_a: str
    shot_id_b: str
    message: str
    evidence: dict
    status: PanelStatus = PanelStatus.PENDING
    note: Optional[str] = None
    detected_at: str = ""         # ISO-8601 UTC

@dataclass
class SceneContinuitySummary:
    scene_id: str
    info_count: int
    warning_count: int
    error_count: int
    total_count: int
    entries: list[PanelEntry] = field(default_factory=list)
```

### 3.2 Endpoints REST

| Método | Rota | Função |
|---|---|---|
| `GET` | `/api/v1/director/productions/{id}/continuity/panel` | Lista entradas + resumo por cena |
| `POST` | `/api/v1/director/productions/{id}/continuity/entries/{entry_id}/justify` | Marca como justificado com nota |
| `POST` | `/api/v1/director/productions/{id}/continuity/entries/{entry_id}/regenerate` | Solicita regeneração do shot_b |
| `POST` | `/api/v1/director/productions/{id}/continuity/entries/{entry_id}/dismiss` | Marca info como ignorado |
| `GET` | `/api/v1/director/productions/{id}/continuity/export.csv` | Download CSV |

### 3.3 Componente UI

```tsx
// ui/src/components/ContinuityPanel/index.tsx
export interface ContinuityPanelProps {
  productionId: string;
  summaries: SceneContinuitySummary[];
  onJustify: (entryId: string, note: string) => Promise<void>;
  onRegenerate: (entryId: string) => Promise<void>;
  onDismiss: (entryId: string) => Promise<void>;
  onExportCsv: () => Promise<void>;
}

export interface ShotCardBadgeProps {
  summary: SceneContinuitySummary;
}
```

Reusar `<SceneCard>` (de A12) com slot para `<ContinuityBadge>`. Banner global usa `<ErrorBoundary>` (de A15).

## 4. Plano

1. **Criar `app/services/director/continuity_panel.py`** com os modelos acima + função `build_panel(check_results, scene_metadata) -> ContinuitySummary[]`.
2. **Criar `app/services/director/continuity_overrides.py`** para ler/escrever `<production>.continuity_overrides.json` (sidecar atômico, padrão do A25).
3. **Estender `app/services/director/continuity_check.py`** (criado em A25) com função `panel_for_production(production_id, shots) -> list[SceneContinuitySummary]` que agrupa por cena.
4. **Estender `app/routers/productions.py`** com as 5 rotas acima.
5. **Criar `ui/src/components/ContinuityPanel/index.tsx`** — componente principal com tabela + modal de detalhes + ações.
6. **Criar `ui/src/components/ContinuityBadge/index.tsx`** — chip compacto injetado em cada Shot Card.
7. **Criar `ui/src/components/ContinuityBanner/index.tsx`** — banner persistente no topo do Director quando há error.
8. **Adicionar endpoint de export CSV** com header `Content-Disposition: attachment` e `Content-Type: text/csv; charset=utf-8`.
9. **Testes**:
   - `tests/test_continuity_panel.py` — `panel_for_production` agrupa corretamente, severidade soma certo.
   - `tests/test_continuity_overrides.py` — round-trip atômico, retrofill.
   - `tests/test_continuity_csv.py` — export válido RFC 4180.
10. **Documentação**: `docs/CONTINUITY.md` (a publicar quando `allowedPaths: docs/**` for liberado).
11. **Backward compatibility**: detector de ausência de Shot IR; exibe estado vazio sem crash.
12. **Release notes**: entrada dedicada na próxima minor (v2.6 ou v3.0).

## 5. Testes de aceitação

- `pytest tests/test_continuity_panel.py tests/test_continuity_overrides.py tests/test_continuity_csv.py -q` passa.
- `python scripts/run_all_prototypes.sh` permanece verde (incluindo o novo `a28_continuity_panel.py`).
- Em uma cena de 6 shots com 2 personagens (corpus anotado), o painel mostra **≥ 95%** das inconsistências reais.
- Shot card com 1 erro mostra badge vermelho; clicar abre modal com detalhes + ações.
- Marcar como justificado: a entrada some da lista "pendentes" mas continua em "histórico".
- Regenerar um shot com erro: pipeline é invocado, status vira `regenerated`, painel atualiza após polling.
- Export CSV: abrir no Excel/Google Sheets mostra colunas corretas e quebras de linha RFC 4180.
- Banner aparece quando há error; some quando todos os errors são justificados ou regenerados.
- Acessibilidade: navegar pelo painel só com teclado; badges têm `aria-label` com texto (não só cor).

## 6. Critérios de pronto

- `docs/CONTINUITY.md` publicado.
- UI utilizável em 1280 px e 390 px (snapshots).
- CSV exportado válido.
- Sidecar `continuity_overrides.json` round-trip sem perda.
- Backward compatibility demonstrada com projeto v2.5.2 aberto e salvo em v2.6+.
- Release notes redigidas.

## 7. Riscos

- **Risco:** painel atrapalha o fluxo do Storyboard visual. **Mitigação:** badges opcionais em Configurações; default `on` mas com toggle.
- **Risco:** muitas entradas viram "barulho" e usuário ignora. **Mitigação:** default é mostrar apenas `warning` e `error`; `info` exige expandir.
- **Risco:** regeneração via UI tem custo de GPU alto. **Mitigação:** confirmar com modal mostrando "Esta regeneração custará ~X minutos e Y MB de VRAM" antes de disparar.
- **Risco:** `continuity_overrides.json` cresce muito. **Mitigação:** arquivar entradas com mais de 90 dias em `continuity_overrides.archive.json` (rotativo).
- **Risco:** CSV mal-formatado quebra Excel. **Mitigação:** validar com `csv.writer` e RFC 4180; testar com nome de personagem contendo vírgula e aspas.
- **Risco:** dependência da liberação de `allowedPaths` trava o merge. **Mitigação:** protótipo isolado em `prototypes/a28_continuity_panel.py` valida estratégia; convive com paths liberados.

## 8. Anexo — vocabulário controlado de ícones

Cada regra tem um ícone + cor (não dependemos só de cor):

| Regra | Ícone (Lucide) | Cor |
|---|---|---|
| `gaze_flip` | `Eye` | warning (âmbar) |
| `wardrobe_skip` | `Shirt` | warning (âmbar) |
| `object_hand_jump` | `Hand` | info (azul) |
| `object_state_unsupported` | `DoorOpen` | warning (âmbar) |
| `action_orphan` | `CircleDot` | warning (âmbar) |
| `position_collision` | `Users` | error (vermelho) |

Texto alternativo (aria-label): "Personagem X trocou de figurino sem registro" (não só `gaze_flip`).