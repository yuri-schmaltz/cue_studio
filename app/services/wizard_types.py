"""Wizard tipado e classificação de mutação MCP (R03).

Tipos de etapa Wizard (creative/mechanical/review), dispatch por kind,
e classificação de ferramentas MCP por efeito (mutation_class).

Fonte: protótipo ``_reversa_forward/plano-2026-10-04/prototypes/r03_wizard_mcp.py``.
"""

from __future__ import annotations

import dataclasses
import hashlib
import json
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Optional


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


@dataclass(frozen=True)
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
# Classificação de ferramentas MCP
# ---------------------------------------------------------------------------

HEURISTIC_KEYWORDS = {
    McpMutationClass.WRITE_ART: {"export", "approve", "reject", "edit_plan", "write_plan", "generate_image", "generate_video", "render", "mix"},
    McpMutationClass.WRITE_META: {"wizard", "set_param", "rename", "set_setting", "update", "configure"},
    McpMutationClass.WRITE_STORAGE: {"delete", "purge", "move", "relink", "upload"},
    McpMutationClass.INSTALL: {"install", "uninstall", "download_model"},
}


def classify_tool(name: str, description: str = "") -> McpMutationClass:
    """Classifica ferramenta pelo nome (e descrição opcional) por heurística."""
    haystack = f"{name} {description}".lower()
    for cls, keywords in HEURISTIC_KEYWORDS.items():
        if any(kw in haystack for kw in keywords):
            return cls
    return McpMutationClass.READ


# ---------------------------------------------------------------------------
# Dispatch por kind
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
