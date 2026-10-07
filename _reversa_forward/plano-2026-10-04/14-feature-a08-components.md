# Feature A08 — Componentes compartilhados

**Origem:** [plano A08](../../_reversa_sdd/auditoria-2026-10-04/plano-de-acao.md).
**Ciclo:** 1 — fundação UX.
**Prioridade:** P1.
**Dependência:** A03 (teclado) pronta, A07 (jornadas) com mapa.

## 1. Contexto

A inspeção identificou diálogos com comportamentos distintos (`WelcomeModal` sem `role="dialog"`, New Project com estrutura diferente, Settings sem trap de foco). Erros são renderizados sem padrão. Não existe campo compartilhado com label, erro e hint consistentes.

## 2. Requisitos

### 2.1 Comportamento esperado

Componentes em `ui/src/components/shared/`:

- `<AppDialog>` — `role="dialog"`, `aria-modal`, foco inicial, `Escape` fecha, retorna foco.
- `<TextField>` — `label`, `aria-describedby` apontando para hint e erro, estados de erro e sucesso.
- `<NumberField>` — idem com `inputMode="numeric"`.
- `<Select>` — combobox com keyboard nav, label e erro.
- `<Button>` — variantes primária/secundária/ghost; foco visível; `aria-busy` durante promise.
- `<StatusBadge>` — semântica `status`/`alert` conforme criticidade.
- `<ErrorState>` — retry explícito quando a ação é repetível.
- `<EmptyState>` — CTA clara.

Cada componente é **controlado** e testa sem dependência do app principal. A11y mínima: foco, labels, navegação por teclado.

### 2.2 Fora de escopo

- Reescrever componentes existentes (migração gradual).
- Adicionar biblioteca de UI externa (Manter, Radix ou Headless só se o time aprovar).

## 3. Contrato (TypeScript)

```ts
// ui/src/components/shared/types.ts
export interface BaseFieldProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
}

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  primaryAction?: { label: string; onClick: () => void; loading?: boolean };
  secondaryAction?: { label: string; onClick: () => void };
  /** Bloqueia fechamento se houver mudanças. */
  confirmOnClose?: boolean;
}
```

## 4. Plano

1. Definir `types.ts` acima.
2. Implementar `<AppDialog>` usando `<dialog>` nativo (HTML) com `useEffect` para foco/retorno.
3. Implementar `<TextField>`/`<NumberField>`/`<Select>` com `aria-describedby` único apontando para `${id}-hint-${id}-error`.
4. Implementar `<Button>` com variantes; usar `forwardRef`.
5. Implementar `<StatusBadge>`, `<ErrorState>`, `<EmptyState>` com tokens de cor semânticos.
6. Migrar primeiro consumidor: `NewProjectDialog`.
7. Smoke + Playwright em uma página de demo `prototypes/shared-components.html`.

## 5. Testes de aceitação

- Unit Vitest por componente (render, label, erro, foco).
- Storybook (se existir) ou `prototypes/shared-components.html` com casos visíveis.
- Foco + Escape + retorno funcionais em `<AppDialog>` (validar com `checklists/keyboard.md`).
- `aria-describedby` conecta hint e erro em campos.

## 6. Critérios de pronto

- 1 consumidor real migrado.
- Documentação mínima em `ui/src/components/shared/README.md`.
- Nenhum alerta novo do `eslint-plugin-jsx-a11y` introduzido.

## 7. Riscos

- Migrar consumidores quebra testes visuais. **Mitigação:** migração um consumidor por vez.
- Componentes virarem "casca" sem uso. **Mitigação:** gate de adoção: nenhum novo `<div>` modal nos PRs sem justificativa.