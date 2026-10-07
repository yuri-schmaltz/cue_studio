# ADR-002 — Restaurar navegação por teclado (remover listener global de Tab)

**Status:** Proposto.
**Data:** 2026-10-04.
**Contexto:** [diagnóstico D01](../../_reversa_sdd/auditoria-2026-10-04/diagnostico.md).

## Contexto e problema

`ui/src/main.tsx` instala um listener em fase de captura no `window` que chama
`preventDefault()` em toda `Tab`, interceptando navegação entre elementos
focalizáveis. Indivíduos que dependem de teclado ficam presos no botão "New project".

## Decisão

1. Remover o listener global de `Tab` em `ui/src/main.tsx`.
2. Indentação em textarea/editor passa a ser explícita:
   - Ctrl+] indenta, Ctrl+[ desindenta.
   - `Tab` continua navegando.
3. Diálogos implementam focus trap via `<AppDialog>` (componente compartilhado da A08).
4. `Escape` fecha diálogos com `confirmOnClose` quando há mudanças não salvas.

## Consequências

**Positivas**
- Cumpre WCAG 2.1.1 (Keyboard).
- Teclado volta a funcionar em toda a UI sem patches locais.
- Atalhos de indentação são explícitos e não interferem no foco global.

**Negativas**
- Migrar indentação para Ctrl+]/[ exige comunicação e tecla em docs.

## Alternativas

- **A. Manter listener só dentro de textareas.** Rejeitado: scope atual não cobre
  os casos `textarea` × `selecting` × vazio; o `preventDefault` global vazou.
- **B. Usar biblioteca de focus trap (FocusTrap, react-focus-lock).** Adiar para A08.