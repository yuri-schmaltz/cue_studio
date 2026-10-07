# Feature A05 — Router do Editor montado corretamente

**Origem:** [diagnóstico D05](../../_reversa_sdd/auditoria-2026-10-04/diagnostico.md) e [plano A05](../../_reversa_sdd/auditoria-2026-10-04/plano-de-acao.md).
**Ciclo:** 0.
**Prioridade:** P1.

## 1. Contexto

`app/routers/video_editor.py:48` define `build_video_editor_router(get_editor)` corretamente: o callable é injetado para permitir testes e composição.

O bug real está em `app/launch.py:10917`, que chama `build_video_editor_router()` **sem passar o argumento**:

```python
from routers.video_editor import build_video_editor_router
api.include_router(build_video_editor_router())
```

Como o `try/except` em volta captura a exceção silenciosamente, o router **nunca é montado** em runtime. Os testes `tests/test_video_editor_router.py` usam o call site canônico (passando `lambda: ed`) e por isso passam — mascarando o problema na produção.

🟢 Achado confirmado por leitura do código real (commit 27cadae).

🟡 **Correção da auditoria original**: `inspect.signature(f).bind()` sem argumentos sempre levanta `TypeError` por design do Python — não é um sinal de bug, mas sim do call site errado. A spec original foi ajustada para refletir isso.

## 2. Requisitos

### 2.1 Comportamento esperado

- `build_video_editor_router(get_editor)` aceita um **único** argumento `get_editor: Callable[[], EditorService]` (ou tipo equivalente decidido em revisão).
- A factory **não** importa singletons nem cria instâncias durante a importação; só registra rotas.
- Os métodos `GET`/`POST`/`PUT`/`DELETE` não conflitam entre si (sem canônico inválido).
- O router pode ser incluído via `app.include_router(...)` no bootstrap sem warnings.
- Contratos dos endpoints de **criar**, **listar**, **abrir**, **apagar** aceitam o payload esperado pela UI (`MediaCard`, `TimelineState` etc.) e usam o `workspace` configurado.

### 2.2 Fora de escopo

- Migrar rotas para outro arquivo (A16 — refatoração por domínio).
- Alterar a forma de persistência do Editor (A18).

## 3. Contrato

### 3.1 Assinatura esperada

```python
# app/routers/video_editor.py
from typing import Callable
from fastapi import APIRouter
from app.services.editor_service import EditorService  # tipo real

def build_video_editor_router(
    get_editor: Callable[[], EditorService],
) -> APIRouter:
    ...
```

### 3.2 Rotas (referência — confirmar com `app/services/editor_service.py`)

| Método | Path | Handler |
|---|---|---|
| GET | `/api/editor/projects` | listar projetos |
| POST | `/api/editor/projects` | criar projeto |
| GET | `/api/editor/projects/{project_id}` | abrir |
| DELETE | `/api/editor/projects/{project_id}` | apagar |

> Os paths acima são **provisórios**. Confirmar com `grep -rn "router\\.\\|@router\\." app/routers/video_editor.py` antes da implementação.

### 3.3 Smoke test programático

```python
# tests/test_video_editor_router_signature.py
import inspect
from app.routers.video_editor import build_video_editor_router

def test_factory_has_expected_signature():
    sig = inspect.signature(build_video_editor_router)
    params = list(sig.parameters.values())
    assert len(params) == 1, params
    assert params[0].name == "get_editor"

def test_factory_builds_router():
    from app.services.editor_service import EditorService  # ajuste real
    router = build_video_editor_router(lambda: EditorService(None))  # type: ignore[arg-type]
    assert router.routes, "router has no routes"
```

## 4. Plano de mudança

1. **Confirmar** que `app.routers.video_editor.build_video_editor_router` aceita `get_editor` (verificado: OK).
2. **Localizar** o call site errado em `app/launch.py:10917` (e qualquer outro). Confirmar com `grep -n 'build_video_editor_router' app/launch.py`.
3. **Substituir** a chamada por `build_video_editor_router(get_editor=lambda: _video_editor_instance)` ou equivalente decidido na revisão (ex.: o nome do singleton real exposto em `app/services/video_editor.py`).
4. **Adicionar teste de integração** que monta a aplicação via `app.launch`/`create_app` (ou equivalente) e faz request a `GET /api/v1/editor/projects`, validando 200 ou 503 — nunca `bind()` exception. O teste atual `test_video_editor_router.py` cobre o router isolado; falta o teste do call site.
5. **Não introduzir** mudanças em `launch.py` além do call site. Refatorações maiores entram em A16.
6. **Log**: o `try/except` atual esconde o erro. Após corrigir, considerar reduzir o `except` para log explícito (sem aumentar escopo).

## 5. Testes de aceitação

- `python -m pytest tests/test_video_editor_router_signature.py` (ou `python -m unittest`) passa.
- `python -c "from app.routers.video_editor import build_video_editor_router; import inspect; inspect.signature(build_video_editor_router).bind()"` não lança `TypeError`.
- A aplicação sobe via `python -m app.launch` (ou similar) sem warning de rota inválida.
- Smoke request para `GET /api/editor/projects` responde com lista (mesmo que vazia) quando a aplicação está de pé.

## 6. Critérios de pronto

- Nenhum `TypeError` em `bind()`.
- App monta o router no startup.
- Testes do Editor (`tests/`) passam.
- `CHANGELOG.md`: entrada "Unreleased".

## 7. Riscos e mitigações

- **Risco:** trocar singleton por injeção quebra outro call site que assume o módulo já importado. **Mitigação:** `grep -rn "editor_service\\b" app/ ui/` antes da mudança.
- **Risco:** mudar paths quebra frontend. **Mitigação:** confirmar paths com grep em `ui/src/api/`; não inventar.
- **Risco:** `launch.py` ainda usa `from app.routers.video_editor import build_video_editor_router` com chamada antiga. **Mitigação:** ajustar o call site na mesma entrega (escopo mínimo), ainda dentro do `launch.py`.

## 9. Pré-condições

- Nenhuma. Pode entrar em paralelo com A01/A03/A04.

## 10. Pós-condições

- A16 pode extrair este e outros routers por domínio sem alterar o call site novamente.