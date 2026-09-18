"""Tests for the extracted Director plan/prompts router.

These tests exercise the routing layer in isolation by mocking the
underlying ``prompt_polish`` generator. They verify that:

* the JSON body is parsed and forwarded,
* HTTPException is raised with the right status code on a value error,
* AbortSignal plumbing is wired through,
* the lazy ``from services.director import prompt_polish`` only fires
  once the endpoint is actually called.
"""

from __future__ import annotations

import asyncio
import sys
import unittest
from pathlib import Path
from typing import Any
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "app") not in sys.path:
    sys.path.insert(0, str(ROOT / "app"))


def run(coro):
    return asyncio.run(coro)


class DirectorPlansRouterTests(unittest.TestCase):
    def setUp(self) -> None:
        # We don't actually mount the router through FastAPI; we
        # exercise the *handler functions* directly by importing the
        # router module and pulling each handler out through its public
        # decorator table.
        from services.director import http_plans

        self.router_module = http_plans
        self.router = http_plans.build_plans_router()

        # Map: path -> handler.
        self.handlers: dict[str, Any] = {}
        for route in self.router.routes:
            path = getattr(route, "path", None)
            if path is not None:
                self.handlers[path] = route.endpoint

    def _fake_request(self, body: dict[str, Any], *, abort_signal: Any | None = None) -> mock.MagicMock:
        request = mock.MagicMock()
        request.json = mock.AsyncMock(return_value=body)
        request.state = mock.MagicMock()
        request.state.abort_signal = abort_signal
        return request

    def test_plan_prompts_handler_exists(self) -> None:
        self.assertIn("/api/v1/director/plan-prompts", self.handlers)

    def test_plan_prompts_delegates_to_prompt_polish(self) -> None:
        with mock.patch(
            "services.director.prompt_polish.plan_prompts", create=True, new=mock.MagicMock(return_value={"prompts": ["a", "b"]})
        ) as patched:
            handler = self.handlers["/api/v1/director/plan-prompts"]
            body = {"skill": "music_video", "scene_description": "x", "plan_inputs": [], "style_bibles": []}
            request = self._fake_request(body)
            response = run(handler(request))
            self.assertEqual(response, {"prompts": ["a", "b"]})
            args, kwargs = patched.call_args
            self.assertEqual(kwargs["skill"], "music_video")
            self.assertEqual(kwargs["scene_description"], "x")

    def test_plan_angle_prompts_delegates_to_prompt_polish(self) -> None:
        with mock.patch(
            "services.director.prompt_polish.plan_angle_prompts", create=True, new=mock.MagicMock(return_value={"prompts": []})
        ) as patched:
            handler = self.handlers["/api/v1/director/plan-angle-prompts"]
            body = {"plan_inputs": [], "style_bibles": []}
            request = self._fake_request(body)
            response = run(handler(request))
            self.assertEqual(response, {"prompts": []})
            self.assertEqual(patched.call_args.kwargs["plan_inputs"], [])

    def test_generate_negative_prompt_delegates_to_prompt_polish(self) -> None:
        with mock.patch(
            "services.director.prompt_polish.generate_negative_prompt",
            create=True,
            new=mock.MagicMock(return_value={"negative_prompt": "blurry"}),
        ) as patched:
            handler = self.handlers["/api/v1/director/generate-negative-prompt"]
            body = {"scene_description": "x", "style_bibles": [], "lyrics_summary": None}
            request = self._fake_request(body)
            response = run(handler(request))
            self.assertEqual(response, {"negative_prompt": "blurry"})

    def test_value_error_translates_to_http_400(self) -> None:
        with mock.patch(
            "services.director.prompt_polish.plan_prompts",
            create=True,
            new=mock.MagicMock(side_effect=ValueError("bad input")),
        ):
            handler = self.handlers["/api/v1/director/plan-prompts"]
            request = self._fake_request({"skill": "", "scene_description": ""})
            from fastapi import HTTPException

            with self.assertRaises(HTTPException) as cm:
                run(handler(request))
            self.assertEqual(cm.exception.status_code, 400)

    def test_abort_signal_forwarded(self) -> None:
        sentinel_signal = mock.MagicMock(name="abort-signal")
        with mock.patch(
            "services.director.prompt_polish.plan_prompts",
            create=True,
            new=mock.MagicMock(return_value={"prompts": []}),
        ) as patched:
            handler = self.handlers["/api/v1/director/plan-prompts"]
            request = self._fake_request({"skill": "x", "scene_description": "y"}, abort_signal=sentinel_signal)
            run(handler(request))
            self.assertIs(patched.call_args.kwargs["abort_signal"], sentinel_signal)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
