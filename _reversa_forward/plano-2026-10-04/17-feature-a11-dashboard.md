# Feature A11 — Dashboard de trabalho

**Origem:** [plano A11](../../_reversa_sdd/auditoria-2026-10-04/plano-de-acao.md).
**Ciclo:** 2.
**Prioridade:** P1.
**Dependência:** A09.

## 1. Contexto

O Dashboard atual é principalmente consulta de pipelines. Quando vazio, falta CTA útil. Quando há produção, falta "continuar / revisar" evidente.

## 2. Requisitos

### 2.1 Comportamento esperado

- **Sem produção**:
  - CTA principal: "Criar projeto" (link para `/projects/new`).
  - Seção "Primeiros passos" com 3 itens (criar, escolher modelo, gerar).
- **Com produção**:
  - Cartão "Continuar último" → último projeto com briefing aberto.
  - Lista resumida de fila com estado e ação ("Abrir", "Cancelar", "Revisar").
  - Lista de últimas saídas (com mídia).
  - Cada cartão tem link direto à seção certa (estúdio/queue/editor).

### 2.2 Fora de escopo

- Personalização do dashboard pelo usuário (release posterior).

## 3. Contrato

```ts
// ui/src/dashboard/types.ts
export interface DashboardSummary {
  continueProject?: { id: string; name: string; section: Section; updatedAt: string };
  queue: Array<{ id: string; label: string; status: string; action?: string }>;
  recentOutputs: Array<{ id: string; thumb: string; projectId: string }>;
}
```

API endpoint (backend):

```
GET /api/dashboard/summary
→ 200 DashboardSummary
→ 401 se auth desabilitada e token ausente (após A02)
```

## 4. Plano

1. Backend: novo router `app/routers/dashboard.py` com `GET /api/dashboard/summary`. Agrega de `projects`, `queue`, `outputs`.
2. Frontend: hook `useDashboardSummary` que usa `apiFetch` (A01) com cache simples (TTL 30 s).
3. Componente `<DashboardSummary>` que renderiza os três blocos.
4. Substituir `DashboardPage` por `<DashboardSummary>` + empty state.
5. Testar com fixtures: sem nada, com fila vazia, com fila ocupada, com outputs.

## 5. Testes de aceitação

- `GET /api/dashboard/summary` retorna 200 com payload válido.
- Dashboard mostra CTA quando vazio.
- Dashboard mostra "Continuar" para último projeto com briefing ativo.
- Fila no dashboard reflete estado real (não polui quando vazia).

## 6. Critérios de pronto

- Acessibilidade: foco, navegação por teclado, contraste.
- Carregamento: skeletons enquanto `summary` não chega.

## 7. Riscos

- Endpoint novo pode ser custoso. **Mitigação:** agregação por id; cache TTL 30 s no servidor.
- Lista de últimas saídas pode crescer. **Mitigação:** limitar a 8.