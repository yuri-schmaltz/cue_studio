# Feature A22 — Alvos de toque ≥ 44 px

**Origem:** [plano A22](../../_reversa_sdd/auditoria-2026-10-04/plano-de-acao.md).
**Ciclo:** 4.
**Prioridade:** P2.
**Dependência:** zero.

## 1. Contexto

Inspeção encontrou controles com uma dimensão < 24 px. WCAG 2.2 recomenda ≥ 44×44 px para alvos de toque.

## 2. Requisitos

### 2.1 Comportamento esperado

- Botões primários e ícones clicáveis ≥ 44×44 px.
- Itens de lista com tap-target ≥ 44 px ou com **espaçamento** ≥ 24 px entre si (alternativa WCAG).
- Sliders/inputs com hit area ≥ 24 px vertical.

### 2.2 Fora de escopo

- Reescrever biblioteca de UI.

## 3. Contrato

```css
/* ui/src/styles/tap-target.css */
.touch-target {
  min-height: 44px;
  min-width: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.icon-button { padding: 10px; } /* 24px + 20 = 44px se ícone 24px */
```

## 4. Plano

1. Auditar `ui/src/components/` com `grep -rn "size-[0-9]"` para encontrar tamanhos pequenos.
2. Aplicar classe `.touch-target` em botões de ícone, fechar, dropdown.
3. Aumentar `padding` em rows de lista.
4. Testar com DevTools simulando touch.

## 5. Testes de aceitação

- Nenhum controle principal abaixo de 44 px.
- Slider ajustável com toque em viewport pequeno.

## 6. Critérios de pronto

- Snapshot em 390 px mostra alvos confortáveis.
- A11y review com teclado confirma equivalentes.

## 7. Riscos

- Visual fica "esparso". **Mitigação:** densidade compacta para desktop.