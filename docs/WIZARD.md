# Wizard — in-app LLM agent (v2.4.0)

> **Status:** v2.4.0 — preview. The Wizard can drive workflows via the
> local LLM. Capability gating for write tools lands in a follow-up
> release (see [MIGRATION_HOCUSPOCUS.md](MIGRATION_HOCUSPOCUS.md) Phase C).

The Wizard is Cue Studio's in-app LLM agent. It runs a deterministic
state machine over a **Wizard workflow** — a durable orchestration
checkpoint that survives restarts, has a revision counter for
optimistic concurrency, and exposes its steps + state to MCP clients
and the HTTP API.

This is Phase C of the [HocusPocus migration plan](MIGRATION_HOCUSPOCUS.md).

---

## Architecture

```
                ┌─────────────────────────┐
                │  Wizard HTTP API        │
                │  /api/v1/wizard/*       │
                │  /api/v1/mcp (tools)    │
                └────────────┬────────────┘
                             │
                             ▼
                ┌─────────────────────────┐
                │  WizardSupervisor       │
                │  (deterministic FSM)    │
                └────────────┬────────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        ┌──────────┐  ┌──────────────┐  ┌──────────┐
        │ Workflow │  │  LLM Router  │  │ Wizard   │
        │ Store    │  │  (llama.cpp) │  │ Workflow │
        │ (JSON)   │  │              │  │ File     │
        └──────────┘  └──────────────┘  └──────────┘
```

The supervisor never trusts the LLM. Every step output is validated
against the step's `required` keys before it is persisted; any
exception becomes a `WizardError` and the step transitions to
`pending` (with `attempts += 1`) for retry, or to `failed` after
`max_attempts`.

---

## HTTP API

### Read

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/wizard/workflows` | List workflows (`?limit=`, default 50) |
| `GET` | `/api/v1/wizard/workflows/{id}` | One workflow |

### Write

| Method | Path | Body | Purpose |
|---|---|---|---|
| `POST` | `/api/v1/wizard/workflows` | full workflow | Create |
| `POST` | `/api/v1/wizard/workflows/{id}/steps` | `{"name": "...", "input": {...}}` | Add a step |
| `POST` | `/api/v1/wizard/workflows/{id}/run` | `{"step_name": "..."}` (optional) | Run one step |
| `POST` | `/api/v1/wizard/workflows/{id}/run-all` | — | Run pending steps |
| `DELETE` | `/api/v1/wizard/workflows/{id}` | — | Delete |

The `run` endpoint returns a `StepResult`:

```json
{
  "ok": true,
  "message": "Step 'plan' completed (attempt 1).",
  "workflow_id": "wf-1",
  "step_name": "plan",
  "state": "completed",
  "output": {"intent": "demo"}
}
```

---

## MCP tools (added in v2.4.0)

Three new read-mostly tools join the v2.3.0 MCP server. The full list
is now **10 entries**:

| Tool | Type | Description |
|---|---|---|
| `wizard_list_workflows` | read | List workflows (limit) |
| `wizard_get_workflow` | read | One workflow by id |
| `wizard_run_step` | read-mostly | Drive the supervisor |

Example agent interaction:

```bash
# Discover workflows
curl -s -X POST http://127.0.0.1:7860/api/v1/mcp \
  -H "Authorization: Bearer $CUE_MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0", "id": 1, "method": "tools/call",
    "params": {"name": "wizard_list_workflows", "arguments": {"limit": 5}}
  }'

# Run the next pending step on a workflow
curl -s -X POST http://127.0.0.1:7860/api/v1/mcp \
  -H "Authorization: Bearer $CUE_MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0", "id": 2, "method": "tools/call",
    "params": {"name": "wizard_run_step",
               "arguments": {"workflow_id": "wf-1"}}
  }'
```

---

## Workflow document

```json
{
  "version": 1,
  "revision": 7,
  "workflows": [
    {
      "id": "wf-1",
      "title": "Open the concert scene",
      "kind": "wizard",
      "state": "running",
      "created_at": 1761000000.0,
      "updated_at": 1761000060.0,
      "context": {"scene": "concert"},
      "steps": [
        {
          "name": "plan",
          "state": "completed",
          "input": {"required": ["intent"]},
          "output": {"intent": "open the concert"},
          "attempts": 1,
          "started_at": 1761000010.0,
          "completed_at": 1761000020.0
        }
      ],
      "task_id": null
    }
  ]
}
```

Persisted to `<CUE_CONFIG_DIR>/.wizard-workflows-v1.json` with atomic
write + revision counter + 0o600 POSIX permissions.

### Workflow states

| State | Meaning |
|---|---|
| `prepared` | Created but no step started yet |
| `queued` / `running` | Active execution |
| `awaiting_input` | Blocked on user input |
| `partial` | Some steps failed, workflow not fully done |
| `completed` / `failed` / `cancelled` | Terminal |

### Step states

`pending` → `running` → `completed` | `failed` | `cancelled`

`awaiting_input` is also a step state for tools that need user clarification.

---

## Input sanitization

The store sanitizes every value before persisting:

| Concern | Behavior |
|---|---|
| **Sensitive keys** | `api_key`, `apikey`, `token`, `authorization`, `password`, `passwd`, `secret`, `cookie`, `session` → replaced with `[redacted]` |
| **Deep nesting** | Recursion depth > 8 collapses to `None` |
| **String length** | Strings truncated at 8 000 chars; object keys at 200 chars |
| **Null bytes** | All `\x00` stripped from strings |
| **Caps** | 100 workflows, 100 steps per workflow, 4 MB file size |

This protects the workflow file from accidental leakage and from
DoS-via-oversized-input.

---

## Optimistic concurrency

`save_workflows()` accepts an `expected_revision` and raises
`WizardWorkflowRevisionConflict` if the on-disk revision differs. The
router accepts the revision via header in a follow-up release; for
now the supervisor writes optimistically and surfaces conflicts as
`WizardError`.

---

## Operational notes

- **Default file path** — `<CUE_CONFIG_DIR>/.wizard-workflows-v1.json`
  (defaults to `~/.cue_studio`).
- **Thread safety** — Module-level `_LOCK` guards the on-disk read-modify
  write cycle.
- **LLM untrusted oracle** — The supervisor never trusts the LLM's
  output; every value is validated before being persisted.
- **Capability gating** — `wizard_run_step` is registered as
  read-mostly because it only drives the FSM, but write-tool capability
  checks are added in a follow-up release.

---

## See also

- [docs/MIGRATION_HOCUSPOCUS.md](MIGRATION_HOCUSPOCUS.md) — full plan
- [docs/MCP_SERVER.md](MCP_SERVER.md) — MCP server docs
- [docs/PRODUCTION_RUN.md](PRODUCTION_RUN.md) — Phase B companion
- `app/services/wizard_workflows.py` — durable store
- `app/services/wizard_supervisor.py` — FSM + LLM driver
- `app/routers/wizard.py` — HTTP API
- `tests/test_wizard_*.py` — 56 tests covering the full stack
