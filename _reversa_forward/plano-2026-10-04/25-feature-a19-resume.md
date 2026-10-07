# Feature A19 — Retomada de jobs após reinício e cancelamento

**Origem:** [plano A19](../../_reversa_sdd/auditoria-2026-10-04/plano-de-acao.md).
**Ciclo:** 3.
**Prioridade:** P1.
**Dependência:** A18.

## 1. Contexto

Retomada de produções já existe (apontado pela auditoria). O gap é: reinício do servidor não deve **reexecutar** saída já concluída, e jobs interrompidos devem ser sinalizados.

## 2. Requisitos

### 2.1 Comportamento esperado

- Ao subir, `classify(endpoint='/api/queue')` retorna cada job com estado pós-reinício:
  - `done` se mídia está no filesystem;
  - `interrupted` se mídia parcial existe ou estado era `running`;
  - `failed` se erro registrado.
- UI mostra "Retomar" só para `interrupted`/`failed`.
- Snapshot aprovado é preservado; destino da exportação é o mesmo.

### 2.2 Fora de escopo

- Worker separado para fila durável (decidir após A20 e métricas).

## 3. Contrato

```python
# app/services/job_classifier.py
from dataclasses import dataclass
from pathlib import Path

@dataclass
class JobState:
    id: str
    status: 'done' | 'interrupted' | 'failed' | 'unknown'
    media_path: Path | None
    can_resume: bool

def classify(job_id: str, db, fs_root: Path) -> JobState:
    ...
```

## 4. Plano

1. Adicionar coluna `interrupted_at` em `app.state.queue`.
3. Implementar `classify` consultando filesystem + DB.
4. Adicionar endpoint `POST /api/queue/{id}/resume`.
5. UI: botão "Retomar" só em estados elegíveis; usa `operationId` para idempotência (A15).

## 5. Testes de aceitação

- Simular reinício com mídia completa: status `done`, sem botão Retomar.
- Simular reinício com mídia parcial: `interrupted`, botão Retomar visível.
- Retomar não cria mídia duplicada (idempotente).

## 6. Critérios de pronto

- Documento `docs/job-resume.md` com cenários cobertos.

## 7. Riscos

- Lock de geração durante reinício. **Mitigação:** `acquire` com timeout.