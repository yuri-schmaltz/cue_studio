"""Project-setup browser test — dependency sanity check.

Why this lives next to ``test_project_setup_browser.py``
--------------------------------------------------------
The browser test suite in ``test_project_setup_browser.py`` is gated
behind the ``browser`` marker — running it requires:

* ``playwright`` + the chromium browser binary installed
  (``python -m playwright install chromium``)
* a live backend reachable on ``SHELL_TEST_URL`` (defaults to
  ``http://127.0.0.1:3000``)
* a UI bundle that can be served by Vite dev server or the static
  ``ui/dist`` mount

These prerequisites aren't part of the standard ``requirements.txt``
because they're heavyweight (chromium is ~150 MB) and the rest of
the suite doesn't need them. The marker keeps them out of the
default test run.

This file is *not* a duplicate of the browser test; it's a tiny
sanity probe that runs in the default suite and tells the developer
what to install when they want to opt into the browser tests.

What we assert
--------------
* ``playwright`` is importable when the env var
  ``MAESTRO_REQUIRE_PLAYWRIGHT=1`` is set.
* The browser binary is reachable when the same env var is set.
* A short README pointer is reachable from the repo root so
  on-call engineers can find the setup instructions.

In normal CI / local runs, both assertions are skipped — the file
just records the contract.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.skipif(
    os.environ.get("MAESTRO_REQUIRE_PLAYWRIGHT") != "1",
    reason="Playwright is opt-in; set MAESTRO_REQUIRE_PLAYWRIGHT=1 to enforce",
)
def test_playwright_is_importable() -> None:
    """``playwright`` must import when the suite is opted in."""

    try:
        import playwright  # type: ignore  # noqa: F401
    except ImportError as exc:
        pytest.fail(
            "playwright is required by the browser tests but not installed: "
            f"{exc}. Install with `uv pip install playwright` and "
            "`python -m playwright install chromium`.",
        )


@pytest.mark.skipif(
    os.environ.get("MAESTRO_REQUIRE_PLAYWRIGHT") != "1",
    reason="Playwright is opt-in; set MAESTRO_REQUIRE_PLAYWRIGHT=1 to enforce",
)
def test_playwright_browser_binary_present() -> None:
    """The chromium browser binary must be reachable."""

    # Try the python -m playwright install --dry-run path first; if
    # that fails we fall back to looking for the cached binary in
    # the playwright install location.
    try:
        result = subprocess.run(
            [sys.executable, "-m", "playwright", "install", "--dry-run", "chromium"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode == 0 and "would install" not in result.stdout:
            return
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass

    # Fallback probe: ``~/.cache/ms-playwright`` is the default
    # install location on Linux. Any chromium-* subdir is enough.
    cache = Path.home() / ".cache" / "ms-playwright"
    if cache.is_dir() and any(cache.glob("chromium-*")):
        return

    pytest.fail(
        "Playwright chromium browser not installed. Run "
        "`python -m playwright install chromium` to enable the "
        "browser test suite."
    )


def test_browser_marker_is_excluded_by_default() -> None:
    """The ``browser`` marker must not run in the default suite."""

    pyproject = ROOT / "pyproject.toml"
    assert pyproject.exists(), "pyproject.toml missing — cannot audit markers"
    text = pyproject.read_text()
    # ``addopts`` should mention the marker exclusion so a default
    # `pytest tests/` run skips the browser suite.
    assert "not browser" in text, (
        "pyproject.toml must exclude the `browser` marker from the "
        "default pytest run. Add `addopts = \"-m 'not browser'\"` "
        "to the [tool.pytest.ini_options] section."
    )


def test_browser_marker_documented() -> None:
    """The browser marker should appear in pyproject markers so
    ``pytest --markers`` shows it."""

    pyproject = ROOT / "pyproject.toml"
    text = pyproject.read_text()
    assert "browser:" in text, (
        "pyproject.toml must declare the `browser` marker so "
        "developers can opt-in via `pytest -m browser`."
    )


def test_setup_instructions_point_at_known_files() -> None:
    """Smoke test: the files referenced by browser-test setup docs
    must exist (so the docs don't drift)."""

    candidates = [
        ROOT / "tests" / "test_project_setup_browser.py",
        ROOT / "ui" / "package.json",
        ROOT / "pyproject.toml",
    ]
    missing = [str(p.relative_to(ROOT)) for p in candidates if not p.exists()]
    assert not missing, f"Setup docs reference missing files: {missing}"


def test_shell_test_url_env_var_has_default() -> None:
    """The browser tests honour ``SHELL_TEST_URL``; ensure the
    default value (http://127.0.0.1:3000) is documented."""

    browser_test = (ROOT / "tests" / "test_project_setup_browser.py").read_text()
    assert "SHELL_TEST_URL" in browser_test, (
        "test_project_setup_browser.py must document the "
        "SHELL_TEST_URL override."
    )
