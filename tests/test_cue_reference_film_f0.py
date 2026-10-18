"""Teste de integração F0 da fixture 'A luz da oficina'.

Executa o gerador determinístico F0 (sem IA, sem GPU) e valida os critérios
de aceite da fixture: duração exata, FPS, sample rate, canais, alinhamento A/V.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures" / "cue_reference_film_v1"
GENERATOR = FIXTURE_DIR / "generate_f0.py"
EXPECTED = json.loads((FIXTURE_DIR / "expected.json").read_text())


@pytest.mark.fixture_f0
def test_f0_render_master_criteria():
    """O gerador F0 deve produzir um master válido passando todos os critérios."""
    result = subprocess.run(
        ["python", str(GENERATOR)],
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert result.returncode == 0, (
        f"generate_f0.py falhou:\n{result.stdout}\n{result.stderr}"
    )
    assert "TODOS OS CRITÉRIOS DE ACEITE PASSARAM" in result.stdout, result.stdout


@pytest.mark.fixture_f0
def test_f0_fixture_files_present():
    """Todos os arquivos obrigatórios da fixture devem existir."""
    required = [
        "project.json", "shots.json", "speech.json", "sound_cues.json",
        "expected.json", "continuity.json", "README.md",
    ]
    for name in required:
        assert (FIXTURE_DIR / name).is_file(), f"arquivo ausente: {name}"


@pytest.mark.fixture_f0
def test_f0_expected_criteria_values():
    """Os valores esperados no expected.json devem ser consistentes."""
    exp = EXPECTED
    assert exp["total_frames"] == 1440
    assert exp["duration_seconds"] == 60
    assert exp["audio_samples_per_channel"] == 2880000
    assert exp["shots_count"] == 12
    assert exp["speech_cues"] == 4
    assert exp["criteria"]["duration_frames_exact"] == 1440
    assert exp["criteria"]["av_drift_frames"] == 1
