# Feature A16 — Extrair API em routers e serviços por domínio

**Origem:** [plano A16](../../_reversa_sdd/auditoria-2026-10-04/plano-de-acao.md).
**Ciclo:** 3 — modernização estrutural.
**Prioridade:** P1.
**Dependência:** A05, A06.

## 1. Contexto

`app/launch.py` tem ~30 mil linhas concentrando inicialização, storage, geração, exportação e endpoints. A modularização precisa começar pelos domínios com dependências maduras.

## 2. Requisitos

### 2.1 Comportamento esperado

- Cada domínio vira um pacote `app/routers/<domain>/` com:
  - `__init__.py` que exporta `build_<domain>_router`;
  - `<domain>_service.py` para a lógica;
  - `schemas.py` para tipos Pydantic.
- `launch.py` apenas compõe routers via `app.include_router`.
- `services/` mantém apenas adaptadores externos (runtime WanGP, LLM externo).

### 2.2 Fora de escopo

- Reescrita completa. Esta é a primeira fatia.
- Mudança de assinatura pública de endpoints (manter compat).

## 3. Contrato

```python
# app/routers/projects/__init__.py
from fastapi import APIRouter
from .service import ProjectsService, get_projects_service

def build_projects_router() -> APIRouter:
    service: ProjectsService = get_projects_service()
    r = APIRouter(prefix="/api/projects", tags=["projects"])
    r.add_api_route("", service.list, methods=["GET"])
    r.add_api_route("", service.create, methods=["POST"])
    return r
```

## 4. Plano (primeira fatia — Projects)

1. Criar `app/routers/projects/{__init__.py,service.py,schemas.py}`.
2. Mover rotas de `/api/projects` de `launch.py` para `service.py`.
3. Substituir em `launch.py` por `app.include_router(build_projects_router())`.
4. Garantir que os testes `tests/test_projects*.py` continuam passando.
5. Repetir para `editor` (após A05) e `director`.

## 5. Testes de aceitação

- Suíte existente passa.
- `grep -rn "from app.launch import" app/routers/` retorna vazio.
- `launch.py` perdeu ≥ 1k linhas (estimativa; medir antes/depois).

## 6. Critérios de pronto

- Domínio Projects 100% no novo pacote.
- Sem regressão de contrato HTTP.

## 7. Riscos

- Dependências circulares entre `service.py` e `launch.py`. **Mitigação:** container de DI simples via `get_*_service()`.