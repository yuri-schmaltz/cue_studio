# Feature A26b — Retake com efeito real (correção do bug R01)

**Origem:** Dossiê de Retomada v2.0, seção 10, **bug confirmado em `production_resume.py:retake_stage()`**.
**Ciclo:** 4 (extensão corretiva de A26).
**Prioridade:** **P0** — primeiro bug funcional a corrigir segundo o dossiê.
**Dependência:** nenhuma forte. Pode ser prototipado isoladamente.

## 1. Contexto

`app/services/production_resume.py:retake_stage()` tem, no caminho efetivo lido:

```python
def retake_stage(self, *, pipeline_id, out_dir, stage_name):
    if not stage_name or not isinstance(stage_name, str):
        return ResumeResult(ok=False, message="stage_name is required")
    return self.resume_production(...).__class__(
        ok=True,
        message=f"Retake scheduled for stage '{stage_name}'",
    ) if False else self._retake_record_only(  # ← `if False`
        pipeline_id=pipeline_id,
        out_dir=out_dir,
        stage_name=stage_name,
    )
```

A expressão `if False else` garante que **somente** `_retake_record_only` é executado. Esse método apenas:

1. Carrega o estado anterior do pipeline via `get_pipeline_state`.
2. Anexa um evento `retake` em `production_events`.
3. Retorna `ResumeResult(ok=True, message="Retake recorded for stage '<X>' (event #<N>).")`.

Não há chamada a `director_pipeline.resume_pipeline`. Não há preparação de nova tentativa. Não há despacho de job. Não há mudança de `status` em `runs`.

O teste `tests/test_production_resume.py:test_retake_stage_records_event` passa porque **verifica apenas o registro do evento**, não o efeito real. O nome do teste é literalmente `records_event`.

**Impacto operacional (do dossiê seção 10):**

- UI/MCP/API chamam `retake_stage` esperando regeneração de mídia.
- O sistema responde `ok=True` com mensagem otimista.
- Nenhum render é despachado. Nenhum artifact novo aparece.
- O usuário percebe quando tenta usar a nova "tomada" — que não existe.
- Catálogo fica inconsistente: registrou evento sem ter gerado trabalho correspondente.

## 2. Requisitos

### 2.1 Comportamento esperado

`retake_stage` deve, em ordem:

1. **Validar entrada**: `stage_name` não-vazio (já existe).
2. **Resolver pipeline**: aceita `pipeline_id` OU `production_id` (já existe via `get_pipeline_state`).
3. **Verificar estado**: pipeline deve existir; senão retorna `ok=False` com mensagem clara (já existe).
4. **Verificar idempotência**: se já existe um `retake` para `(pipeline_id, stage_name, idempotency_key)` nos últimos N minutos (configurável; padrão 10 min), retornar o resultado anterior sem despachar de novo.
5. **Resolver executor canônico**: usar o mesmo executor que `resume_production` usa (`director_pipeline.resume_pipeline` ou wrapper injetável).
6. **Preparar nova tentativa**: incrementar `attempt` no payload do snapshot antes de despachar.
7. **Despachar**: chamar o executor com `pipeline_id`, `out_dir`, e um sinalizador `stage_filter=[stage_name]` para que apenas aquela etapa rode (não o pipeline inteiro).
8. **Persistir nova Run**: criar `attempt=N+1` no `runs` com status `running` ou `accepted`.
9. **Emitir evento `retake`** com referência ao job_id aceito.
10. **Retornar `ResumeResult`** com `run_id`, `production_id`, `attempt=N+1` e mensagem descritiva.

### 2.2 Fora de escopo

- Reescrever `resume_production` (continua funcionando; só a fachada de retake está quebrada).
- Adicionar suporte a "retomada de difusão interna" (depende do backend; não universal).
- Substituir a fila de jobs — reusar o caminho canônico.
- Modificar schema SQLite (mantém compatibilidade com v2.5.2).
- Reescrever testes existentes — preservar contrato `test_retake_stage_records_event` (que continua passando) **e** adicionar novos testes para o efeito real.

### 2.3 Critérios de aceite (do dossiê seção 10.3, literal)

- Um pedido de retake válido provoca **exatamente um despacho lógico** (contador do executor fake + 1 por chamada).
- Retentativa de transporte com mesma `idempotency_key` **não cria outro job**.
- Etapa inexistente **falha antes de criar trabalho** (`stage_name` desconhecido → 400/422 sem evento gravado).
- A tomada anterior e seus arquivos **permanecem disponíveis**.
- A saída nova é ligada à produção, tentativa e etapa corretas.
- Nenhum `ok: true` é interpretado como conclusão sem verificação da saída (contrato permanece na resposta; testes verificam o despacho).

### 2.4 Critérios de aceite adicionais (específicos desta spec)

- O evento `retake` registrado passa a incluir `job_id` (id do despacho) além de `stage` e `pipeline_id`.
- A fachada aceita `idempotency_key` opcional no parâmetro; quando ausente, deriva um hash do payload.
- O método nunca bloqueia: sempre retorna após ≤ 5 s em caminho feliz (despacho é assíncrono; fachada apenas registra `accepted`).
- O bug do `if False` desaparece (a expressão `if X else _retake_record_only(...)` se torna `return self._retake_dispatch(...)` direto, sem `if False`).

## 3. Contrato

### 3.1 Novo método na fachada

```python
# app/services/production_resume.py
def retake_stage(
    self,
    *,
    pipeline_id: str,
    out_dir: str,
    stage_name: str,
    idempotency_key: Optional[str] = None,
    executor: Optional[Callable[..., tuple[bool, str]]] = None,
) -> ResumeResult:
    """Despacha uma nova tentativa focada em stage_name.

    Args:
        pipeline_id: id do pipeline (ou production_id, aceito por get_pipeline_state).
        out_dir: workspace_id onde a nova tentativa será materializada.
        stage_name: nome da etapa (deve estar em snapshot["stages"]).
        idempotency_key: chave opcional; se ausente, derivada de pipeline_id+stage_name.
        executor: callable opcional (pipeline_id, out_dir, stage_name) -> (ok, message).
                  Default: director_pipeline.resume_pipeline (lazy).
    """
```

### 3.2 Mensagens e status

| Caso | ok | message | attempt |
|---|---|---|---|
| Sucesso | True | "Retake accepted for stage 'image' (run attempt 2)" | N+1 |
| stage_name vazio | False | "stage_name is required" | None |
| Pipeline inexistente | False | "No saved state for this pipeline." | None |
| Etapa inexistente no snapshot | False | "Stage 'X' not in pipeline; available: ['plan', 'image', 'video']" | None |
| Idempotente (mesma chave em janela) | True | "Retake already accepted for stage 'X' at <timestamp> (event #<N>)" | N (não incrementa) |
| Executor falhou | False | "Retake executor returned: <message>" | None |

### 3.3 Evento `retake` estendido

Payload antes:
```json
{"stage": "image", "pipeline_id": "pipe-1"}
```

Payload depois:
```json
{
  "stage": "image",
  "pipeline_id": "pipe-1",
  "run_id": "run_legacy_…",
  "production_id": "production_legacy_…",
  "attempt": 2,
  "idempotency_key": "ab12cd34…",
  "job_id": "job_legacy_…",
  "outcome": "accepted"
}
```

### 3.4 Helper de idempotência

```python
def _is_recent_duplicate(
    store: ProductionStore,
    *,
    pipeline_id: str,
    stage_name: str,
    idempotency_key: str,
    window_seconds: int = 600,
) -> Optional[dict[str, Any]]:
    """Return the most recent retake event matching this idempotency_key
    if it was created within window_seconds. Otherwise return None."""
```

Janela configurável por settings (default 600s = 10 min). Após esse tempo, novo pedido com mesma chave é tratado como novo.

## 4. Plano

### 4.1 Fase 0 — Preparação (dentro da política Reversa)

Antes de mexer em `app/`, usuário deve liberar `allowedPaths` em `.reversa/reversa-config.json`. Esta spec descreve **o que fazer**; a execução depende de autorização.

### 4.2 Fase 1 — Correção mínima (correção do `if False`)

1. Editar `app/services/production_resume.py:retake_stage` para chamar `self._retake_dispatch(...)` em vez de `_retake_record_only(...)`.
2. Adicionar `_retake_dispatch(...)` ao lado de `<_retake_record_only(...)`, mantendo o último como `_retake_record_only_DEPRECATED` (a ser removido em versão futura) para preservar compatibilidade de testes.
3. Adicionar parâmetro `idempotency_key` opcional.

### 4.3 Fase 2 — Helper de idempotência

1. Criar `app/services/production_resume_idempotency.py` com a função `_is_recent_duplicate(store, ...)`.
2. Adicionar índice opcional `idx_production_events_kind_payload` em `production_events` se performance justificar (medir antes).
3. Documentar janela configurável em `app_state_db.py` (campo `retake_idempotency_window_seconds`).

### 4.4 Fase 3 — Executor injetável

1. Adicionar parâmetro `executor` em `_retake_dispatch` (já presente em `__init__` como `pipeline_resume`).
2. Validar que `executor` aceita `stage_name` (compat: fallback para `resume_pipeline` sem filtro se executor não suportar).
3. Para Director, o executor alvo é `services.director_pipeline.resume_pipeline` com um wrapper que:
   - aceita `(pipeline_id, out_dir, stage_filter)`;
   - despacha apenas o stage;
   - retorna `(ok, message)`.

### 4.5 Fase 4 — Testes

Adicionar em `tests/test_production_resume.py`:

1. `test_retake_stage_dispatches_executor_when_stage_valid` — confirma que executor fake recebe chamada.
2. `test_retake_stage_records_dispatch_event_with_job_id` — evento inclui job_id.
3. `test_retake_stage_increments_attempt` — `attempt` no ResumeResult é N+1.
4. `test_retake_stage_idempotency_same_key_returns_existing` — segunda chamada com mesma key não cria novo evento nem chama executor de novo.
5. `test_retake_stage_unknown_stage_fails_before_executor` — falha sem despachar.
6. `test_retake_stage_preserves_previous_take_files` — files da tomada anterior não são apagados.
7. `test_retake_stage_concurrent_calls_get_distinct_attempts` — duas chamadas concorrentes recebem attempts diferentes (lock do store garante; testar com threads).

Manter `test_retake_stage_records_event` (passa com a correção).

### 4.6 Fase 5 — Documentação

1. Atualizar `docs/PRODUCTION_RUN.md` com a nova semântica.
2. Adicionar `docs/RETAKE.md` com exemplos de uso, edge cases e FAQ.
3. Atualizar `CHANGELOG.md` com a correção e a adição de idempotência.

### 4.7 Fase 6 — Release notes

Entrada na próxima minor (v2.6 ou v3.0) descrevendo:
- Correção do retake (era apenas registro, agora despacha).
- Idempotência (mesma chave em 10 min não duplica).
- Compatibilidade: testes antigos continuam passando.

## 5. Testes de aceitação

- `pytest tests/test_production_resume.py -q` passa (todos os antigos + 7 novos).
- `pytest tests/test_productions_router.py tests/test_director_pipeline_e2e.py -q` continua passando.
- `python scripts/run_all_prototypes.sh` permanece verde.
- Manual: abrir UI, clicar "Retake" em uma produção existente → nova tentativa é criada em `runs` com `attempt=N+1` e status `running`.
- Manual: clicar "Retake" duas vezes rapidamente → segunda chamada não cria nova tentativa; UI mostra "já em andamento".
- Manual: tentar retake com `stage_name="foo"` em pipeline que tem `["plan", "image", "video"]` → falha sem despachar; mensagem lista estágios válidos.

## 6. Critérios de pronto

- `docs/RETAKE.md` publicado.
- Testes 100% passando.
- Smoke: chamar `retake_stage` em produção real (banco de teste com snapshot) confirma despacho.
- Release notes redigidas.
- Validação contra fixture "A luz da oficina" do dossiê: retake do S09 (lâmpada acende) regenera apenas o S09.

## 7. Riscos

- **Risco:** executor real (`director_pipeline.resume_pipeline`) não suporta filtro por stage. **Mitigação:** wrapper que filtra o payload; se wrapper não conseguir filtrar, executa tudo mas emite evento `retake` com `partial=true`. Documentar.
- **Risco:** dois pedidos concorrentes com chaves diferentes para o mesmo pipeline podem levar a `attempt` duplicado. **Mitigação:** o lock `BEGIN IMMEDIATE` do store serializa escrita; testar com threads.
- **Risco:** janela de 10 min é arbitrária. **Mitigação:** configurável via setting; default documentado.
- **Risco:** remover `_retake_record_only` quebra consumidores que importam diretamente. **Mitigação:** manter como `_retake_record_only_DEPRECATED` por uma minor; remover só depois de verificar `grep` em `app/` e `ui/`.

## 8. Apêndice — Anexo do dossiê aplicado

Esta spec implementa diretamente o roteiro de reprodução definido no dossiê:

> **Apêndice C — Roteiro de reprodução do primeiro bug funcional**
>
> O teste do retake deve ser escrito antes da correção e produzir falha controlada no código de referência, quando o caminho ainda for apenas de registro:
>
> 1. Construir ProductionStore com banco temporário e inserir produção/run/etapas de fixture.
> 2. Injetar executor fake que recebe `execution_request`, persiste job estável e conta chamadas.
> 3. Invocar a fachada e, em outro teste, a rota da aplicação efetivamente montada.
> 4. Esperar request aceito, ID de produção correto e uma chamada do executor; contar zero chamadas deve falhar no teste que exige render.
> 5. Simular callback do job com mídia F0; verificar nova tomada e publicação.
> 6. Reenviar a mesma chave; esperar mesmo request e nenhuma chamada adicional.
> 7. Inspecionar versão anterior, correlação com snapshot e evento final.

Cada item do roteiro acima corresponde a um teste listado na seção 4.5.