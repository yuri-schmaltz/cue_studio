"""Testes de integração do perfil econômico (A29)."""

from __future__ import annotations

from pathlib import Path

from app.services.economy_profile import (
    BenchmarkResult,
    EconomyBudget,
    HardwareProfile,
    WorkloadMetrics,
)


def test_add_run_and_aggregate():
    profile = HardwareProfile(gpu_name="RTX 3060", vram_mb=12288, system_ram_mb=32768)
    result = BenchmarkResult(profile=profile)
    result.add_run(WorkloadMetrics(wall_time_s=100, peak_vram_mb=7000, peak_ram_mb=16000, approval_score=3.5))
    result.add_run(WorkloadMetrics(wall_time_s=120, peak_vram_mb=7500, peak_ram_mb=17000, approval_score=3.8))
    agg = result.aggregate()
    assert agg["n_runs"] == 2
    assert agg["max_vram_mb"] == 7500
    assert agg["mean_approval"] > 3.0


def test_validate_budget_pass():
    profile = HardwareProfile(gpu_name="RTX 3060", vram_mb=12288, system_ram_mb=32768)
    result = BenchmarkResult(profile=profile)
    result.add_run(WorkloadMetrics(wall_time_s=100, peak_vram_mb=7000, peak_ram_mb=16000, approval_score=3.5))
    budget = EconomyBudget(max_p90_wall_s=300, max_vram_mb=8000, max_ooms=0, min_approval=3.0)
    v = result.validate(budget)
    assert v["p90_wall_ok"] is True
    assert v["vram_ok"] is True
    assert v["ooms_ok"] is True
    assert v["approval_ok"] is True
    assert result.is_passing(budget) is True


def test_validate_budget_fail():
    profile = HardwareProfile(gpu_name="RTX 3060", vram_mb=12288, system_ram_mb=32768)
    result = BenchmarkResult(profile=profile)
    result.add_run(WorkloadMetrics(wall_time_s=100, peak_vram_mb=9000, peak_ram_mb=16000, oom_count=1, approval_score=2.0))
    budget = EconomyBudget(max_p90_wall_s=300, max_vram_mb=8000, max_ooms=0, min_approval=3.0)
    v = result.validate(budget)
    assert v["vram_ok"] is False
    assert v["ooms_ok"] is False
    assert v["approval_ok"] is False
    assert result.is_passing(budget) is False


def test_aggregate_empty():
    profile = HardwareProfile(gpu_name="RTX 3060", vram_mb=12288, system_ram_mb=32768)
    result = BenchmarkResult(profile=profile)
    agg = result.aggregate()
    assert agg["n_runs"] == 0
    assert agg["p50_wall_s"] == 0.0


def test_write_report():
    import tempfile
    from pathlib import Path
    profile = HardwareProfile(gpu_name="RTX 3060", vram_mb=12288, system_ram_mb=32768)
    result = BenchmarkResult(profile=profile)
    result.add_run(WorkloadMetrics(wall_time_s=100, peak_vram_mb=7000, peak_ram_mb=16000, approval_score=3.5))
    with tempfile.TemporaryDirectory() as td:
        path = Path(td) / "report.md"
        result.write_report(path)
        assert path.exists()
        content = path.read_text()
        assert "Hardware" in content
        assert "Métricas" in content
        assert "RTX 3060" in content


def test_detect_regression():
    profile = HardwareProfile(gpu_name="RTX 3060", vram_mb=12288, system_ram_mb=32768)
    result = BenchmarkResult(profile=profile)
    result.add_run(WorkloadMetrics(wall_time_s=100, peak_vram_mb=7000, peak_ram_mb=16000, approval_score=3.5))
    pct, within = result.detect_regression(baseline_p90=100, threshold=0.20)
    assert within is True
    pct2, within2 = result.detect_regression(baseline_p90=100, threshold=0.05)
    # 100s vs 100s baseline = 0% regression
    assert within2 is True


def test_detect_regression_worse():
    profile = HardwareProfile(gpu_name="RTX 3060", vram_mb=12288, system_ram_mb=32768)
    result = BenchmarkResult(profile=profile)
    result.add_run(WorkloadMetrics(wall_time_s=130, peak_vram_mb=7000, peak_ram_mb=16000, approval_score=3.5))
    pct, within = result.detect_regression(baseline_p90=100, threshold=0.20)
    assert pct == 30.0
    assert within is False
