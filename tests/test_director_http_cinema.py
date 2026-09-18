"""Tests for the Director cinema router."""

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


def _fake_request(body: dict[str, Any]) -> mock.MagicMock:
    request = mock.MagicMock()
    request.json = mock.AsyncMock(return_value=body)
    request.headers = mock.MagicMock()
    request.headers.get = mock.MagicMock(return_value="application/json")
    return request


class _Hit:
    def __init__(self, rule_id: str, severity: Any, message: str, field: str, suggestion: str) -> None:
        self.rule_id = rule_id
        self.severity = severity
        self.message = message
        self.field = field
        self.suggestion = suggestion


class _Era:
    def __init__(self, era: Any) -> None:
        self.era = era


class _Result:
    def __init__(self, warnings: list[str], hits: list[Any]) -> None:
        self.warnings = warnings
        self.hits = hits


class _EnumStub:
    """Plain object with a ``value`` attr — passes neither Severity
    isinstance check nor enum membership."""

    def __init__(self, value: str) -> None:
        self.value = value


class DirectorCinemaRouterTests(unittest.TestCase):
    def setUp(self) -> None:
        from services.director import http_cinema

        self.module = http_cinema
        self.router = http_cinema.build_cinema_router()
        handlers: dict[str, Any] = {}
        for route in self.router.routes:
            path = getattr(route, "path", None)
            if path is not None:
                handlers[path] = route.endpoint
        self.handlers = handlers

    def test_evaluate_handler_exists(self) -> None:
        self.assertIn("/api/v1/director/cinema/evaluate", self.handlers)

    def test_real_enum_severity_is_serialized(self) -> None:
        # When the real Severity enum is in play, the handler must
        # read ``.value`` rather than passing the enum instance.
        from services.director.cinema import Severity as RealSeverity

        fake_result = _Result(
            warnings=[],
            hits=[_Hit("r1", RealSeverity.WARNING, "m", "f", "s")],
        )
        fake_era = _Era(RealSeverity.WARNING)

        with mock.patch(
            "services.director.cinema.evaluate_shot", return_value=fake_result
        ), mock.patch(
            "services.director.cinema.era.detect_era", return_value=fake_era
        ):
            handler = self.handlers["/api/v1/director/cinema/evaluate"]
            request = _fake_request({"props": ["p"]})
            response = run(handler(request))
            self.assertEqual(response["hits"][0]["severity"], "warning")
            self.assertEqual(response["era"], "warning")

    def test_props_must_be_list(self) -> None:
        from fastapi import HTTPException

        handler = self.handlers["/api/v1/director/cinema/evaluate"]
        request = _fake_request({"props": "not a list"})
        with self.assertRaises(HTTPException) as cm:
            run(handler(request))
        self.assertEqual(cm.exception.status_code, 400)

    def test_invalid_json_returns_400(self) -> None:
        from fastapi import HTTPException

        handler = self.handlers["/api/v1/director/cinema/evaluate"]
        request = mock.MagicMock()
        request.json = mock.AsyncMock(side_effect=ValueError("nope"))
        request.headers = mock.MagicMock()
        request.headers.get = mock.MagicMock(return_value="application/json")
        with self.assertRaises(HTTPException) as cm:
            run(handler(request))
        self.assertEqual(cm.exception.status_code, 400)

    def test_non_json_body_returns_empty_dict(self) -> None:
        # When the client forgets to set Content-Type the route accepts
        # the request as empty and runs the evaluator with no props.
        from services.director.cinema import Severity as RealSeverity

        fake_result = _Result(warnings=[], hits=[])
        fake_era = _Era(RealSeverity.WARNING)

        with mock.patch(
            "services.director.cinema.evaluate_shot", return_value=fake_result
        ) as patched, mock.patch(
            "services.director.cinema.era.detect_era", return_value=fake_era
        ):
            handler = self.handlers["/api/v1/director/cinema/evaluate"]
            request = mock.MagicMock()
            request.json = mock.AsyncMock(return_value={})
            request.headers = mock.MagicMock()
            request.headers.get = mock.MagicMock(return_value="")
            response = run(handler(request))
            self.assertEqual(response["hits"], [])
            self.assertEqual(response["era"], "warning")
            # Empty props + empty fields reach the evaluator.
            self.assertEqual(patched.call_args.kwargs["props"], ())


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
