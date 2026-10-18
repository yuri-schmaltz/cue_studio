# Shared UI primitives (feature A08)

Controlled, accessible building blocks shared across the app so
dialogs, fields, errors and status displays stop drifting apart.
Every component is controlled (no internal value state) and testable
without mounting the main application.

| Component | File | Notes |
|---|---|---|
| `AppDialog` | `AppDialog.tsx` | Native `<dialog>`: `role`/`aria-modal` implicit+explicit, initial focus (honours `data-autofocus`; `TextField` mirrors its `autoFocus` prop into it), `Escape` routed through the controlled `onClose`, backdrop click, focus restore. `confirmOnClose` blocks Escape/backdrop dismissal (close becomes an explicit action). |
| `TextField` | `TextField.tsx` | Label + hint + error/success; `aria-describedby` connects `${id}-hint`, `${id}-error` (and `${id}-success`); `aria-invalid` on error. |
| `NumberField` | `NumberField.tsx` | Same contract with `inputMode="numeric"`; reports `number | ''`. |
| `Select` | `Select.tsx` | Native `<select>` combobox (platform keyboard nav), label/hint/error wiring identical to `TextField`. |
| `Button` | `Button.tsx` | `primary` / `secondary` / `ghost` variants, visible focus ring, `aria-busy` + disabled during `loading` or while an async `onClick` promise is pending. `forwardRef`. |
| `StatusBadge` | `StatusBadge.tsx` | `role="status"` for info/ok/busy, `role="alert"` for warning/error (criticality-driven semantics). |
| `ErrorState` | `ErrorState.tsx` | `role="alert"` block; explicit retry button when the failed action is repeatable (`onRetry`). |
| `EmptyState` | `EmptyState.tsx` | Icon + headline + copy + single CTA. |

Contracts live in `types.ts` (`BaseFieldProps`, `DialogProps`).

## Adoption

- `Shell/ProjectsPage.tsx` — the New project / Edit setup dialog now
  uses `AppDialog` + `TextField` + `Button` (the hand-rolled
  role/Tab-trap/Escape markup was removed).

Migration is gradual: legacy dialogs (WelcomeModal, SettingsDrawer)
keep their markup until migrated one consumer at a time.

## Tests

Unit tests per component live next to the components
(`*.test.tsx`, jsdom environment via docblock) and run with
`npm run test` (Vitest).
