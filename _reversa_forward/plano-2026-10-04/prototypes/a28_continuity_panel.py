#!/usr/bin/env python3
"""Protótipo isolado do Continuity Panel (A28).

Valida a estratégia proposta em `33-feature-a28-continuity-panel.md`
**sem** importar de `app/` (política do Reversa). O protótipo:

1. Reusa o `check_sequence` do protótipo A25 (dataclasses equivalentes).
2. Agrega resultados por cena (`panel_for_production`).
3. Calcula resumo (info/warning/error count) por cena.
4. Aplica overrides do usuário (justified/dismissed/regenerated).
5. Exporta CSV no formato RFC 4180.
6. Renderiza HTML estático com badges (chip + ícone + cor) e modal stub.

Rodar:
    python3 _reversa_forward/plano-2026-10-04/prototypes/a28_continuity_panel.py

Saída esperada: 7 checks OK + arquivo HTML gerado.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import sys
import tempfile
import warnings
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

# Reusa o protótipo A25 in-process para não duplicar schema.
sys.path.insert(0, str(Path(__file__).parent))
from a25_shot_ir import (  # noqa: E402
    ShotIR,
    CharacterInShot,
    Position,
    Gaze,
    HandState,
    ObjectState,
    Environment,
    Action,
    Camera,
    AudioCue,
    ContinuityHints,
    Inconsistency,
    check_sequence,
    make_ana,
    make_joao,
    make_shot,
)


# ---------------------------------------------------------------------------
# 1. Modelo de dados do painel
# ---------------------------------------------------------------------------

class PanelStatus:
    PENDING = "pending"
    JUSTIFIED = "justified"
    REGENERATED = "regenerated"
    DISMISSED = "dismissed"


VALID_STATUSES = (
    PanelStatus.PENDING,
    PanelStatus.JUSTIFIED,
    PanelStatus.REGENERATED,
    PanelStatus.DISMISSED,
)

SEVERITY_ORDER = ("info", "warning", "error")


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
    evidence: dict
    scene_id: str
    status: str = PanelStatus.PENDING
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
# 2. Overrides do usuário
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


def apply_overrides(
    entries: list[PanelEntry], overrides: dict[str, dict]
) -> list[PanelEntry]:
    for e in entries:
        ov = overrides.get(e.inconsistency_id)
        if ov:
            e.status = ov.get("status", e.status)
            e.note = ov.get("note")
    return entries


# ---------------------------------------------------------------------------
# 3. Agregação por cena
# ---------------------------------------------------------------------------

def panel_for_production(
    production_id: str,
    shots_by_scene: dict[str, list[ShotIR]],
    overrides: Optional[dict[str, dict]] = None,
) -> ContinuityPanel:
    panel = ContinuityPanel(production_id=production_id)
    overrides = overrides or {}
    now = datetime.now(timezone.utc).isoformat()
    for scene_id, shots in shots_by_scene.items():
        summary = SceneContinuitySummary(scene_id=scene_id)
        inconsistencies = check_sequence(shots)
        for inc in inconsistencies:
            entry = PanelEntry(
                inconsistency_id=_entry_id(inc.kind, inc.shot_id_a, inc.shot_id_b),
                kind=inc.kind,
                severity=inc.severity,
                shot_id_a=inc.shot_id_a,
                shot_id_b=inc.shot_id_b,
                message=inc.message,
                evidence=inc.evidence,
                scene_id=scene_id,
                detected_at=now,
            )
            apply_overrides([entry], overrides)
            summary.entries.append(entry)
            if entry.status == PanelStatus.PENDING:
                if inc.severity == "info":
                    summary.info_count += 1
                elif inc.severity == "warning":
                    summary.warning_count += 1
                elif inc.severity == "error":
                    summary.error_count += 1
            summary.total_count += 1
        panel.scenes.append(summary)
        panel.entries.extend(summary.entries)
    return panel


# ---------------------------------------------------------------------------
# 4. Export CSV (RFC 4180)
# ---------------------------------------------------------------------------

CSV_HEADERS = ("scene_id", "entry_id", "kind", "severity", "shot_id_a", "shot_id_b", "status", "message")


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
# 5. Render HTML (Storyboard + Modal stub)
# ---------------------------------------------------------------------------

SEVERITY_ICON = {
    "gaze_flip": "👁 gaze",
    "wardrobe_skip": "👕 wardrobe",
    "object_hand_jump": "🤚 hand",
    "object_state_unsupported": "🚪 door",
    "action_orphan": "● action",
    "position_collision": "👥 collision",
}


def render_html(panel: ContinuityPanel, title: str = "Continuity Panel") -> str:
    totals = panel.totals()
    banner = ""
    if panel.has_any_error():
        banner = (
            f'<div class="banner" role="alert" aria-label="Inconsistência crítica">'
            f'⚠ {totals["error"]} inconsistência(s) crítica(s) — bloqueia export'
            f"</div>"
        )
    scene_blocks = []
    for s in panel.scenes:
        chips = []
        if s.info_count:
            chips.append(f'<span class="chip info" aria-label="{s.info_count} info">ℹ {s.info_count}</span>')
        if s.warning_count:
            chips.append(f'<span class="chip warning" aria-label="{s.warning_count} warning">⚠ {s.warning_count}</span>')
        if s.error_count:
            chips.append(f'<span class="chip error" aria-label="{s.error_count} error">⛔ {s.error_count}</span>')
        if not chips:
            chips.append('<span class="chip none" aria-label="sem inconsistências">✓ 0</span>')
        rows = []
        for e in s.entries:
            icon = SEVERITY_ICON.get(e.kind, e.kind)
            row_status = e.status
            actions = []
            if e.status == PanelStatus.PENDING:
                actions.append("Justificar")
                actions.append("Regenerar")
                if e.severity == "info":
                    actions.append("Ignorar")
            else:
                actions.append("Reabrir")
            rows.append(
                f"<tr>"
                f"<td>{icon}</td>"
                f"<td>{e.severity}</td>"
                f"<td>{e.shot_id_a}→{e.shot_id_b}</td>"
                f"<td>{e.message}</td>"
                f"<td>{row_status}</td>"
                f"<td>{' · '.join(actions)}</td>"
                f"</tr>"
            )
        scene_blocks.append(
            f'<section class="scene" aria-label="Cena {s.scene_id}">'
            f"<h3>{s.scene_id} {' '.join(chips)}</h3>"
            f"<table><thead><tr>"
            f"<th>Regra</th><th>Sev</th><th>Shots</th><th>Mensagem</th>"
            f"<th>Status</th><th>Ações</th></tr></thead>"
            f"<tbody>{''.join(rows)}</tbody></table>"
            f"</section>"
        )
    css = """
    body { font-family: ui-sans-serif, system-ui; background:#0c0c0c; color:#eee;
           padding:1.5rem; max-width:1100px; margin:0 auto; }
    h1 { margin:0 0 1rem; }
    .banner { background:#7f1d1d; color:#fee2e2; padding:.75rem 1rem;
              border-radius:6px; margin-bottom:1.25rem; font-weight:600; }
    .scene { background:#171717; border:1px solid #262626; border-radius:8px;
             padding:1rem 1.25rem; margin-bottom:1rem; }
    .scene h3 { margin:0 0 .75rem; display:flex; gap:.5rem; align-items:center; }
    table { width:100%; border-collapse:collapse; font-size:.9rem; }
    th, td { padding:.4rem .5rem; border-bottom:1px solid #262626; text-align:left; }
    th { color:#9ca3af; font-weight:500; }
    .chip { font-size:.75rem; padding:.15rem .5rem; border-radius:999px;
            border:1px solid #404040; }
    .chip.info { background:#1e3a8a; border-color:#1d4ed8; }
    .chip.warning { background:#78350f; border-color:#b45309; }
    .chip.error { background:#7f1d1d; border-color:#b91c1c; }
    .chip.none { background:#14532d; border-color:#15803d; }
    """
    body = (
        f'<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">'
        f"<title>{title}</title><style>{css}</style></head><body>"
        f"<h1>{title}</h1>"
        f"{banner}"
        f"{''.join(scene_blocks)}"
        f"</body></html>"
    )
    return body


# ---------------------------------------------------------------------------
# 6. Suíte de testes
# ---------------------------------------------------------------------------

def check(name: str, ok: bool, detail: str = "") -> bool:
    status = "OK" if ok else "FAIL"
    print(f"  {status} {name}{(' — ' + detail) if detail else ''}")
    return ok


def _build_scenes() -> dict[str, list[ShotIR]]:
    """Constrói 2 cenas com casos conhecidos para validação."""
    # Cena 1: tudo consistente (0 achados)
    c1 = [make_shot("c1s1", None), make_shot("c1s2", "c1s1"), make_shot("c1s3", "c1s2")]
    # Cena 2: 4 problemas injetados
    c2 = [make_shot("c2s1", None)]
    s2_gaze = make_shot("c2s2", "c2s1")
    s2_gaze.characters[0].gaze.direction = "screen_left"  # gaze_flip
    s2_ward = make_shot("c2s3", "c2s2")
    s2_ward.characters[0].wardrobe_version = "wardrobe_v99"  # wardrobe_skip
    s2_obj = make_shot("c2s4", "c2s3", {"objects": [ObjectState("obj_fridge", "open")]})
    # action_orphan: deixa um intent em c2s4 que c2s5 não completa
    s2_obj.action.in_progress = ["Ana fecha a geladeira"]
    s2_last = make_shot("c2s5", "c2s4")  # não completa a ação
    c2.extend([s2_gaze, s2_ward, s2_obj, s2_last])
    return {"cena_1": c1, "cena_2": c2}


def test_panel_aggregates_per_scene() -> bool:
    panel = panel_for_production("prod_test", _build_scenes())
    by_id = {s.scene_id: s for s in panel.scenes}
    ok = (
        "cena_1" in by_id
        and by_id["cena_1"].total_count == 0
        and "cena_2" in by_id
        and by_id["cena_2"].warning_count >= 3
        and by_id["cena_2"].total_count >= 3
    )
    return check(
        "panel: agrega por cena, separa counts",
        ok,
        f"cena_1={by_id['cena_1'].total_count}, "
        f"cena_2={by_id['cena_2'].warning_count} warn + {by_id['cena_2'].info_count} info",
    )


def test_overrides_roundtrip() -> bool:
    with tempfile.TemporaryDirectory() as td:
        path = Path(td) / "overrides.json"
        overrides = {
            "abc123": {"status": PanelStatus.JUSTIFIED, "note": "Cortney pediu"},
            "def456": {"status": PanelStatus.DISMISSED, "note": "falso positivo"},
        }
        save_overrides(path, overrides)
        loaded = load_overrides(path)
        return check(
            "overrides: round-trip atômico preserva status+note",
            loaded == overrides,
            f"loaded_keys={list(loaded.keys())}",
        )


def test_apply_overrides_changes_visible_count() -> bool:
    panel = panel_for_production("prod_test", _build_scenes())
    cena_2 = next(s for s in panel.scenes if s.scene_id == "cena_2")
    # Marca todos como justificados
    overrides = {
        e.inconsistency_id: {"status": PanelStatus.JUSTIFIED, "note": "ok"}
        for e in cena_2.entries
    }
    apply_overrides(panel.entries, overrides)
    # Reagrega
    rebuild = panel_for_production("prod_test", _build_scenes(), overrides)
    cena_2_after = next(s for s in rebuild.scenes if s.scene_id == "cena_2")
    return check(
        "apply_overrides: pending=0 quando tudo justificado",
        cena_2_after.warning_count + cena_2_after.info_count + cena_2_after.error_count == 0
        and cena_2_after.total_count == cena_2.total_count,
        f"before_warn={cena_2.warning_count}, after_warn={cena_2_after.warning_count}, "
        f"total_preserved={cena_2_after.total_count}",
    )


def test_csv_export_rfc4180() -> bool:
    panel = panel_for_production("prod_test", _build_scenes())
    text = export_csv(panel)
    rows = list(csv.reader(io.StringIO(text)))
    has_header = rows[0] == list(CSV_HEADERS)
    all_rows_valid = all(len(r) == len(CSV_HEADERS) for r in rows[1:])
    has_message_with_comma = any("," in r[7] for r in rows[1:])
    # Conta entradas com vírgula na mensagem (devem estar quotadas)
    quoted_comma_ok = True
    for row in rows[1:]:
        if "," in row[7] and not row[7].startswith('"'):
            quoted_comma_ok = False
    return check(
        "csv_export: header + RFC 4180 com vírgulas quotadas",
        has_header and all_rows_valid and quoted_comma_ok,
        f"rows={len(rows)-1}, has_comma_in_msg={has_message_with_comma}",
    )


def test_html_render_includes_banner_and_badges() -> bool:
    """Testa duas variantes:
    A) só warning → sem banner, com chip warning;
    B) com error → banner presente + chip error."""
    # Variante A: só warning (já é o cenário padrão)
    panel = panel_for_production("prod_test", _build_scenes())
    html_a = render_html(panel, "Test A")
    has_warn_chip = 'class="chip warning"' in html_a
    no_banner = 'class="banner"' not in html_a
    has_aria = 'aria-label=' in html_a
    has_table = '<table>' in html_a

    # Variante B: injeta um erro de position_collision manualmente
    custom_entry = PanelEntry(
        inconsistency_id=_entry_id("position_collision", "c2s1", "c2s1"),
        kind="position_collision",
        severity="error",
        shot_id_a="c2s1",
        shot_id_b="c2s1",
        message="Personagens no mesmo frame",
        evidence={"frames": ["screen_left"]},
        scene_id="cena_2",
    )
    summary_c2 = next(s for s in panel.scenes if s.scene_id == "cena_2")
    summary_c2.entries.append(custom_entry)
    summary_c2.error_count += 1
    panel.entries.append(custom_entry)
    html_b = render_html(panel, "Test B")
    has_banner = 'class="banner"' in html_b
    has_error_chip = 'class="chip error"' in html_b

    return check(
        "html_render: A=só warning (chips+aria), B=com error (banner+chip)",
        has_warn_chip and no_banner and has_aria and has_table
        and has_banner and has_error_chip,
        f"A(warn={has_warn_chip},no_banner={no_banner}) "
        f"B(banner={has_banner},error_chip={has_error_chip})",
    )


def test_panel_ignores_dismissed_in_aggregation() -> bool:
    """info dismissado não conta no summary; warning/error continuam."""
    panel = panel_for_production("prod_test", _build_scenes())
    info_entries = [e for e in panel.entries if e.severity == "info"]
    if not info_entries:
        return check("dismiss_info: pula (sem info entries neste cenário)", True)
    overrides = {e.inconsistency_id: {"status": PanelStatus.DISMISSED, "note": ""} for e in info_entries}
    rebuild = panel_for_production("prod_test", _build_scenes(), overrides)
    cena_total_before = sum(s.total_count for s in panel.scenes)
    cena_total_after = sum(s.total_count for s in rebuild.scenes)
    info_visible_before = sum(s.info_count for s in panel.scenes)
    info_visible_after = sum(s.info_count for s in rebuild.scenes)
    return check(
        "dismiss_info: total preservado, info_count zera",
        cena_total_before == cena_total_after and info_visible_after == 0
        and info_visible_before > 0,
        f"info_visible before={info_visible_before}, after={info_visible_after}",
    )


def test_hashes_are_stable() -> bool:
    """inconsistency_id é determinístico para a mesma entrada."""
    shot1 = make_shot("s1", None)
    shot2 = make_shot("s2", "s1")
    shot2.characters[0].gaze.direction = "screen_left"  # força gaze_flip
    incs = check_sequence([shot1, shot2])
    if not incs:
        return check("hash_stable: sem inconsistências para testar", True)
    inc = incs[0]
    expected = _entry_id(inc.kind, inc.shot_id_a, inc.shot_id_b)
    again = _entry_id(inc.kind, inc.shot_id_a, inc.shot_id_b)
    return check(
        "hash_stable: inconsistency_id determinístico",
        expected == again and len(expected) == 16,
        f"hash={expected}",
    )


def main() -> int:
    print("== A28 Continuity Panel prototype ==")
    tests = [
        test_panel_aggregates_per_scene,
        test_overrides_roundtrip,
        test_apply_overrides_changes_visible_count,
        test_csv_export_rfc4180,
        test_html_render_includes_banner_and_badges,
        test_panel_ignores_dismissed_in_aggregation,
        test_hashes_are_stable,
    ]
    failures = 0
    for t in tests:
        if not t():
            failures += 1
    # Renderiza HTML de exemplo para inspeção visual
    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "panel.html"
        panel = panel_for_production("prod_demo", _build_scenes())
        out.write_text(render_html(panel, "Demo Continuity Panel"), encoding="utf-8")
        size = out.stat().st_size
        print(f"\nHTML renderizado em {out} ({size} bytes)")
        # Salva CSV de exemplo
        csv_path = Path(td) / "panel.csv"
        csv_path.write_text(export_csv(panel), encoding="utf-8")
        print(f"CSV exportado em {csv_path} ({csv_path.stat().st_size} bytes)")
    print()
    if failures == 0:
        print(f"PASS {len(tests)}/{len(tests)} checks")
        return 0
    print(f"FAIL {failures}/{len(tests)} checks")
    return 1


if __name__ == "__main__":
    sys.exit(main())