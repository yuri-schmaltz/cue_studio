# Job resume after restart (A19)

Server restarts no longer leave Director jobs ambiguous. On boot the
queue router (`/api/v1/queue`) flags every non-terminal run with
`runs.interrupted_at` (idempotent — the first stamp wins), and every
queue listing classifies each persisted job against the filesystem.

> Spec: `_reversa_forward/plano-2026-10-04/25-feature-a19-resume.md`.
> **Deviation:** the spec's `app.state.queue` table and `/api/queue`
> prefix do not exist in this codebase; the real queue is the `runs`
> table of `services.production_store` and the namespace is `/api/v1`.

## States

| State         | Meaning                                                    | `can_resume` |
|---------------|------------------------------------------------------------|--------------|
| `done`        | expected media is complete on the filesystem                | no           |
| `interrupted` | media partial, or persisted state was `running`/`queued`/`held` | yes      |
| `failed`      | an error was recorded (status `failed` or `error` set)      | yes          |
| `unknown`     | no persisted record and no media                           | no           |

Classification lives in `app/services/job_classifier.py`
(`classify(job_id, db, fs_root)`), which looks jobs up by run id,
production id, or the legacy `correlations.pipeline_id` bridge.

## Covered scenarios

1. **Restart with complete media** — status `done`; resume is skipped,
   so finished output is never re-executed (no duplicate media).
2. **Restart with partial media** — status `interrupted`; `POST
   /api/v1/queue/{id}/resume` dispatches
   `ProductionResume.resume_production`, which replays from the last
   completed checkpoint into the same export destination.
3. **Restart with recorded error** — status `failed`; resumable like
   `interrupted`.
4. **Repeat resume clicks** — idempotent via `Idempotency-Key` (header
   or body field). Without an explicit key a stable per-job key is used;
   a replayed resume returns the recorded result instead of dispatching
   again. A deliberate retry uses a *different* key.
5. **Unknown job** — `POST .../resume` returns HTTP 404.

The approved snapshot and export destination are preserved because
resume delegates to the existing `director_pipeline.resume_pipeline`
(`out_dir` is passed through unchanged).

## Tests

`tests/test_queue_resume.py` exercises every scenario above against an
isolated temp database (see `tests/conftest.py`, A06).
