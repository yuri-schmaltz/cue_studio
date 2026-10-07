# Feature A23 — Foco visível e ARIA

**Origem:** [plano A23](../../_reversa_sdd/auditoria-2026-10-04/plano-de-acao.md).
**Ciclo:** 4.
**Prioridade:** P2.
**Dependência:** A08, A03.

## 1. Contexto

Foco visível depende de tema. Anúncios de progresso sem `aria-live`. ARIA presente, mas **não declarado** como conformidade (auditoria).

## 2. Requisitos

### 2.1 Comportamento esperado

- Foco visível com `outline` ou anel de 2 px em ambos os temas.
- Anúncios de progresso em `aria-live="polite"`.
- Modais com `role`/`aria-modal` (já em A08).
- Foco devolvido ao fechar modal.
- Movimento reduzido: `@media (prefers-reduced-motion)` desativa animações decorativas.

### 2.2 Fora de escopo

- Auditoria completa WCAG 2.2 AA (lifecycle release).

## 3. Contrato

```css
/* ui/src/styles/focus.css */
:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

## 4. Plano

1. Adicionar CSS acima globalmente.
2. Auditar uso de `aria-live`.
3. Adicionar `<div aria-live="polite" id="a11y-status" />` no `<body>`.
4. Helper `announce(msg)` que escreve nesse nó.

## 5. Testes de aceitação

- Foco visível em 100% dos focalizáveis.
- Tab + Shift+Tab percorrem ordem correta.
- `prefers-reduced-motion` zera animações.

## 6. Critérios de pronto

- Auditoria com leitor de tela (NVDA/VoiceOver) em uma jornada principal.

## 7. Riscos

- Animações decorativas são parte da identidade visual. **Mitigação:** `prefers-reduced-motion` só desativa movimento, não cor.