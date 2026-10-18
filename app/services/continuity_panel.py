"""Continuity Panel backend (A28).

Agregação de inconsistências de continuidade por cena, overrides do
usuário, exportação CSV (RFC 4180), render HTML com badges.

Fonte: protótipo ``_reversa_forward/plano-2026-10-04/prototypes/a28_continuity_panel.py``.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import os
import tempfile
import warnings
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

VALID_STATUSES = ("pending", "justified", "regenerated", "dismissed")
SEVERITY_ORDER = ("info", "warning", "error")
CSV_HEADERS = ("scene_id", "entry_id", "kind", "severity", "shot_id_a", "shot_id_b", "status", "message")


def _entry_id(kind: str, shot_a: str, shot_b: str) -> str:
    return hashlib.sha256(f"{kind}|{shot_a}|{shot_b}".encode()).hexdigest()[:16]


@dataclass
class PanelEntry:
    inconsistency_id: str
    kind: str
    severity: str
    shot_id_a: str
    shot_id_b: str
    message: str
    evidence: dict = field(default_factory=dict)
    scene_id: str = ""
    status: str = "pending"
    note: Optional[str] = None
    detected_at: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class SceneContinuitySummary:
    scene_id: str
    info_count: int = 0
    warning_count: int = 0
    error_count: int = 0
    total_count: int = 0
    entries: list[PanelEntry] = field(default_factory=list)

    @property
    def has_error(self) -> bool:
        return self.error_count > 0

    @property
    def worst_severity(self) -> str:
        if self.error_count > 0:
            return "error"
        if self.warning_count > 0:
            return "warning"
        if self.info_count > 0:
            return "info"
        return "none"


@dataclass
class ContinuityPanel:
    production_id: str
    scenes: list[SceneContinuitySummary] = field(default_factory=list)
    entries: list[PanelEntry] = field(default_factory=list)

    def totals(self) -> dict[str, int]:
        return {
            "info": sum(s.info_count for s in self.scenes),
            "warning": sum(s.warning_count for s in self.scenes),
            "error": sum(s.error_count for s in self.scenes),
        }

    def has_any_error(self) -> bool:
        return any(s.has_error for s in self.scenes)


# ---------------------------------------------------------------------------
# Overrides
# ---------------------------------------------------------------------------

def load_overrides(path: Path) -> dict[str, dict]:
    if not path.exists():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    return payload.get("entries", {})


def save_overrides(path: Path, entries: dict[str, dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema_version": "1.0",
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "entries": entries,
    }
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def apply_overrides(entries: list[PanelEntry], overrides: dict[str, dict]) -> list[PanelEntry]:
    for e in entries:
        ov = overrides.get(e.inconsistency_id)
        if ov:
            e.status = ov.get("status", e.status)
            e.note = ov.get("note")
    return entries


# ---------------------------------------------------------------------------
# Agregação por cena (usa check_sequence do A25)
# ---------------------------------------------------------------------------

def panel_for_production(
    production_id: str,
    shots_by_scene: dict[str, list],
    overrides: Optional[dict[str, dict]] = None,
) -> ContinuityPanel:
    # Import A25 check_sequence lazily
    try:
        from app.services.director.continuity_check import check_sequence
    except ImportError:
        try:
            from services.director.continuity_check import check_sequence
        except ImportError:
            check_sequence = None

    panel = ContinuityPanel(production_id=production_id)
    overrides = overrides or {}
    now = datetime.now(timezone.utc).isoformat()

    for scene_id, shots in shots_by_scene.items():
        summary = SceneContinuitySummary(scene_id=scene_id)
        inconsistencies = check_sequence(shots) if check_sequence else []
        for inc in inconsistencies:
            kind = getattr(inc, "kind", str(inc))
            severity = getattr(inc, "severity", "warning")
            shot_a = getattr(inc, "shot_id_a", "")
            shot_b = getattr(inc, "shot_id_b", "")
            message = getattr(inc, "message", "")
            evidence = getattr(inc, "evidence", {})
            entry = PanelEntry(
                inconsistency_id=_entry_id(kind, shot_a, shot_b),
                kind=kind,
                severity=severity,
                shot_id_a=shot_a,
                shot_id_b=shot_b,
                message=message,
                evidence=evidence if isinstance(evidence, dict) else {},
                scene_id=scene_id,
                detected_at=now,
            )
            apply_overrides([entry], overrides)
            summary.entries.append(entry)
            if entry.status == "pending":
                if severity == "info":
                    summary.info_count += 1
                elif severity == "warning":
                    summary.warning_count += 1
                elif severity == "error":
                    summary.error_count += 1
            summary.total_count += 1
        panel.scenes.append(summary)
        panel.entries.extend(summary.entries)
    return panel


# ---------------------------------------------------------------------------
# Export CSV (RFC 4180)
# ---------------------------------------------------------------------------

def export_csv(panel: ContinuityPanel) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n", quoting=csv.QUOTE_ALL)
    writer.writerow(CSV_HEADERS)
    for entry in panel.entries:
        writer.writerow([
            entry.scene_id,
            entry.inconsistency_id,
            entry.kind,
            entry.severity,
            entry.shot_id_a,
            entry.shot_id_b,
            entry.status,
            entry.message,
        ])
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Render HTML
# ---------------------------------------------------------------------------

def render_html(panel: ContinuityPanel, title: str = "Continuity Panel") -> str:
    totals = panel.totals()
    banner = ""
    if panel.has_any_error():
        banner = (
            f'<div class="banner" role="alert" aria-label="Inconsistência crítica">'
            f'⚠ {totals["error"]} inconsistência(s) crítica(s) — bloqueia export'
            f'</div>'
        )
    rows = []
    for scene in panel.scenes:
        for entry in scene.entries:
            chip = f'<span class="chip {entry.severity}">{entry.kind}</span>'
            rows.append(
                f'<tr><td>{entry.scene_id}</td><td>{chip}</td>'
                f'<td>{entry.shot_id_a} → {entry.shot_id_b}</td>'
                f'<td>{entry.message}</td><td>{entry.status}</td></tr>'
            )
    return (
        f'<html><head><title>{title}</title></head><body>'
        f'<h1>{title}</h1>{banner}'
        f'<table><thead><tr>'
        f'<th>Scene</th><th>Kind</th><th>Shots</th><th>Message</th><th>Status</th>'
        f'</tr></thead><tbody>{"".join(rows)}</tbody></table>'
        f'</body></html>'
    )
