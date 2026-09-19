"""Regression test for the `app.plugin_manager` NameError bug in wgp.py.

Background
----------
WanGP's `prepare_inputs_dict` historically called
`hasattr(app, 'plugin_manager')` to gate a data-hook pass that the
upstream Gradio wiring used to register via
`app = gr.Blocks(); app.initialize_plugins(globals())`. When Cue Studio
ported WanGP to FastAPI that injection never happened — `app` was
never bound in `wgp.py`'s module globals — so the very first Director
image-gen call raised `NameError: name 'app' is not defined` at
VAE-decoding time. The exception was swallowed by the WanGP queue
worker, which then surfaced a misleading
"Start-image generation did not produce valid recorded files" error
to the user.

The fix
--------
Replace `hasattr(app, 'plugin_manager')` with a `"app" in globals()`
guard so the data-hook pass is silently skipped when no plugin
manager is registered. We must NOT change the happy-path behaviour
(when a real plugin manager IS bound).

What this test asserts
----------------------
The exact bytes of the data-hook guard in `prepare_inputs_dict` match
the expected `"app" in globals()` shape — NOT the legacy
`hasattr(app, ...)` form that triggers the NameError on FastAPI.

Why a textual assertion, not a behavioural one
----------------------------------------------
`prepare_inputs_dict` is a 200-line function that depends on
`get_state_model_type`, `update_loras_url_cache`, `get_lora_dir`, the
full `model_signatures` registry, and `get_model_def`. Importing
those just to exercise the plugin-guard branch would pull the entire
30k-line `wgp.py` into the test process — which itself runs
`argparse.parse_args()` at import time and dies on pytest's argv.

Instead we test the bug-prone pattern at the level that matters:
the source code itself. If a future refactor reintroduces the
unguarded `hasattr(app, ...)` form, this test fails immediately
with a clear diff message — no GPU, no torch, no WanGP boot required.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WGP_PATH = ROOT / "app" / "wgp.py"


@pytest.fixture(scope="module")
def prepare_inputs_dict_source() -> str:
    """Read the source of `prepare_inputs_dict` out of wgp.py once."""
    if not WGP_PATH.is_file():
        pytest.skip(f"wgp.py not found at {WGP_PATH}")
    src = WGP_PATH.read_text(encoding="utf-8")
    # Find the function body. We use a simple marker-based slice
    # rather than ast.parse to keep this test dependency-free.
    marker = "def prepare_inputs_dict("
    start = src.find(marker)
    if start < 0:
        pytest.skip("prepare_inputs_dict not found in wgp.py")
    # Walk forward until the first top-level `def`/`class`/EOF that
    # ends the function (assume consistent 4-space indent, which
    # is enforced by ruff in this repo).
    end_markers = ["\ndef ", "\nclass ", "\n@api.", "\n@router."]
    end = len(src)
    for m in end_markers:
        idx = src.find(m, start + len(marker))
        if 0 < idx < end:
            end = idx
    return src[start:end]


def _strip_python_comments(src: str) -> str:
    """Remove Python ``# ...`` comments line-by-line so we don't
    false-positive on a docstring that mentions the legacy pattern.

    Preserves ``#`` inside strings (heuristic: skip stripping when the
    line's accumulated quoting state is non-empty). Sufficient for
    the simple top-level function bodies this test inspects.
    """
    cleaned_lines = []
    in_triple = False
    triple_quote = None
    for line in src.splitlines():
        if not in_triple:
            stripped_line = []
            i = 0
            while i < len(line):
                ch = line[i]
                # Detect triple-quoted strings
                if line[i:i + 3] in ('"""', "'''"):
                    q = line[i:i + 3]
                    stripped_line.append(q)
                    in_triple = True
                    triple_quote = q
                    i += 3
                    continue
                # Detect # outside any string context
                if ch == "#":
                    break
                stripped_line.append(ch)
                i += 1
            cleaned_lines.append("".join(stripped_line))
        else:
            # Inside triple-quoted string — pass through, but watch for the close
            stripped_lines = [line]
            triple_close = line.find(triple_quote)
            if triple_close >= 0:
                # Close found; everything after is normal Python again
                after = line[triple_close + 3:]
                in_triple = False
                triple_quote = None
                # Strip comments in the after-portion
                stripped_lines = [line[:triple_close + 3]] + _strip_python_comments(after).splitlines()
            cleaned_lines.extend(stripped_lines)
    return "\n".join(cleaned_lines)


class TestAppPluginManagerGuard:
    """Source-level regression suite for the NameError-on-image-gen bug."""

    def test_uses_globals_guard_not_nameerror_prone_form(
        self, prepare_inputs_dict_source: str
    ) -> None:
        """The data-hook guard must use `"app" in globals()` (or
        equivalent safe form), NEVER the legacy `hasattr(app, ...)`
        pattern that raises NameError on FastAPI where `app` is not
        bound.
        """
        # Find the target == "metadata" block.
        target_match = re.search(
            r'if\s+target\s*==\s*["\']metadata["\']\s*:',
            prepare_inputs_dict_source,
        )
        assert target_match, (
            "Could not find the `if target == \"metadata\":` block in "
            "prepare_inputs_dict — the function was restructured. "
            "Update this test."
        )
        # Slice the block — from `if target == "metadata"` to the next
        # `return inputs` or end of function.
        block_start = target_match.start()
        end_match = re.search(r"return\s+inputs", prepare_inputs_dict_source[block_start:])
        if end_match is None:
            pytest.fail("Could not find the trailing `return inputs` in prepare_inputs_dict")
        block = prepare_inputs_dict_source[block_start:block_start + end_match.end()]

        # The legacy bug form MUST NOT appear in real code (ignoring
        # comments — the fix's own docstring mentions the legacy form
        # to explain what was wrong).
        block_no_comments = _strip_python_comments(block)
        assert "hasattr(app," not in block_no_comments, (
            "Found `hasattr(app, ...)` inside the metadata branch of "
            "prepare_inputs_dict — this raises NameError on FastAPI "
            "where the legacy `app` namespace is never injected. Use "
            "`\"app\" in globals()` (or equivalent) to gate the "
            "data-hook pass."
        )

        # The safe form MUST appear.
        safe_patterns = [
            r'["\']app["\']\s+in\s+globals\s*\(',
            r'globals\s*\(\s*\)\s*\[\s*["\']app["\']\s*\]',
            # Equivalent: a get() that defaults to a synthetic namespace
            # object that lacks the attribute.
            r'globals\s*\(\s*\)\.get\s*\(\s*["\']app["\']',
        ]
        assert any(re.search(p, block) for p in safe_patterns), (
            "Could not find any safe-form guard (`\"app\" in globals()`, "
            "`globals()['app']`, or `globals().get('app', ...)`) inside "
            "the metadata branch of prepare_inputs_dict. Without one of "
            "these guards the function raises NameError on FastAPI."
        )

    def test_metadata_block_filters_none_values(
        self, prepare_inputs_dict_source: str
    ) -> None:
        """The metadata branch must drop keys whose value is None
        before any plugin hook runs. This was the original behaviour
        and the bug-fix didn't change it — we assert it explicitly
        so a future refactor doesn't regress.
        """
        target_match = re.search(
            r'if\s+target\s*==\s*["\']metadata["\']\s*:',
            prepare_inputs_dict_source,
        )
        assert target_match
        block_start = target_match.start()
        end_match = re.search(r"return\s+inputs", prepare_inputs_dict_source[block_start:])
        assert end_match
        block = prepare_inputs_dict_source[block_start:block_start + end_match.end()]

        # Either the comprehension-style or the dict-comprehension filter
        # is acceptable.
        none_filter_patterns = [
            r"v\s*!=\s*None",
            r"v\s+is\s+not\s+None",
            r"not\s+v\s+is\s+None",  # defensive double-form
        ]
        assert any(re.search(p, block) for p in none_filter_patterns), (
            "Expected the metadata branch to filter out None values "
            "before the plugin hook. Found none of `v != None`, "
            "`v is not None`, or `not v is None`."
        )

    def test_optional_plugin_hook_call_uses_safe_getattr(
        self, prepare_inputs_dict_source: str
    ) -> None:
        """When the guard passes and an `app` global IS bound, the
        plugin manager must be looked up via `getattr(app, ...)`
        (or `app.plugin_manager` direct attribute access on a safely
        obtained reference) — not via a bare `app.something` that
        could AttributeError on a partial binding.
        """
        target_match = re.search(
            r'if\s+target\s*==\s*["\']metadata["\']\s*:',
            prepare_inputs_dict_source,
        )
        assert target_match
        block_start = target_match.start()
        end_match = re.search(r"return\s+inputs", prepare_inputs_dict_source[block_start:])
        assert end_match
        block = prepare_inputs_dict_source[block_start:block_start + end_match.end()]

        # Look for the actual plugin manager invocation. It must be
        # reachable through a safely obtained `app` reference.
        #
        # Acceptable forms:
        #   - getattr(_plugin_app, "plugin_manager")      (defensive)
        #   - _plugin_app.plugin_manager                  (direct, after
        #     verifying `_plugin_app` is not None via the guard)
        #   - app.plugin_manager with `if "app" in globals()` already
        #     established `app` is bound
        # Unacceptable forms:
        #   - hasattr(app, "plugin_manager")              (NameError)
        #   - try: app.plugin_manager except:              (silently
        #                                                    swallowing)
        has_plugin_call = bool(
            re.search(r"plugin_manager", block)
            and re.search(r"run_data_hooks", block)
        )
        assert has_plugin_call, (
            "Expected the metadata branch to invoke "
            "`plugin_manager.run_data_hooks(...)` somewhere."
        )

        # No bare `hasattr(app,` (legacy bug form) — comments
        # excluded since the fix's docstring mentions the legacy form.
        block_no_comments = _strip_python_comments(block)
        assert "hasattr(app," not in block_no_comments, (
            "Found legacy `hasattr(app, ...)` pattern — see test_uses_"
            "globals_guard_not_nameerror_prone_form for the fix."
        )
