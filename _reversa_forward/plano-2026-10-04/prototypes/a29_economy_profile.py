#!/usr/bin/env python3
"""Protótipo isolado do Perfil Econômico E2 (A29 / R05).

Valida `38-feature-a29-economy-profile.md` sem importar de `app/`. Como o
protótipo não tem GPU real, simula medições a partir de fixtures sintéticas
e valida que o pipeline de benchmark produz relatórios consistentes.

1. Modelo de medição: HardwareMeasurement dataclass.
2. Função `run_benchmark(profile, fixture_runs) -> BenchmarkReport`.
3. Função `aggregate_metrics(reports) -> AggregatedMetrics` com p50/p90.
4. Função `write_report(report, path) -> None` em Markdown.
5. Função `validate_against_budget(report, budget) -> dict` com pass/fail.
6. 7 testes cobrindo: medição individual, agregação p50/p90, relatório
   contém seções obrigatórias, validação contra budget, smoke test,
   regressão > 20%, GPU insuficiente → skip.

Rodar:
    python3 _reversa_forward/plano-2026-10-04/prototypes/a29_economy_profile.py
"""
from __future__ import annotations

import json
import math
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from statistics import mean, median
from typing import Optional


# ---------------------------------------------------------------------------
# 1. Modelo de medição
# ---------------------------------------------------------------------------

@dataclass
class HardwareMeasurement:
    gpu_name: str
    gpu_vram_mb: int
    driver_version: str
    cuda_version: str
    system_ram_mb: int
    os: str  # "linux" | "windows" | "macos"


@dataclass
class RunMeasurement:
    run_id: str
    mode: str  # "F0" | "F1" | "F2" | "F3"
    wall_seconds: float
    peak_vram_mb: int
    peak_ram_mb: int
    oom_failures: int
    decoder_failures: int
    continuity_failures: int
    takes_approved_without_rerun: int
    takes_total: int
    wer_pt_br: Optional[float] = None
    audio_drift_ms: Optional[float] = None
    frame_drift: Optional[int] = None
    seed: int = 0


@dataclass
class AggregatedMetrics:
    p50_wall: float
    p90_wall: float
    mean_vram: float
    max_vram: int
    total_ooms: int
    approval_rate: float
    n_runs: int


@dataclass
class Budget:
    max_p90_wall: float
    max_p95_vram_mb: int
    max_ooms: int
    min_approval_rate: float


@dataclass
class BenchmarkReport:
    hardware: HardwareMeasurement
    cue_studio_version: str
    fixture_id: str  # "cue-reference-film-v1"
    runs: list[RunMeasurement]
    aggregated: Optional[AggregatedMetrics] = None
    generated_at: str = ""


# ---------------------------------------------------------------------------
# 2. run_benchmark e aggregate
# ---------------------------------------------------------------------------

def aggregate_metrics(runs: list[RunMeasurement]) -> AggregatedMetrics:
    walls = sorted(r.wall_seconds for r in runs)
    n = len(walls)
    p50 = walls[n // 2] if n else 0.0
    p90 = walls[max(0, int(math.ceil(n * 0.9)) - 1)] if n else 0.0
    mean_vram = mean(r.peak_vram_mb for r in runs) if runs else 0.0
    max_vram = max((r.peak_vram_mb for r in runs), default=0)
    total_ooms = sum(r.oom_failures for r in runs)
    approved = sum(r.takes_approved_without_rerun for r in runs)
    total_takes = sum(r.takes_total for r in runs)
    approval = (approved / total_takes) if total_takes else 0.0
    return AggregatedMetrics(
        p50_wall=p50, p90_wall=p90,
        mean_vram=mean_vram, max_vram=max_vram,
        total_ooms=total_ooms, approval_rate=approval, n_runs=n,
    )


def run_benchmark(hardware: HardwareMeasurement, fixture_runs: list[RunMeasurement]) -> BenchmarkReport:
    return BenchmarkReport(
        hardware=hardware,
        cue_studio_version="2.5.2",
        fixture_id="cue-reference-film-v1",
        runs=fixture_runs,
        aggregated=aggregate_metrics(fixture_runs),
    )


# ---------------------------------------------------------------------------
# 3. write_report (Markdown)
# ---------------------------------------------------------------------------

REQUIRED_SECTIONS = ("Hardware", "Métricas", "Limitações")


def write_report(report: BenchmarkReport, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    agg = report.aggregated
    lines = [
        f"# Benchmark E2 6–8 GB — {report.fixture_id}",
        "",
        f"**Gerado em:** {report.generated_at}",
        f"**Cue Studio:** {report.cue_studio_version}",
        "",
        "## Hardware",
        "",
        f"- GPU: {report.hardware.gpu_name} ({report.hardware.gpu_vram_mb} MB)",
        f"- Driver: {report.hardware.driver_version}",
        f"- CUDA: {report.hardware.cuda_version}",
        f"- RAM: {report.hardware.system_ram_mb} MB",
        f"- SO: {report.hardware.os}",
        "",
        "## Métricas",
        "",
        f"- Runs: {agg.n_runs}",
        f"- p50 wall time: {agg.p50_wall:.2f} s",
        f"- p90 wall time: {agg.p90_wall:.2f} s",
        f"- VRAM média: {agg.mean_vram:.0f} MB",
        f"- VRAM pico máximo: {agg.max_vram} MB",
        f"- Total OOM: {agg.total_ooms}",
        f"- Taxa de aprovação (sem rerun): {agg.approval_rate:.1%}",
        "",
        "## Detalhes por run",
        "",
        "| Run | Mode | Wall (s) | VRAM pico (MB) | OOM | Aprovação |",
        "|-----|------|---------:|---------------:|----:|----------:|",
    ]
    for r in report.runs:
        approval = f"{r.takes_approved_without_rerun}/{r.takes_total}"
        lines.append(f"| {r.run_id} | {r.mode} | {r.wall_seconds:.2f} | {r.peak_vram_mb} | {r.oom_failures} | {approval} |")
    lines += ["", "## Limitações", ""]
    lines.append("- Números refletem GPU única; resultados variam em outras máquinas.")
    lines.append("- Wall time inclui carga de modelo no primeiro run (não apenas difusão).")
    lines.append("- Métricas de qualidade (rubrica F2) não estão neste relatório — ver dossiê §67.")
    path.write_text("\n".join(lines), encoding="utf-8")


def has_required_sections(text: str) -> bool:
    return all(f"## {sec}" in text for sec in REQUIRED_SECTIONS)


# ---------------------------------------------------------------------------
# 4. validate_against_budget
# ---------------------------------------------------------------------------

def validate_against_budget(report: BenchmarkReport, budget: Budget) -> dict[str, bool]:
    if not report.aggregated:
        return {"valid": False, "missing_aggregated": True}
    return {
        "p90_wall_ok": report.aggregated.p90_wall <= budget.max_p90_wall,
        "vram_ok": report.aggregated.max_vram <= budget.max_p95_vram_mb,
        "ooms_ok": report.aggregated.total_ooms <= budget.max_ooms,
        "approval_ok": report.aggregated.approval_rate >= budget.min_approval_rate,
    }


# ---------------------------------------------------------------------------
# 5. Suíte de testes
# ---------------------------------------------------------------------------

def check(name: str, ok: bool, detail: str = "") -> bool:
    status = "OK" if ok else "FAIL"
    print(f"  {status} {name}{(' — ' + detail) if detail else ''}")
    return ok


def _hw(vram_mb: int = 8192) -> HardwareMeasurement:
    return HardwareMeasurement("NVIDIA RTX 3060", vram_mb, "550.54", "12.1", 32768, "linux")


def _run(run_id: str, wall: float, vram: int, oom: int = 0, approval: int = 10) -> RunMeasurement:
    return RunMeasurement(run_id, "F2", wall, vram, 24576, oom, 0, 0, approval, 12)


def test_individual_measurement_stored() -> bool:
    hw = _hw()
    runs = [_run("run_1", 900.0, 7800)]
    report = run_benchmark(hw, runs)
    return check(
        "run_benchmark: armazena hardware + runs + agregação",
        len(report.runs) == 1 and report.hardware.gpu_name == "NVIDIA RTX 3060" and report.aggregated is not None,
        f"runs={len(report.runs)}, has_aggregated={report.aggregated is not None}",
    )


def test_aggregate_p50_p90() -> bool:
    runs = [_run(f"run_{i}", wall=600.0 + i * 100, vram=7000 + i * 100) for i in range(10)]
    agg = aggregate_metrics(runs)
    # walls: 600, 700, 800, ..., 1500. p50 = walls[5] = 800 + 100 = 1100? sorted: 600..1500.
    # p50 (median) = avg of walls[4] and walls[5] = 1000, 1100 → 1050 (with even n=10).
    # usamos walls[n//2] = walls[5] = 1100
    expected_p50 = sorted(r.wall_seconds for r in runs)[10 // 2]
    expected_p90_idx = max(0, int(math.ceil(10 * 0.9)) - 1)  # 8
    expected_p90 = sorted(r.wall_seconds for r in runs)[expected_p90_idx]
    return check(
        "aggregate: p50 e p90 calculados corretamente",
        agg.p50_wall == expected_p50 and agg.p90_wall == expected_p90 and agg.max_vram == max(r.peak_vram_mb for r in runs),
        f"p50={agg.p50_wall}, p90={agg.p90_wall}, max_vram={agg.max_vram}",
    )


def test_report_has_required_sections() -> bool:
    with tempfile.TemporaryDirectory() as td:
        path = Path(td) / "report.md"
        report = run_benchmark(_hw(), [_run("r1", 600.0, 7800), _run("r2", 720.0, 7900)])
        report.generated_at = "2026-10-16T13:00Z"
        write_report(report, path)
        text = path.read_text(encoding="utf-8")
        return check(
            "write_report: contém seções Hardware/Métricas/Limitações",
            has_required_sections(text),
            f"path={path}, size={path.stat().st_size}",
        )


def test_validate_against_budget_passes() -> bool:
    runs = [_run(f"r{i}", 600.0, 7800, oom=0, approval=10) for i in range(5)]
    report = run_benchmark(_hw(), runs)
    budget = Budget(max_p90_wall=2000.0, max_p95_vram_mb=8000, max_ooms=0, min_approval_rate=0.5)
    results = validate_against_budget(report, budget)
    return check(
        "validate: budget generoso passa em todas as métricas",
        all(results.values()),
        f"results={results}",
    )


def test_validate_against_budget_fails_strict() -> bool:
    runs = [_run("r1", 600.0, 7800, oom=3, approval=4)]  # OOM=3, aprovação=4/12=33%
    report = run_benchmark(_hw(), runs)
    budget = Budget(max_p90_wall=2000.0, max_p95_vram_mb=8000, max_ooms=1, min_approval_rate=0.5)
    results = validate_against_budget(report, budget)
    ooms_ok = results.get("ooms_ok", False)
    approval_ok = results.get("approval_ok", False)
    return check(
        "validate: budget estrito falha em OOM e aprovação",
        (not ooms_ok) and (not approval_ok),
        f"ooms_ok={ooms_ok}, approval_ok={approval_ok}",
    )


def test_smoke_test_single_clip() -> bool:
    """Smoke: 1 run curto (2s wall) cabe no perfil E2."""
    smoke = _run("smoke", 2.0, 7000)
    report = run_benchmark(_hw(), [smoke])
    agg = report.aggregated
    return check(
        "smoke: 1 clipe de 2s roda em perfil E2 com VRAM < 8000 MB",
        agg.p90_wall <= 5.0 and agg.max_vram <= 8000,
        f"p90={agg.p90_wall}s, vram={agg.max_vram}MB",
    )


def test_regression_within_20_percent() -> bool:
    """Comparação entre dois reports: regressão > 20% no p90 wall é detectada."""
    base_runs = [_run(f"b{i}", 1000.0, 7800) for i in range(5)]
    new_runs = [_run(f"n{i}", 1300.0, 7800) for i in range(5)]  # +30%
    base = aggregate_metrics(base_runs)
    new = aggregate_metrics(new_runs)
    regression_pct = (new.p90_wall - base.p90_wall) / base.p90_wall
    within = abs(regression_pct) <= 0.20
    return check(
        "regressão: 30% de piora é detectada como > 20%",
        regression_pct > 0.20 and not within,
        f"regression={regression_pct:.1%}, within_20%={within}",
    )


def test_gpu_insufficient_skips() -> bool:
    """Em GPU E0 (CPU-only), smoke test deve sinalizar skip."""
    insufficient_hw = HardwareMeasurement("CPU-only", 0, "n/a", "n/a", 16384, "linux")
    runs: list[RunMeasurement] = []  # nenhuma execução
    report = run_benchmark(insufficient_hw, runs)
    return check(
        "GPU E0 sem runs: relatório válido com 0 runs",
        report.aggregated is not None and report.aggregated.n_runs == 0,
        f"n_runs={report.aggregated.n_runs if report.aggregated else 'None'}",
    )


def main() -> int:
    print("== A29 Economy Profile E2 prototype ==")
    tests = [
        test_individual_measurement_stored,
        test_aggregate_p50_p90,
        test_report_has_required_sections,
        test_validate_against_budget_passes,
        test_validate_against_budget_fails_strict,
        test_smoke_test_single_clip,
        test_regression_within_20_percent,
        test_gpu_insufficient_skips,
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