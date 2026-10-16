# Feature A25 — Shot IR: estado narrativo estruturado por plano

**Origem:** especificação CineLocal v1.0, eixo 2 (seções 6, 14 e 14.1 do documento original), atualizado após varredura do código em 2026-10-15.
**Ciclo:** 4 (complementar a A01–A24; pode entrar em v2.6 ou v3.0).
**Prioridade:** P1 (fundação para eixo 1 — dependências explícitas — e para o Dashboard de continuidade).
**Dependência:** nenhuma forte. Convivência com `h3_story_ledger.py` v24 e `h3_sequence_continuity.py`.

## 1. Contexto

A especificação CineLocal pede que cada Shot tenha um **schema explícito e validável** para: posição dos personagens, direção do olhar, objeto em cada mão, estado de portas/objetos, figurino atual, iluminação, ação concluída e intenção da próxima ação. Esses campos devem entrar no prompt do LLM e do gerador de vídeo de forma estruturada, e o sistema deve detectar inconsistências (inversão de direção, salto de figurino, ação não terminada).

**Estado atual verificado em 2026-10-15** (commit `main`, Cue Studio v2.5.2):

- `app/services/h3_story_ledger.py` versão 24 já implementa `subject_continuity`, `setting_continuity`, `visual_continuity`, `_infer_h3_blocking_contract`, persistência interna para H3.
- `app/services/h3_sequence_continuity.py` separa continuidade (wardrobe, location, lighting, color) da identidade do personagem.
- `app/services/director/schema.py` declara `wardrobe: Optional[str]`.
- `app/services/director_video_strategy.py` consome wardrobe no contexto do prompt.
- `app/services/director/cinema/integration.py` retorna `scene_goal, environment, lighting, wardrobe, props`.
- `app/services/director/validators/shot_validator.py` faz validação estrutural.

**O que falta** (lacuna concreta):

1. O IR interno do H3 **não é exposto** como schema editável pelo usuário; ele só existe como string passada ao gerador.
2. Não há campos para **`hand_object`** (objeto em cada mão), **`gaze_direction`**, **`action_completed_in_shot`**, **`action_in_progress`**, **`next_intent`** e **`object_state`** (portas/objetos com estado discreto).
3. Não há detector de inconsistências entre shots consecutivos (olhar invertido sem justificativa, figurino mudou sem evento, objeto em mão diferente sem transição).
4. Não há sidecar versionado para o IR — só payload transitório.

## 2. Requisitos

### 2.1 Comportamento esperado

- Cada Shot do Director passa a ter um **Shot IR** persistido em sidecar `<shot>.shot_ir.json`, validável por Pydantic.
- O Shot IR inclui, **além do que já existe** no H3 story ledger, os campos:
  - `characters[]` com `id`, `position` (x/y/z + frame), `gaze` (direction + target), `hands` (left/right com asset_id opcional), `wardrobe_version`, `expression`, `posture`.
  - `environment` com `location_id`, `time_of_day`, `lighting`, `objects_state[]` (id + state).
  - `action.completed_in_shot[]`, `action.in_progress[]`, `action.next_intent`.
  - `camera` com `shot_size`, `movement`, `angle`.
  - `audio` com `dialogue`, `ambient[]`, `music_segment`.
  - `continuity_hints` com `previous_shot_id` e `state_inherited_from`.
- O Shot IR é **editável** pela UI (painel lateral no Shot Card, com autocomplete para `wardrobe_version`, `location_id`, `object_id`).
- Existe um **continuity check** (`app/services/director/continuity_check.py`) que detecta, **por padrão apenas como aviso**, não como bloqueio:
  - Olhar invertido entre campo/contracampo sem justificativa.
  - Figurino mudou sem entrada de wardrobe_version nova no Shot IR.
  - Objeto em uma mão diferente entre shots consecutivos sem evento explícito.
  - Estado de objeto mudou (porta aberta → fechada) sem ação.
  - `action.in_progress` no Shot N não aparece em `action.completed_in_shot` no Shot N+1.
- O Shot IR é exportado como conditioning adicional para H3 / LTX onde suportado (via `director_video_strategy.py`).
- O continuity check respeita uma flag de severidade: `info` (amarelo), `warning` (laranja), `error` (vermelho).
- Backward compatibility: cenas geradas antes de A25 ficam com Shot IR parcial; UI marca como "estado herdado, valide antes de regenerar".

### 2.2 Fora de escopo

- Reescrever o H3 story ledger; apenas **consumir** e **estender** o que ele produz.
- Substituir o sistema de blocking atual (`_infer_h3_blocking_contract`); Shot IR passa a **conter** o blocking_contract como campo derivado.
- Inferir automaticamente o estado narrativo a partir do prompt (a extração automática pode entrar em A26 — "auto-fill de Shot IR" — mas está fora deste escopo).
- Bloquear geração por inconsistência (apenas avisar).
- Treinar modelo de detecção de inconsistência por ML; usar regras determinísticas.

## 3. Contrato

### 3.1 Schema Pydantic (referência para Python e JSON Schema)

```python
# app/services/director/shot_ir_schema.py
from __future__ import annotations
from typing import Literal, Optional
from pydantic import BaseModel, Field, ConfigDict

class Position(BaseModel):
    model_config = ConfigDict(extra="forbid")
    x: float = Field(ge=0.0, le=1.0)
    y: float = Field(ge=0.0, le=1.0)
    z: float = Field(ge=-2.0, le=2.0)
    frame: Literal["screen_left", "screen_center", "screen_right", "off_screen"]

class Gaze(BaseModel):
    model_config = ConfigDict(extra="forbid")
    direction: Literal["screen_left", "screen_right", "screen_up", "screen_down", "into_camera", "away"]
    target: Optional[str] = None  # character_id ou object_id

class HandState(BaseModel):
    model_config = ConfigDict(extra="forbid")
    left: Optional[str] = None   # asset_id do objeto
    right: Optional[str] = None

class CharacterInShot(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    position: Position
    gaze: Gaze
    hands: HandState
    wardrobe_version: str
    expression: str
    posture: str

class ObjectState(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    state: str  # string controlada (closed, open, half_open, on, off, broken, ...)

class Environment(BaseModel):
    model_config = ConfigDict(extra="forbid")
    location_id: str
    time_of_day: Literal["dawn", "morning", "midday", "afternoon", "dusk", "night"]
    lighting: str
    objects_state: list[ObjectState]

class Action(BaseModel):
    model_config = ConfigDict(extra="forbid")
    completed_in_shot: list[str]
    in_progress: list[str]
    next_intent: Optional[str]

class Camera(BaseModel):
    model_config = ConfigDict(extra="forbid")
    shot_size: Literal["extreme_wide", "wide", "medium_wide", "medium", "medium_close_up", "close_up", "extreme_close_up"]
    movement: Literal["static", "pan", "tilt", "dolly", "tracking", "handheld"]
    angle: Literal["eye_level", "high", "low", "dutch"]

class AudioCue(BaseModel):
    model_config = ConfigDict(extra="forbid")
    dialogue: Optional[str] = None
    ambient: list[str]
    music_segment: Optional[str] = None

class ContinuityHints(BaseModel):
    model_config = ConfigDict(extra="forbid")
    previous_shot_id: Optional[str] = None
    state_inherited_from: Optional[str] = None  # shot_id do qual o estado foi herdado

class ShotIR(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: Literal["1.0"] = "1.0"
    shot_id: str
    characters: list[CharacterInShot]
    environment: Environment
    action: Action
    camera: Camera
    audio: AudioCue
    continuity_hints: ContinuityHints
    blocking_contract: Optional[str] = None  # derivado de h3_story_ledger._infer_h3_blocking_contract
```

### 3.2 Sidecar

- Localização: `<project_dir>/director/<production_id>/shots/<shot_id>.shot_ir.json`.
- Schema versionada; leitores devem ignorar `schema_version` desconhecido com warning, não crash.
- Escrita atômica (write-to-temp + rename).

### 3.3 Detector de inconsistências

```python
# app/services/director/continuity_check.py
from dataclasses import dataclass
from enum import Enum

class Severity(str, Enum):
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"

@dataclass
class Inconsistency:
    kind: str            # ex.: "gaze_flip", "wardrobe_skip", "object_hand_jump"
    severity: Severity
    shot_id_a: str
    shot_id_b: str
    message: str
    evidence: dict

def check_sequence(shots: list[ShotIR]) -> list[Inconsistency]:
    """Compara pares adjacentes e emite inconsistências com severidade."""
```

Regras iniciais (cada uma coberta por teste unitário):

| Regra | Severidade padrão |
|---|---|
| `gaze_flip`: gaze de personagem A em campo/contracampo sem alinhamento | WARNING |
| `wardrobe_skip`: wardrobe_version mudou sem nova entrada na bíblia | WARNING |
| `object_hand_jump`: objeto trocou de mão sem ação explícita | INFO |
| `object_state_unsupported`: estado de objeto mudou sem action correspondente | WARNING |
| `action_orphan`: action.in_progress não foi completed | WARNING |
| `position_collision`: dois personagens no mesmo `frame` | ERROR |

### 3.4 Endpoint REST (caminho recomendado)

| Método | Rota | Função |
|---|---|---|
| `GET` | `/api/v1/director/productions/{id}/shots/{shot_id}/shot_ir` | Ler Shot IR |
| `PUT` | `/api/v1/director/productions/{id}/shots/{shot_id}/shot_ir` | Substituir Shot IR (Pydantic valida) |
| `GET` | `/api/v1/director/productions/{id}/continuity` | Lista inconsistências |
| `POST` | `/api/v1/director/productions/{id}/continuity/check` | Forçar rerun |

## 4. Plano

1. **Criar `app/services/director/shot_ir_schema.py`** com os modelos Pydantic acima e versão `1.0`.
2. **Criar `app/services/director/shot_ir_store.py`** com operações de leitura/escrita atômica do sidecar `<shot>.shot_ir.json`. Reusar padrão de `editor_projects.py:1777` para sidecar.
3. **Estender `app/services/director/h3_story_ledger.py`** com função `to_shot_ir(story_ledger_entry) -> ShotIR` que **converte** o estado interno do H3 para o IR exposto. Manter backward compat: se algum campo do Shot IR não tiver origem no story ledger, marca `None` ou string vazia conforme o tipo.
4. **Criar `app/services/director/continuity_check.py`** com a função `check_sequence(shots)` e a lista de regras inicial. Cada regra vira função pura testável.
5. **Estender `app/services/director_pipeline.py`** para que, ao final de cada Shot, persista o Shot IR derivado e registre o `previous_shot_id` no Shot IR do próximo Shot da mesma cena.
6. **Estender `app/routers/productions.py`** com as 4 rotas acima. Reusar padronização de erro de `contracts/api_errors.py`.
7. **Criar `ui/src/components/ShotIREditor/`** — painel lateral no Shot Card com formulário por personagem + visualização top-down 2D simples (SVG inline) das posições. Autocomplete lê de `ui/src/api/bible.ts` (vocabulário controlado).
8. **Criar `ui/src/components/ContinuityWarnings/`** — banner no storyboard e no Dashboard com chips coloridos por severidade (não depende só de cor; usa ícone também — atende `docs/WALKTHROUGH_PLANO_5_UI_UX.md`).
9. **Adicionar continuidade_check ao Director Dashboard** (em `ui/src/components/DirectorDashboard/`): seção "Continuidade" mostra contadores por severidade e link para detalhes.
10. **Testes**:
    - `tests/test_shot_ir_schema.py` — validação Pydantic.
    - `tests/test_shot_ir_store.py` — round-trip atômico.
    - `tests/test_continuity_check.py` — cada regra isolada + corpus anotado.
    - `tests/test_director_shot_ir_integration.py` — gera Shot IR a partir de produção pequena, executa check, verifica avisos.
11. **Documentação**:
    - Atualizar `_reversa_sdd/inventory.md` (seção 7) com nova linha para `shot_ir_schema`, `shot_ir_store`, `continuity_check`.
    - Criar `docs/SHOT_IR.md` (na pasta do Cue Studio; usuário deve liberar `allowedPaths` para `docs/**` antes) com schema, regras e exemplos.
12. **Backward compatibility**: projetos abertos sem `*.shot_ir.json` são marcados como IR `legacy`; o primeiro salvamento gera o arquivo com `schema_version: "1.0"` e campos nulos onde não há dado.
13. **Release notes**: entrada dedicada na próxima minor (v2.6.x ou v3.0), com screenshot do Shot IR editor e do banner de continuidade.

## 5. Testes de aceitação

- `pytest tests/test_shot_ir_schema.py tests/test_shot_ir_store.py tests/test_continuity_check.py tests/test_director_shot_ir_integration.py -q` passa.
- `python scripts/run_all_prototypes.sh` permanece em 44/44 + novos checks.
- Em uma cena de 6 shots com 2 personagens (corpus `tests/continuity/corpus.json`), o sistema detecta **≥ 95%** das inconsistências reais anotadas.
- Abrir um projeto v2.5.2 sem sidecar Shot IR: o sistema infere IR parcial a partir do `h3_story_ledger.py` e marca como `legacy`. UI mostra badge "estado herdado".
- Editar gaze de um personagem no Shot 3:Shot IR é persistido; continuity_check recalcula; warning visível se a gaze não casa com o Shot 4.
- Importar uma produção com `schema_version` desconhecido (`"2.0"`): sistema ignora com warning, não crash.

## 6. Critérios de pronto

- `docs/SHOT_IR.md` publicado.
- Schema versionado e validável em CI.
- UI do Shot IR Editor utilizável em 1280 px e 390 px (snapshots em `tests/ui_screenshots/`).
- Continuity check com pelo menos 6 regras, cada uma coberta por teste.
- Backward compatibility demonstrada com projeto v2.5.2 aberto e salvo em v2.6+.
- Release notes redigidas.

## 7. Riscos

- **Risco:** Shot IR grande infla sidecar. **Mitigação:** separar IR canônico (`characters`, `environment`, `action`, `camera`, `audio`) de `blocking_contract` derivado (regenerável).
- **Risco:** continuity_check tem muitos falsos positivos e irrita usuários. **Mitigação:** thresholds ajustáveis por production; primeiro warning como `info`, segundo como `warning`; toggle global em Configurações.
- **Risco:** schema rígido frustra casos criativos (ex.: cena onírica com física impossível). **Mitigação:** campo `continuity_hints.previous_shot_id` aceita `None` (corte frio); `object_state.state` aceita string livre, validada por catálogo opcional.
- **Risco:** mudanças no formato do sidecar quebram projetos antigos. **Mitigação:** `schema_version` explícito; leitor aceita `1.0` e marca `legacy` para formatos diferentes; nunca deleta sidecar antigo.
- **Risco:** o Shot IR pode virar prompt duplicado (LLM já infere do script). **Mitigação:** Shot IR entra no conditioning apenas quando o usuário marca `use_shot_ir: true` na estratégia de vídeo; default off para `faithful_creative`, on para `continuity_strict`.
- **Risco:** dependência da liberação de `allowedPaths` no `reversa-config.json` trava o merge. **Mitigação:** scaffold isolado em `contracts/` e `prototypes/` da pasta `_reversa_forward/plano-2026-10-04/` permite validar a estratégia antes da aplicação real; tudo cabe nos caminhos já liberados (`contracts/`, `prototypes/`, `tests/`, `scripts/`, `patches/`).

## 8. Anexo — vocabulário controlado sugerido

```
locations: loc_kitchen, loc_studio, loc_office, loc_street_day, loc_street_night, loc_forest, loc_station, ...
objects: obj_door, obj_window, obj_table, obj_phone, obj_cup, obj_key, obj_laptop, ...
wardrobes (per character): wardrobe_v1, wardrobe_v2, ...
ambient_sfx: ambient_loop_001, ambient_loop_002, ...
music_segments: music_intro, music_verse, music_chorus, music_break, music_outro
```

Esses vocabulários vivem em `app/services/director/shot_ir_vocab.py` e são editáveis pelo usuário com autocomplete na UI.