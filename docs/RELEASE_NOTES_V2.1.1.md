# Cue Studio v2.1.1

**Release date:** 2026-09-19
**Tag:** `v2.1.1`
**Focus:** Stability, security and UX polish on top of v2.1 (Project Setup).

## Highlights

- **Director cancel infrastructure completed.** The `cancelDirectorAnalyze`,
  `cancelDirectorTrackGen` and `cancelDirectorImageGen` actions in
  `ui/src/stores/useStore.ts` now abort the in-flight request via
  `AbortController`, invalidate the resolver sequence, close the
  matching UI step and (image-gen only) call `api.cancelJob` on the
  job server-side. `cancelPlan` orchestrates all three and returns a
  structured payload with `cancelledAnalyze`, `cancelledTrackGen` and
  `cancelledImageGen` booleans. The `DirectorImageGenProgress.status`
  literal gained `'cancelled'`.
- **`AbortSignal` plumbing in `ui/src/api/client.ts`.** `analyzeAudio`,
  `generateMusic` and `uploadAudio` accept an optional `signal` and
  plug it into the `fetch` call. Cancellation is now real and not just
  a sequence bump.
- **Late-failure protection.** `directorAnalyzeAndPlan` and
  `directorGenerateStartImages` compare the captured sequence on entry
  with the global sequence in their catch block and bail out early if
  they differ — preventing a cancelled state from being overwritten by
  a stale error.
- **Studio persistence extraction.** New `ui/src/stores/studioPersistence.ts`
  exposes `saveModeSettings`, `loadModeSettings`, `modeBlobToLoraIdKeyed` /
  `modeBlobToFilenameKeyed`, `stripEphemeralParams` and
  `persistStickyStudioPreferences`. `useStore.ts` keeps the legacy
  `_saveSettings` / `_loadSettings` aliases and slices continue to
  receive persistence helpers via `dependencies`.
- **Studio slice contracts locked in `test:store`.** Coverage for
  hydration of single visibility per boot, v1→v11 defaults upgrade,
  model toggle / bulk / reset persistence, `selectModel` LoRA reset,
  per-mode `toggleLora` / `setLoraWeight` lifecycle, `recast` / `restyle`
  recipe model swaps to SCAIL-2, `retake` restore, repaint clamp to 5,
  recast derive/clamp and creation routing that rejects omni-only
  frame inputs.

## Bug fixes

- **`useStore.ts` build regression.** A dead import of
  `recommendedH3OmniSequenceProfile` from `studioModelSlice` broke the
  official build; removed. `npm run build`, `npm run lint`,
  `npm run test:store` and `npm run test:control` now exit zero.

## Verification

| Gate | Result |
| --- | --- |
| `npm run build` | ✅ pass |
| `npm run lint` | ✅ pass |
| `npm run test:store` | ✅ pass (5 consecutive runs) |
| `npm run test:control` | ✅ pass |
| `pytest tests/ -q` | ✅ 171 passed, 2 skipped, 4 deselected, 33 subtests |

## Files of interest

- `ui/src/api/client.ts` — `signal?: AbortSignal` on three endpoints
- `ui/src/stores/useStore.ts` — three new cancel actions + `cancelPlan`
- `ui/src/stores/studioPersistence.ts` — new persistence layer
- `ui/src/types/index.ts` — `DirectorImageGenProgress.status` literal
