# Feature A03 — Teclado e foco de diálogos

**Origem:** [diagnóstico D01](../../_reversa_sdd/auditoria-2026-10-04/diagnostico.md#d01--navgaçaça-por-teclado-bloqueada) e [plano A03](../../_reversa_sdd/auditoria-2026-10-04/plano-de-acao.md).
**Ciclo:** 0 — falhas verificadas, pequeno escopo.
**Prioridade:** P0.

## 1. Contexto

`ui/src/main.tsx` intercepta `Tab` em captura no `window` e chama `preventDefault()` globalmente. A inspeção confirmou que o foco permaneceu no botão “New project” após `Tab`. O comportamento afeta:

- navegação entre seções da Sidebar;
- troca de campos em formulários (incluindo New Project);
- fechamento de diálogos via `Escape`;
- ativação de botões via `Space`/`Enter`.

🟢 Achado confirmado por inspeção de código e teste manual no navegador.

## 2. Requisitos

### 2.1 Comportamento esperado

- `Tab`/`Shift+Tab` percorrem o foco na ordem natural do DOM, parando em elementos focalizáveis.
- Modais e popovers armadilham o foco (`focus trap`) enquanto estiverem abertos.
- `Escape` fecha modais/popovers (com confirmação de fechamento quando houver alterações não salvas).
- O foco é devolvido ao elemento que abriu o diálogo ao fechar.
- Atalhos históricos de indentação (`Tab`/`Shift+Tab` em textarea/editor de texto) são preservados **apenas** dentro do componente responsável, com atalho explícito opcional (ex.: `Ctrl+]/Ctrl+[`).
- Atalhos com `mod+key` (ex.: `Ctrl+Enter` para enviar) seguem funcionando e **não** disparam quando o foco está em um campo de texto curto.

### 2.2 Fora de escopo

- Reorganização do `Sidebar` em outro componente.
- Reescrita do sistema de modais (pré-requisito da cobertura A08).
- Tradução de novos atalhos.

## 3. Contrato

### 3.1 Sem alteração de API HTTP

Esta feature é puramente UI. Nenhum endpoint é adicionado ou modificado.

### 3.2 Contrato de comportamento (testável)

```ts
// ui/src/a11y/keyboard.ts
export interface KeyboardPolicy {
  /** Bloqueia Tab globalmente? Deve ser false por padrão. */
  blockGlobalTab: false;
  /** Atalhos mod+key permitidos no app. */
  appShortcuts: ReadonlyArray<{ combo: string; action: string }>;
  /** Dentro de qual seletor o Tab faz indentação? null = nunca. */
  indentScopeSelector: string | null;
}

export const DEFAULT_KEYBOARD_POLICY: KeyboardPolicy = {
  blockGlobalTab: false,
  appShortcuts: [
    { combo: "mod+k", action: "openCommandPalette" },
    { combo: "mod+enter", action: "submitActiveForm" },
  ],
  indentScopeSelector: '[data-allow-indent="true"]',
};
```

## 4. Plano de mudança

1. **Localizar** o listener de `Tab` em `ui/src/main.tsx`. Confirmar que intercepta no `window` em fase de captura.
2. **Remover** o listener global. Se houver motivo legítimo (ex.: atalho customizado), mover o handler para o componente que de fato precisa dele e limitar via `event.target`.
3. **Introduzir** `ui/src/a11y/keyboard.ts` com a política padrão acima e helper `installKeyboardListener(policy)` que pode ser usado em pontos que precisem.
4. **Auditar** os usos de `preventDefault` em listeners de teclado (`grep -rn 'preventDefault' ui/src`) e classificar cada um em:
   - `manter` — atalho intencional em escopo correto;
   - `mover para componente` — listener no componente, em vez de delegação global.
6. **Modais**: confirmar que `WelcomeModal` e `NewProjectDialog` têm `role="dialog"`/`aria-modal`, foco inicial no primeiro focalizável e retorno de foco ao fechar. Se faltarem, mover para o componente compartilhado (A08) **ou** aplicar mudança mínima que adicione:
   - `tabIndex={-1}` no container, foco inicial programático no primeiro item focalizável;
   - listener de `Escape` no escopo do diálogo;
   - retorno de foco no `useEffect` de cleanup.
8. **Indentação**: implementar atalho explícito `Ctrl+]` / `Ctrl+[` em textareas do Director/Editor; nunca interceptar `Tab` globalmente.

## 5. Testes de aceitação

### 5.1 Teste manual (checklist em [`checklists/keyboard.md`](../checklists/keyboard.md))

- [ ] Em desktop, pressionar `Tab` na home move o foco sequencialmente por **todos** botões da Sidebar.
- [ ] Em New Project, `Tab` percorre `name → destination → type → ... → cancel → create`.
- [ ] `Shift+Tab` inverte a ordem.
- [ ] `Escape` fecha o diálogo e devolve foco ao gatilho.
- [ ] Em um campo multiline (Director/Editor), `Ctrl+]` indenta e `Ctrl+[` desindenta. `Tab` continua navegando o foco.

### 5.2 Teste automatizado (Playwright)

```ts
// ui/tests/e2e/keyboard.spec.ts
import { test, expect } from "@playwright/test";

test("Tab moves focus through sidebar", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-testid="new-project"]').focus();
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).not.toHaveAttribute(
    "data-testid",
    "new-project",
  );
});

test("Escape closes dialog and returns focus", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-testid="new-project"]').click();
  await page.locator('[data-testid="new-project-name"]').focus();
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-testid="new-project"]')).toBeFocused();
});
```

### 5.3 Teste de regressão mínimo

Adicionar em `ui/src/test/keyboard.test.ts` (a criar):

```ts
import { describe, it, expect } from "vitest";
import { DEFAULT_KEYBOARD_POLICY } from "../a11y/keyboard";

describe("keyboard policy", () => {
  it("does not block Tab globally", () => {
    expect(DEFAULT_KEYBOARD_POLICY.blockGlobalTab).toBe(false);
  });
  it("indent scope is opt-in", () => {
    expect(DEFAULT_KEYBOARD_POLICY.indentScopeSelector).toBe(
      '[data-allow-indent="true"]',
    );
  });
});
```

## 6. Critérios de pronto

- `npm run lint` passa em todos os arquivos modificados.
- `npm run test` (Vitest) passa, incluindo o teste novo acima.
- Playwright (se instalado) passa nos testes 5.2. Se ainda não instalado, registrar em A06.
- Inspeção manual: navegação por teclado funcional na home, New Project, Director e Studio.
- `CHANGELOG.md`: entrada em "Unreleased" com referência à issue.

## 7. Riscos e mitigações

- **Risco:** remover o listener global pode quebrar um atalho legítimo escondido. **Mitigação:** auditoria `grep preventDefault` antes da remoção; revisar changelog.
- **Risco:** foco preso em diálogo que não tem lógica de trap. **Mitigação:** fallback mínimo (Escape + retorno de foco) é parte do critério de pronto.
- **Risco:** componentes que ainda dependem do listener global param de funcionar. **Mitigação:** smoke test manual após mudança; mapear componentes por rota.

## 9. Pré-condições

- A04 (lint) limpa os arquivos tocados, ou é feita em conjunto.
- A08 pode paralelizar: se A08 entrar antes, esta feature reaproveita o componente de diálogo; se A08 entrar depois, aplicar mudança mínima local.

## 10. Pós-condições

- A02 pode prosseguir assumindo que `Window`-level não bloqueia mais nada.
- A15 (Error Boundary) pode usar `restoreFocus` quando trocar de seção sem suporte do teclado.