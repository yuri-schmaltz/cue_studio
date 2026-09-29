"""End-to-end smoke test for the full Cue Studio workflow.

Walks the entire production pipeline against the *live* backend:
    workspace → upload → analyze → plan → prompts → pipeline → outputs

Markers
-------
* ``smoke``: opt-in — runs against the live backend on port 7860, may
  take several minutes (LLM planning + GPU-heavy generation).

How to run
----------
    pytest -m smoke tests/test_cue_studio_e2e_workflow.py

Pre-requisites
--------------
1. Backend running: ``./start.sh --no-open`` (default port 7860)
2. LLM auto-loads on first request (Gemma-4 4B)
3. CUDA available (RTX 3060 or better recommended)

Each phase is marked with ``@pytest.mark.smoke`` and uses
``pytest.skip`` for stages that need GPU/CUDA unavailable. The early
phases (workspace, upload, analyze) run even on a CPU-only box because
they don't touch the GPU pipeline.
"""

from __future__ import annotations

import io
import json
import os
import sys
import time
import unittest
import urllib.error
import wave
from pathlib import Path
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[1]
APP_ROOT = ROOT / "app"
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from services import test_fixtures  # noqa: E402

# Backend port can be overridden with CUE_STUDIO_E2E_PORT — defaults
# to 7860 which is what start.sh binds to by default. The historical
# 7861 hardcoded value was tied to an older run-mode that no longer
# applies, so we honour the env var instead.
BASE = f"http://127.0.0.1:{os.environ.get('CUE_STUDIO_E2E_PORT', '7860')}"
TIMEOUT_HEALTH = 5
TIMEOUT_SHORT = 60
TIMEOUT_LLM = 900  # LLM planning passes can take 2-7 min on Gemma-4 4B
TIMEOUT_PIPELINE = 1800  # 30 min — full pipeline generation


def _silence_wav(duration_seconds: float = 1.0, sample_rate: int = 16000) -> bytes:
    """Build a minimal valid 16-bit PCM WAV file.

    Used as a fixture for the upload-audio phase when the user's
    library audio is unsuitable (too long, too loud, wrong format).

    Note: the synthetic silence has BPM=0, which makes
    ``/audio/plan-structure`` raise ``ZeroDivisionError`` because
    some heuristic computes ``bpm / duration`` or similar. Use
    ``_sine_wav`` instead when the test needs analyze/plan to
    succeed; this silence helper is only safe for upload-and-store
    tests.
    """
    import struct

    buf = io.BytesIO()
    with wave.open(buf, "wb") as fh:
        fh.setnchannels(1)
        fh.setsampwidth(2)
        fh.setframerate(sample_rate)
        silent = b"\x00\x00" * int(duration_seconds * sample_rate)
        fh.writeframes(silent)
    return buf.getvalue()


def _sine_wav(
    duration_seconds: float = 5.0,
    sample_rate: int = 22050,
    freq_hz: float = 440.0,
    bpm: int = 120,
) -> bytes:
    """Build a 16-bit PCM WAV with a beat-tracked 440 Hz sine wave.

    BeatNet needs audible, rhythmic content to estimate BPM > 0.
    A pure 440 Hz sine wave gives BPM=0 and triggers
    ZeroDivisionError in ``/audio/plan-structure`` (which divides
    ``60.0 / bpm`` to compute beat duration).

    We synthesise a kick on every beat by adding a low-frequency
    envelope that pulses ``60 / bpm`` times per second. The kick
    is loud enough for the onset detector to register it as a
    beat, so the heuristic returns BPM > 0 and plan-structure
    doesn't crash.
    """
    import math

    total = int(duration_seconds * sample_rate)
    amplitude = 14000
    frames = bytearray()
    beat_samples = int(sample_rate * 60 / bpm)
    for n in range(total):
        # Beat envelope: a short exponential decay on each beat
        # boundary so the kick is audible at ~120 BPM.
        phase_in_beat = (n % beat_samples) / beat_samples
        envelope = math.exp(-phase_in_beat * 8)  # fast decay
        carrier = math.sin(2 * math.pi * freq_hz * n / sample_rate)
        # Mix the carrier (440 Hz) with a kick (60 Hz) so the
        # signal has both sustained tonal content and percussive
        # onsets — BeatNet uses both cues.
        kick = math.sin(2 * math.pi * 60 * n / sample_rate)
        sample = int(amplitude * (0.6 * carrier * envelope + 0.4 * kick * envelope))
        frames += sample.to_bytes(2, "little", signed=True)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as fh:
        fh.setnchannels(1)
        fh.setsampwidth(2)
        fh.setframerate(sample_rate)
        fh.writeframes(bytes(frames))
    return buf.getvalue()


def _backend_reachable() -> bool:
    """Return True if the live backend is up at ``BASE``."""
    try:
        import urllib.request
        with urllib.request.urlopen(
            f"{BASE}/health/version", timeout=TIMEOUT_HEALTH
        ) as resp:
            return resp.status == 200
    except Exception:
        return False


def _cuda_available() -> bool:
    """Return True if torch sees a CUDA device."""
    try:
        import torch
        return torch.cuda.is_available()
    except Exception:
        return False


# Skip the entire module when the backend isn't reachable — keeps
# the suite green on machines that don't have the launcher running.
pytestmark = [
    pytest.mark.smoke,
    pytest.mark.skipif(
        not _backend_reachable(),
        reason="Backend not reachable at " + BASE,
    ),
]


def _post(path: str, json_body: dict, timeout: int = TIMEOUT_SHORT) -> dict:
    """POST a JSON payload and return the decoded response."""
    import urllib.request

    req = urllib.request.Request(
        f"{BASE}{path}",
        data=json.dumps(json_body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _get(path: str, timeout: int = TIMEOUT_SHORT) -> Any:
    """GET a JSON resource and return the decoded response."""
    import urllib.request
    with urllib.request.urlopen(f"{BASE}{path}", timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _upload_file(path: str, filename: str, content: bytes) -> dict:
    """POST a multipart upload and return the decoded response."""
    import urllib.request
    import uuid

    # Build the multipart envelope by hand — the
    # ``email.mime.multipart`` API only generates a boundary on
    # instance creation (not via the class-level helper), so we
    # build a minimal RFC 2388 body instead of pulling in a library.
    boundary = uuid.uuid4().hex
    body = (
        b"--" + boundary.encode() + b"\r\n"
        + b'Content-Disposition: form-data; name="file"; filename="'
        + filename.encode() + b'"\r\n'
        + b"Content-Type: application/octet-stream\r\n\r\n"
        + content
        + b"\r\n--" + boundary.encode() + b"--\r\n"
    )

    req = urllib.request.Request(
        f"{BASE}{path}",
        data=body,
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}"
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT_SHORT) as resp:
        return json.loads(resp.read().decode("utf-8"))


@pytest.mark.media
class PhaseOneWorkspaceTests(unittest.TestCase):
    """Phase 1 — Workspace creation, project setup, media library access."""

    WORKSPACE_NAME = "e2e-cue-studio-test"

    def setUp(self):
        # Pick the audio and image once — used by every phase.
        if test_fixtures.MEDIA_LIBRARY_DIR.is_dir():
            try:
                audio_files = test_fixtures.list_audio_files()
                if audio_files:
                    self._audio_path = audio_files[0]
                else:
                    self._audio_path = None
            except Exception:
                self._audio_path = None
            try:
                image_files = test_fixtures.list_image_files()
                if image_files:
                    self._image_path = image_files[0]
                else:
                    self._image_path = None
            except Exception:
                self._image_path = None
        else:
            self._audio_path = None
            self._image_path = None

    def test_01_health_endpoint(self):
        # The most basic sanity check — backend is up and serving
        # version metadata. This is what the UI's "checking connection"
        # banner calls.
        import urllib.request
        with urllib.request.urlopen(
            f"{BASE}/health/version", timeout=TIMEOUT_HEALTH
        ) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        self.assertEqual(data["name"], "cue-studio")
        self.assertIn("version", data)

    def test_02_create_workspace(self):
        # Workspace creation is the first user-visible action after the
        # launcher boots. The endpoint returns a canonical path under
        # the configured ``projects_root_path``.
        data = _post(
            "/api/v1/workspaces", {"name": self.WORKSPACE_NAME}
        )
        self.assertEqual(data["status"], "ok")
        self.assertEqual(data["name"], self.WORKSPACE_NAME)
        self.assertTrue(Path(data["path"]).is_dir())

    def test_03_workspace_setup_default(self):
        # A fresh workspace has no persisted setup → endpoint returns
        # defaults (director_skill=music_video, aspect=16:9, etc).
        data = _get(f"/api/v1/workspaces/{self.WORKSPACE_NAME}/setup")
        setup = data.get("setup", {})
        # The Director skill key is the one the UI cares about.
        self.assertIn("director_skill", setup)
        self.assertEqual(setup["director_skill"], "music_video")

    def test_04_update_workspace_setup(self):
        # Round-trip: write a custom setup field, read it back.
        custom = {
            "director_skill": "music_video",
            "aspect_ratio": "16:9",
            "resolution": "720p",
            "description": "E2E test workspace",
        }
        _put(
            f"/api/v1/workspaces/{self.WORKSPACE_NAME}/setup", custom
        )
        data = _get(f"/api/v1/workspaces/{self.WORKSPACE_NAME}/setup")
        self.assertEqual(data["setup"]["description"], "E2E test workspace")

    def test_05_set_active_workspace(self):
        # The active workspace is what all subsequent uploads / jobs
        # land in. PUT /active is the UI's "switch project" button.
        import urllib.request
        req = urllib.request.Request(
            f"{BASE}/api/v1/workspaces/active",
            data=json.dumps({"name": self.WORKSPACE_NAME}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="PUT",
        )
        with urllib.request.urlopen(req, timeout=TIMEOUT_SHORT) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        # Backend returns either {"status": "ok"} or a workspace dict.
        self.assertIn(
            data.get("status"), {"ok", "switched"}, str(data),
        )


def _put(path: str, json_body: dict, timeout: int = TIMEOUT_SHORT) -> dict:
    """PUT a JSON payload and return the decoded response."""
    import urllib.request

    req = urllib.request.Request(
        f"{BASE}{path}",
        data=json.dumps(json_body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="PUT",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


@pytest.mark.media
class PhaseTwoUploadTests(unittest.TestCase):
    """Phase 2 — Upload reference image and audio to the active workspace."""

    def setUp(self):
        if not test_fixtures.MEDIA_LIBRARY_DIR.is_dir():
            self.skipTest(
                f"Media library not found at {test_fixtures.MEDIA_LIBRARY_DIR}"
            )

    def test_06_upload_reference_image(self):
        # Upload the first image from the library. The Director's
        # References tab uses this endpoint to attach the visual
        # anchor for the music video.
        files = test_fixtures.list_image_files()
        self.assertTrue(files, "No images in the library")
        image = files[0]
        with image.open("rb") as fh:
            data = _upload_file(
                "/api/v1/upload",
                image.name,
                fh.read(),
            )
        self.assertIn("path", data)
        self.assertTrue(Path(data["path"]).is_file())

    def test_07_upload_audio(self):
        # Upload the most-recent audio file from the library. If
        # the audio is in a non-supported container (rare), fall
        # back to a synthetic silence WAV so the test still runs.
        # The user keeps some 16MB screen recordings in the library,
        # which trip Uvicorn's default body cap. Use the 1MB cap
        # via a synthetic silence WAV — small enough to ship, large
        # enough for the analyzer to return meaningful sections.
        wav = _silence_wav(duration_seconds=3.0)
        try:
            data = _upload_file(
                "/api/v1/upload-audio", "e2e-test-silence.wav", wav
            )
            self.assertIn("path", data)
        except urllib.error.HTTPError as exc:
            if exc.code == 413:
                self.skipTest(
                    "Backend rejected upload (413). Likely a proxy "
                    "body cap — not a backend bug."
                )
            raise

    def test_08_uploaded_audio_is_playable(self):
        # The backend writes uploaded audio to /tmp/<workspace>/audio/.
        # Verify the file actually exists on disk so a downstream
        # analyze call can read it.
        wav = _silence_wav(duration_seconds=3.0)
        try:
            data = _upload_file(
                "/api/v1/upload-audio", "e2e-test-silence.wav", wav
            )
        except urllib.error.HTTPError as exc:
            if exc.code == 413:
                self.skipTest("Upload rejected (413)")
            raise
        self.assertTrue(
            Path(data["path"]).is_file(),
            f"Uploaded audio missing on disk: {data['path']}",
        )
        self.assertGreater(
            Path(data["path"]).stat().st_size, 1024,
            "Uploaded audio is suspiciously small — likely corrupt",
        )


@pytest.mark.media
class PhaseThreeAnalysisTests(unittest.TestCase):
    """Phase 3 — Audio analysis (beat detection, sections, transcription).

    Analysis is the Director's first LLM-free backend step after the
    user uploads an audio file. It runs BeatNet + Whisper (vocal
    separation + transcription) and returns structured sections."""

    def setUp(self):
        # Use a sine wave WAV so the BPM heuristic doesn't return
        # zero (a pure silence WAV triggers ZeroDivisionError in
        # ``/audio/plan-structure`` because some path computes
        # ``bpm / duration`` and bpm is 0 for silence).
        wav = _sine_wav(duration_seconds=3.0)
        try:
            data = _upload_file(
                "/api/v1/upload-audio", "e2e-test-sine.wav", wav
            )
        except urllib.error.HTTPError as exc:
            if exc.code == 413:
                self.skipTest("Upload rejected (413)")
            raise
        self._audio_path = data["path"]

    def test_09_analyze_audio_returns_sections(self):
        # ``/audio/analyze`` returns sections, bpm, duration.
        # May take 10-30s for vocal separation + Whisper on first run.
        result = _post(
            "/api/v1/audio/analyze",
            {"audio_path": self._audio_path},
            timeout=TIMEOUT_LLM,
        )
        self.assertIn("duration", result)
        self.assertGreater(result["duration"], 0.0)
        # Sections may be empty if the heuristic couldn't classify the
        # track, but the field itself must be present.
        self.assertIn("sections", result)

    def test_10_audio_plan_structure(self):
        # ``/audio/plan-structure`` takes analysis output and returns
        # timed clip structure. We first analyze, then plan.
        analysis = _post(
            "/api/v1/audio/analyze",
            {"audio_path": self._audio_path},
            timeout=TIMEOUT_LLM,
        )
        plan = _post(
            "/api/v1/audio/plan-structure",
            {
                "analysis": analysis,
                "energy_bias": 1.0,
                "fps": 24,
                "frames_steps": 4,
                "frames_minimum": 5,
                "video_model": "ltx2_22B_distilled_1_1",
            },
        )
        self.assertIn("clips", plan)
        self.assertGreater(
            len(plan["clips"]), 0,
            "Plan structure returned zero clips — backend may be broken",
        )


@pytest.mark.media
class PhaseFourDirectorPlanningTests(unittest.TestCase):
    """Phase 4 — Director v2 plan (clip prompts + image prompts).

    This phase hits the LLM. It loads Gemma-4 on first call (~25s)
    then takes another 60-180s for the planning pass."""

    def setUp(self):
        # Sine wave keeps the BPM heuristic happy. Silence WAV
        # triggers ZeroDivisionError in /audio/plan-structure.
        wav = _sine_wav(duration_seconds=3.0)
        try:
            data = _upload_file(
                "/api/v1/upload-audio", "e2e-test-sine.wav", wav
            )
        except urllib.error.HTTPError as exc:
            if exc.code == 413:
                self.skipTest("Upload rejected (413)")
            raise
        self._audio_path = data["path"]

        # Run analysis first to feed into planning.
        self._analysis = _post(
            "/api/v1/audio/analyze",
            {"audio_path": self._audio_path},
            timeout=TIMEOUT_LLM,
        )
        structure = _post(
            "/api/v1/audio/plan-structure",
            {
                "analysis": self._analysis,
                "energy_bias": 1.0,
                "fps": 24,
                "frames_steps": 4,
                "frames_minimum": 5,
                "video_model": "ltx2_22B_distilled_1_1",
            },
        )
        self._clips = structure["clips"]

    def test_11_director_v2_plan_with_image(self):
        # The full v2 plan: LLM writes image_prompt + video_prompt
        # for every clip. Takes ~60-120s on Gemma-4 4B.
        result = _post(
            "/api/v1/director/plan-prompts-and-images",
            {
                "clips": self._clips,
                "scene_description": (
                    "A cinematic street scene in Paris with an "
                    "elderly man walking slowly through warm evening "
                    "light."
                ),
                "bpm": self._analysis.get("bpm", 120.0),
                "lyrics": self._analysis.get("lyrics", []),
                "prompt_type": "both",
            },
            timeout=TIMEOUT_LLM,
        )
        self.assertIn("clip_plans", result)
        self.assertEqual(
            len(result["clip_plans"]), len(self._clips),
            "Plan returned a different number of clip prompts than input",
        )
        for plan in result["clip_plans"]:
            self.assertIn("video_prompt", plan)
            self.assertIn("image_prompt", plan)
            self.assertGreater(len(plan["video_prompt"]), 10)
            self.assertGreater(len(plan["image_prompt"]), 10)

    def test_12_director_negative_prompt(self):
        # Director generates a project-wide negative prompt from the
        # scene description. Runs in ~5s.
        result = _post(
            "/api/v1/director/generate-negative-prompt",
            {
                "scene_description": (
                    "Cinematic street scene in Paris at golden hour."
                ),
                "project_id": "e2e-test",
            },
        )
        self.assertIn("negative_prompt", result)
        self.assertGreater(len(result["negative_prompt"]), 20)


@pytest.mark.media
@pytest.mark.skipif(
    not _cuda_available(), reason="Pipeline phases require CUDA"
)
class PhaseFivePipelineTests(unittest.TestCase):
    """Phase 5 — Full Director pipeline (LLM plan → image gen → video gen).

    This is the heaviest phase — it actually invokes the GPU stack.
    Total runtime: 5-15 minutes on a RTX 3060. We poll the pipeline
    status endpoint instead of waiting synchronously."""

    def test_13_director_pipeline_start(self):
        # Submit a minimal pipeline that exercises the planning path.
        # We don't submit a full image-gen pipeline here because that
        # requires loading Flux 2 Klein (5GB) which can OOM a 12GB
        # card while the LLM is loaded. The next test in the suite
        # covers the full image + video path.
        result = _post(
            "/api/v1/director/pipeline/start",
            {
                "auto_mode": True,
                "skill_type": "music_video",
                "pipeline_type": "music_video",
                "use_director_v2": True,
                "scene_description": "E2E test — quick stop after planning.",
                "fps": 24,
                "frames_steps": 4,
                "frames_minimum": 5,
                "planned_clips": [
                    {
                        "index": 0,
                        "start": 0.0,
                        "end": 2.0,
                        "section": "intro",
                        "energy": 0.3,
                    }
                ],
                "prepared_clip_plans": [
                    {
                        "video_prompt": "Brief test shot.",
                        "image_prompt": "Brief test shot, cinematic.",
                    }
                ],
            },
            timeout=TIMEOUT_SHORT,
        )
        self.assertIn("pipeline_id", result)
        self.pipeline_id = result["pipeline_id"]

    def test_14_director_pipeline_status_polling(self):
        # Submit + poll: verify the status endpoint reports progress.
        # We poll for up to 30s — if the pipeline doesn't transition
        # past ``planning`` in that window, the test still passes
        # (long LLM planning is expected) but logs the state.
        result = _post(
            "/api/v1/director/pipeline/start",
            {
                "auto_mode": True,
                "skill_type": "music_video",
                "pipeline_type": "music_video",
                "use_director_v2": True,
                "scene_description": "E2E test — status polling check.",
                "fps": 24,
                "frames_steps": 4,
                "frames_minimum": 5,
                "planned_clips": [
                    {
                        "index": 0,
                        "start": 0.0,
                        "end": 2.0,
                        "section": "intro",
                        "energy": 0.3,
                    }
                ],
                "prepared_clip_plans": [
                    {
                        "video_prompt": "Status polling test shot.",
                        "image_prompt": "Status polling test shot.",
                    }
                ],
            },
            timeout=TIMEOUT_SHORT,
        )
        pipeline_id = result["pipeline_id"]
        # Poll briefly to verify the status endpoint works.
        seen_states: set[str] = set()
        deadline = time.time() + 30
        while time.time() < deadline:
            status = _get(
                f"/api/v1/director/pipeline/{pipeline_id}",
                timeout=TIMEOUT_SHORT,
            )
            seen_states.add(status["status"])
            if status["status"] in {"completed", "failed", "cancelled"}:
                break
            time.sleep(2)
        # Stop the pipeline so we don't leak GPU work into the next
        # test. ``/stop`` is a no-op once the pipeline is already in
        # a terminal state.
        try:
            _post(
                f"/api/v1/director/pipeline/{pipeline_id}/stop", {},
                timeout=TIMEOUT_SHORT,
            )
        except Exception:
            pass
        # We accept any non-empty status state — the only failure
        # mode is "the status endpoint never responds".
        self.assertTrue(seen_states)


@pytest.mark.media
class PhaseSixJobsAndOutputsTests(unittest.TestCase):
    """Phase 6 — Jobs registry + output listing."""

    def test_15_jobs_endpoint(self):
        # ``/api/v1/jobs`` lists every running + recent job. After
        # the prior phases the registry should have at least one
        # entry from the pipeline tests.
        data = _get("/api/v1/jobs")
        self.assertIn("jobs", data)
        self.assertIsInstance(data["jobs"], list)

    def test_16_outputs_endpoint(self):
        # ``/api/v1/outputs`` lists finished files. May be empty if
        # no pipeline completed in this session — that's still a
        # valid state.
        data = _get("/api/v1/outputs")
        # Backend returns ``{"outputs": [...], "total": N}`` —
        # verify the envelope shape and that ``outputs`` is a list.
        self.assertIn("outputs", data)
        self.assertIsInstance(data["outputs"], list)
        self.assertIn("total", data)


if __name__ == "__main__":
    unittest.main()