"""Tests for the /api/v1/wizard FastAPI router."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.services.wizard_workflows import WizardWorkflowStore


@pytest.fixture
def store(tmp_path: Path) -> WizardWorkflowStore:
    return WizardWorkflowStore(tmp_path / "wf.json")


@pytest.fixture
def app(store):
    from app.routers.wizard import build_wizard_router
    from app.services.wizard_supervisor import WizardSupervisor

    application = FastAPI()
    application.include_router(build_wizard_router(store=store))
    return application


@pytest.fixture
def client(app):
    return TestClient(app)


def _workflow(**overrides):
    base = {
        "id": "wf-1",
        "title": "Test",
        "kind": "wizard",
        "state": "running",
        "steps": [
            {"name": "plan", "state": "pending", "input": {"required": ["intent"]}},
        ],
    }
    base.update(overrides)
    return base


def test_list_empty(client):
    r = client.get("/api/v1/wizard/workflows")
    assert r.status_code == 200
    assert r.json() == {"count": 0, "workflows": []}


def test_list_returns_workflows(client, store):
    store.upsert(_workflow(id="a"))
    store.upsert(_workflow(id="b", title="Other"))
    r = client.get("/api/v1/wizard/workflows")
    assert r.status_code == 200
    assert r.json()["count"] == 2


def test_get_workflow_404(client):
    r = client.get("/api/v1/wizard/workflows/nope")
    assert r.status_code == 404


def test_get_workflow(client, store):
    store.upsert(_workflow(id="wf-1"))
    r = client.get("/api/v1/wizard/workflows/wf-1")
    assert r.status_code == 200
    assert r.json()["title"] == "Test"


def test_create_workflow(client):
    r = client.post(
        "/api/v1/wizard/workflows",
        json={
            "id": "wf-new",
            "title": "New workflow",
            "kind": "wizard",
            "state": "prepared",
            "steps": [],
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["revision"] == 1
    assert len(body["workflows"]) == 1
    assert body["workflows"][0]["id"] == "wf-new"


def test_create_workflow_empty_body_400(client):
    r = client.post("/api/v1/wizard/workflows", json={})
    assert r.status_code == 400


def test_add_step_to_unknown_workflow_404(client):
    r = client.post("/api/v1/wizard/workflows/missing/steps", json={"name": "x"})
    assert r.status_code == 404


def test_add_step_requires_name(client, store):
    store.upsert(_workflow(id="wf-1"))
    r = client.post("/api/v1/wizard/workflows/wf-1/steps", json={})
    assert r.status_code == 400


def test_add_step_appends(client, store):
    store.upsert(_workflow(id="wf-1", steps=[]))
    r = client.post(
        "/api/v1/wizard/workflows/wf-1/steps",
        json={"name": "image", "input": {"required": ["prompt"]}},
    )
    assert r.status_code == 200
    body = r.json()
    workflow = next(w for w in body["workflows"] if w["id"] == "wf-1")
    assert len(workflow["steps"]) == 1
    assert workflow["steps"][0]["name"] == "image"


def test_run_step_uses_supervisor(client, store):
    store.upsert(_workflow(id="wf-1"))
    from app.routers.wizard import build_wizard_router
    # Re-mount with a supervisor whose _call_llm is stubbed
    app2 = FastAPI()
    from app.services.wizard_supervisor import WizardSupervisor
    supervisor = WizardSupervisor(store=store)
    supervisor._call_llm = lambda step, workflow: {"intent": "demo"}
    # Re-build the router and inject a stubbed supervisor via a swap
    # In practice we test the run_step via the supervisor fixture directly.
    # Here we just ensure the route accepts a payload and returns StepResult.
    app2.include_router(build_wizard_router(store=store))
    c = TestClient(app2)
    # swap the supervisor inside the router via direct attribute access
    # (router keeps a reference; not exposed, so we rebuild the app).
    # Use a fresh supervisor where _call_llm is stubbed, but the router
    # already wired the OLD one. We patch the existing supervisor.
    # Easier: just hit /run with a workflow whose step requires nothing.
    store.upsert({
        "id": "wf-2", "title": "No requirements",
        "kind": "wizard", "state": "running",
        "steps": [{"name": "free", "state": "pending", "input": {}}],
    })
    # Patch the existing supervisor's _call_llm through its module
    from app.services import wizard_supervisor
    orig = wizard_supervisor.WizardSupervisor._call_llm
    wizard_supervisor.WizardSupervisor._call_llm = lambda self, step, workflow: {}
    try:
        r = c.post("/api/v1/wizard/workflows/wf-2/run", json={})
        # step expects {} returned, which is valid for input {} (no required)
        assert r.status_code == 200
        assert r.json()["step_name"] == "free"
    finally:
        wizard_supervisor.WizardSupervisor._call_llm = orig


def test_run_step_unknown_workflow_400(client, store):
    r = client.post("/api/v1/wizard/workflows/missing/run", json={})
    assert r.status_code == 400


def test_run_all_returns_list(store):
    from app.routers.wizard import build_wizard_router
    from app.services.wizard_supervisor import WizardSupervisor
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    store.upsert({
        "id": "wf-3", "title": "Multi",
        "kind": "wizard", "state": "running",
        "steps": [
            {"name": "s-1", "state": "pending", "input": {}},
            {"name": "s-2", "state": "pending", "input": {}},
        ],
    })
    supervisor = WizardSupervisor(store=store)
    supervisor._call_llm = lambda step, workflow: {}
    app = FastAPI()
    app.include_router(build_wizard_router(store=store, supervisor=supervisor))
    c = TestClient(app)
    r = c.post("/api/v1/wizard/workflows/wf-3/run-all")
    assert r.status_code == 200
    body = r.json()
    assert body["count"] == 2
    assert all(res["ok"] for res in body["results"])


def test_delete_workflow(client, store):
    store.upsert(_workflow(id="wf-1"))
    r = client.delete("/api/v1/wizard/workflows/wf-1")
    assert r.status_code == 200
    assert r.json()["deleted"] is True
    assert store.get("wf-1") is None


def test_delete_unknown_404(client):
    r = client.delete("/api/v1/wizard/workflows/nope")
    assert r.status_code == 404
