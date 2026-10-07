# Feature A15 — Error Boundary por seção + erro HTTP padronizado

**Origem:** [plano A15](../../_reversa_sdd/auditoria-2026-10-04/plano-de-acao.md).
**Ciclo:** 2.
**Prioridade:** P1.
**Dependência:** A01, A08.

## 1. Contexto

Erros de render e HTTP não têm contrato consistente. Falha de render pode derrubar a aplicação inteira; respostas HTTP variam em formato.

## 2. Requisitos

### 2.1 Comportamento esperado

- `<ErrorBoundary>` por seção (não global único). Falha em Director não tira navegação.
- Toda resposta HTTP da API tem payload:
  ```json
  { "code": "string", "message": "human-readable", "operationId": "uuid" }
  ```
- Frontend mapeia `code` → texto e ação sugerida (cancelar, repetir, abrir suporte).
- Repetição usa `operationId` como chave idempotente quando suportado.

### 2.2 Fora de escopo

- Telemetria externa (Sentry etc.) — A24.

## 3. Contrato

```python
# app/services/errors.py (proposto)
from fastapi import HTTPException
from uuid import uuid4

class ApiError(HTTPException):
    def __init__(self, code: str, message: str, status: int = 400,
                 cause: str | None = None):
        self.code = code
        self.message = message
        self.operation_id = str(uuid4())
        super().__init__(
            status_code=status,
            detail={
                "code": code,
                "message": message,
                "operationId": self.operation_id,
                "cause": cause,
            },
        )
```

Uso:

```python
raise ApiError("queue.cancel.not_allowed", "Job não pode ser cancelado", 409)
```

```ts
// ui/src/api/errors.ts
export interface ApiErrorPayload {
  code?: string;
  message: string;
  operationId?: string;
}

export class ApiError extends Error {
  readonly code: string;
  readonly operationId: string;
  constructor(payload: ApiErrorPayload, public status: number) { ... }
}
```

## 4. Plano

1. Backend: implementar `ApiError` e middleware que padroniza respostas não-HTTPException.
2. Aplicar em endpoints de geração, fila, projetos.
3. Frontend: `apiFetch` (A01) deserializa payload; converte em `ApiError`.
4. Adicionar `<ErrorBoundary>` por rota (`/projects`, `/queue`, `/studio`, `/editor`, `/configurations`).
5. Mapear `code` → ação em `ui/src/api/error-actions.ts`.

## 5. Testes de aceitação

- Endpoint retorna `code/message/operationId` em 4xx/5xx.
- Falha de render em uma rota não derruba navegação global.
- `ApiError` na UI mostra ação sugerida.

## 6. Critérios de pronto

- Sem respostas 4xx/5xx com payload cru do FastAPI.
- Idempotência por `operationId` documentada para retry seguro.

## 7. Riscos

- Mudar formato quebra consumidores. **Mitigação:** versão em `Accept: application/vnd.cue.v2+json` ou campo `schemaVersion`.