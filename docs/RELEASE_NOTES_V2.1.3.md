# Cue Studio v2.1.3

**Release date:** 2026-09-20
**Tag:** `v2.1.3`
**Focus:** Complete refactor of the Director panel — three-column left layout.

## Highlights

- **Director panel rebuilt around a three-column left layout.**
  The old top-level tabs are gone. Status, plan and clip columns now
  stack vertically on the left half of the viewport while the
  right column carries only per-take controls and Style Bibles.
- **Sub-header removed.** The redundant Director sub-header was
  dropped; column-aware status moves into each column's rodapé.
- **Dashboard lifted to the first top-tab.** Director is no longer
  the implicit landing tab — Dashboard leads so users see recent
  productions before planning a new take.
- **Audio source picker rewritten.** The legacy `<select>`-style
  combobox was replaced by three equal-width tabs (upload, library,
  Director-generated) at the top of the audio step.
- **Studio moved to its own shell tab** as `Laboratório Manual`, so
  Director and Studio no longer share the same tab strip and compete
  for vertical space.
- **Layout pinned to the viewport.** Director columns now constrain
  their own height so the rodapé lands above the status bar instead
  of being pushed off-screen on shorter windows.
- **Per-column rodapé with column-aware status.** Each Director
  column now shows its own status line at the bottom — Status column
  reports pipeline phase, Plan column reports plan completeness,
  Clips column reports generation progress.

## Bug fixes

- **`useStore` lifted out of conditional IIFE in `DirectorStatusPanel`.**
  Hooks must run unconditionally; the previous code violated React's
  rules of hooks and produced a runtime warning in dev builds.
- **Analysis selector reuse in `DirectorPlanColumn`.** Reusing the
  memoized selector avoids hook count mismatches when the analysis
  payload toggles between `null` and a populated value.
- **Ref-empty-state copy.** Verbose multi-paragraph text replaced
  with a single square add card to match the visual weight of
  neighboring empty states.

## Verification

| Gate | Result |
| --- | --- |
| `npm run build` | ✅ pass |
| `npm run lint` | ✅ pass |
| `npm run test:store` | ✅ pass |
| `pytest tests/ -q` | ✅ pass (no regressions vs v2.1.1 baseline) |

## Files of interest

- `ui/src/components/Sidebar/DirectorPanel.tsx` — three-column refactor
- `ui/src/components/Sidebar/DirectorStatusPanel.tsx` — hook-order fix
- `ui/src/components/Sidebar/DirectorPlanColumn.tsx` — selector reuse
- `ui/src/components/Sidebar/DirectorClipsColumn.tsx` — column layout
- `ui/src/components/Shell/DashboardTab.tsx` — promoted to first tab
