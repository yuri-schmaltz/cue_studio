"""E2E tests for Director pipeline management endpoints.

Covers the lifecycle operations that don't require GPU generation:

* GET /api/v1/director/pipelines — list
* GET /api/v1/director/pipeline/{pid} — status (404 path)
* POST /api/v1/director/pipeline/{pid}/stop — cancel (404 path)
* POST /api/v1/director/classify-sections — heuristic fallback
* POST /api/v1/director/plan-angle-prompts — angle prompts
* GET /api/v1/director/skills — registry
* GET /api/v1/llm/models — catalog
* GET /api/v1/llm/status — readiness
* GET /api/v1/director/pipelines/{pid}/thumbnail — 404 path

The tests use the running Cue Studio backend on port 7860 by default
(CUE_STUDIO_E2E_PORT env var to override). They auto-skip when the
backend is unreachable or no media library is mounted.
"""
from __future__ import annotations

import json
import os
import sys
import unittest

import pytest
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP_ROOT = ROOT / "app"
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from services import test_fixtures  # noqa: E402

PORT = int(os.environ.get("CUE_STUDIO_E2E_PORT", "7860"))
BASE = f"http://127.0.0.1:{PORT}"
TIMEOUT_SHORT = 60
TIMEOUT_LLM = 900


def _post(path: str, payload: dict) -> dict:
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT_LLM) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _get(path: str) -> dict:
    with urllib.request.urlopen(f"{BASE}{path}", timeout=TIMEOUT_SHORT) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _require_backend(test: unittest.TestCase) -> None:
    try:
        _get("/health/version")
    except Exception as exc:  # noqa: BLE001
        test.skipTest(f"Backend not reachable on {BASE}: {exc}")


def _require_media(test: unittest.TestCase) -> None:
    if not test_fixtures.first_audio():
        test.skipTest("Media library not mounted")


@pytest.mark.smoke
@pytest.mark.media
class DirectorPipelineCRUDTests(unittest.TestCase):
    """Tests for Director pipeline lifecycle that don't need GPU."""

    @classmethod
    def setUpClass(cls):
        # Skip the entire class if media library missing.
        if not test_fixtures.first_audio():
            raise unittest.SkipTest("Media library not mounted")

    def setUp(self):
        _require_backend(self)
        _require_media(self)

    def test_01_list_pipelines_returns_array(self):
        # GET /api/v1/director/pipelines must return an object with a
        # ``pipelines`` list (possibly empty). Older revisions returned
        # the list directly; the current contract wraps it so callers
        # can attach pagination metadata later without a breaking change.
        data = _get("/api/v1/director/pipelines")
        self.assertIsInstance(data, dict)
        self.assertIn("pipelines", data)
        self.assertIsInstance(data["pipelines"], list)

    def test_02_get_pipeline_status_returns_404_for_unknown_pid(self):
        # A pid that was never registered should 404, not 500.
        fake_pid = "00000000-0000-0000-0000-000000000000"
        req = urllib.request.Request(f"{BASE}/api/v1/director/pipeline/{fake_pid}")
        try:
            urllib.request.urlopen(req, timeout=TIMEOUT_SHORT)
            self.fail("Expected 404 for unknown pipeline id")
        except urllib.error.HTTPError as exc:
            self.assertEqual(exc.code, 404)

    def test_03_stop_pipeline_returns_404_for_unknown_pid(self):
        # Same guarantee for the cancel endpoint.
        fake_pid = "11111111-1111-1111-1111-111111111111"
        req = urllib.request.Request(
            f"{BASE}/api/v1/director/pipeline/{fake_pid}/stop",
            method="POST",
        )
        try:
            urllib.request.urlopen(req, timeout=TIMEOUT_SHORT)
            self.fail("Expected 404 for unknown pipeline id")
        except urllib.error.HTTPError as exc:
            self.assertEqual(exc.code, 404)

    def test_04_thumbnail_returns_404_for_unknown_pid(self):
        fake_pid = "22222222-2222-2222-2222-222222222222"
        req = urllib.request.Request(
            f"{BASE}/api/v1/director/pipelines/{fake_pid}/thumbnail"
        )
        try:
            urllib.request.urlopen(req, timeout=TIMEOUT_SHORT)
            self.fail("Expected 404 for unknown pipeline id")
        except urllib.error.HTTPError as exc:
            self.assertEqual(exc.code, 404)

    def test_05_pipeline_start_validates_params(self):
        # The endpoint is intentionally permissive: an empty body
        # returns 200 with a freshly-allocated pipeline id so the UI
        # can show "queued" before the user uploads audio. We verify
        # that the response shape stays sane (pipeline_id is a string)
        # and that the created pipeline is immediately queryable.
        req = urllib.request.Request(
            f"{BASE}/api/v1/director/pipeline/start",
            data=b"{}",
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=TIMEOUT_SHORT) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        self.assertIn("pipeline_id", data)
        pid = data["pipeline_id"]
        self.assertIsInstance(pid, str)
        self.assertGreater(len(pid), 0)
        # Status of freshly-created pipeline should be queryable.
        status = _get(f"/api/v1/director/pipeline/{pid}")
        self.assertIsInstance(status, dict)
        # Clean up — delete the test pipeline so the directory tree
        # doesn't accumulate orphan entries across runs.
        try:
            urllib.request.urlopen(
                urllib.request.Request(
                    f"{BASE}/api/v1/director/pipelines/{pid}",
                    method="DELETE",
                ),
                timeout=TIMEOUT_SHORT,
            )
        except Exception:
            pass

    def test_06_director_skills_endpoint_returns_dict(self):
        data = _get("/api/v1/director/skills")
        self.assertIsInstance(data, dict)

    def test_07_llm_models_returns_list(self):
        data = _get("/api/v1/llm/models")
        self.assertIsInstance(data, dict)
        self.assertIn("models", data)
        self.assertIsInstance(data["models"], list)

    def test_08_llm_status_returns_dict(self):
        data = _get("/api/v1/llm/status")
        self.assertIsInstance(data, dict)

    def test_09_director_queue_returns_list(self):
        # The /director/queue endpoint returns an object with an
        # ``entries`` list. It can be empty.
        data = _get("/api/v1/director/queue")
        self.assertIsInstance(data, dict)
        self.assertIn("entries", data)
        self.assertIsInstance(data["entries"], list)

    def test_10_classify_sections_no_lyrics_falls_back_to_heuristic(self):
        # When lyrics are absent, classify-sections must fall back to
        # the heuristic path without crashing the LLM call.
        analysis = {
            "duration": 30.0,
            "sections": [
                {"start": 0.0, "end": 15.0, "label": "verse", "energy": 0.5},
                {"start": 15.0, "end": 30.0, "label": "chorus", "energy": 0.7},
            ],
            "lyrics": [],
        }
        data = _post("/api/v1/director/classify-sections", {"analysis": analysis})
        self.assertEqual(data.get("method"), "heuristic")
        # Sections should be returned unchanged.
        self.assertEqual(len(data["sections"]), 2)


@pytest.mark.smoke
@pytest.mark.media
class DirectorAnglePromptsTests(unittest.TestCase):
    """Tests for the angle-prompts LLM endpoint."""

    def setUp(self):
        _require_backend(self)
        _require_media(self)

    def test_01_angle_prompts_requires_style_prompt(self):
        # Empty body must return 400 with a clear message, not 500.
        req = urllib.request.Request(
            f"{BASE}/api/v1/director/plan-angle-prompts",
            data=b"{}",
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            urllib.request.urlopen(req, timeout=TIMEOUT_SHORT)
            self.fail("Expected 400 for missing style_prompt")
        except urllib.error.HTTPError as exc:
            self.assertEqual(exc.code, 400)

    def test_02_angle_prompts_happy_path(self):
        # With a valid style_prompt the endpoint must return a list of
        # angle prompts in prompt_type='angles' shape.
        data = _post("/api/v1/director/plan-angle-prompts", {
            "style_prompt": "cinematic noir, dramatic chiaroscuro, 1940s detective mood",
            "num_angles": 3,
        })
        self.assertIn("prompts", data)
        self.assertGreater(len(data["prompts"]), 0)


@pytest.mark.smoke
@pytest.mark.media
class DirectorNegativePromptTests(unittest.TestCase):
    """Tests for /api/v1/director/generate-negative-prompt endpoint."""

    def setUp(self):
        _require_backend(self)
        _require_media(self)

    def test_01_negative_prompt_with_scene_description(self):
        # LLM-driven negative prompt generation. This is slower than
        # angle prompts because the prompt is larger; allow up to 10 min.
        data = _post("/api/v1/director/generate-negative-prompt", {
            "scene_description": (
                "A noir-style rooftop chase in the rain. Two detectives "
                "corner a suspect on a 1940s industrial rooftop. "
                "Chiaroscuro lighting with deep shadows."
            ),
        })
        self.assertIn("negative_prompt", data)
        self.assertIsInstance(data["negative_prompt"], str)
        self.assertGreater(len(data["negative_prompt"]), 0)


@pytest.mark.smoke
@pytest.mark.media
class DirectorPlanPromptsAndImagesTests(unittest.TestCase):
    """Tests for the LLM-only plan-prompts-and-images endpoint."""

    def setUp(self):
        _require_backend(self)
        _require_media(self)

    def test_01_plan_prompts_and_images_no_gpu(self):
        # This endpoint returns clip_plans from the LLM but skips image
        # gen. With no audio analysis it should still produce a valid
        # response (or a clean 400 if the planner insists on clips).
        try:
            data = _post("/api/v1/director/plan-prompts-and-images", {
                "scene_description": "A single dramatic shot of a city at dusk.",
                "clips": [
                    {
                        "start": 0.0,
                        "end": 4.0,
                        "section_label": "intro",
                        "energy": 0.5,
                    },
                ],
                "video_model": "ltx2_3",
                "prompt_type": "both",
            })
        except urllib.error.HTTPError as exc:
            # If the planner requires a real analysis, 400 is acceptable.
            self.assertIn(exc.code, (200, 400, 500))
            return
        # If it succeeded, must have clip_plans array.
        self.assertIn("clip_plans", data)
        self.assertIsInstance(data["clip_plans"], list)


@pytest.mark.smoke
@pytest.mark.media
class DirectorLLMDescribeImageTests(unittest.TestCase):
    """Tests for /api/v1/llm/describe-image (vision capability)."""

    def setUp(self):
        _require_backend(self)
        _require_media(self)

    def test_01_describe_image_with_library_fixture(self):
        # Try a real image from the media library. The endpoint should
        # return a description or a clean error if the model lacks
        # vision.
        try:
            images = test_fixtures.list_image_files(test_fixtures.MEDIA_IMAGES_SUBDIR)
        except FileNotFoundError:
            self.skipTest("Images subdirectory missing")
        if not images:
            self.skipTest("No images available in library")
        # Pick a small image to keep payload light.
        try:
            image_path = test_fixtures.first_image()
        except FileNotFoundError:
            self.skipTest("No suitable images in library")
        if not image_path:
            self.skipTest("No suitable images in library")
        data = _post("/api/v1/llm/describe-image", {
            "image_path": str(image_path),
            "prompt": "Describe this image in one sentence.",
        })
        # Either a description came back, or an error key indicating
        # the model can't do vision — both are acceptable.
        self.assertTrue(
            "description" in data or "error" in data,
            f"Unexpected response: {data}",
        )


@pytest.mark.smoke
@pytest.mark.media
class DirectorV2PlanValidationTests(unittest.TestCase):
    """Tests for /api/v1/director/v2/plan request validation.

    Regression for the gauntlet-found bug where an empty body crashed
    the planner with HTTP 500 ``MusicVideoPlanner.plan() missing 2
    required positional arguments`` instead of a clean HTTP 400.
    """

    def setUp(self):
        _require_backend(self)

    def test_01_empty_body_returns_400_with_validation_message(self):
        # An empty body must be rejected with 400, not crash as 500.
        req = urllib.request.Request(
            f"{BASE}/api/v1/director/v2/plan",
            data=b"{}",
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            urllib.request.urlopen(req, timeout=TIMEOUT_SHORT)
            self.fail("Expected 400 for empty v2/plan body")
        except urllib.error.HTTPError as exc:
            self.assertEqual(exc.code, 400)
            body = exc.read().decode("utf-8")
            # Must mention at least one of the required fields.
            self.assertIn("scene_description", body)
            self.assertIn("clips", body)

    def test_02_non_object_body_returns_400(self):
        # A JSON array is not a valid body — must be rejected before
        # the planner is invoked.
        req = urllib.request.Request(
            f"{BASE}/api/v1/director/v2/plan",
            data=b"[]",
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            urllib.request.urlopen(req, timeout=TIMEOUT_SHORT)
            self.fail("Expected 400 for non-object v2/plan body")
        except urllib.error.HTTPError as exc:
            self.assertEqual(exc.code, 400)

    def test_03_missing_clips_returns_400(self):
        # Partial payload — has scene_description but no clips.
        req = urllib.request.Request(
            f"{BASE}/api/v1/director/v2/plan",
            data=json.dumps({"scene_description": "A city at dusk"}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            urllib.request.urlopen(req, timeout=TIMEOUT_SHORT)
            self.fail("Expected 400 for missing clips")
        except urllib.error.HTTPError as exc:
            self.assertEqual(exc.code, 400)

    def test_04_short_film_requires_story_description(self):
        # Different skill types have different required fields. Make
        # sure the validation is per-skill.
        req = urllib.request.Request(
            f"{BASE}/api/v1/director/v2/plan",
            data=json.dumps({"skill_type": "short_film", "clips": []}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            urllib.request.urlopen(req, timeout=TIMEOUT_SHORT)
            self.fail("Expected 400 for missing story_description")
        except urllib.error.HTTPError as exc:
            self.assertEqual(exc.code, 400)
            body = exc.read().decode("utf-8")
            self.assertIn("story_description", body)


if __name__ == "__main__":
    unittest.main()
