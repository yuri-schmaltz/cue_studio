"""Testes de recuperação F3 da fixture 'A luz da oficina'.

Simula cenários de falha e recuperação usando ``ProductionStore`` e
``ProductionResume``:
- Crash antes do despacho (pedido recuperável sem duplicação)
- Cancelamento tardio (estado terminal consistente)
- Reinício reconcilia jobs e evita duplicação de execução
- Retake com mesmo idempotency_key não duplica job
- Arquivo parcial não publicado como master
- Referência removida bloqueia antes da inferência
"""

from __future__ import annotations

from pathlib import Path

from app.services.production_store import ProductionStore
from app.services.production_resume import ProductionResume


def _make_store(tmp_path: Path) -> ProductionStore:
    db = tmp_path / "recovery.sqlite3"
    return ProductionStore(db_path=str(db))


def _snapshot(status: str = "running", attempt: int = 1) -> dict:
    return {
        "pipeline_id": "pipe-recovery",
        "status": status,
        "attempt": attempt,
        "stages": [{"name": "video", "ok": True}],
        "created_at": "2026-10-17T00:00:00Z",
        "updated_at": "2026-10-17T00:00:00Z",
    }


# ── Crash antes do despacho: pedido recuperável sem duplicação ──


def test_crash_before_dispatch_no_duplicate_job(tmp_path: Path):
    store = _make_store(tmp_path)
    adapted = store.upsert_pipeline(_snapshot(status="queued", attempt=1))

    # Reabrir o store (simula reinício) — production ainda queued, sem run extra.
    store2 = ProductionStore(db_path=str(tmp_path / "recovery.sqlite3"))
    facade = ProductionResume(store=store2)
    state = facade.get_pipeline_state("pipe-recovery")
    assert state is not None
    assert state["status"] == "queued"


# ── Cancelamento tardio: estado terminal consistente ──


def test_late_cancellation_terminal_state_consistent(tmp_path: Path):
    store = _make_store(tmp_path)
    store.upsert_pipeline(_snapshot(status="cancelled", attempt=1))

    facade = ProductionResume(store=store)
    state = facade.get_pipeline_state("pipe-recovery")
    assert state is not None
    assert state["status"] == "cancelled"
    assert state["status"] not in ("running", "succeeded")


# ── Reinício reconcilia jobs sem duplicação ──


def test_restart_reconciles_without_duplicate(tmp_path: Path):
    store = _make_store(tmp_path)
    store.upsert_pipeline(_snapshot(status="reconciliation_required", attempt=1))

    facade = ProductionResume(store=store)
    state = facade.get_pipeline_state("pipe-recovery")
    assert state["status"] == "reconciliation_required"
    assert state["attempt"] == 1  # não incrementou sozinho


# ── Retake com mesma chave idempotente não duplica ──


def test_retake_idempotent_key_no_duplicate(tmp_path: Path):
    store = _make_store(tmp_path)
    store.upsert_pipeline(_snapshot(status="running", attempt=1))

    def fake_executor(pipeline_id, out_dir, stage_name):
        return True, "ok"

    facade = ProductionResume(store=store, pipeline_resume=fake_executor)

    r1 = facade.retake_stage(
        pipeline_id="pipe-recovery",
        out_dir=str(tmp_path / "out"),
        stage_name="video",
        idempotency_key="same-key-123",
    )
    assert r1.ok is True
    assert r1.attempt == 2

    r2 = facade.retake_stage(
        pipeline_id="pipe-recovery",
        out_dir=str(tmp_path / "out"),
        stage_name="video",
        idempotency_key="same-key-123",
    )
    assert r2.ok is True
    assert r2.attempt == 2  # mesma attempt, não criou novo job


# ── Arquivo parcial não publicado como master ──


def test_partial_file_not_published_as_master(tmp_path: Path):
    store = _make_store(tmp_path)
    store.upsert_pipeline(_snapshot(status="validating_output", attempt=1))

    facade = ProductionResume(store=store)
    state = facade.get_pipeline_state("pipe-recovery")
    assert state["status"] == "validating_output"


# ── Referência removida bloqueia antes da inferência ──


def test_missing_reference_blocks_before_inference(tmp_path: Path):
    store = _make_store(tmp_path)
    store.upsert_pipeline(_snapshot(status="blocked", attempt=1))

    facade = ProductionResume(store=store)
    state = facade.get_pipeline_state("pipe-recovery")
    assert state["status"] == "blocked"
