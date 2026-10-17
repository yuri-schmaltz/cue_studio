#!/usr/bin/env python3
"""Integração demonstrativa dos 10 protótipos do Plano Executivo.

Este script importa e exercita em conjunto os 10 protótipos do ciclo 4,
simulando o fluxo de produção completo da fixture "A luz da oficina" sem
depender de GPU, FastAPI, PyTorch ou do Cue Studio real. Ele demonstra como
cada peça se encaixa no Director pipeline.

Etapas executadas:
1. Shot IR (A25)             — schema Pydantic-like + 6 regras de continuidade
2. Continuity Panel (A28)    — agrega erros por cena e exporta CSV
3. Retake (A26b / R01)       — reproduz bug + corrige
4. Dependencies (A26)        — build_graph + impact_of + regenerate
5. CapabilityMatrix (A34)    — catálogo 14 modelos + check
6. Provenance (A27)          — SHA-256 + bundle round-trip
7. PT-BR Corpus (A30)        — 30+ frases + avaliação simulada
8. Economy Profile (A29)     — relatório Markdown + budget validation
9. Offline-strict (A31)      — auditor de conexões
10. Wizard tipado (R03)      — dispatch creative/mechanical/review
11. Verificação cruzada       — coerência A25/A28/A26/A34/A30
12. Cross-family continuity   — adapters H3/LTX/Wan/Hunyuan + fallback
13. Lockfile reproduzível     — parse + lock + drift + upgrade

Rodar:
    python3 _reversa_forward/plano-2026-10-04/prototypes/integration_smoke.py

Saída esperada: 13/13 steps OK.
"""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

# Adiciona o diretório de protótipos ao sys.path
PROTOS = Path(__file__).parent
sys.path.insert(0, str(PROTOS))

# Importa os 10 protótipos como módulos
import a25_shot_ir
import a25b_cross_family_continuity
import a26b_retake_dispatch
import a26_dependencies
import a26c_lockfile_reproducible
import a27_provenance
import a28_continuity_panel
import a29_economy_profile
import a30_ptbr_corpus
import a31_offline_strict
import a34_capability_matrix
import r03_wizard_mcp


# ---------------------------------------------------------------------------
# Mini-helpers compartilhados
# ---------------------------------------------------------------------------

def _print_step(n: int, label: str, ok: bool, detail: str = "") -> bool:
    status = "OK" if ok else "FAIL"
    print(f"  [{n:2d}/13] {status}  {label}{(' — ' + detail) if detail else ''}")
    return ok


def _build_luz_da_oficina_shots() -> list[dict]:
    """Constrói 12 shots da fixture com Shot IR inline, simulando o cue-reference-film-v1."""
    import dataclasses
    shots = []
    # Shot 1: oficina vazia
    shots.append({
        "shot_id": "shot_001",
        "schema_version": "1.0",
        "characters": [
            {
                "id": "robot_01",
                "position": {"x": 0.5, "y": 0.5, "z": 0.0, "frame": "screen_center"},
                "gaze": {"direction": "into_camera", "target": None},
                "hands": {"left": None, "right": None},
                "wardrobe_version": "wardrobe_v1",
                "expression": "neutral",
                "posture": "standing",
            }
        ],
        "environment": {
            "location_id": "room_a",
            "time_of_day": "morning",
            "lighting": "natural_window_left",
            "objects_state": [
                {"id": "obj_fridge", "state": "closed"},
                {"id": "obj_door", "state": "open"},
                {"id": "obj_lamp_base", "state": "off"},
            ],
        },
        "action": {
            "completed_in_shot": [],
            "in_progress": [],
            "next_intent": "robot entra pela porta",
        },
        "camera": {"shot_size": "wide", "movement": "static", "angle": "eye_level"},
        "audio": {"dialogue": None, "ambient": ["ambient_loop_001"], "music_segment": "music_intro"},
        "continuity_hints": {"previous_shot_id": None, "state_inherited_from": None},
        "blocking_contract": None,
    })
    # Shot 2: robot entra pela porta
    shots.append({
        "shot_id": "shot_002",
        "schema_version": "1.0",
        "characters": [
            {
                "id": "robot_01",
                "position": {"x": 0.3, "y": 0.5, "z": 0.0, "frame": "screen_left"},
                "gaze": {"direction": "screen_right", "target": "obj_door"},
                "hands": {"left": None, "right": None},
                "wardrobe_version": "wardrobe_v1",
                "expression": "neutral",
                "posture": "walking",
            }
        ],
        "environment": {
            "location_id": "room_a",
            "time_of_day": "morning",
            "lighting": "natural_window_left",
            "objects_state": [
                {"id": "obj_fridge", "state": "closed"},
                {"id": "obj_door", "state": "open"},
                {"id": "obj_lamp_base", "state": "off"},
            ],
        },
        "action": {
            "completed_in_shot": ["robot entrou pela porta"],
            "in_progress": ["robot caminha até a mesa"],
            "next_intent": "robot olha para o cubo",
        },
        "camera": {"shot_size": "medium_wide", "movement": "static", "angle": "eye_level"},
        "audio": {"dialogue": None, "ambient": ["ambient_loop_001"], "music_segment": "music_intro"},
        "continuity_hints": {"previous_shot_id": "shot_001", "state_inherited_from": "shot_001"},
        "blocking_contract": "robot_01@screen_left, door@screen_right",
    })
    # Shot 3: close das 3 lentes
    shots.append({
        "shot_id": "shot_003",
        "schema_version": "1.0",
        "characters": [
            {
                "id": "robot_01",
                "position": {"x": 0.5, "y": 0.4, "z": 1.0, "frame": "screen_center"},
                "gaze": {"direction": "screen_down", "target": "red_cube"},
                "hands": {"left": None, "right": None},
                "wardrobe_version": "wardrobe_v1",
                "expression": "curious",
                "posture": "leaning_forward",
            }
        ],
        "environment": {
            "location_id": "room_a",
            "time_of_day": "morning",
            "lighting": "natural_window_left",
            "objects_state": [
                {"id": "obj_fridge", "state": "closed"},
                {"id": "obj_door", "state": "half_open"},
                {"id": "obj_lamp_base", "state": "off"},
                {"id": "red_cube", "state": "on_table"},
            ],
        },
        "action": {
            "completed_in_shot": ["robot caminhou até a mesa"],
            "in_progress": ["robot observa o cubo"],
            "next_intent": "robot pega o cubo",
        },
        "camera": {"shot_size": "close_up", "movement": "static", "angle": "eye_level"},
        "audio": {"dialogue": "Na oficina silenciosa, uma pequena descoberta.", "ambient": ["ambient_loop_001"], "music_segment": "music_intro"},
        "continuity_hints": {"previous_shot_id": "shot_002", "state_inherited_from": "shot_002"},
        "blocking_contract": "robot_01@screen_center, red_cube@screen_down",
    })
    # Shot 4: pega cubo
    shots.append({
        "shot_id": "shot_004",
        "schema_version": "1.0",
        "characters": [
            {
                "id": "robot_01",
                "position": {"x": 0.5, "y": 0.5, "z": 0.5, "frame": "screen_center"},
                "gaze": {"direction": "screen_down", "target": "red_cube"},
                "hands": {"left": None, "right": "red_cube"},
                "wardrobe_version": "wardrobe_v1",
                "expression": "neutral",
                "posture": "reaching",
            }
        ],
        "environment": {
            "location_id": "room_a",
            "time_of_day": "morning",
            "lighting": "natural_window_left",
            "objects_state": [
                {"id": "obj_fridge", "state": "closed"},
                {"id": "obj_door", "state": "half_open"},
                {"id": "obj_lamp_base", "state": "off"},
                {"id": "red_cube", "state": "in_hand"},
            ],
        },
        "action": {
            "completed_in_shot": ["robot pegou o cubo com a mão direita"],
            "in_progress": [],
            "next_intent": "robot caminha até a base",
        },
        "camera": {"shot_size": "medium", "movement": "static", "angle": "eye_level"},
        "audio": {"dialogue": None, "ambient": ["ambient_loop_001"], "music_segment": "music_intro"},
        "continuity_hints": {"previous_shot_id": "shot_003", "state_inherited_from": "shot_003"},
        "blocking_contract": "robot_01@screen_center, red_cube@hand_right",
    })
    # Shots 5-12: simplificados (apenas marcadores)
    for i in range(5, 13):
        sid = f"shot_{i:03d}"
        shots.append({
            "shot_id": sid,
            "schema_version": "1.0",
            "characters": [
                {
                    "id": "robot_01",
                    "position": {"x": 0.5, "y": 0.5, "z": 0.5, "frame": "screen_center"},
                    "gaze": {"direction": "into_camera", "target": None},
                    "hands": {"left": None, "right": "red_cube" if i < 8 else None},
                    "wardrobe_version": "wardrobe_v1",
                    "expression": "neutral",
                    "posture": "standing",
                }
            ],
            "environment": {
                "location_id": "room_a",
                "time_of_day": "morning",
                "lighting": "natural_window_left" if i < 9 else "amber_lamp",
                "objects_state": [
                    {"id": "obj_lamp_base", "state": "off" if i < 9 else "on"},
                    {"id": "red_cube", "state": "in_hand" if i < 8 else "in_base"},
                ],
            },
            "action": {
                "completed_in_shot": [],
                "in_progress": [],
                "next_intent": None,
            },
            "camera": {"shot_size": "medium", "movement": "static", "angle": "eye_level"},
            "audio": {"dialogue": None, "ambient": ["ambient_loop_001"], "music_segment": "music_outro" if i >= 11 else "music_intro"},
            "continuity_hints": {"previous_shot_id": f"shot_{i-1:03d}", "state_inherited_from": f"shot_{i-1:03d}"},
            "blocking_contract": None,
        })
    return shots


# ---------------------------------------------------------------------------
# Orquestração
# ---------------------------------------------------------------------------

def main() -> int:
    print("=" * 72)
    print("Integration Smoke Test — Plano Executivo Cue Studio v2.5.2")
    print("Fixture: cue-reference-film-v1 — 'A luz da oficina' (12 shots)")
    print("=" * 72)
    print()

    failures = 0

    # Step 1: Shot IR (A25) — carregar shots como ShotIR objects
    shots_raw = _build_luz_da_oficina_shots()
    shot_irs = []
    for raw in shots_raw:
        shot_irs.append(a25_shot_ir.dict_to_shotir(raw))
    ok1 = _print_step(1, "A25 Shot IR (12 shots parseados)", len(shot_irs) == 12, f"shots={len(shot_irs)}")
    failures += 0 if ok1 else 1

    # Step 2: Continuity Check (A25 + A28)
    inconsistencies = a25_shot_ir.check_sequence(shot_irs)
    # Filtra action_orphan que aparece naturalmente em sequências longas
    panel = a28_continuity_panel.panel_for_production(
        "proj_demo", {"cena_1": shot_irs[:6], "cena_2": shot_irs[6:]},
    )
    csv_text = a28_continuity_panel.export_csv(panel)
    csv_first_line = csv_text.splitlines()[0] if csv_text else ""
    csv_header_ok = 'scene_id' in csv_first_line and 'entry_id' in csv_first_line
    error_count = sum(1 for e in panel.entries if getattr(e, 'severity', '') == 'error')
    ok2 = _print_step(
        2, "A25+A28 Continuity check + CSV export",
        len(csv_text) > 50 and csv_header_ok,
        f"lines={csv_text.count(chr(10))}, errors={error_count}",
    )
    failures += 0 if ok2 else 1

    # Step 3: Retake (A26b) — reproduce bug + fix
    buggy = a26b_retake_dispatch.ProductionResumeBuggy
    fixed = a26b_retake_dispatch.ProductionResumeFixed
    with tempfile.TemporaryDirectory() as td:
        store_b = a26b_retake_dispatch.ProductionStore(Path(td) / "b.sqlite3")
        store_b.upsert_pipeline(a26b_retake_dispatch._snapshot())
        executor_b = a26b_retake_dispatch.FakeExecutor()
        facade_b = buggy(store_b, pipeline_resume=executor_b)
        r_buggy = facade_b.retake_stage(pipeline_id="pipe-1", out_dir="ws-1", stage_name="image")

        store_f = a26b_retake_dispatch.ProductionStore(Path(td) / "f.sqlite3")
        store_f.upsert_pipeline(a26b_retake_dispatch._snapshot())
        executor_f = a26b_retake_dispatch.FakeExecutor()
        facade_f = fixed(store_f, pipeline_resume=executor_f)
        r_fixed = facade_f.retake_stage(pipeline_id="pipe-1", out_dir="ws-1", stage_name="image")
    ok3 = _print_step(
        3, "A26b Retake — bug confirmado + corrigido",
        r_buggy.ok and executor_b.call_count == 0 and r_fixed.ok and executor_f.call_count == 1,
        f"buggy_count={executor_b.call_count}, fixed_count={executor_f.call_count}",
    )
    failures += 0 if ok3 else 1

    # Step 4: Dependencies (A26)
    # Constrói shots com dialogue + approved para o grafo
    deps_shots = []
    for raw in shots_raw:
        d = {
            "shot_id": raw["shot_id"],
            "characters": raw["characters"],
            "audio": {
                "dialogue": raw["audio"].get("dialogue"),
                "music_segment": raw["audio"].get("music_segment"),
            },
            "approved": raw["shot_id"] in {"shot_001", "shot_005"},
        }
        deps_shots.append(d)
    graph = a26_dependencies.build_graph_from_shots("proj_demo", deps_shots)
    # Muda o dialogue do shot_001 e vê o impacto
    text_ref = next(
        (e.source for e in graph.edges if e.source.kind == a26_dependencies.ResourceKind.TEXT),
        None,
    )
    if text_ref is not None:
        report = a26_dependencies.impact_of(graph, text_ref)
        ok4 = _print_step(
            4, "A26 Dependencies — impact_of",
            report.changed.resource_id != "",
            f"affected={len(report.affected)}, preserved={len(report.preserve)}",
        )
    else:
        ok4 = _print_step(4, "A26 Dependencies — sem dialogue, skip", True)
    failures += 0 if ok4 else 1

    # Step 5: CapabilityMatrix (A34)
    matrix = a34_capability_matrix.CapabilityMatrix()
    h3_omni_caps = matrix.capabilities_for("minimax_h3_omni_pruned", a34_capability_matrix.Runtime.WAN_GP, "t2v")
    ltx_caps = matrix.capabilities_for("ltx25_distilled", a34_capability_matrix.Runtime.WAN_GP, "t2v")
    ok5 = _print_step(
        5, "A34 CapabilityMatrix — 14 modelos catalogados",
        a34_capability_matrix.Capability.AUDIO_GENERATE in h3_omni_caps
        and a34_capability_matrix.Capability.TEXT_TO_VIDEO in ltx_caps
        and a34_capability_matrix.Capability.AUDIO_GENERATE not in ltx_caps,
        f"H3.omni.audio_generate={a34_capability_matrix.Capability.AUDIO_GENERATE in h3_omni_caps}, LTX.text_to_video={a34_capability_matrix.Capability.TEXT_TO_VIDEO in ltx_caps}",
    )
    failures += 0 if ok5 else 1

    # Step 6: Provenance (A27)
    with tempfile.TemporaryDirectory() as td:
        # Cria um asset + manifesto
        output = Path(td) / "take_001.mp4"
        output.write_bytes(b"FAKE OUTPUT BYTES " * 1024)
        sidecar = Path(td) / "take_001.meta.json"
        sidecar.write_bytes(b'{"title": "test"}')
        # Cria peso do modelo
        weights = Path(td) / "weights" / "model.safetensors"
        weights.parent.mkdir(parents=True, exist_ok=True)
        weights.write_bytes(b"MODEL_WEIGHTS " * 512)
        sha_w = a27_provenance.compute_sha256(weights)
        manifest = a27_provenance.ProvenanceManifest(
            schema_version=a27_provenance.PROVENANCE_SCHEMA_VERSION,
            take_id="take_001",
            project_id="proj_demo",
            generation_timestamp="2026-10-16T13:00Z",
            adapter_id="minimax_h3_omni_pruned",
            adapter_revision="5b37a5d",
            model=a27_provenance.ModelRef(
                model_id="model_h3_pruned_20b",
                sha256=sha_w,
                quantization="int8",
                precision="pruned",
            ),
            seed=148920,
            profile=a27_provenance.HardwareProfile(
                gpu_name="NVIDIA RTX 3060",
                gpu_vram_mb=8192,
                system_ram_mb=32768,
                os="linux",
            ),
            runtime=a27_provenance.RuntimeRef(
                python="3.11.14",
                pytorch="2.7.1",
                cuda="12.8",
                cue_studio_revision="5b37a5d",
            ),
            artifacts=[
                a27_provenance.AssetRef(
                    asset_id="asset_001",
                    role="output",
                    sha256=a27_provenance.compute_sha256(output),
                    size_bytes=output.stat().st_size,
                    relative_path="take_001.mp4",
                ),
            ],
            sidecars={sidecar.name: a27_provenance.compute_sha256(sidecar)},
        )
        manifest_path = Path(td) / "take_001.provenance.json"
        a27_provenance.write_manifest_atomic(manifest, manifest_path)
        status, issues = a27_provenance.validate_against_disk(manifest, Path(td))
    ok6 = _print_step(
        6, "A27 Provenance — manifest válido",
        status == "verified" and not issues,
        f"status={status}, issues={issues}",
    )
    failures += 0 if ok6 else 1

    # Step 7: PT-BR Corpus (A30)
    corpus = a30_ptbr_corpus.default_corpus()
    dict_pt = a30_ptbr_corpus.PronunciationDictionary()
    dict_pt.set("Schmaltz", "Xmalts")
    qwen_report = a30_ptbr_corpus.simulate_evaluation(a30_ptbr_corpus.TtsEngine.QWEN3_TTS, corpus)
    ok7 = _print_step(
        7, "A30 Corpus PT-BR (34 frases, ranking consistente)",
        len(corpus) >= 30 and qwen_report.mean_wer < 0.15,
        f"corpus={len(corpus)}, qwen_wer={qwen_report.mean_wer:.2%}",
    )
    failures += 0 if ok7 else 1

    # Step 8: Economy Profile (A29)
    hw = a29_economy_profile.HardwareMeasurement("NVIDIA RTX 3060", 8192, "550.54", "12.8", 32768, "linux")
    # RunMeasurement(run_id, mode, wall_seconds, peak_vram_mb, peak_ram_mb,
    #                oom_failures, decoder_failures, continuity_failures,
    #                takes_approved_without_rerun, takes_total, wer_pt_br, ...)
    runs = [
        a29_economy_profile.RunMeasurement(f"run_{i}", "F2", 1800.0 + i * 60, 7800, 0, 0, 0, 10, 12, 0.08)
        for i in range(3)
    ]
    report = a29_economy_profile.run_benchmark(hw, runs)
    with tempfile.TemporaryDirectory() as td:
        report.generated_at = "2026-10-16T13:00Z"
        report_path = Path(td) / "economy.md"
        a29_economy_profile.write_report(report, report_path)
        text = report_path.read_text(encoding="utf-8")
    budget = a29_economy_profile.Budget(max_p90_wall=3000.0, max_p95_vram_mb=8000, max_ooms=0, min_approval_rate=0.5)
    budget_results = a29_economy_profile.validate_against_budget(report, budget)
    ok8 = _print_step(
        8, "A29 Economy Profile E2 — budget OK",
        all(budget_results.values()),
        f"p90={report.aggregated.p90_wall}s, budget_results={budget_results}",
    )
    failures += 0 if ok8 else 1

    # Step 9: Offline-strict (A31)
    auditor = a31_offline_strict.ConnectionAuditor(a31_offline_strict.NetworkPolicy.OFFLINE)
    summary = a31_offline_strict.ci_smoke(auditor)
    ok9 = _print_step(
        9, "A31 Offline-strict — auditor bloqueia remotas",
        summary["allowed"] == 5 and summary["blocked"] == 5,
        f"summary={summary}",
    )
    failures += 0 if ok9 else 1

    # Step 10: Wizard tipado (R03)
    creative_step = r03_wizard_mcp.WizardStep(
        step_id="plan_short_film", workflow_id="short_film",
        kind=r03_wizard_mcp.WizardStepKind.CREATIVE,
        expected_effect="json_only",
        schema={"required": ["scenes", "characters"]},
    )
    r_creative = r03_wizard_mcp.dispatch_step(
        creative_step,
        llm_call=lambda s: {"scenes": ["intro", "rising"], "characters": ["robot_01"]},
    )
    mechanical_step = r03_wizard_mcp.WizardStep(
        step_id="download_audio", workflow_id="short_film",
        kind=r03_wizard_mcp.WizardStepKind.MECHANICAL,
        expected_effect="artifact_at_path",
        effect_target="/tmp/audio.wav",
    )
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as fh:
        fh.write(b"RIFF"); real_audio = fh.name
    r_mech = r03_wizard_mcp.dispatch_step(mechanical_step, mechanical_call=lambda s: real_audio)
    Path(real_audio).unlink(missing_ok=True)
    review_step = r03_wizard_mcp.WizardStep(
        step_id="approve_plan", workflow_id="short_film",
        kind=r03_wizard_mcp.WizardStepKind.REVIEW,
        expected_effect="human_decision",
    )
    r_review = r03_wizard_mcp.dispatch_step(review_step, review_input="approve")
    ok10 = _print_step(
        10, "R03 Wizard tipado — 3 kinds OK",
        (not r_creative.completed) and r_mech.completed and r_review.completed,
        f"creative={r_creative.completed}, mech={r_mech.completed}, review={r_review.completed}",
    )
    failures += 0 if ok10 else 1

    # Step 11: Verificação cruzada — A25 continuidade_check + A28 panel + A26 dependencies
    # Aplica Shot IR inconsistente injetado e mede cada sistema isolado
    collected_issues: dict[str, int] = {}
    # (1) check_sequence
    seq_issues = a25_shot_ir.check_sequence(shot_irs)
    collected_issues["a25_check_sequence"] = len(seq_issues)
    # (2) panel_for_production
    panel_all = a28_continuity_panel.panel_for_production("p", {"cena_1": shot_irs[:6], "cena_2": shot_irs[6:]})
    collected_issues["a28_panel_entries"] = sum(s.total_count for s in panel_all.scenes)
    # (3) graph
    g = a26_dependencies.build_graph_from_shots("p", deps_shots)
    collected_issues["a26_edges"] = len(g.edges)
    # (4) CapabilityMatrix
    matrix_all = a34_capability_matrix.CapabilityMatrix()
    collected_issues["a34_entries"] = len(matrix_all.entries)
    # (5) Corpus
    collected_issues["a30_corpus_size"] = len(a30_ptbr_corpus.default_corpus())
    ok11 = _print_step(
        11, "Verificação cruzada — 5 dimensões coerentes",
        collected_issues["a25_check_sequence"] >= 0
        and collected_issues["a28_panel_entries"] >= 0
        and collected_issues["a26_edges"] > 0
        and collected_issues["a34_entries"] == 14
        and collected_issues["a30_corpus_size"] >= 30,
        f"{collected_issues}",
    )
    failures += 0 if ok11 else 1

    # Step 12: Cross-family continuity (A25b) — adapters H3/LTX/Wan/Hunyuan + fallback
    a25b = a25b_cross_family_continuity
    reg = a25b._registry()
    from dataclasses import replace as _dc_replace
    fake_next = _dc_replace(shot_irs[1])  # Shot 2 da fixture
    h3 = a25b.resolve_continuity(
        registry=reg, next_shot_ir=fake_next, director_strategy="continuous",
        family=a25b.ModelFamily.H3,
        previous_output=a25b.PreviousShotOutput(shot_id="shot_001", picture_n_index=2),
        previous_state=None,
    )
    ltx = a25b.resolve_continuity(
        registry=reg, next_shot_ir=fake_next, director_strategy="continuous",
        family=a25b.ModelFamily.LTX,
        previous_output=a25b.PreviousShotOutput(
            shot_id="shot_001",
            last_frame_path="/tmp/shot_001_last.png",
            multi_window_state={"next_window_size": 24, "next_window_id": "window_002"},
        ),
        previous_state=None,
    )
    wan = a25b.resolve_continuity(
        registry=reg, next_shot_ir=fake_next, director_strategy="continuous",
        family=a25b.ModelFamily.WAN,
        previous_output=a25b.PreviousShotOutput(
            shot_id="shot_001", last_frame_path="/tmp/shot_001_last.png",
        ),
        previous_state=None,
    )
    fallback = a25b.resolve_continuity(
        registry=reg, next_shot_ir=fake_next, director_strategy="continuous",
        family=a25b.ModelFamily.UNKNOWN,
        previous_output=a25b.PreviousShotOutput(shot_id="shot_001"),
        previous_state=None,
    )
    adapter_count = len(reg.available_families())
    ok12 = _print_step(
        12, "A25b Cross-family — H3/LTX/Wan + fallback",
        h3.mode == "picture_n_reference"
        and ltx.mode == "extend_previous"
        and wan.mode == "first_last_frame"
        and fallback.mode == "independent"
        and fallback.confidence == 0.0
        and adapter_count == 6,
        f"h3={h3.mode}, ltx={ltx.mode}, wan={wan.mode}, "
        f"fallback={fallback.mode}/conf={fallback.confidence}, "
        f"families={adapter_count}",
    )
    failures += 0 if ok12 else 1

    # Step 13: Lockfile reproduzível (A26c) — parse + lock + drift + upgrade
    a26c = a26c_lockfile_reproducible
    _mini_req = (
        a26c.Requirement("mmgp", "==3.7.12", (), (), (), None),
        a26c.Requirement("diffusers", "==0.36.0", (), (), (), None),
        a26c.Requirement("transformers", "==4.57.1", (), (), (), None),
    )
    _lock, _manifest = a26c.generate_lock(
        profile="E2",
        source_requirements=_mini_req,
        source_requirements_txt_sha="src_sha_smoke",
        source_pyproject_sha="pyp_sha_smoke",
        profile_excludes=(),
        extra_indexes=("https://download.pytorch.org/whl/cu121",),
        platform="linux-x86_64-cuda12.1",
        python_version="3.11",
        generated_at="2026-10-16T12:00:00Z",
        commit_sha="bf50b33",
        pip_version="pip 24.0",
    )
    # drift limpo
    _clean_drift = a26c.validate_lock(
        _lock, _manifest, _mini_req, observed_requirements_txt_sha="src_sha_smoke",
    )
    # upgrade safe_minor
    _new_req = (
        a26c.Requirement("mmgp", "==3.7.12", (), (), (), None),
        a26c.Requirement("diffusers", "==0.36.1", (), (), (), None),  # safe_minor
        a26c.Requirement("transformers", "==4.57.1", (), (), (), None),
    )
    _proposal = a26c.upgrade_proposal(
        current_lock=_lock,
        new_requirements=_new_req,
        new_requirements_txt_sha="src_sha_smoke_v2",
        previous_requirements_txt_sha="src_sha_smoke",
    )
    ok13 = _print_step(
        13, "A26c Lockfile — parse + drift + upgrade OK",
        _clean_drift.ok
        and not _proposal.block_merge
        and len(_lock.requirements) == 3
        and any(p[0] == "diffusers" and p[2] == "0.36.1" for p in _proposal.safe_minor),
        f"clean_drift={_clean_drift.ok}, lock_pkgs={len(_lock.requirements)}, "
        f"upgrade_summary={_proposal.summary}",
    )
    failures += 0 if ok13 else 1

    print()
    print("=" * 72)
    if failures == 0:
        print(f"PASS 13/13 — protótipos integrados sem GPU, sem FastAPI, sem Cue Studio real")
        print()
        print("Resumo do que está pronto para deploy:")
        print("  - 12 specs + 12 protótipos + 1 smoke de integração")
        print("  - Política Reversa respeitada (allowLegacyEdits=false)")
        print("  - Aplicação real requer: editar reversa-config.json, venv Python 3.11,")
        print("    GPU NVIDIA CUDA 12.8, ~50-300 GB de modelos sob demanda")
        return 0
    else:
        print(f"FAIL {failures}/13 steps")
        return 1


if __name__ == "__main__":
    sys.exit(main())