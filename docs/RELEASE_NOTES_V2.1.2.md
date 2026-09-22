# Cue Studio v2.1.2

**Release date:** 2026-09-19
**Tag:** `v2.1.2` (internal — superseded by `v2.1.3`)
**Focus:** Stabilization window between cancel work and the Director refactor.

## Status

This tag was reserved as a stabilization snapshot but no release
commit was published for it on `origin`. The changes that would have
landed here were rolled forward into `v2.1.3`. The release notes are
preserved for traceability so the changelog stays complete.

## What landed here

- `force_terminate_job` made `async` so it can `await request.json()`.
  Previously a JSON body would be silently dropped and only the
  query-string flag took effect, leading to jobs that survived the
  intended kill.
- Internal hardening of the Director cancel-resolver race when the
  AbortController fires between `fetch` returning and the JSON parse.

## Verification

No fresh gauntlet run was performed for this intermediate tag.
`v2.1.3` re-verifies the same code paths.
