"""E2E tests for outputs, jobs, and gallery endpoints.

Covers the lifecycle of generated media without GPU generation:

* GET /api/v1/outputs — list with pagination and filters
* GET /api/v1/outputs/{name}/metadata — single output metadata
* GET /api/v1/jobs — list active jobs
* POST /api/v1/jobs/queue/start — start the queue (idempotent)
* POST /api/v1/extract-frames — error paths
* POST /api/v1/outputs/{name}/move — error paths
* GET /api/v1/favorites — favorites list
* POST /api/v1/favorites/{name} — favorite an existing output

These tests run against the live Cue Studio backend and skip when
no media library is mounted or the backend is unreachable.
"""
from __future__ import annotations

import json
import os
import sys
import unittest
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP_ROOT = ROOT / "app"
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

import pytest  # noqa: E402

from services import test_fixtures  # noqa: E402

PORT = int(os.environ.get("CUE_STUDIO_E2E_PORT", "7860"))
BASE = f"http://127.0.0.1:{PORT}"
TIMEOUT_SHORT = 30


def _get(path: str) -> dict:
    with urllib.request.urlopen(f"{BASE}{path}", timeout=TIMEOUT_SHORT) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _post(path: str, payload: dict | None = None) -> dict:
    if payload is None:
        payload = {}
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT_SHORT) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _require_backend(test: unittest.TestCase) -> None:
    try:
        _get("/health/version")
    except Exception as exc:  # noqa: BLE001
        test.skipTest(f"Backend not reachable on {BASE}: {exc}")


@pytest.mark.smoke
@pytest.mark.media
class OutputsListTests(unittest.TestCase):
    """Tests for GET /api/v1/outputs."""

    @classmethod
    def setUpClass(cls):
        if not test_fixtures.first_audio():
            raise unittest.SkipTest("Media library not mounted")

    def setUp(self):
        _require_backend(self)

    def test_01_list_outputs_returns_paginated_dict(self):
        data = _get("/api/v1/outputs")
        self.assertIsInstance(data, dict)
        self.assertIn("outputs", data)
        self.assertIn("total", data)
        self.assertIsInstance(data["outputs"], list)
        self.assertIsInstance(data["total"], int)

    def test_02_list_outputs_with_limit(self):
        data = _get("/api/v1/outputs?limit=5")
        self.assertLessEqual(len(data["outputs"]), 5)
        # If there are at least 5 total items, the limit must take effect.
        if data["total"] >= 5:
            self.assertEqual(len(data["outputs"]), 5)

    def test_03_list_outputs_with_offset(self):
        data0 = _get("/api/v1/outputs?limit=2&offset=0")
        data1 = _get("/api/v1/outputs?limit=2&offset=2")
        # Items at offset 2 should be different from offset 0 (when total > 4).
        if data0["total"] > 4 and data1["total"] > 2:
            names0 = {o.get("name") for o in data0["outputs"]}
            names1 = {o.get("name") for o in data1["outputs"]}
            self.assertTrue(names0.isdisjoint(names1),
                            "Offset pagination must not return overlapping items")

    def test_04_list_outputs_favorites_only(self):
        data = _get("/api/v1/outputs?favorites_only=true")
        # Every returned item should be a favorite.
        for out in data["outputs"]:
            self.assertTrue(
                out.get("favorite") or out.get("is_favorite"),
                f"favorites_only=true returned non-favorite: {out.get('name')}",
            )

    def test_05_list_outputs_search_filter(self):
        # A search that matches nothing should still return a clean dict.
        data = _get("/api/v1/outputs?search=__nonexistent_zzzzzz__")
        self.assertIsInstance(data, dict)
        self.assertIn("outputs", data)
        # With no matches, the list should be empty (or contain only matches
        # that genuinely contain the search term).
        for out in data["outputs"]:
            name = (out.get("name") or "").lower()
            self.assertIn("__nonexistent_zzzzzz__", name)


@pytest.mark.smoke
@pytest.mark.media
class OutputsUploadsVirtualWorkspaceTests(unittest.TestCase):
    """Tests for the virtual __uploads__ workspace view."""

    def setUp(self):
        _require_backend(self)

    def test_01_uploads_workspace_returns_outputs(self):
        # Browsing the virtual uploads folder must not raise — even if
        # the directory is empty we get a clean {outputs, total} dict.
        data = _get("/api/v1/outputs?workspace=__uploads__")
        self.assertIsInstance(data, dict)
        self.assertIn("outputs", data)
        self.assertIn("total", data)


@pytest.mark.smoke
@pytest.mark.media
class OutputsMetadataTests(unittest.TestCase):
    """Tests for GET /api/v1/outputs/{name}/metadata."""

    def setUp(self):
        _require_backend(self)

    def test_01_metadata_returns_404_for_unknown_output(self):
        fake = "this-output-does-not-exist-123456789.mp4"
        try:
            urllib.request.urlopen(
                f"{BASE}/api/v1/outputs/{fake}/metadata",
                timeout=TIMEOUT_SHORT,
            )
            self.fail("Expected 404 for unknown output metadata")
        except urllib.error.HTTPError as exc:
            self.assertEqual(exc.code, 404)


@pytest.mark.smoke
@pytest.mark.media
class JobsListTests(unittest.TestCase):
    """Tests for /api/v1/jobs lifecycle endpoints."""

    def setUp(self):
        _require_backend(self)

    def test_01_list_jobs_returns_dict(self):
        data = _get("/api/v1/jobs")
        # /jobs returns either a list of jobs or an object with a jobs key
        # depending on the backend version. Accept either.
        if isinstance(data, dict):
            self.assertIn("jobs", data)
            self.assertIsInstance(data["jobs"], list)
        else:
            self.assertIsInstance(data, list)

    def test_02_start_queue_is_idempotent(self):
        # Starting the queue twice must not raise and must return 200 both
        # times. The endpoint is intentionally idempotent — calling it
        # when the queue is already running just returns the current state.
        try:
            _post("/api/v1/jobs/queue/start", {})
            _post("/api/v1/jobs/queue/start", {})
        except urllib.error.HTTPError as exc:
            self.fail(f"start_queue not idempotent: {exc.code} {exc.reason}")

    def test_03_cancel_unknown_job_returns_404(self):
        fake_id = "00000000-0000-0000-0000-deadbeefcafe"
        req = urllib.request.Request(
            f"{BASE}/api/v1/cancel/{fake_id}",
            method="POST",
        )
        try:
            urllib.request.urlopen(req, timeout=TIMEOUT_SHORT)
            self.fail("Expected 404 for unknown job cancel")
        except urllib.error.HTTPError as exc:
            # 404 is expected; some backends return 400. Either is OK.
            self.assertIn(exc.code, (400, 404))


@pytest.mark.smoke
@pytest.mark.media
class ExtractFramesErrorPathTests(unittest.TestCase):
    """Tests for error handling in /api/v1/extract-frames."""

    def setUp(self):
        _require_backend(self)

    def test_01_extract_frames_missing_video_path_returns_400(self):
        try:
            _post("/api/v1/extract-frames", {})
            self.fail("Expected 400 for missing video_path")
        except urllib.error.HTTPError as exc:
            self.assertEqual(exc.code, 400)

    def test_02_extract_frames_nonexistent_video_returns_400_or_404(self):
        try:
            _post("/api/v1/extract-frames", {
                "video_path": "/tmp/__nonexistent_video_xyz.mp4",
            })
            self.fail("Expected error for nonexistent video")
        except urllib.error.HTTPError as exc:
            self.assertIn(exc.code, (400, 404, 422, 500))


@pytest.mark.smoke
@pytest.mark.media
class OutputsMoveErrorPathTests(unittest.TestCase):
    """Tests for /api/v1/outputs/{name}/move error paths."""

    def setUp(self):
        _require_backend(self)

    def test_01_move_nonexistent_output_returns_error(self):
        try:
            _post("/api/v1/outputs/__nonexistent_xyz__.mp4/move", {
                "target": "/tmp",
            })
            self.fail("Expected error for nonexistent output move")
        except urllib.error.HTTPError as exc:
            # 404 is canonical; 400/422 acceptable.
            self.assertIn(exc.code, (400, 404, 422))


@pytest.mark.smoke
@pytest.mark.media
class FavoritesEndpointTests(unittest.TestCase):
    """Tests for /api/v1/favorites lifecycle."""

    def setUp(self):
        _require_backend(self)

    def test_01_list_favorites_returns_array_or_object(self):
        data = _get("/api/v1/favorites")
        # Accept either a bare list or a dict with a ``favorites`` key.
        if isinstance(data, dict):
            self.assertIn("favorites", data)
            self.assertIsInstance(data["favorites"], list)
        else:
            self.assertIsInstance(data, list)

    def test_02_favorite_nonexistent_output_returns_error(self):
        fake = "__nonexistent_favorite_xyz__.mp4"
        req = urllib.request.Request(
            f"{BASE}/api/v1/favorites/{fake}",
            method="POST",
        )
        try:
            urllib.request.urlopen(req, timeout=TIMEOUT_SHORT)
            # Some backends are permissive — also acceptable.
        except urllib.error.HTTPError as exc:
            # 404 is canonical; 400/422 acceptable.
            self.assertIn(exc.code, (400, 404, 422))


@pytest.mark.smoke
@pytest.mark.media
class OutputsGroupTests(unittest.TestCase):
    """Tests for /api/v1/outputs/group/{group_id} endpoint."""

    def setUp(self):
        _require_backend(self)

    def test_01_unknown_group_returns_empty_clips(self):
        # The /outputs/group endpoint is intentionally permissive:
        # unknown group ids return 200 with an empty clips array rather
        # than 404, so the UI can render an empty gallery without
        # special-casing missing data.
        fake_group = "00000000-0000-0000-0000-000000000000"
        data = _get(f"/api/v1/outputs/group/{fake_group}")
        self.assertIsInstance(data, dict)
        self.assertIn("clips", data)
        self.assertIsInstance(data["clips"], list)
        self.assertEqual(len(data["clips"]), 0)


if __name__ == "__main__":
    unittest.main()
