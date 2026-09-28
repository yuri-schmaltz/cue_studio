"""Tests for the Wizard supervisor."""

from __future__ import annotations

import threading
from pathlib import Path

import pytest

from app.services.wizard_supervisor import StepResult, WizardError, WizardSupervisor
from app.services.wizard_workflows import WizardWorkflowStore


@pytest.fixture
def store(tmp_path: Path) -> WizardWorkflowStore:
    return WizardWorkflowStore(tmp_path / "wf.json")


@pytest.fixture
def supervisor(store: WizardWorkflowStore) -> WizardSupervisor:
    return WizardSupervisor(store=store)


def _workflow(**overrides):
    base = {
        "id": "wf-1",
        "title": "Test",
        "kind": "wizard",
        "state": "running",
        "steps": [
            {"name": "plan", "state": "pending", "input": {"required": ["intent"]}},
            {"name": "image", "state": "pending", "input": {"required": ["prompt"]}},
        ],
    }
    base.update(overrides)
    return base


def _stub_llm(supervisor: WizardSupervisor, mapping: dict) -> None:
    """Replace the supervisor's _call_llm with a stub returning ``mapping``."""
    supervisor._call_llm = lambda step, workflow: dict(mapping)  # type: ignore[assignment]


# -------------------------------------------------------------- result


def test_step_result_to_dict() -> None:
    r = StepResult(
        ok=True,
        message="ok",
        workflow_id="wf-1",
        step_name="plan",
        state="completed",
        output={"intent": "demo"},
    )
    payload = r.to_dict()
    assert payload["ok"] is True
    assert payload["step_name"] == "plan"
    assert payload["output"] == {"intent": "demo"}


# -------------------------------------------------------------- run_step


def test_run_step_unknown_workflow_raises(supervisor: WizardSupervisor) -> None:
    with pytest.raises(WizardError):
        supervisor.run_step("missing")


def test_run_step_picks_first_pending(supervisor: WizardSupervisor, store: WizardWorkflowStore) -> None:
    store.upsert(_workflow())
    _stub_llm(supervisor, {"intent": "demo"})
    result = supervisor.run_step("wf-1")
    assert result.ok is True
    assert result.step_name == "plan"
    workflow = store.get("wf-1")
    assert workflow is not None
    plan_step = next(s for s in workflow["steps"] if s["name"] == "plan")
    assert plan_step["state"] == "completed"
    assert plan_step["output"] == {"intent": "demo"}


def test_run_step_named_specific_step(supervisor: WizardSupervisor, store: WizardWorkflowStore) -> None:
    store.upsert(_workflow())
    _stub_llm(supervisor, {"prompt": "hi"})
    result = supervisor.run_step("wf-1", step_name="image")
    assert result.ok is True
    assert result.step_name == "image"


def test_run_step_validation_failure_leaves_pending(
    supervisor: WizardSupervisor, store: WizardWorkflowStore,
) -> None:
    """On first failure, step stays pending with attempts=1 for retry."""
    store.upsert(_workflow())
    _stub_llm(supervisor, {})  # missing 'intent'
    result = supervisor.run_step("wf-1")
    assert result.ok is False
    assert result.state == "pending"
    workflow = store.get("wf-1")
    plan_step = next(s for s in workflow["steps"] if s["name"] == "plan")
    assert plan_step["state"] == "pending"
    assert plan_step["attempts"] == 1
    assert plan_step["error"] is not None


def test_run_step_retries_until_max_attempts(
    supervisor: WizardSupervisor, store: WizardWorkflowStore,
) -> None:
    supervisor._max_attempts = 2
    store.upsert(_workflow())
    _stub_llm(supervisor, {})  # always invalid
    first = supervisor.run_step("wf-1")
    assert first.state == "pending"  # first attempt left pending for retry
    second = supervisor.run_step("wf-1")
    assert second.ok is False
    # After max_attempts is reached the step goes to "failed".
    assert second.state == "failed"
    assert "missing required key" in second.message


def test_run_step_records_attempts(
    supervisor: WizardSupervisor, store: WizardWorkflowStore,
) -> None:
    store.upsert(_workflow())
    _stub_llm(supervisor, {"intent": "demo"})
    supervisor.run_step("wf-1")
    workflow = store.get("wf-1")
    plan_step = next(s for s in workflow["steps"] if s["name"] == "plan")
    assert plan_step["attempts"] == 1


def test_run_step_workflow_in_terminal_state_refuses(
    supervisor: WizardSupervisor, store: WizardWorkflowStore,
) -> None:
    store.upsert(_workflow(state="cancelled"))
    _stub_llm(supervisor, {"intent": "demo"})
    result = supervisor.run_step("wf-1")
    assert result.ok is False
    assert "cancelled" in result.message


def test_run_step_unknown_step_name(
    supervisor: WizardSupervisor, store: WizardWorkflowStore,
) -> None:
    store.upsert(_workflow())
    _stub_llm(supervisor, {})
    result = supervisor.run_step("wf-1", step_name="does_not_exist")
    assert result.ok is False
    assert "No pending step" in result.message


def test_run_step_no_pending_steps(
    supervisor: WizardSupervisor, store: WizardWorkflowStore,
) -> None:
    store.upsert(_workflow(steps=[
        {"name": "plan", "state": "completed"},
        {"name": "image", "state": "completed"},
    ]))
    result = supervisor.run_step("wf-1")
    assert result.ok is False


# -------------------------------------------------------------- run_all


def test_run_all_completes_workflow(
    supervisor: WizardSupervisor, store: WizardWorkflowStore,
) -> None:
    """Sequential LLM stubs run all pending steps."""
    calls = {"n": 0}
    responses = iter([
        {"intent": "demo"},
        {"prompt": "img"},
    ])

    def stub(step, workflow):
        calls["n"] += 1
        return dict(next(responses))

    supervisor._call_llm = stub  # type: ignore[assignment]
    store.upsert(_workflow())
    results = supervisor.run_all("wf-1")
    assert len(results) == 2
    assert all(r.ok for r in results)
    workflow = store.get("wf-1")
    assert workflow["state"] == "completed"


def test_run_all_stops_on_awaiting_input(
    supervisor: WizardSupervisor, store: WizardWorkflowStore,
) -> None:
    """Validation failure that exhausts max_attempts stops the loop."""
    supervisor._max_attempts = 1  # fail on first invalid response
    store.upsert(_workflow(steps=[
        {"name": "plan", "state": "pending", "input": {"required": ["intent"]}},
    ]))
    _stub_llm(supervisor, {})
    results = supervisor.run_all("wf-1")
    assert len(results) == 1
    assert results[0].ok is False
    assert results[0].state == "failed"


def test_run_all_respects_max_steps(
    supervisor: WizardSupervisor, store: WizardWorkflowStore,
) -> None:
    store.upsert(_workflow(steps=[
        {"name": f"s-{i}", "state": "pending", "input": {"required": ["x"]}}
        for i in range(10)
    ]))
    _stub_llm(supervisor, {"x": "ok"})
    results = supervisor.run_all("wf-1", max_steps=3)
    assert len(results) == 3


# -------------------------------------------------------------- llm errors


def test_run_step_propagates_llm_exception(
    supervisor: WizardSupervisor, store: WizardWorkflowStore,
) -> None:
    def boom(step, workflow):
        raise WizardError("LLM down")

    supervisor._call_llm = boom  # type: ignore[assignment]
    store.upsert(_workflow())
    result = supervisor.run_step("wf-1")
    assert result.ok is False
    assert "LLM down" in result.message
    workflow = store.get("wf-1")
    plan_step = next(s for s in workflow["steps"] if s["name"] == "plan")
    assert plan_step["state"] == "failed"


def test_step_result_output_isolated_from_state() -> None:
    r = StepResult(ok=True, message="x", workflow_id="w", step_name="s", state="c")
    payload = r.to_dict()
    payload["output"] = {"tampered": True}
    assert r.output is None
