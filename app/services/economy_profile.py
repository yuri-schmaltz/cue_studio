"""Perfil econômico E2 (A29).

Modelo de perfil de hardware, budget de VRAM/RAM/tempo, validação de
workload contra budget, relatório de benchmark.

Fonte: protótipo ``_reversa_forward/plano-2026-10-04/prototypes/a29_economy_profile.py``.
"""

from __future__ import annotations

import json
import os
import tempfile
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Optional


@dataclass
class HardwareProfile:
    gpu_name: str
    vram_mb: int
    system_ram_mb: int
    driver_version: str = ""
    cuda_version: str = ""
    profile_id: str = "E2"


@dataclass
class WorkloadMetrics:
    wall_time_s: float
    peak_vram_mb: int
    peak_ram_mb: int
    oom_count: int = 0
    approval_score: float = 0.0
    quality_scores: dict = field(default_factory=dict)


@dataclass
class EconomyBudget:
    max_p90_wall_s: float = 300.0
    max_vram_mb: int = 8000
    max_ooms: int = 0
    min_approval: float = 3.0
    min_quality: float = 3.0


@dataclass
class BenchmarkResult:
    profile: HardwareProfile
    runs: list[dict] = field(default_factory=list)
    aggregated: Optional[dict] = None

    def add_run(self, metrics: WorkloadMetrics) -> None:
        self.runs.append({
            "wall_time_s": metrics.wall_time_s,
            "peak_vram_mb": metrics.peak_vram_mb,
            "peak_ram_mb": metrics.peak_ram_mb,
            "oom_count": metrics.oom_count,
            "approval_score": metrics.approval_score,
            "quality_scores": metrics.quality_scores,
        })

    def aggregate(self) -> dict:
        if not self.runs:
            self.aggregated = {
                "p50_wall_s": 0.0,
                "p90_wall_s": 0.0,
                "max_vram_mb": 0,
                "max_ram_mb": 0,
                "total_ooms": 0,
                "mean_approval": 0.0,
                "n_runs": 0,
            }
            return self.aggregated
        walls = sorted(r["wall_time_s"] for r in self.runs)
        n = len(walls)
        p50 = walls[n // 2] if n else 0.0
        p90_idx = min(int(n * 0.9), n - 1)
        p90 = walls[p90_idx] if n else 0.0
        self.aggregated = {
            "p50_wall_s": p50,
            "p90_wall_s": p90,
            "max_vram_mb": max(r["peak_vram_mb"] for r in self.runs),
            "max_ram_mb": max(r["peak_ram_mb"] for r in self.runs),
            "total_ooms": sum(r["oom_count"] for r in self.runs),
            "mean_approval": sum(r["approval_score"] for r in self.runs) / n,
            "n_runs": n,
        }
        return self.aggregated

    def validate(self, budget: EconomyBudget) -> dict:
        agg = self.aggregated or self.aggregate()
        return {
            "p90_wall_ok": agg["p90_wall_s"] <= budget.max_p90_wall_s,
            "vram_ok": agg["max_vram_mb"] <= budget.max_vram_mb,
            "ooms_ok": agg["total_ooms"] <= budget.max_ooms,
            "approval_ok": agg["mean_approval"] >= budget.min_approval,
        }

    def is_passing(self, budget: EconomyBudget) -> bool:
        v = self.validate(budget)
        return all(v.values())

    def write_report(self, path: Path) -> None:
        agg = self.aggregated or self.aggregate()
        lines = [
            "# Relatório de Perfil Econômico E2",
            "",
            "## Hardware",
            f"- GPU: {self.profile.gpu_name}",
            f"- VRAM: {self.profile.vram_mb} MB",
            f"- RAM: {self.profile.system_ram_mb} MB",
            f"- Driver: {self.profile.driver_version}",
            f"- CUDA: {self.profile.cuda_version}",
            "",
            "## Métricas",
            f"- Runs: {agg['n_runs']}",
            f"- p50 wall: {agg['p50_wall_s']:.1f}s",
            f"- p90 wall: {agg['p90_wall_s']:.1f}s",
            f"- Max VRAM: {agg['max_vram_mb']} MB",
            f"- Max RAM: {agg['max_ram_mb']} MB",
            f"- Total OOMs: {agg['total_ooms']}",
            f"- Mean approval: {agg['mean_approval']:.2f}",
            "",
            "## Limitações",
            "- Benchmark sintético, não geração real de vídeo.",
            "- VRAM medida por amostragem (pode perder picos).",
        ]
        path.write_text("\n".join(lines), encoding="utf-8")

    def detect_regression(self, baseline_p90: float, threshold: float = 0.20) -> tuple[float, bool]:
        agg = self.aggregated or self.aggregate()
        if baseline_p90 <= 0:
            return 0.0, False
        pct = (agg["p90_wall_s"] - baseline_p90) / baseline_p90
        return pct * 100, pct <= threshold
