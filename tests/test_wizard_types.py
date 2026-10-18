"""Testes de integração do Wizard tipado e MCP mutation_class (R03)."""

from __future__ import annotations

import tempfile
from pathlib import Path

from app.services.wizard_types import (
    McpMutationClass,
    WizardStep,
    WizardStepKind,
    classify_tool,
    dispatch_step,
)


def test_step_validates_effect():
    try:
        WizardStep("s1", "wf1", WizardStepKind.CREATIVE, expected_effect="foo_bar").validate()
        assert False, "deveria ter levantado ValueError"
    except ValueError:
        pass


def test_classify_tool_by_keyword():
    cases = [
        ("wizard_run_step", "", McpMutationClass.WRITE_META),
        ("editor_export", "renders final timeline", McpMutationClass.WRITE_ART),
        ("install_model", "downloads and registers", McpMutationClass.INSTALL),
        ("delete_production", "removes from db", McpMutationClass.WRITE_STORAGE),
        ("list_productions", "", McpMutationClass.READ),
    ]
    for name, desc, expected in cases:
        got = classify_tool(name, desc)
        assert got == expected, f"{name}: esperado {expected}, obteve {got}"


def test_creative_does_not_complete_without_review():
    step = WizardStep(
        step_id="plan", workflow_id="short_film",
        kind=WizardStepKind.CREATIVE,
        expected_effect="json_only",
        schema={"required": ["scenes"]},
    )
    result = dispatch_step(step, llm_call=lambda s: {"scenes": ["intro", "rising"]})
    assert not result.completed and result.proposal is not None


def test_creative_rejects_missing_required_key():
    step = WizardStep(
        step_id="plan", workflow_id="short_film",
        kind=WizardStepKind.CREATIVE,
        expected_effect="json_only",
        schema={"required": ["scenes", "characters"]},
    )
    result = dispatch_step(step, llm_call=lambda s: {"scenes": ["intro"]})
    assert not result.completed
    assert "characters" in (result.error or "")


def test_mechanical_completes_with_real_artifact():
    with tempfile.TemporaryDirectory() as td:
        artifact = Path(td) / "out.mp4"
        artifact.write_bytes(b"fake")
        step = WizardStep(
            step_id="render", workflow_id="short_film",
            kind=WizardStepKind.MECHANICAL,
            expected_effect="artifact_at_path",
            effect_target=str(artifact),
        )
        result = dispatch_step(step, mechanical_call=lambda s: str(artifact))
        assert result.completed is True
        assert result.artifact_path == str(artifact)


def test_mechanical_rejects_missing_artifact():
    step = WizardStep(
        step_id="render", workflow_id="short_film",
        kind=WizardStepKind.MECHANICAL,
        expected_effect="artifact_at_path",
        effect_target="/nonexistent/path.mp4",
    )
    result = dispatch_step(step, mechanical_call=lambda s: "/nonexistent/path.mp4")
    assert not result.completed
    assert "artefato prometido não existe" in (result.error or "")


def test_mechanical_rejects_wrong_effect():
    step = WizardStep(
        step_id="render", workflow_id="short_film",
        kind=WizardStepKind.MECHANICAL,
        expected_effect="json_only",
    )
    result = dispatch_step(step, mechanical_call=lambda s: "/tmp/x.mp4")
    assert not result.completed
    assert "artifact_at_path" in (result.error or "")


def test_review_completes_with_valid_decision():
    step = WizardStep(
        step_id="approve", workflow_id="short_film",
        kind=WizardStepKind.REVIEW,
        expected_effect="human_decision",
    )
    result = dispatch_step(step, review_input="approve")
    assert result.completed is True
    assert result.decision == "approve"


def test_review_rejects_invalid_decision():
    step = WizardStep(
        step_id="approve", workflow_id="short_film",
        kind=WizardStepKind.REVIEW,
        expected_effect="human_decision",
    )
    result = dispatch_step(step, review_input="maybe")
    assert not result.completed
    assert "decisão inválida" in (result.error or "")


def test_review_requires_human_input():
    step = WizardStep(
        step_id="approve", workflow_id="short_film",
        kind=WizardStepKind.REVIEW,
        expected_effect="human_decision",
    )
    result = dispatch_step(step, review_input=None)
    assert not result.completed
    assert "aguardando decisão humana" in (result.error or "")


def test_wizard_run_step_is_write_meta():
    assert classify_tool("wizard_run_step", "") == McpMutationClass.WRITE_META


def test_editor_export_is_write_art():
    assert classify_tool("editor_export", "renders final timeline") == McpMutationClass.WRITE_ART
