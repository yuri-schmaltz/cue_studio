"""Wizard supervisor — LLM-driven workflow orchestration.

A supervisor runs an agent loop over a Wizard workflow:

  1. Pick the next step in ``pending`` state.
  2. Build a GBNF-constrained prompt for the local LLM (via llm_router).
  3. Validate the LLM response against the step's expected shape.
  4. Mark the step completed/failed and persist via the workflow store.
  5. Repeat until the workflow is done, awaiting_input, or failed.

The supervisor is intentionally **not** the UI. It is a deterministic
state machine that the UI / MCP / HTTP endpoint drives. The LLM is
treated as an untrusted oracle: every action it suggests is validated
before it is persisted.

This module is the v2.4.0 preview; mutations land later under capability
gates (see docs/MIGRATION_HOCUSPOCUS.md Phase C).
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Iterable, Mapping
from typing import Any

from .wizard_workflows import (
    STEP_STATES,
    WORKFLOW_STATES,
    WizardWorkflowStore,
    get_default,
)


log = logging.getLogger("cue_studio.wizard.supervisor")


__all__ = [
    "WizardSupervisor",
    "WizardError",
    "StepResult",
]


# ---------------------------------------------------------------- errors


class WizardError(ValueError):
    """Raised when a workflow cannot advance (validation failure, etc.)."""


# --------------------------------------------------------------- result


class StepResult:
    """Outcome of one supervised step."""

    __slots__ = ("ok", "message", "workflow_id", "step_name", "state", "output")

    def __init__(
        self,
        *,
        ok: bool,
        message: str,
        workflow_id: str,
        step_name: str,
        state: str,
        output: Mapping[str, Any] | None = None,
    ) -> None:
        self.ok = ok
        self.message = message
        self.workflow_id = workflow_id
        self.step_name = step_name
        self.state = state
        self.output = dict(output) if output else None

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "message": self.message,
            "workflow_id": self.workflow_id,
            "step_name": self.step_name,
            "state": self.state,
            "output": self.output,
        }


# --------------------------------------------------------------- supervisor


class WizardSupervisor:
    """Orchestrates a workflow by calling the local LLM for each step.

    Parameters
    ----------
    store:
        Optional workflow store. Defaults to the process singleton.
    llm_role:
        Which LLM role to use from :mod:`services.llm_router`. Defaults to
        ``technical_json`` (structured-output friendly).
    max_attempts:
        Maximum retries per step before the step is marked failed.
    """

    def __init__(
        self,
        store: WizardWorkflowStore | None = None,
        *,
        llm_role: str = "technical_json",
        max_attempts: int = 2,
    ) -> None:
        self._store = store or get_default()
        self._llm_role = llm_role
        self._max_attempts = max(1, max_attempts)

    # ------------------------------------------------------------- helpers

    def _find_next_step(
        self, workflow: Mapping[str, Any],
    ) -> dict[str, Any] | None:
        for step in workflow.get("steps") or []:
            if step.get("state") == "pending":
                return step
        return None

    def _validate_step_output(
        self, step: Mapping[str, Any], output: Mapping[str, Any],
    ) -> list[str]:
        """Return a list of validation errors (empty == valid)."""
        errors: list[str] = []
        required = (step.get("input") or {}).get("required") or []
        for key in required:
            if key not in output:
                errors.append(f"missing required key '{key}'")
        return errors

    def _call_llm(
        self, step: Mapping[str, Any], workflow: Mapping[str, Any],
    ) -> dict[str, Any]:
        """Invoke the LLM with a GBNF grammar to constrain output shape.

        Falls back to a minimal heuristic when the local LLM is not loaded
        so the supervisor is testable in isolation. The fallback never
        invents values for required keys — it always raises WizardError
        so the test must stub _call_llm explicitly.
        """
        try:
            from app.services import llm_router  # type: ignore
        except Exception as exc:  # pragma: no cover — defensive
            raise WizardError(f"LLM service unavailable: {exc}") from exc

        prompt = self._build_prompt(step, workflow)
        try:
            response = llm_router.generate_for_role(
                role=self._llm_role,
                prompt=prompt,
                json_schema=self._step_schema(step),
            )
        except Exception as exc:  # pragma: no cover — depends on LLM
            raise WizardError(f"LLM call failed: {exc}") from exc

        if not isinstance(response, Mapping):
            raise WizardError("LLM response was not a mapping")
        return dict(response)

    def _build_prompt(
        self, step: Mapping[str, Any], workflow: Mapping[str, Any],
    ) -> str:
        return (
            f"Workflow: {workflow.get('title') or workflow.get('id')}\n"
            f"Step: {step.get('name')}\n"
            f"Context: {json.dumps(workflow.get('context') or {}, ensure_ascii=False)}\n"
            "Respond with a JSON object only."
        )

    def _step_schema(self, step: Mapping[str, Any]) -> dict[str, Any]:
        """Build a permissive JSON schema covering required keys from input."""
        required = list((step.get("input") or {}).get("required") or [])
        properties = {key: {"type": "string"} for key in required}
        return {
            "type": "object",
            "properties": properties,
            "required": required,
            "additionalProperties": True,
        }

    # ------------------------------------------------------------- public

    def run_step(
        self, workflow_id: str, step_name: str | None = None,
    ) -> StepResult:
        """Run one step (the next pending one if step_name is not given)."""
        workflow = self._store.get(workflow_id)
        if workflow is None:
            raise WizardError(f"Workflow not found: {workflow_id}")
        if workflow.get("state") not in ("prepared", "running", "partial"):
            return StepResult(
                ok=False,
                message=f"Workflow is in state '{workflow.get('state')}', cannot advance.",
                workflow_id=workflow_id,
                step_name=step_name or "",
                state=workflow.get("state", "unknown"),
            )

        step = self._locate_step(workflow, step_name)
        if step is None:
            return StepResult(
                ok=False,
                message="No pending step to run.",
                workflow_id=workflow_id,
                step_name=step_name or "",
                state=workflow.get("state", "unknown"),
            )

        attempts = int(step.get("attempts") or 0) + 1
        try:
            output = self._call_llm(step, workflow)
        except WizardError as exc:
            self._mark_step(workflow, step["name"], state="failed", error=str(exc), attempts=attempts)
            return StepResult(
                ok=False, message=str(exc), workflow_id=workflow_id,
                step_name=step["name"], state="failed",
            )

        errors = self._validate_step_output(step, output)
        if errors and attempts >= self._max_attempts:
            self._mark_step(
                workflow, step["name"],
                state="failed",
                error="; ".join(errors),
                attempts=attempts,
            )
            return StepResult(
                ok=False, message="; ".join(errors),
                workflow_id=workflow_id, step_name=step["name"], state="failed",
            )
        if errors:
            self._mark_step(
                workflow, step["name"],
                state="pending",
                error="; ".join(errors),
                attempts=attempts,
            )
            return StepResult(
                ok=False,
                message=f"Validation failed (attempt {attempts}/{self._max_attempts})",
                workflow_id=workflow_id,
                step_name=step["name"],
                state="pending",
                output=output,
            )

        self._mark_step(
            workflow, step["name"],
            state="completed",
            output=output,
            attempts=attempts,
        )
        self._maybe_complete_workflow(workflow_id)
        return StepResult(
            ok=True,
            message=f"Step '{step['name']}' completed (attempt {attempts}).",
            workflow_id=workflow_id,
            step_name=step["name"],
            state="completed",
            output=output,
        )

    def run_all(
        self, workflow_id: str, *, max_steps: int = 32,
    ) -> list[StepResult]:
        """Run pending steps until exhausted, awaiting_input, or max_steps."""
        results: list[StepResult] = []
        for _ in range(max_steps):
            workflow = self._store.get(workflow_id)
            if workflow is None:
                break
            if workflow.get("state") in ("awaiting_input", "completed", "failed", "cancelled"):
                break
            result = self.run_step(workflow_id)
            results.append(result)
            # Stop on hard failures only. Pending/awaiting_input results
            # are surfaced to the caller so retries can be driven explicitly.
            if result.state == "failed":
                break
            # If the workflow itself just hit a terminal state, stop.
            wf = self._store.get(workflow_id)
            if wf and wf.get("state") in ("completed", "awaiting_input", "cancelled"):
                break
        return results

    # ------------------------------------------------------------- internal

    def _locate_step(
        self,
        workflow: Mapping[str, Any],
        step_name: str | None,
    ) -> dict[str, Any] | None:
        steps = list(workflow.get("steps") or [])
        if step_name:
            for step in steps:
                if step.get("name") == step_name:
                    return step
            return None
        return self._find_next_step(workflow)

    def _mark_step(
        self,
        workflow: Mapping[str, Any],
        step_name: str,
        *,
        state: str,
        output: Mapping[str, Any] | None = None,
        error: str | None = None,
        attempts: int | None = None,
    ) -> None:
        """Persist a step state transition. Updates workflow.updated_at."""
        if state not in STEP_STATES:
            raise WizardError(f"Unknown step state: {state}")
        now = time.time()
        steps = []
        for step in workflow.get("steps") or []:
            if step.get("name") == step_name:
                step = dict(step)
                step["state"] = state
                if output is not None:
                    step["output"] = output
                if error is not None:
                    step["error"] = error
                if attempts is not None:
                    step["attempts"] = attempts
                if state == "running":
                    step["started_at"] = step.get("started_at") or now
                if state in ("completed", "failed", "cancelled"):
                    step["completed_at"] = now
            steps.append(step)
        updated = dict(workflow)
        updated["steps"] = steps
        updated["updated_at"] = now
        if state == "running":
            updated["state"] = "running"
        elif state == "completed":
            # workflow state is finalized in _maybe_complete_workflow
            pass
        elif state == "failed":
            updated["state"] = "partial" if any(
                s.get("state") == "completed" for s in steps
            ) else "failed"
        self._store.upsert(updated)

    def _maybe_complete_workflow(self, workflow_id: str) -> None:
        """If every step is completed/failed/cancelled, mark workflow done."""
        workflow = self._store.get(workflow_id)
        if workflow is None:
            return
        steps = list(workflow.get("steps") or [])
        if not steps:
            return
        terminal = {"completed", "failed", "cancelled"}
        if all(s.get("state") in terminal for s in steps):
            updated = dict(workflow)
            updated["state"] = "completed"
            updated["updated_at"] = time.time()
            self._store.upsert(updated)
