"""Tests for the Wizard workflow store."""

from __future__ import annotations

import json
import threading
from pathlib import Path

import pytest

from app.services.wizard_workflows import (
    STEP_STATES,
    WORKFLOW_STATES,
    WizardWorkflowRevisionConflict,
    WizardWorkflowStore,
    empty_workflows,
    load_workflows,
    save_workflows,
)


@pytest.fixture
def store(tmp_path: Path) -> WizardWorkflowStore:
    return WizardWorkflowStore(tmp_path / "wf.json")


def _workflow(**overrides):
    base = {
        "id": "wf-1",
        "title": "Test workflow",
        "kind": "wizard",
        "state": "running",
        "steps": [
            {"name": "plan", "state": "completed", "output": {"ok": True}},
            {"name": "image", "state": "pending", "input": {"prompt": "hi"}},
        ],
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------- basics


def test_empty_workflows_has_revision_zero() -> None:
    doc = empty_workflows()
    assert doc["version"] == 1
    assert doc["revision"] == 0
    assert doc["workflows"] == []


def test_load_missing_returns_empty(tmp_path: Path) -> None:
    assert load_workflows(tmp_path / "absent.json") == empty_workflows()


def test_load_corrupt_returns_empty(tmp_path: Path) -> None:
    p = tmp_path / "wf.json"
    p.write_text("not json")
    assert load_workflows(p) == empty_workflows()


def test_load_non_dict_returns_empty(tmp_path: Path) -> None:
    p = tmp_path / "wf.json"
    p.write_text("[1,2,3]")
    assert load_workflows(p) == empty_workflows()


# ---------------------------------------------------------- upsert


def test_upsert_persists(store: WizardWorkflowStore) -> None:
    saved = store.upsert(_workflow())
    assert saved["revision"] == 1
    assert len(saved["workflows"]) == 1
    assert saved["workflows"][0]["title"] == "Test workflow"


def test_upsert_replaces_by_id(store: WizardWorkflowStore) -> None:
    store.upsert(_workflow())
    store.upsert(_workflow(title="Updated"))
    document = store.load()
    assert len(document["workflows"]) == 1
    assert document["workflows"][0]["title"] == "Updated"
    assert document["revision"] == 2


def test_upsert_generates_id_when_missing(store: WizardWorkflowStore) -> None:
    import re
    saved = store.upsert(_workflow(id=""))
    new_id = saved["workflows"][0]["id"]
    assert re.match(r"^[0-9a-f]{32}$", new_id)


# ---------------------------------------------------------- get / list


def test_get_returns_workflow(store: WizardWorkflowStore) -> None:
    store.upsert(_workflow(id="a"))
    store.upsert(_workflow(id="b", title="Other"))
    result = store.get("b")
    assert result is not None
    assert result["title"] == "Other"


def test_get_returns_none_for_unknown(store: WizardWorkflowStore) -> None:
    assert store.get("nope") is None


def test_list_sorted_newest_first(store: WizardWorkflowStore) -> None:
    store.upsert(_workflow(id="old", updated_at=100.0))
    store.upsert(_workflow(id="new", updated_at=200.0))
    listed = store.list()
    assert [w["id"] for w in listed] == ["new", "old"]


def test_list_respects_limit(store: WizardWorkflowStore) -> None:
    for i in range(5):
        store.upsert(_workflow(id=f"w-{i}", updated_at=float(i)))
    assert len(store.list(limit=2)) == 2


# ---------------------------------------------------------- delete


def test_delete_removes(store: WizardWorkflowStore) -> None:
    store.upsert(_workflow(id="a"))
    assert store.delete("a") is True
    assert store.get("a") is None


def test_delete_unknown_returns_false(store: WizardWorkflowStore) -> None:
    assert store.delete("nope") is False


# ---------------------------------------------------------- revision / concurrency


def test_save_with_expected_revision_conflict(store: WizardWorkflowStore) -> None:
    store.upsert(_workflow())
    with pytest.raises(WizardWorkflowRevisionConflict) as exc:
        store.save({"workflows": []}, expected_revision=99)
    assert exc.value.expected == 99
    assert exc.value.current == 1


def test_save_with_matching_revision_succeeds(store: WizardWorkflowStore) -> None:
    store.upsert(_workflow())
    document = store.load()
    result = store.save(document, expected_revision=document["revision"])
    assert result["revision"] == document["revision"] + 1


def test_concurrent_upsert_serializes(store: WizardWorkflowStore) -> None:
    """Multiple threads upserting different workflows must not lose data."""
    barrier = threading.Barrier(8)

    def worker(i: int) -> None:
        barrier.wait()
        store.upsert(_workflow(id=f"w-{i}"))

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    listed = store.list(limit=100)
    assert {w["id"] for w in listed} >= {f"w-{i}" for i in range(8)}


# ---------------------------------------------------------- sanitization


def test_workflow_state_normalized_to_known_set(store: WizardWorkflowStore) -> None:
    saved = store.upsert(_workflow(state="not-a-real-state"))
    assert saved["workflows"][0]["state"] == "prepared"


def test_step_state_normalized_to_known_set(store: WizardWorkflowStore) -> None:
    saved = store.upsert(_workflow(steps=[{"name": "x", "state": "garbage"}]))
    assert saved["workflows"][0]["steps"][0]["state"] == "pending"


def test_sensitive_keys_redacted_in_context(store: WizardWorkflowStore) -> None:
    saved = store.upsert(_workflow(context={
        "api_key": "sk-1234",
        "token": "tok",
        "password": "hunter2",
        "ok": "safe",
    }))
    ctx = saved["workflows"][0]["context"]
    assert ctx["api_key"] == "[redacted]"
    assert ctx["token"] == "[redacted]"
    assert ctx["password"] == "[redacted]"
    assert ctx["ok"] == "safe"


def test_deep_structures_truncated(store: WizardWorkflowStore) -> None:
    """Nesting deeper than 8 levels collapses to None."""
    deep = {"a": {"b": {"c": {"d": {"e": {"f": {"g": {"h": {"i": "too deep"}}}}}}}}}
    saved = store.upsert(_workflow(context=deep))
    assert saved["workflows"][0]["context"] is not None  # some level survives


def test_null_bytes_stripped_from_strings(store: WizardWorkflowStore) -> None:
    saved = store.upsert(_workflow(title="hello\x00world"))
    assert "\x00" not in saved["workflows"][0]["title"]


def test_workflow_capped_at_max(store: WizardWorkflowStore) -> None:
    """Loading a file with too many workflows caps to MAX_WORKFLOWS."""
    path = store.path
    raw = {
        "version": 1,
        "revision": 0,
        "workflows": [
            {"id": f"w-{i}", "title": f"w-{i}", "kind": "wizard", "state": "prepared",
             "updated_at": float(i)}
            for i in range(150)
        ],
    }
    path.write_text(json.dumps(raw))
    document = load_workflows(path)
    assert len(document["workflows"]) == 100


# ---------------------------------------------------------- state constants


def test_workflow_states_include_expected() -> None:
    for required in ("prepared", "running", "completed", "failed", "cancelled"):
        assert required in WORKFLOW_STATES


def test_step_states_include_expected() -> None:
    for required in ("pending", "running", "completed", "failed", "cancelled"):
        assert required in STEP_STATES


# ---------------------------------------------------------- atomic write


def test_save_writes_atomically_no_tmp_leftover(store: WizardWorkflowStore) -> None:
    store.upsert(_workflow())
    leftovers = [
        p for p in store.path.parent.iterdir()
        if p.name.startswith(f".{store.path.name}.") and p.name.endswith(".tmp")
    ]
    assert leftovers == []


def test_file_permissions_0600(store: WizardWorkflowStore) -> None:
    import os
    import stat
    store.upsert(_workflow())
    if os.name != "posix":
        pytest.skip("POSIX file mode check only")
    mode = stat.S_IMODE(store.path.stat().st_mode)
    assert mode == 0o600


# ---------------------------------------------------------- module singleton


def test_default_singleton_is_path_aware(tmp_path: Path, monkeypatch) -> None:
    from app.services import wizard_workflows
    monkeypatch.setenv("CUE_CONFIG_DIR", str(tmp_path))
    wizard_workflows.reset_default_for_tests(None)
    inst = wizard_workflows.get_default()
    assert inst.path.parent == tmp_path
    wizard_workflows.reset_default_for_tests(inst)
    assert wizard_workflows.get_default() is inst
    wizard_workflows.reset_default_for_tests(None)
