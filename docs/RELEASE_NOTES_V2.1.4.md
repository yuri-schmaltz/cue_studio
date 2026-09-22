# Cue Studio v2.1.4

**Release date:** 2026-09-20
**Tag:** `v2.1.4`
**Focus:** Performance optimizations on the Director panel — left column.

## Highlights

The left column of the Director panel (which now carries the heaviest
state — analysis payload, plan, categorized clips, beat distribution,
lyrics and speaker samples) was memoized end-to-end. The previous
implementation recomputed several derived arrays on every render of
the surrounding tree, including frames that did not depend on them
(state updates from any of the three columns).

### `ui/src/components/Sidebar/DirectorPanel.tsx`

- **`useMemo` for `analysisMemo`.** Avoids recompute on every render;
  includes a guard clause for early-exit when the analysis payload is
  empty.
- **`useMemo` for `categorizedClips`.** Memoizes the categorization by
  speaker; recomputes only when the source clips array or the speaker
  map changes.
- **`useMemo` for `processedClips`.** Avoids recompute on each frame.
- **`useMemo` for `beatDistribution`.** Computed only when the
  analysis payload changes, not on every parent render.
- **`useMemo` for `totalClipDuration`.** Caches the running total so
  resizing the column does not pay the O(n) sum again.
- **`useMemo` for `refImagePreview`.** Prevents `URL.createObjectURL`
  from being called on every render — important because previously
  each render leaked one URL.
- **`useMemo` for `speakerSamples`.** Memoized alongside the lyrics
  block so the lyric cards do not churn when unrelated state updates.

## Files changed

| File | Insertions | Deletions |
| --- | --- | --- |
| `ui/src/components/Sidebar/DirectorPanel.tsx` | +83 | −80 |

## Verification

| Gate | Result |
| --- | --- |
| `npm run build` | ✅ pass |
| `npm run lint` | ✅ pass |
| `npm run test:store` | ✅ pass |
| Manual render profiling | ✅ no `createObjectURL` leak, no `Categorize clips` work on unrelated state updates |

## Upgrade notes

No user-visible changes. Pure performance pass; the user-visible
behavior of the Director panel is unchanged from `v2.1.3`. The diff
is intentionally narrow — `DirectorPanel.tsx` only — so this is a
safe drop-in upgrade from any `v2.1.x` build.
