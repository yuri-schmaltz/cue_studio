"""Real process termination/restart checks, independent of GPU inference.

The child commits using ProductionStore and reports readiness over stdout.
The parent kills it only after that handshake, then a fresh process queries
and classifies the persisted job. This covers process boundaries, not just
reading a pre-seeded state in the same process.
"""
from pathlib import Path
import json
import os
import selectors
import subprocess
import sys

ROOT = next(p for p in Path(__file__).resolve().parents if (p / "pyproject.toml").is_file())

WORKER = r'''
import sys
from pathlib import Path
from app.services.production_store import ProductionStore
root = Path(sys.argv[1])
store = ProductionStore(str(root / "production.sqlite3"))
store.upsert_pipeline({
    "pipeline_id": "recovery-process",
    "status": "running",
    "attempt": 1,
    "stages": [],
    "output_files": [],
    "created_at": "2026-10-19T00:00:00Z",
    "updated_at": "2026-10-19T00:00:00Z",
})
(root / "recovery-process.partial").write_bytes(b"incomplete output")
print("committed", flush=True)
sys.stdin.readline()
'''

READER = r'''
import sys, json
from pathlib import Path
from app.services.production_store import ProductionStore
from app.services.job_classifier import classify, QueueResumeService
root = Path(sys.argv[1])
store = ProductionStore(str(root / "production.sqlite3"))
state = classify("recovery-process", store, root)
with store.connect() as conn:
    runs = conn.execute("SELECT COUNT(*) FROM runs").fetchone()[0]
    integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
print(json.dumps({"state": state.to_dict(), "runs": runs, "integrity": integrity}))
'''


def test_committed_job_survives_killed_writer_and_repeated_restart(tmp_path):
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
    worker = subprocess.Popen(
        [sys.executable, "-u", "-c", WORKER, str(tmp_path)],
        cwd=ROOT, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, text=True,
    )
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(worker.stdout, selectors.EVENT_READ)
            assert selector.select(timeout=20), "worker never committed the checkpoint"
        assert worker.stdout.readline().strip() == "committed"
        worker.kill()
        worker.wait(timeout=10)
        assert worker.returncode < 0
        observations = []
        for _ in range(2):
            result = subprocess.run(
                [sys.executable, "-c", READER, str(tmp_path)],
                cwd=ROOT, env=env, capture_output=True, text=True,
                check=True, timeout=20,
            )
            observations.append(json.loads(result.stdout))
        for observed in observations:
            assert observed["integrity"] == "ok"
            assert observed["runs"] == 1
            assert observed["state"]["status"] == "interrupted"
            assert observed["state"]["can_resume"] is True
            assert observed["state"]["media_path"] is None
        assert (tmp_path / "recovery-process.partial").read_bytes() == b"incomplete output"
    finally:
        if worker.poll() is None:
            worker.kill()
        worker.communicate(timeout=10)
