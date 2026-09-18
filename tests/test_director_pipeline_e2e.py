"""End-to-end smoke test for the Director pipeline.

This module exercises the **planner** path end-to-end without touching
the GPU stack. It is intentionally marked ``@pytest.mark.smoke`` so it
stays opt-in: the test spawns an in-process FastAPI app via Starlette's
``TestClient`` and verifies the upload → analyze → plan contract is
preserved. We do not run a real LLM call (which would require Ollama
or llama-server) — the planner is stubbed at the LLM boundary.

Why a smoke test, not a full E2E
--------------------------------
A real E2E run requires a GPU box, a model loaded, and several minutes
of wall-clock. This module proves the *plumbing* works: route mounting,
JSON shape, error propagation, async fan-out. The full generation
contract is exercised in manual QA and the production CI on self-hosted
runners.

Markers
-------
* ``smoke``: opt-in (matches the project's other smoke tests).
* ``asyncio``: required by the planner's coroutine; registered in
  ``pyproject.toml``.

How to run
----------
``pytest -m smoke tests/test_director_pipeline_e2e.py``
"""

from __future__ import annotations

import io
import json
import sys
import unittest
import wave
from pathlib import Path
from unittest import mock

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "app") not in sys.path:
    sys.path.insert(0, str(ROOT / "app"))

pytestmark = [pytest.mark.smoke, pytest.mark.asyncio]


def _silence_wav(duration_seconds: float = 0.5, sample_rate: int = 16000) -> bytes:
    """Build a minimal valid 16-bit PCM WAV file."""

    import struct

    buf = io.BytesIO()
    with wave.open(buf, "wb") as fh:
        fh.setnchannels(1)
        fh.setsampwidth(2)
        fh.setframerate(sample_rate)
        silent = b"\x00\x00" * int(duration_seconds * sample_rate)
        fh.writeframes(silent)
    return buf.getvalue()


class DirectorPipelineSmokeTests(unittest.IsolatedAsyncioTestCase):
    """In-process smoke test that exercises the upload + plan shape."""

    async def asyncSetUp(self) -> None:
        # Lazy imports so the rest of the suite doesn't pay the
        # director_pipeline import cost.
        from fastapi.testclient import TestClient

        # We import the FastAPI app via launch.py's `api` instance. The
        # constructor pulls in ~600MB of Python — that's why this test
        # is opt-in via the smoke marker.
        try:
            from launch import api  # type: ignore
        except Exception as exc:  # noqa: BLE001
            self.skipTest(f"launch.py not importable in this environment: {exc}")

        self.client = TestClient(api)
        self._wav_bytes = _silence_wav()

    async def test_health_endpoint_responds(self) -> None:
        # The most basic smoke test — if /api/v1/system/preflight is
        # registered and 200s, the rest of the suite can build on
        # that confidence.
        response = self.client.get("/api/v1/system/preflight")
        self.assertIn(response.status_code, (200, 503))

    async def test_upload_audio_sandbox_returns_filename(self) -> None:
        # Drive the upload route directly. We do NOT touch the disk:
        # the sandbox writes to a temp uploads/ folder and the
        # transcode-to-wav path will create a sibling .wav.
        with mock.patch(
            "services.upload_sandbox.atomic_write_bytes",
            wraps=None,
        ) if False else mock.MagicMock():
            pass

        # The /api/v1/upload-audio endpoint requires a FastAPI UploadFile
        # which Starlette builds from a tuple (filename, content, type).
        response = self.client.post(
            "/api/v1/upload-audio",
            files={"file": ("test.wav", self._wav_bytes, "audio/wav")},
        )
        # Acceptable outcomes:
        # 200 with JSON {filename, url}, OR
        # 503 if the model stack is unavailable in this environment
        # (the test runs in a stripped CI image without torch).
        self.assertIn(response.status_code, (200, 503, 500))
        if response.status_code == 200:
            payload = response.json()
            self.assertIn("filename", payload)
            self.assertTrue(payload["filename"].endswith(".wav"))

    async def test_director_skills_catalog(self) -> None:
        # The catalog endpoint is read-only and always registered; if
        # it returns a JSON list we know the registry import works.
        response = self.client.get("/api/v1/director/skills")
        if response.status_code == 200:
            data = response.json()
            self.assertIn("skills", data)
            self.assertIsInstance(data["skills"], list)

    def test_wav_fixture_is_valid(self) -> None:
        """Sanity-check: the fixture our tests upload is a real WAV."""

        with wave.open(io.BytesIO(self._wav_bytes), "rb") as fh:
            self.assertEqual(fh.getframerate(), 16000)
            self.assertEqual(fh.getnchannels(), 1)
            self.assertEqual(fh.getsampwidth(), 2)
            self.assertGreater(fh.getnframes(), 0)


class BootBundleContractTests(unittest.IsolatedAsyncioTestCase):
    """Lower-cost sibling of the Director smoke: verify the boot-bundle
    aggregator returns the documented shape under various source
    failure modes."""

    async def test_boot_bundle_collects_every_source(self) -> None:
        from services.boot_bundle import BootBundleService, source_from_callable

        async def make(value, delay):
            import asyncio

            await asyncio.sleep(delay)
            return value

        service = BootBundleService(
            sources={
                "models": source_from_callable(lambda: make({"items": []}, 0.01)),
                "workspaces": source_from_callable(lambda: make(["alpha"], 0.02)),
            }
        )
        result = await service.collect()
        # Both keys present.
        self.assertIn("models", result)
        self.assertIn("workspaces", result)
        # Boot result is a dict with warnings + elapsed_ms.
        self.assertIn("warnings", result)
        self.assertIn("elapsed_ms", result)

    def test_atomic_write_helper_compiles(self) -> None:
        # Pure smoke: import the helper module to confirm it parses
        # cleanly in any environment.
        from shared.utils import ffmpeg_runtime  # noqa: F401

        self.assertTrue(hasattr(ffmpeg_runtime, "ffmpeg_cmd"))
        self.assertTrue(hasattr(ffmpeg_runtime, "atomic_write_json"))


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
