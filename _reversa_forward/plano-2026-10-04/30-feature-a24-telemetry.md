# Feature A24 — Telemetria de runtime

**Origem:** [plano A24](../../_reversa_sdd/auditoria-2026-10-04/plano-de-acao.md).
**Ciclo:** 4.
**Prioridade:** P3 (necessidade ainda deve ser demonstrada).

## 1. Contexto

Auditoria não confirmou necessidade de telemetria. Não promete "equipe notificada" sem observabilidade. Esta feature entra sob demanda.

## 2. Requisitos (provisórios)

- Eventos estruturados: `app_started`, `project_created`, `job_started`, `job_finished`, `job_failed`, `export_started`, `export_finished`.
- Cada evento carrega `projectId`, `jobId`/`runId`, `phase`, `durationMs`.
- Logs estruturados **não** incluem prompt, mídia, path absoluto ou token.
- Sink inicial: arquivo local rotativo (`logs/events.ndjson`).

### 2.2 Fora de escopo

- Envio para SaaS.
- Tracing distribuído (OpenTelemetry). Decidir após métricas.

## 3. Contrato

```python
# app/services/events.py
import json, time
from pathlib import Path

class EventLog:
    def __init__(self, path: Path) -> None:
        self._path = path
        self._path.parent.mkdir(parents=True, exist_ok=True)

    def emit(self, name: str, **fields) -> None:
        rec = {"ts": time.time(), "name": name, **fields}
        with self._path.open("a") as f:
            f.write(json.dumps(rec) + "\n")
```

## 4. Plano

1. Implementar `EventLog`.
2. Conectar a eventos chave.
3. Documentar como ler `events.ndjson`.
4. Política explícita: nada de prompt/mídia/token/path-absoluto.

## 5. Testes de aceitação

- Eventos são emitidos em pontos chave.
- Nenhum token nem prompt em `events.ndjson` em teste.

## 6. Critérios de pronto

- Documento `docs/telemetry.md` com lista de eventos e campos.

## 7. Riscos

- Privacidade. **Mitigação:** revisão do payload por time de segurança antes de release.