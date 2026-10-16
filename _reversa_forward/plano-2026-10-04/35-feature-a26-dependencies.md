# Feature A26 — Dependências explícitas e propagação de impacto

**Origem:** Plano Executivo §7 Eixo 2 + Dossiê R02 (reconciliação IDs) + R06 (dependências e invalidação seletiva).
**Ciclo:** 4 (consolidação de R02 e R06).
**Prioridade:** P1.
**Dependência:** nenhuma forte. Reaproveita `shot_ir.py` (A25) e `provenance.py` (A27).

## 1. Contexto

Quando o usuário edita uma fala, troca uma referência visual ou altera um modelo, o Cue Studio precisa identificar **automaticamente** quais clipes, efeitos, montagens e exports ficam desatualizados e oferecer regenerar só o subconjunto afetado. Hoje o Dashboard tem rerun por clipe (v1.4) e Check + Repair regenera missing, mas não há:

1. **Grafo explícito entre Takes** (fala aprovada → vídeo condicionado → montagem → export).
2. **Função `impact_of(change)`** que retorna o conjunto de artefatos derivados.
3. **Endpoint REST** `GET /projects/{id}/impact?resource_id=…`.
4. **UI** com painel "Impacto da alteração".
5. **Ação "Regenerar impactados"** que reaproveita Takes approved.

Esta spec define o esqueleto completo e o protótipo isolado `a26_dependencies.py`.

## 2. Requisitos

### 2.1 Comportamento esperado

- Cada Take registra os IDs de recursos que consumiu (texto, refs, voz, parâmetros, modelo).
- Cada `TimelineClip` registra os IDs de Takes que o compõem.
- Cada `ExportRender` registra o snapshot_id da timeline.
- Função `impact_of(change: ResourceChange) -> Set[ArtifactId]` retorna o conjunto derivado.
- Endpoint `GET /api/v1/projects/{id}/impact?resource_id=...` retorna a lista de artefatos impactados.
- UI: painel "Impacto da alteração" no Studio/Director com ações Justificar / Regenerar / Manter antigo.
- Undo cooperativo: ao desfazer uma edição de recurso, retorna o grafo ao estado anterior sem perder reruns intermediários.

### 2.2 Fora de escopo

- Reescrever scheduler Director.
- Reescrever pipeline de export.
- Reescrever sidecar schema; conviver com sidecars existentes.
- Inferir dependências automaticamente a partir de grafos externos.

## 3. Modelo de dados

```python
# app/services/director/dependencies.py
from __future__ import annotations
from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field, ConfigDict

class ResourceKind(str, Enum):
    TEXT = "text"                    # fala, dialogue, caption
    VOICE_REFERENCE = "voice_ref"
    SOUNDTRACK = "soundtrack"
    IMAGE_REFERENCE = "image_ref"
    LORA = "lora"
    MODEL = "model"
    PARAMETERS = "parameters"        # resolution, duration, fps
    EDITORIAL = "editorial"          # approved take, locked sequence

class ResourceRef(BaseModel):
    model_config = ConfigDict(extra="forbid")
    resource_id: str
    kind: ResourceKind
    version: int = 1
    source: str  # ex.: "script.txt:line_42", "character_library:char_ana"

class Edge(BaseModel):
    """Relação de dependência: target depende de source."""
    model_config = ConfigDict(extra="forbid")
    source: ResourceRef
    target_id: str                    # take_id, timeline_clip_id, export_id
    target_kind: str                  # "take", "timeline_clip", "export"
    relation: str                     # "uses", "composes", "renders_to"

class ArtifactId(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    kind: str                         # "take", "timeline_clip", "export"
    staleness: Optional[str] = None   # "stale", "fresh", "unknown"

class ImpactReport(BaseModel):
    model_config = ConfigDict(extra="forbid")
    changed: ResourceRef
    affected: list[ArtifactId]
    preserve: list[ArtifactId]   # approved, não dependem do recurso
```

## 4. Endpoints REST

| Método | Rota | Função |
|---|---|---|
| `GET` | `/api/v1/projects/{id}/graph` | Lista edges (source→target) |
| `GET` | `/api/v1/projects/{id}/impact?resource_id=...` | Retorna ImpactReport |
| `POST` | `/api/v1/projects/{id}/regenerate` | Regenera affected |
| `POST` | `/api/v1/projects/{id}/undo-impact` | Desfaz e retorna ao estado anterior |

## 5. Plano

1. Criar `app/services/director/dependencies.py` com `ResourceKind`, `ResourceRef`, `Edge`, `ArtifactId`, `ImpactReport` e a função `build_graph(project_dir) -> list[Edge]`.
2. Criar `app/services/director/impact.py` com `impact_of(graph, change) -> ImpactReport`.
3. Persistir grafo em `<project>.dependencies.json` (sidecar atômico).
4. Estender `app/routers/productions.py` com 4 rotas.
5. UI: `<ImpactPanel>` injetado no Studio/Director (especificação externa).
6. Testes pytest `tests/test_dependencies.py`, `tests/test_impact.py`.
7. Docs `docs/DEPENDENCIES.md`.

## 6. Critérios de aceite

- `pytest tests/test_dependencies.py tests/test_impact.py -q` passa.
- `python scripts/run_all_prototypes.sh` permanece verde.
- Em projeto de 30 Takes, alterar uma fala → relatório lista exatamente os 3 Takes esperados.
- Regenerar affected reaproveita Takes approved não-dependentes.

## 7. Riscos

- Grafo cresce rápido. Cachear `impact_of` por hash do recurso.
- Projetos sem sidecar geram grafo por varredura sob demanda com flag `partial: true`.
- Undo cooperativo pode confundir usuário; toggle em Configurações.