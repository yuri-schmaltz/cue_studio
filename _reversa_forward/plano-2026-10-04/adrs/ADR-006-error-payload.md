# ADR-006 — Payload de erro HTTP padronizado

**Status:** Proposto.
**Data:** 2026-10-04.
**Contexto:** [diagnóstico D07](../../_reversa_sdd/auditoria-2026-10-04/diagnostico.md).

## Contexto e problema

Erros HTTP variam em formato. UI precisa mapear resposta para ação (cancelar,
repetir, abrir suporte), mas sem `code` estável isso vira heurística.

## Decisão

1. Toda resposta 4xx/5xx da API tem payload:
   ```json
   {
     "code": "string",
     "message": "human-readable",
     "operationId": "uuid",
     "cause": "optional"
   }
   ```
2. `ApiError` é o único caminho canônico; middleware converte respostas não-API.
3. Códigos canônicos em `ErrorCode` (auth.missing, auth.invalid, queue.cancel.not_allowed, etc.).
4. UI: `ApiError` JS com `.code`, `.message`, `.operationId`.
5. `operationId` é chave idempotente para retry seguro (A19).

## Consequências

**Positivas**
- UI pode mapear `code` → texto e ação.
- Retry idempotente confiável.
- Telemetria estruturada (A24) ganha um campo fixo.

**Negativas**
- Compat: clientes externos que parsejam `detail` direto quebram. Documentar.
- Versão: considerar `Accept` header ou `schemaVersion`.

## Alternativas

- **A. RFC 7807 (Problem Details).** Considerar para fase posterior; hoje vamos
  com payload simples.
- **B. Sem `operationId`.** Rejeitado: impede idempotência confiável.