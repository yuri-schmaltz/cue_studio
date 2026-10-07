# ADR-005 — Monólito modular: routers por domínio

**Status:** Proposto.
**Data:** 2026-10-04.
**Contexto:** [diagnóstico D06](../../_reversa_sdd/auditoria-2026-10-04/diagnostico.md).

## Contexto e problema

`app/launch.py` tem ~30 mil linhas concentrando inicialização, endpoints, storage
e configuração. Refatoração ampla é arriscada.

## Decisão

1. Manter `app/launch.py` como **bootstrap** (FastAPI app composition).
2. Cada domínio vira `app/routers/<domain>/__init__.py` com:
   - `service.py` (lógica);
   - `schemas.py` (Pydantic);
   - `build_<domain>_router()` (factory de `APIRouter`).
3. `launch.py` apenas chama `app.include_router(...)` para cada domínio.
4. Domínios prioritários: projects, director, editor, queue, dashboard, configurations.
5. **Não** mudar contratos HTTP na primeira passagem; manter compat.
6. Migração por fatia, validada por suíte existente.

## Consequências

**Positivas**
- Cada router fica < 500 linhas; revisão fica viável.
- Permite paralelizar trabalho entre times.
- Próximo passo natural: serviços em pacotes próprios (`app.services.<domain>`).

**Negativas**
- Cuidado com dependências circulares.
- Tempo para reorganizar arquivos.

## Alternativas

- **A. Migrar tudo em um PR.** Rejeitado: revisão impossível.
- **B. Microserviços.** Rejeitado: acoplamento GPU/runtime impede.