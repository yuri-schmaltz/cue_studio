"""Smoke-import regression test (Directo pattern).

Catches the class of bugs where a module fails to import at runtime even
though it compiles cleanly. This pattern was lifted from directo_studio
v1.1.7 — they added a smoke-import step to CI after a string of releases
shipped through 5 quality gates with broken imports (missing `_` alias
in i18n shims, Gtk 3/4 removed methods, modules referenced in
manifests/entry-points that no longer exist).

The test imports each target in a fresh subprocess so a module-level
crash (e.g. torch.load without weights_only, yaml.load with FullLoader,
def __init__ that runs expensive work at class-definition time) is
isolated to that target's output instead of poisoning the whole pytest
session. The subprocess is a hard wall: even an OOM or segfault doesn't
take down the runner.
"""
from __future__ import annotations

import os
import subprocess
import sys
import unittest
from pathlib import Path

# Repo root (parent of tests/, parent of app/).
ROOT = Path(__file__).resolve().parents[1]
APP_DIR = ROOT / "app"


# Smoke-import is heavy (one subprocess per target) and the entry
# points it exercises all need the real venv at app/env. Marked with
# the ``smoke`` pytest marker so the default ``pytest tests/``
# discovery skips it. Opt in with ``pytest tests/ -m smoke``.
import pytest

pytestmark = pytest.mark.smoke


# Entry points we want to guarantee importable. These are the modules
# the user-facing code touches (Gradio tabs, FastAPI routes, CLI helpers,
# pipeline runners). Heavy model code (wgp.py) is intentionally excluded
# — it needs GPU + several GB of model weights. The launch surface that
# serves /health/version is included, since it's the first thing the
# bootstrapper probes.
SMOKE_TARGETS = [
    # Top-level app entry points.
    "launch",  # FastAPI app + /health/version
    "setup",   # bootstrap script (also imported by tests)
    # Core service modules that Director/Editor tabs rely on.
    "services.access_log_filter",
    "services.audio_analysis",
    "services.character_library",
    "services.checkpoint_compatibility",
    "services.creative_review",
    "services.director_pipeline",
    "services.director_video_strategy",
    "services.editor_projects",
    "services.enhance_guides",
    "services.generation_eta",
    "services.generation_reviews",
    "services.guide_loader",
    "services.h3_prompt_budget",
    "services.h3_sequence_continuity",
    "services.h3_sequence_planner",
    "services.h3_story_ledger",
    "services.h3_window_planner",
    "services.hardware_detect",
    # Director subsystem.
    "services.director.guide_loader",
    "services.director.image_prompt_rules",
    "services.director.long_form_story",
    "services.director.nsfw_guidance",
    "services.director.orchestrator",
    "services.director.policies",
    "services.director.prompt_polish",
    "services.director.registry",
    "services.director.safety_scan",
    "services.director.schema",
    "services.director.v2_plan_cancel",
    "services.director.validators",
    # Submodules under services/director/ with public symbols.
    "services.director.planners",
    "services.director.renderers",
    "services.director.plugins",
]


def _import_in_subprocess(target: str) -> subprocess.CompletedProcess:
    """Import `app.<target>` in a fresh Python subprocess. The target
    string is concatenated into a tiny -c command — we never use
    `importlib.import_module` because that would inherit the parent's
    import state and defeat the point of a clean import."""
    # Add APP_DIR to PYTHONPATH so plain "launch" / "services.x" resolve.
    # We do NOT pass -S (skip site) because the venv depends on sitecustomize
    # to find torch / diffusers / etc — without it, smoke would always fail.
    env = dict(os.environ)
    existing = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = str(APP_DIR) + (os.pathsep + existing if existing else "")
    code = f"import importlib; importlib.import_module({target!r}); print('__CUE_SMOKE_IMPORT_OK__')"
    return subprocess.run(
        [sys.executable, "-c", code],
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )


class SmokeImportTests(unittest.TestCase):
    """Each module in SMOKE_TARGETS must import cleanly in a fresh
    subprocess. Failures pinpoint the exact module."""

    def test_all_targets_import(self):
        failures: list[tuple[str, int, str, str]] = []
        for target in SMOKE_TARGETS:
            with self.subTest(target=target):
                result = _import_in_subprocess(target)
                if result.returncode != 0 or '__CUE_SMOKE_IMPORT_OK__' not in result.stdout:
                    failures.append((target, result.returncode, result.stdout, result.stderr))
        if failures:
            message_lines = ["smoke-import failed for the following targets:"]
            for target, returncode, stdout, stderr in failures:
                message_lines.append(f"\n--- {target} (exit={returncode}) ---")
                if stdout.strip():
                    message_lines.append(f"stdout: {stdout.strip()[-4000:]}")
                if stderr.strip():
                    message_lines.append(f"stderr: {stderr.strip()[-4000:]}")
            self.fail("\n".join(message_lines))


if __name__ == "__main__":
    unittest.main()
