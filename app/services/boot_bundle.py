"""Batched boot-bundle endpoint logic.

Why this exists
---------------
Cue Studio's frontend boot path (``App.tsx`` useEffect on mount) fans
out to eight independent endpoints:

* ``GET /api/v1/models``
* ``GET /api/v1/workspaces``
* ``GET /api/v1/outputs``
* ``GET /api/v1/system-config``
* ``GET /api/v1/services-config``
* ``GET /api/v1/llm/status``
* ``GET /api/v1/llm/models``
* ``GET /api/v1/director/pipelines``
* ``GET /api/v1/studio-preferences``

In a typical LAN each request is 5-50 ms; serialised, that's ~400 ms
just for cold-boot hydration. In WAN-shared environments or behind a
TLS proxy it can easily balloon past two seconds. The eight requests
also do not depend on each other so the latency floor is the sum.

This module provides :class:`BootBundleService` that fans the calls
out **in parallel** on the server side and returns one combined JSON
blob in a single HTTP response. The frontend can swap its eight
``useEffect`` triggers for a single ``fetchBootBundle()`` call without
giving up any of the existing endpoints — the older routes still exist
and stay useful for partial refreshes.

Failure handling
----------------
If a sub-fetch raises, the boot bundle still returns a partial
response with the failed key set to ``null`` and a ``warnings`` array
that lists each failed source. The frontend can decide whether a
degraded response is acceptable (e.g. the optional LLM status section)
or whether to surface an error toast.
"""

from __future__ import annotations

import asyncio
import inspect
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Mapping


log = logging.getLogger("cue_studio.boot_bundle")


# Default source map: each entry is a callable that takes no arguments
# and returns the same shape the corresponding REST endpoint would
# return. The boot bundle merges them under the same key.
#
# The route layer (``launch.py``) wires concrete fetcher closures
# into this map; the dataclass below only knows the contract.
Fetcher = Callable[[], Awaitable[Any]]


@dataclass
class BootBundleService:
    """Aggregates the boot-time fetches into a single response.

    The default source list matches what the frontend's ``App.tsx``
    useEffect fans out today; the constructor accepts an override so
    tests can inject deterministic fakes.
    """

    sources: Mapping[str, Fetcher] = field(default_factory=dict)
    timeout: float = 30.0  # seconds — per-request cap

    async def collect(self) -> dict[str, Any]:
        """Run all sources in parallel and return a merged dict.

        Each top-level key is preserved exactly as the source
        contributed it (no transformation), so the existing frontend
        code can plug the bundle straight into the per-slice setters.

        On sub-fetch failure the corresponding key is replaced by
        ``None`` and a warning is appended to the ``warnings`` list.
        """

        if not self.sources:
            return {"warnings": ["boot bundle invoked without any sources registered"]}

        started = time.monotonic()
        tasks = {
            key: asyncio.create_task(self._guarded_fetch(key, fetcher))
            for key, fetcher in self.sources.items()
        }

        results: dict[str, Any] = {}
        warnings: list[dict[str, Any]] = []

        for key, task in tasks.items():
            try:
                results[key] = await asyncio.wait_for(task, timeout=self.timeout)
            except asyncio.TimeoutError:
                warnings.append({"key": key, "error": "timeout"})
                results[key] = None
            except Exception as exc:  # noqa: BLE001 — surface any sub-failure
                warnings.append({"key": key, "error": str(exc), "type": type(exc).__name__})
                results[key] = None

        results["warnings"] = warnings
        results["elapsed_ms"] = int((time.monotonic() - started) * 1000)
        log.info(
            "[boot-bundle] served in %dms with %d/%d sources ok",
            results["elapsed_ms"],
            sum(1 for k in self.sources if results.get(k) is not None),
            len(self.sources),
        )
        return results

    async def _guarded_fetch(self, key: str, fetcher: Fetcher) -> Any:
        """Wrap the user-supplied fetcher in a uniform exception envelope."""

        try:
            return await fetcher()
        except Exception as exc:  # noqa: BLE001
            log.warning("[boot-bundle] source %s failed: %s", key, exc)
            raise


def source_from_callable(factory: Callable[[], Any]) -> Fetcher:
    """Adapt a synchronous or async callable into a :class:`Fetcher`.

    Lets the route layer register a function that returns a coroutine
    (FastAPI dependency) without wrapping every call site by hand.
    """

    if inspect.iscoroutinefunction(factory):
        async def _async() -> Any:
            return await factory()
        return _async

    async def _sync() -> Any:
        result = factory()
        if inspect.isawaitable(result):
            return await result
        return result
    return _sync


__all__ = ["BootBundleService", "Fetcher", "source_from_callable"]
