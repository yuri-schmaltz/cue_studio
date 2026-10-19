"""F3 lifecycle and retake behavior with controlled CPU generation.

Process crash/restart: test_recovery_process.py.
Atomic media publication: test_media_publication.py.
Removed input before inference: test_director_input_recovery.py.
These tests validate recovery mechanics, not real-model artistic acceptance.
"""
from __future__ import annotations

import threading
from pathlib import Path
import subprocess

from app.services.job_lifecycle import finish_job, request_cancel, try_start
from app.services.production_store import ProductionStore
from app.services.production_resume import ProductionResume
from app.services.media_publication import publish_video


def test_late_completion_cannot_overwrite_cancellation():
    job = {'id': 'late-worker', 'status': 'queued'}
    ready, finish = threading.Event(), threading.Event()
    results = []
    def worker():
        assert try_start(job)
        ready.set()
        if finish.wait(timeout=10):
            results.append(finish_job(job, 'completed', output_files=['late.mp4']))
    thread = threading.Thread(target=worker)
    thread.start()
    try:
        assert ready.wait(timeout=10)
        assert request_cancel(job).changed
        finish.set()
        thread.join(timeout=10)
        assert not thread.is_alive()
        assert results == [False]
        assert job['status'] == 'cancelled'
        assert 'output_files' not in job
    finally:
        finish.set()
        thread.join(timeout=10)


def test_retake_key_survives_reopening_store_without_duplicate_encode(tmp_path: Path):
    db = tmp_path / 'recovery.sqlite3'
    store = ProductionStore(db_path=str(db))
    store.upsert_pipeline({
        'pipeline_id': 'pipe-recovery', 'status': 'running', 'attempt': 1,
        'stages': [{'name': 'video', 'ok': True}],
        'created_at': '2026-10-19T00:00:00Z', 'updated_at': '2026-10-19T00:00:00Z',
    })
    calls = []
    master = tmp_path / 'master.mp4'
    def executor(pipeline_id, out_dir, stage_name):
        calls.append((pipeline_id, stage_name))
        def encode(path):
            subprocess.run(['ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i',
                            'color=s=160x96:r=24:d=0.25', '-c:v', 'libx264', path], check=True)
            return True
        assert publish_video(master, encode)
        return True, 'encoded'
    facade = ProductionResume(store=store, pipeline_resume=executor)
    first = facade.retake_stage(pipeline_id='pipe-recovery', out_dir=str(tmp_path),
                               stage_name='video', idempotency_key='same-retake')
    original = master.read_bytes()
    reopened = ProductionResume(store=ProductionStore(db_path=str(db)), pipeline_resume=executor)
    second = reopened.retake_stage(pipeline_id='pipe-recovery', out_dir=str(tmp_path),
                                  stage_name='video', idempotency_key='same-retake')
    assert first.ok and second.ok
    assert first.attempt == second.attempt == 2
    assert calls == [('pipe-recovery', 'video')]
    assert master.read_bytes() == original
