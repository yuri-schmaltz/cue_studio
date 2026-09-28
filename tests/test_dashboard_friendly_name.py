"""Unit tests for `_friendly_pipeline_name`.

These tests cover the auto-derived label that powers the Dashboard
pipeline ``<select>``. The helper has to stay short, scannable, and
free of stacked separators — the dropdown becomes unreadable otherwise.

We don't import the whole `services.director_pipeline` module because
it pulls in runtime-only dependencies (FastAPI app context, GPU
detectors, etc). We re-exec the helper source so the test stays
isolated and fast.
"""

from __future__ import annotations

import ast
import os
import re
import types


def _load_helper():
    """Pull just `_friendly_pipeline_name` out of director_pipeline.py."""
    import sys

    src_path = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "..", "app", "services", "director_pipeline.py",
    )
    with open(src_path, "r", encoding="utf-8") as fh:
        src = fh.read()

    tree = ast.parse(src)
    keep_names = {
        "_PIPELINE_TYPE_LABELS",
        "_PIPELINE_TITLE_STOPWORDS",
        "_friendly_pipeline_name",
    }
    kept: list[ast.stmt] = []
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id in keep_names:
                    kept.append(node)
                    break
        elif isinstance(node, ast.FunctionDef) and node.name in keep_names:
            kept.append(node)
        elif isinstance(node, ast.Import):
            kept.append(node)
        elif isinstance(node, ast.ImportFrom):
            # We only need `re` and `time`.
            mod = node.module or ""
            if mod in {"re", "time"}:
                kept.append(node)
        elif isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant):
            # Drop module docstring.
            continue

    module = ast.Module(body=kept, type_ignores=[])
    code = compile(module, src_path, "exec")

    # Stub modules the module-level imports may reference. Track which
    # stubs we actually installed so we can clean them up after exec —
    # otherwise a freshly-installed ``services`` stub lingers in
    # ``sys.modules`` and shadows the real package for every subsequent
    # test module that does ``from services.X import ...`` (this is the
    # root cause of the pre-existing fixture-isolation failure that
    # surfaced as ``AttributeError: module 'services' has no attribute
    # 'director'`` in adjacent suites).
    installed_stubs: list[str] = []
    real_modules_before: dict[str, types.ModuleType] = {}
    for stub in ("services", "models", "models.minimax_h3",
                 "services.scene_takes", "services.creative_review",
                 "services.job_lifecycle", "services.director_model_compat",
                 "services.director_video_strategy",
                 "services.h3_window_planner", "services.text_integrity"):
        if stub in sys.modules:
            real_modules_before[stub] = sys.modules[stub]
        else:
            sys.modules[stub] = types.ModuleType(stub)
            installed_stubs.append(stub)

    namespace: dict = {"__name__": "director_pipeline_helper"}
    try:
        exec(code, namespace)
    finally:
        # Roll back: remove stubs we installed, restore anything that
        # was there before.
        for stub in installed_stubs:
            sys.modules.pop(stub, None)
        for stub, original in real_modules_before.items():
            sys.modules[stub] = original
    return namespace["_friendly_pipeline_name"]


friendly_pipeline_name = _load_helper()


def test_known_type_with_title():
    name = friendly_pipeline_name("music_video", "Sunset Drive", 1738000000)
    assert name == "Music Video · Sunset Drive"


def test_strips_leading_stopword():
    name = friendly_pipeline_name("music_video", "the morning drive", 1738000000)
    assert name == "Music Video · Morning Drive"


def test_preserves_short_uppercase_token():
    name = friendly_pipeline_name("short_film_story", "LA noir", 1738000000)
    assert name == "Short Film · LA Noir"


def test_strips_surrounding_quotes():
    name = friendly_pipeline_name("music_video", '"Neon Skyline"', 1738000000)
    assert name == "Music Video · Neon Skyline"


def test_first_sentence_only():
    name = friendly_pipeline_name(
        "music_video",
        "First title. Second sentence that should not appear.",
        1738000000,
    )
    assert name == "Music Video · First Title"
    assert "Second sentence" not in name


def test_truncates_long_titles():
    long = "A long sentence that should be truncated to keep the dropdown readable at a glance"
    name = friendly_pipeline_name("music_video", long, 1738000000)
    assert name.startswith("Music Video · ")
    assert name.endswith("…")
    # Soft cap is 48 chars on the title itself before the separator.
    fragment = name.split(" · ", 1)[1]
    assert len(fragment) <= 49  # 48 + ellipsis


def test_unknown_type_falls_back():
    name = friendly_pipeline_name("experimental_xyz", "Hello", 1738000000)
    assert name == "Experimental Xyz · Hello"


def test_empty_description_uses_stamp():
    name = friendly_pipeline_name("music_video", "", 1738000000)
    assert name.startswith("Music Video: run ")
    # "Music Video: run 27 Jan 14:46"
    assert re.match(r"^Music Video: run \d{1,2} [A-Z][a-z]{2} \d{2}:\d{2}$", name)


def test_whitespace_only_description_uses_stamp():
    name = friendly_pipeline_name("music_video", "   \n\t  ", 1738000000)
    assert name.startswith("Music Video: run ")


def test_no_timestamp_uses_untitled():
    name = friendly_pipeline_name("music_video", "", None)
    assert name == "Music Video: untitled run"


def test_short_film_audio_label_collapses_to_short_film():
    # Short Film variants share the same human label — that's intentional,
    # but the helper must not crash on them.
    name = friendly_pipeline_name("short_film_audio", "Quiet room", 1738000000)
    assert name == "Short Film · Quiet Room"


def test_no_double_separator_in_fallback():
    # Regression: earlier draft produced "Music Video · Run · 27 Jan 14:46".
    name = friendly_pipeline_name("music_video", "", 1738000000)
    assert "· ·" not in name
    assert name.count("·") == 0
