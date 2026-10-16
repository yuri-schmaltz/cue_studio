#!/usr/bin/env python3
"""Protótipo isolado de Wizard tipado e MCP mutation_class (R03).

Valida `36-feature-r03-wizard-mcp.md` sem importar de `app/`.

1. Tipos `WizardStepKind`, `WizardStep`, `McpMutationClass`, `McpTool`.
2. Função `dispatch_step(step, executor, validator) -> StepResult`.
3. Executor creative: chama LLM stub; saída é proposta.
4. Executor mechanical: chama serviço stub; valida artefato.
6. Executor review: aguarda decisão; marca concluído após input.
7. Função `classify_tool(name, effect_description) -> McpMutationClass`.
8. 7 testes cobrindo: tipos, creative, mechanical, review, mutation_class
   automático, wizard_run_step/editor_export, edge case.

Rodar:
    python3 _reversa_forward/plano-2026-10-04/prototypes/r03_wizard_mcp.py
"""
from __future__ import annotations

import dataclasses
import hashlib
import json
import sys
import tempfile
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Optional


# ---------------------------------------------------------------------------
# 1. Modelo de dados
# ---------------------------------------------------------------------------

class WizardStepKind(str, Enum):
    CREATIVE = "creative"
    MECHANICAL = "mechanical"
    REVIEW = "review"


class McpMutationClass(str, Enum):
    READ = "read"
    WRITE_ART = "write_art"
    WRITE_META = "write_meta"
    WRITE_STORAGE = "write_storage"
    INSTALL = "install"


VALID_EFFECTS = {"json_only", "artifact_at_path", "human_decision"}


@dataclass(frozen=True)
class WizardStep:
    step_id: str
    workflow_id: str
    kind: WizardStepKind
    expected_effect: str
    effect_target: Optional[str] = None
    schema: dict = field(default_factory=dict)

    def validate(self) -> None:
        if self.expected_effect not in VALID_EFFECTS:
            raise ValueError(f"expected_effect={self.expected_effect} inválido")


@dataclass
class McpTool:
    name: str
    mutation_class: McpMutationClass
    requires_capability: str = ""


@dataclass
class StepResult:
    step_id: str
    completed: bool
    artifact_path: Optional[str] = None
    proposal: Optional[dict] = None
    decision: Optional[str] = None
    error: Optional[str] = None


# ---------------------------------------------------------------------------
# 2. Classificação de ferramentas MCP
# ---------------------------------------------------------------------------

HEURISTIC_KEYWORDS = {
    McpMutationClass.WRITE_ART: {"export", "approve", "reject", "edit_plan", "write_plan", "generate_image", "generate_video", "render", "mix"},
    McpMutationClass.WRITE_META: {"wizard", "set_param", "rename", "set_setting", "update", "configure"},
    McpMutationClass.WRITE_STORAGE: {"delete", "purge", "move", "relink", "upload"},
    McpMutationClass.INSTALL: {"install", "uninstall", "download_model"},
}


def classify_tool(name: str, description: str = "") -> McpMutationClass:
    """Classifica ferramenta pelo nome (e descrição opcional) por heurística de palavras-chave."""
    haystack = f"{name} {description}".lower()
    for cls, keywords in HEURISTIC_KEYWORDS.items():
        if any(kw in haystack for kw in keywords):
            return cls
    return McpMutationClass.READ


# ---------------------------------------------------------------------------
# 3. Dispatch por kind
# ---------------------------------------------------------------------------

def dispatch_step(
    step: WizardStep,
    *,
    llm_call: Optional[Callable[[WizardStep], dict]] = None,
    mechanical_call: Optional[Callable[[WizardStep], str]] = None,
    review_input: Optional[str] = None,
) -> StepResult:
    """Despacha executor apropriado pelo kind do step."""
    step.validate()
    if step.kind == WizardStepKind.CREATIVE:
        if llm_call is None:
            return StepResult(step_id=step.step_id, completed=False, error="llm_call obrigatório")
        proposal = llm_call(step)
        # Valida contra schema (simplificado: chaves obrigatórias presentes)
        for required in step.schema.get("required", []):
            if required not in proposal:
                return StepResult(
                    step_id=step.step_id, completed=False, proposal=proposal,
                    error=f"proposta faltando chave obrigatória {required!r}",
                )
        # Creative NÃO marca concluído: usuário precisa aprovar.
        return StepResult(step_id=step.step_id, completed=False, proposal=proposal)
    if step.kind == WizardStepKind.MECHANICAL:
        if mechanical_call is None:
            return StepResult(step_id=step.step_id, completed=False, error="mechanical_call obrigatório")
        if step.expected_effect != "artifact_at_path":
            return StepResult(
                step_id=step.step_id, completed=False,
                error=f"mechanical requer expected_effect=artifact_at_path; recebido {step.expected_effect}",
            )
        artifact = mechanical_call(step)
        if not Path(artifact).exists():
            return StepResult(
                step_id=step.step_id, completed=False, artifact_path=artifact,
                error=f"artefato prometido não existe em {artifact}",
            )
        return StepResult(step_id=step.step_id, completed=True, artifact_path=artifact)
    if step.kind == WizardStepKind.REVIEW:
        if review_input is None:
            return StepResult(step_id=step.step_id, completed=False, error="aguardando decisão humana")
        if step.expected_effect != "human_decision":
            return StepResult(
                step_id=step.step_id, completed=False,
                error=f"review requer expected_effect=human_decision; recebido {step.expected_effect}",
            )
        if review_input not in {"approve", "reject", "skip"}:
            return StepResult(
                step_id=step.step_id, completed=False,
                error=f"decisão inválida {review_input!r}; esperado approve|reject|skip",
            )
        return StepResult(step_id=step.step_id, completed=True, decision=review_input)
    return StepResult(step_id=step.step_id, completed=False, error=f"kind desconhecido {step.kind}")


# ---------------------------------------------------------------------------
# 4. Suíte de testes
# ---------------------------------------------------------------------------

def check(name: str, ok: bool, detail: str = "") -> bool:
    status = "OK" if ok else "FAIL"
    print(f"  {status} {name}{(' — ' + detail) if detail else ''}")
    return ok


def test_step_validates_effect() -> bool:
    try:
        WizardStep("s1", "wf1", WizardStepKind.CREATIVE, expected_effect="foo_bar").validate()
        return check("schema: expected_effect inválido falha", False)
    except ValueError:
        return check("schema: expected_effect inválido falha", True)


def test_classify_tool_by_keyword() -> bool:
    cases = [
        ("wizard_run_step", "", McpMutationClass.WRITE_META),
        ("editor_export", "renders final timeline", McpMutationClass.WRITE_ART),
        ("install_model", "downloads and registers", McpMutationClass.INSTALL),
        ("delete_production", "removes from db", McpMutationClass.WRITE_STORAGE),
        ("list_productions", "", McpMutationClass.READ),
    ]
    for name, desc, expected in cases:
        got = classify_tool(name, desc)
        if got != expected:
            return check(f"classify: {name} → {expected}", False, f"obteve {got}")
    return check(
        "classify_tool: 5 ferramentas classificadas corretamente",
        True,
        f"wizard_run_step=WRITE_META, editor_export=WRITE_ART, install=INSTALL, delete=WRITE_STORAGE, list=READ",
    )


def test_creative_does_not_complete_without_review() -> bool:
    step = WizardStep(
        step_id="plan", workflow_id="short_film",
        kind=WizardStepKind.CREATIVE,
        expected_effect="json_only",
        schema={"required": ["scenes"]},
    )
    result = dispatch_step(step, llm_call=lambda s: {"scenes": ["intro", "rising"]})
    return check(
        "creative: NÃO marca concluído (aguarda revisão humana)",
        not result.completed and result.proposal is not None,
        f"completed={result.completed}, proposal={result.proposal}",
    )


def test_creative_rejects_missing_required_key() -> bool:
    step = WizardStep(
        step_id="plan", workflow_id="short_film",
        kind=WizardStepKind.CREATIVE,
        expected_effect="json_only",
        schema={"required": ["scenes", "characters"]},
    )
    result = dispatch_step(step, llm_call=lambda s: {"scenes": ["x"]})  # faltando characters
    return check(
        "creative: proposta sem chave obrigatória retorna erro",
        not result.completed and "characters" in (result.error or ""),
        f"error={result.error}",
    )


def test_mechanical_completes_only_with_artifact() -> bool:
    step = WizardStep(
        step_id="download_audio", workflow_id="movie",
        kind=WizardStepKind.MECHANICAL,
        expected_effect="artifact_at_path",
        effect_target="/tmp/audio.wav",
    )
    # Caso 1: serviço não gera arquivo
    r1 = dispatch_step(step, mechanical_call=lambda s: "/tmp/audio_ghost.wav")
    # Caso 2: serviço gera arquivo real
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as fh:
        fh.write(b"RIFF")
        real_path = fh.name
    r2 = dispatch_step(step, mechanical_call=lambda s: real_path)
    Path(real_path).unlink(missing_ok=True)
    return check(
        "mechanical: concluído só com artefato real no disco",
        (not r1.completed) and r2.completed,
        f"ghost_completed={r1.completed}, real_completed={r2.completed}",
    )


def test_mechanical_rejects_wrong_expected_effect() -> bool:
    step = WizardStep(
        step_id="x", workflow_id="y",
        kind=WizardStepKind.MECHANICAL,
        expected_effect="json_only",  # errado para mechanical
    )
    r = dispatch_step(step, mechanical_call=lambda s: "/tmp/x")
    return check(
        "mechanical: expected_effect errado retorna erro",
        (not r.completed) and "artifact_at_path" in (r.error or ""),
        f"error={r.error}",
    )


def test_review_completes_with_valid_decision() -> bool:
    step = WizardStep(
        step_id="approve_plan", workflow_id="short_film",
        kind=WizardStepKind.REVIEW,
        expected_effect="human_decision",
    )
    r_ok = dispatch_step(step, review_input="approve")
    r_invalid = dispatch_step(step, review_input="maybe_later")
    return check(
        "review: concluído só com decisão válida",
        r_ok.completed and r_ok.decision == "approve" and (not r_invalid.completed),
        f"approve_ok={r_ok.completed}, invalid_ok={r_invalid.completed}",
    )


def test_wizard_run_step_is_write_meta() -> bool:
    """Confirma que a ferramenta wizard_run_step (mencionada pelo dossiê)
    é classificada como write_meta."""
    tool = McpTool(name="wizard_run_step", mutation_class=classify_tool("wizard_run_step"))
    return check(
        "wizard_run_step é WRITE_META (não READ)",
        tool.mutation_class == McpMutationClass.WRITE_META,
        f"mutation_class={tool.mutation_class.value}",
    )


def test_editor_export_is_write_art() -> bool:
    tool = McpTool(name="editor_export", mutation_class=classify_tool("editor_export", "renders final video"))
    return check(
        "editor_export é WRITE_ART (não READ)",
        tool.mutation_class == McpMutationClass.WRITE_ART,
        f"mutation_class={tool.mutation_class.value}",
    )


def main() -> int:
    print("== R03 Wizard tipado e MCP mutation_class ==")
    tests = [
        test_step_validates_effect,
        test_classify_tool_by_keyword,
        test_creative_does_not_complete_without_review,
        test_creative_rejects_missing_required_key,
        test_mechanical_completes_only_with_artifact,
        test_mechanical_rejects_wrong_expected_effect,
        test_review_completes_with_valid_decision,
        test_wizard_run_step_is_write_meta,
        test_editor_export_is_write_art,
    ]
    failures = 0
    for t in tests:
        if not t():
            failures += 1
    print()
    if failures == 0:
        print(f"PASS {len(tests)}/{len(tests)} checks")
        return 0
    print(f"FAIL {failures}/{len(tests)} checks")
    return 1


if __name__ == "__main__":
    sys.exit(main())