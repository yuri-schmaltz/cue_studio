# Feature A14 — Fila: ações coerentes e feedback de duração

**Origem:** [plano A14](../../_reversa_sdd/auditoria-2026-10-04/plano-de-acao.md).
**Ciclo:** 2.
**Prioridade:** P1.
**Dependência:** A08.

## 1. Contexto

A fila tem tela própria e estados específicos (inspeção usou fila vazia). Cancelamento e revisão são tratados sem distinção clara.

## 2. Requisitos

### 2.1 Comportamento esperado

Estados internos expostos ao usuário com rótulos consistentes:

| Interno | Rótulo |
|---|---|
| `queued` | Aguardando |
| `preparing` | Preparando/download |
| `running` | Gerando |
| `awaiting_review` | Aguardando revisão |
| `done` | Concluído |
| `failed` | Falhou |
| `cancelled` | Cancelado |

Cada item mostra: projeto, fase, posição (quando aplicável), progresso disponível, ações válidas por estado.

- **Cancelar** só aparece em `queued/preparing/running`. Em `running` pede confirmação.
- **Revisar** só em `awaiting_review`/`done`.
- **Reabrir** só em `failed`/`cancelled`.
- Duração estimada é apresentada como **estimativa** quando incerta (sem ETA falso).

### 2.2 Fora de escopo

- Estimativa precisa por modelo (depende ao runtime de cada modelo).

## 3. Contrato

```ts
// ui/src/queue/types.ts
export type QueueState =
  | 'queued' | 'preparing' | 'running' | 'awaiting_review'
  | 'done' | 'failed' | 'cancelled';

export const QUEUE_LABELS: Record<QueueState, string> = {
  queued: 'Aguardando',
  preparing: 'Preparando/download',
  running: 'Gerando',
  awaiting_review: 'Aguardando revisão',
  done: 'Concluído',
  failed: 'Falhou',
  cancelled: 'Cancelado',
};

export const QUEUE_ACTIONS: Record<QueueState, ReadonlyArray<'cancel'|'review'|'reopen'|'download'>> = {
  queued: ['cancel'],
  preparing: ['cancel'],
  running: ['cancel'],
  awaiting_review: ['review'],
  done: ['review', 'download'],
  failed: ['reopen'],
  cancelled: ['reopen'],
};
```

## 4. Plano

1. Criar `QUEUE_LABELS` e `QUEUE_ACTIONS` em `ui/src/queue/types.ts`.
2. Substituir lógica condicional inline nos componentes da fila por leitura da tabela.
3. Para estimativa, expor `expectedSec` (calculado pelo backend) e mostrar "≈ X min" apenas quando `expectedSec !== null`.
4. Atualizar endpoint `/api/queue` para devolver `expectedSec` quando disponível.
5. Botão "Cancelar" em `running` pede modal de confirmação.

## 5. Testes de aceitação

- Cada estado exibe rótulo correto.
- Ações disponíveis batem com `QUEUE_ACTIONS`.
- Cancelamento durante running pede modal; não cancela direto.

## 6. Critérios de pronto

- Sem regressão em fila já funcional.
- Duração visível como estimativa (não ETA falso).

## 7. Riscos

- Tradução dos rótulos divergir entre lugares. **Mitigação:** `QUEUE_LABELS` único; sem strings hardcoded.