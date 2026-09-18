"""Tests for the unified SQLite application-state database."""

from __future__ import annotations

import sys
import tempfile
import threading
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "app") not in sys.path:
    sys.path.insert(0, str(ROOT / "app"))

from services import app_state_db  # noqa: E402


class AppStateDBTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.db = app_state_db.AppStateDB(Path(self.tmp.name) / "state.sqlite3")

    def test_schema_version_after_init(self) -> None:
        self.assertGreaterEqual(self.db.schema_version(), 1)

    def test_kv_set_and_get_roundtrip(self) -> None:
        self.db.kv_set("ui:theme", "golden-hour")
        self.assertEqual(self.db.kv_get("ui:theme"), "golden-hour")

    def test_kv_complex_payload_roundtrip(self) -> None:
        payload = {"nested": {"a": 1, "b": [2, 3, 4]}, "γ": True}
        self.db.kv_set("config", payload)
        self.assertEqual(self.db.kv_get("config"), payload)

    def test_kv_missing_returns_default(self) -> None:
        self.assertIsNone(self.db.kv_get("missing"))
        self.assertEqual(self.db.kv_get("missing", "fallback"), "fallback")

    def test_kv_delete(self) -> None:
        self.db.kv_set("tmp", "value")
        self.assertTrue(self.db.kv_delete("tmp"))
        self.assertFalse(self.db.kv_delete("tmp"))

    def test_workspace_crud(self) -> None:
        self.db.upsert_workspace("alpha", "/tmp/alpha")
        self.db.upsert_workspace("beta", "/tmp/beta", pinned=True)

        names = [w["name"] for w in self.db.list_workspaces()]
        self.assertIn("alpha", names)
        self.assertIn("beta", names)

        beta = next(w for w in self.db.list_workspaces() if w["name"] == "beta")
        self.assertTrue(beta["pinned"])

        self.db.upsert_workspace("alpha", "/tmp/alpha2")  # update path
        alpha = next(w for w in self.db.list_workspaces() if w["name"] == "alpha")
        self.assertEqual(alpha["path"], "/tmp/alpha2")

        self.assertTrue(self.db.delete_workspace("alpha"))
        self.assertFalse(self.db.delete_workspace("alpha"))

    def test_director_queue_round_trip(self) -> None:
        self.db.upsert_director_entry(
            pipeline_id="pipe-1",
            status="running",
            payload={"skill": "music_video", "clips": 12},
        )
        self.db.upsert_director_entry(
            pipeline_id="pipe-2",
            status="queued",
            payload={"skill": "short_film"},
        )

        entries = self.db.list_director_queue()
        self.assertEqual(len(entries), 2)
        by_id = {e["pipeline_id"]: e for e in entries}
        self.assertEqual(by_id["pipe-1"]["payload"]["clips"], 12)
        self.assertEqual(by_id["pipe-2"]["status"], "queued")

        # Update in place — re-fetch so we get the post-update values.
        self.db.upsert_director_entry(
            pipeline_id="pipe-2",
            status="completed",
            payload={"skill": "short_film"},
        )
        entries = self.db.list_director_queue()
        self.assertEqual(len(entries), 2)
        by_id = {e["pipeline_id"]: e for e in entries}
        self.assertEqual(by_id["pipe-2"]["status"], "completed")

        self.assertTrue(self.db.remove_director_entry("pipe-1"))
        self.assertEqual(len(self.db.list_director_queue()), 1)

    def test_history_append_and_list(self) -> None:
        ids = []
        for i in range(3):
            ids.append(self.db.append_history("director.plan", {"i": i}))
        for i in range(2):
            ids.append(self.db.append_history("studio.generate", {"i": i}))

        self.assertEqual(len(set(ids)), 5)

        director_events = self.db.list_history(kind="director.plan")
        self.assertEqual(len(director_events), 3)
        for entry in director_events:
            self.assertEqual(entry["kind"], "director.plan")

        recent = self.db.list_history(limit=10)
        self.assertEqual(len(recent), 5)
        # Newest first
        self.assertEqual(recent[0]["kind"], "studio.generate")

    def test_concurrent_writes_dont_corrupt(self) -> None:
        def writer(prefix: str, count: int) -> None:
            for i in range(count):
                self.db.kv_set(f"{prefix}-{i}", {"i": i, "payload": "x" * 32})

        threads = [
            threading.Thread(target=writer, args=(f"thread-{tid}", 25))
            for tid in range(4)
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        # All 4 * 25 keys should be present.
        for tid in range(4):
            for i in range(25):
                key = f"thread-{tid}-{i}"
                # Some keys may have been overwritten in the same slot if
                # the test class is reused; but with unique prefixes this
                # cannot happen here.
                self.assertEqual(self.db.kv_get(key), {"i": i, "payload": "x" * 32})

    def test_stats_reflects_state(self) -> None:
        self.db.kv_set("alpha", 1)
        self.db.kv_set("beta", 2)
        self.db.upsert_workspace("ws1", "/tmp/ws1")
        self.db.upsert_director_entry(pipeline_id="p1", status="queued", payload={})
        self.db.append_history("test", {"k": 1})

        stats = self.db.stats()
        self.assertEqual(stats["kv_count"], 2)
        self.assertEqual(stats["workspaces_count"], 1)
        self.assertEqual(stats["director_queue_count"], 1)
        self.assertEqual(stats["history_count"], 1)


class AppStateDBSingletonTests(unittest.TestCase):
    def test_singleton_returns_same_instance(self) -> None:
        app_state_db.reset_app_state_db_singleton()
        a = app_state_db.get_app_state_db()
        b = app_state_db.get_app_state_db()
        self.assertIs(a, b)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
