# Feature A21 — Densidade confortável e compacta

**Origem:** [plano A21](../../_reversa_sdd/auditoria-2026-10-04/plano-de-acao.md).
**Ciclo:** 4.
**Prioridade:** P2.
**Dependência:** A07 (validação com criadores).

## 1. Contexto

Tokens base: 13 px / small 12 px / xs 11 px. Diversos controles a 10–12 px. Cronograma da auditoria sugere densidade **confortável** para formulários e tarefas, **compacta** para timeline e listas técnicas.

## 2. Requisitos

### 2.1 Comportamento esperado

- Variantes de densidade por seção:
  - `comfortable` (default): texto de tarefa 14–16 px, metadados 12–13 px.
  - `compact` (timeline/listas técnicas): texto 12–13 px, metadados 11–12 px.
- Tokens em CSS (`--font-density-comfortable-task`, `--font-density-compact-list`).
- Toggle por usuário em Configurações (opcional).

### 2.2 Fora de escopo

- Tipografia nova (manter famílias atuais).

## 3. Contrato

```css
/* ui/src/styles/density.css */
:root {
  --font-task: 14px;
  --font-task-meta: 12px;
  --font-list: 12px;
  --font-list-meta: 11px;
}
[data-density="compact"] {
  --font-task: 13px;
  --font-task-meta: 11px;
  --font-list: 12px;
  --font-list-meta: 11px;
}
[data-density="comfortable"] {
  --font-task: 15px;
  --font-task-meta: 13px;
  --font-list: 13px;
  --font-list-meta: 12px;
}
```

## 4. Plano

1. Auditar uso de px literais em `ui/src/`.
3. Introduzir tokens e variantes.
4. Aplicar `data-density` em `<body>` ou `<main>`.
5. Medir com screenshot em 1440 px e revisar com 3 criadores.

## 5. Testes de aceitação

- Confortável aumenta tamanho de tarefa em ≥ 10%.
- Compacto não prejudica leitura da timeline (avaliação manual).

## 6. Critérios de pronto

- Sem texto abaixo de 11 px (exceto ícone).

## 7. Riscos

- A11y: zoom 200% pode quebrar. **Mitigação:** teste de zoom.