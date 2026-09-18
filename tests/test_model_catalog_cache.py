"""Tests for the SQLite-backed model catalogue cache."""

from __future__ import annotations

import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "app") not in sys.path:
    sys.path.insert(0, str(ROOT / "app"))

from services import model_catalog_cache  # noqa: E402


class ModelCatalogCacheTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.cache = model_catalog_cache.ModelCatalogCache(
            db_path=Path(self.tmpdir.name) / "cache.sqlite3",
            ttl_map={"models": 60, "tiny": 0},  # tiny forces immediate expiry
        )

    def test_first_call_invokes_fetcher_and_misses(self) -> None:
        calls = {"count": 0}

        def fetcher():
            calls["count"] += 1
            return {"items": [1, 2, 3]}

        payload, hit = self.cache.get_fresh("models", fetcher)
        self.assertEqual(payload, {"items": [1, 2, 3]})
        self.assertFalse(hit)
        self.assertEqual(calls["count"], 1)

    def test_second_call_within_ttl_hits(self) -> None:
        calls = {"count": 0}

        def fetcher():
            calls["count"] += 1
            return {"items": []}

        self.cache.get_fresh("models", fetcher)
        payload, hit = self.cache.get_fresh("models", fetcher)
        self.assertTrue(hit)
        self.assertEqual(calls["count"], 1)
        self.assertEqual(payload, {"items": []})

    def test_expiry_triggers_refresh(self) -> None:
        calls = {"count": 0}

        def fetcher():
            calls["count"] += 1
            return {"items": [calls["count"]]}

        self.cache.get_fresh("tiny", fetcher)  # ttl=0 so the entry is already expired
        payload, hit = self.cache.get_fresh("tiny", fetcher)
        self.assertFalse(hit)
        self.assertEqual(payload, {"items": [2]})

    def test_force_refresh(self) -> None:
        calls = {"count": 0}

        def fetcher():
            calls["count"] += 1
            return {"v": calls["count"]}

        self.cache.get_fresh("models", fetcher)
        payload, hit = self.cache.get_fresh("models", fetcher, force=True)
        self.assertFalse(hit)
        self.assertEqual(payload, {"v": 2})

    def test_invalidate_specific_key(self) -> None:
        self.cache.get_fresh("models", lambda: {"x": 1})
        removed = self.cache.invalidate("models")
        self.assertEqual(removed, 1)
        payload, hit = self.cache.get_fresh("models", lambda: {"x": 2})
        self.assertFalse(hit)
        self.assertEqual(payload, {"x": 2})

    def test_invalidate_all(self) -> None:
        self.cache.get_fresh("models", lambda: {"x": 1})
        self.cache.get_fresh("loras_installed", lambda: {"y": 1})
        removed = self.cache.invalidate()
        self.assertEqual(removed, 2)

    def test_fetcher_exception_returns_stale_value(self) -> None:
        self.cache.get_fresh("models", lambda: {"x": 1})
        def boom():
            raise RuntimeError("downstream failed")
        payload, hit = self.cache.get_fresh("models", boom)
        self.assertTrue(hit)
        self.assertEqual(payload, {"x": 1})

    def test_fetcher_exception_no_cache_raises(self) -> None:
        def boom():
            raise RuntimeError("downstream failed")
        with self.assertRaises(RuntimeError):
            self.cache.get_fresh("models", boom)

    def test_concurrent_writes_are_serialised(self) -> None:
        # Two threads racing on the same key; neither must corrupt the
        # cache. Final value is one of the two payloads.
        a_called = threading.Event()

        def fetcher_a():
            a_called.set()
            time.sleep(0.05)
            return {"src": "A"}

        def fetcher_b():
            # Wait until A started so they race.
            a_called.wait(1.0)
            return {"src": "B"}

        results: list[tuple[dict, bool]] = []
        errors: list[Exception] = []

        def runner(fetcher):
            try:
                results.append(self.cache.get_fresh("models", fetcher, force=True))
            except Exception as exc:  # pragma: no cover - assertion below
                errors.append(exc)

        threads = [
            threading.Thread(target=runner, args=(fetcher_a,)),
            threading.Thread(target=runner, args=(fetcher_b,)),
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        self.assertEqual(errors, [])
        self.assertEqual(len(results), 2)
        for payload, hit in results:
            self.assertIn(payload["src"], {"A", "B"})
            self.assertFalse(hit)

    def test_stats_lists_entries(self) -> None:
        self.cache.get_fresh("models", lambda: {"x": 1})
        stats = self.cache.stats()
        keys = [entry["key"] for entry in stats["entries"]]
        self.assertIn("models", keys)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
