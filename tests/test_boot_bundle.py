"""Tests for the boot-bundle aggregator."""

from __future__ import annotations

import asyncio
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "app") not in sys.path:
    sys.path.insert(0, str(ROOT / "app"))

from services import boot_bundle  # noqa: E402


def run(coro):
    """Run the coroutine to completion using the new asyncio.run API.

    Python 3.14's deprecations around ``get_event_loop`` make the
    pre-3.10 helper flaky, so we standardise on ``asyncio.run`` here.
    """

    return asyncio.run(coro)


class BootBundleTests(unittest.TestCase):
    def test_empty_sources_returns_warning(self) -> None:
        service = boot_bundle.BootBundleService(sources={})
        result = run(service.collect())
        self.assertEqual(len(result["warnings"]), 1)
        self.assertIn("without any sources", result["warnings"][0])

    def test_parallel_fanout_collects_every_source(self) -> None:
        async def make(value, delay):
            await asyncio.sleep(delay)
            return value

        service = boot_bundle.BootBundleService(
            sources={
                "models": boot_bundle.source_from_callable(lambda: make({"items": []}, 0.05)),
                "workspaces": boot_bundle.source_from_callable(lambda: make(["alpha"], 0.10)),
            }
        )
        result = run(service.collect())
        self.assertEqual(result["models"], {"items": []})
        self.assertEqual(result["workspaces"], ["alpha"])
        # Parallel: total elapsed must be less than the sum of the
        # individual delays (50ms + 100ms = 150ms). Anything less than
        # 130ms proves they really did run concurrently.
        self.assertLess(result["elapsed_ms"], 130)
        self.assertEqual(result["warnings"], [])

    def test_source_failure_recorded_as_warning(self) -> None:
        async def failing():
            raise RuntimeError("downstream failure")

        service = boot_bundle.BootBundleService(
            sources={
                "good": boot_bundle.source_from_callable(lambda: {"ok": 1}),
                "broken": boot_bundle.source_from_callable(failing),
            }
        )
        result = run(service.collect())
        self.assertEqual(result["good"], {"ok": 1})
        self.assertIsNone(result["broken"])
        self.assertEqual(len(result["warnings"]), 1)
        self.assertEqual(result["warnings"][0]["key"], "broken")
        self.assertIn("downstream failure", result["warnings"][0]["error"])

    def test_timeout_flagged_separately(self) -> None:
        async def slow():
            await asyncio.sleep(2.0)
            return {"should": "never"}

        service = boot_bundle.BootBundleService(
            sources={"slow": boot_bundle.source_from_callable(slow)},
            timeout=0.05,
        )
        result = run(service.collect())
        self.assertIsNone(result["slow"])
        self.assertEqual(result["warnings"][0]["error"], "timeout")

    def test_source_from_callable_supports_sync(self) -> None:
        service = boot_bundle.BootBundleService(
            sources={
                "sync_value": boot_bundle.source_from_callable(lambda: "hello"),
            }
        )
        result = run(service.collect())
        self.assertEqual(result["sync_value"], "hello")

    def test_source_from_callable_supports_async_factory(self) -> None:
        async def async_factory():
            return {"async": True}

        service = boot_bundle.BootBundleService(
            sources={
                "async_value": boot_bundle.source_from_callable(async_factory),
            }
        )
        result = run(service.collect())
        self.assertEqual(result["async_value"], {"async": True})


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
