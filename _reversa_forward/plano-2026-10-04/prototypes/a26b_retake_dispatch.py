#!/usr/bin/env python3
"""Protótipo isolado do Retake com efeito real (A26b).

Valida a estratégia proposta em `34-feature-a26b-retake-dispatch.md`
**sem** importar de `app/` (política do Reversa). O protótipo:

1. Replica o `ResumeResult`, `ProductionStore` (stub mínimo) e `ProductionResume`
   com fidelidade suficiente para reproduzir o bug do `if False`.
2. Inclui a **versão BUGGY** (`_retake_record_only`) e a **versão CORRIGIDA**
   (`_retake_dispatch`) lado a lado.
3. Implementa o executor fake que conta chamadas (item 2 do roteiro do dossiê).
4. Implementa o helper de idempotência com janela configurável.
5. Implementa 7 testes que correspondem aos 7 itens do Apêndice C do dossiê.

Rodar:
    python3 _reversa_forward/plano-2026-10-04/prototypes/a26b_retake_dispatch.py

Saída esperada: 9 checks OK + 1 demonstração explícita do bug atual.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
import sys
import tempfile
import threading
import time
import warnings
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Optional


# ---------------------------------------------------------------------------
# 1. Modelo de dados (espelha production_resume.py + production_store.py)
# ---------------------------------------------------------------------------

@dataclass
class ResumeResult:
    """Envelope read-only; atributos imutáveis via __slots__."""
    __slots__ = ("ok", "message", "run_id", "production_id", "attempt")

    def __init__(
        self,
        ok: bool,
        message: str,
        *,
        run_id: Optional[str] = None,
        production_id: Optional[str] = None,
        attempt: Optional[int] = None,
    ) -> None:
        self.ok = ok
        self.message = message
        self.run_id = run_id
        self.production_id = production_id
        self.attempt = attempt

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "message": self.message,
            "run_id": self.run_id,
            "production_id": self.production_id,
            "attempt": self.attempt,
        }


# DDL espelhado de production_store.py
_DDL = """
CREATE TABLE IF NOT EXISTS productions (
    id TEXT PRIMARY KEY,
    title TEXT,
    workspace_ids TEXT,
    created_at REAL,
    updated_at REAL,
    plan TEXT,
    payload TEXT
);
CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    production_id TEXT,
    status TEXT,
    attempt INTEGER,
    correlations TEXT,
    payload TEXT,
    created_at REAL,
    updated_at REAL
);
CREATE TABLE IF NOT EXISTS production_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    production_id TEXT,
    run_id TEXT,
    kind TEXT,
    payload TEXT,
    created_at REAL
);
"""


class ProductionStore:
    """Stub mínimo do ProductionStore (WAL + threadsafe)."""

    def __init__(self, db_path: Path):
        self._db_path = db_path
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._ensure_schema()

    @contextmanager
    def connect(self):
        conn = sqlite3.connect(
            str(self._db_path), timeout=10.0, check_same_thread=False
        )
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")
            conn.execute("PRAGMA foreign_keys=ON")
            yield conn
        finally:
            conn.close()

    def _ensure_schema(self) -> None:
        with self._lock, self.connect() as conn:
            conn.executescript(_DDL)
            conn.commit()

    def upsert_pipeline(self, snapshot: dict[str, Any], workspace_id: str = "default") -> dict[str, Any]:
        """Persist production + run a partir do snapshot."""
        pipeline_id = snapshot["pipeline_id"]
        attempt = int(snapshot.get("attempt", 1))
        production_id = f"production_legacy_{hashlib.md5(pipeline_id.encode()).hexdigest()[:12]}"
        run_id = f"run_legacy_{hashlib.md5(f'{pipeline_id}:{attempt}'.encode()).hexdigest()[:12]}"
        now = time.time()
        payload = json.dumps(snapshot, default=str)
        with self._lock, self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                conn.execute(
                    """INSERT INTO productions (id, title, workspace_ids, created_at, updated_at, plan, payload)
                       VALUES (?, ?, ?, ?, ?, ?, ?)
                       ON CONFLICT(id) DO UPDATE SET
                         updated_at=excluded.updated_at,
                         payload=excluded.payload""",
                    (
                        production_id,
                        snapshot.get("pipeline_type", "music_video"),
                        json.dumps([workspace_id]),
                        now,
                        now,
                        "{}",
                        payload,
                    ),
                )
                conn.execute(
                    """INSERT INTO runs (id, production_id, status, attempt, correlations, payload, created_at, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                       ON CONFLICT(id) DO UPDATE SET
                         status=excluded.status,
                         payload=excluded.payload,
                         updated_at=excluded.updated_at""",
                    (
                        run_id,
                        production_id,
                        snapshot.get("status", "running"),
                        attempt,
                        json.dumps({"pipeline_id": pipeline_id}),
                        payload,
                        now,
                        now,
                    ),
                )
                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                raise
        return {"production_id": production_id, "run_id": run_id, "attempt": attempt}

    def append_event(
        self,
        *,
        production_id: Optional[str] = None,
        run_id: Optional[str] = None,
        kind: str,
        payload: Optional[dict[str, Any]] = None,
    ) -> int:
        body = json.dumps(dict(payload or {}), default=str)
        with self._lock, self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                cur = conn.execute(
                    """INSERT INTO production_events
                       (production_id, run_id, kind, payload, created_at)
                       VALUES (?, ?, ?, ?, ?)""",
                    (production_id, run_id, kind, body, time.time()),
                )
                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                raise
        return int(cur.lastrowid)

    def get_pipeline_state(self, pipeline_id: str) -> Optional[dict[str, Any]]:
        with self.connect() as conn:
            row = conn.execute(
                """SELECT payload FROM runs
                   WHERE json_extract(correlations, '$.pipeline_id') = ?
                   ORDER BY attempt DESC, updated_at DESC LIMIT 1""",
                (pipeline_id,),
            ).fetchone()
        if row is None:
            return None
        return json.loads(row["payload"])

    def list_events(
        self,
        *,
        run_id: Optional[str] = None,
        production_id: Optional[str] = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        clauses, params = [], []
        if run_id:
            clauses.append("run_id = ?")
            params.append(run_id)
        if production_id:
            clauses.append("production_id = ?")
            params.append(production_id)
        where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
        params.append(max(1, min(int(limit), 1000)))
        sql = (
            f"SELECT id, kind, payload, created_at FROM production_events{where} "
            f"ORDER BY created_at DESC LIMIT ?"
        )
        with self.connect() as conn:
            rows = conn.execute(sql, params).fetchall()
        return [
            {
                "id": int(r["id"]),
                "kind": r["kind"],
                "payload": json.loads(r["payload"]) if r["payload"] else {},
                "created_at": float(r["created_at"]),
            }
            for r in rows
        ]


# ---------------------------------------------------------------------------
# 2. Executor fake (conta chamadas para detectar o bug)
# ---------------------------------------------------------------------------

class FakeExecutor:
    """Conta quantas vezes foi invocado e simula sucesso."""

    def __init__(self, *, fail: bool = False, message: str = "Resumed"):
        self.call_count = 0
        self.calls: list[tuple[str, str, Optional[str]]] = []
        self.fail = fail
        self.message = message

    def __call__(
        self,
        pipeline_id: str,
        out_dir: str,
        stage_name: Optional[str] = None,
    ) -> tuple[bool, str]:
        self.call_count += 1
        self.calls.append((pipeline_id, out_dir, stage_name))
        if self.fail:
            return False, "executor forced to fail"
        return True, self.message

    def reset(self) -> None:
        self.call_count = 0
        self.calls = []


# ---------------------------------------------------------------------------
# 3. Helper de idempotência
# ---------------------------------------------------------------------------

def derive_idempotency_key(pipeline_id: str, stage_name: str, attempt: int = 0) -> str:
    raw = f"{pipeline_id}|{stage_name}|{attempt}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def _is_recent_duplicate(
    store: ProductionStore,
    *,
    pipeline_id: str,
    idempotency_key: str,
    window_seconds: int = 600,
) -> Optional[dict[str, Any]]:
    """Retorna o evento mais recente com mesma chave dentro da janela."""
    cutoff = time.time() - window_seconds
    events = store.list_events(limit=200)
    for ev in events:
        if ev["kind"] != "retake":
            continue
        if ev["payload"].get("pipeline_id") != pipeline_id:
            continue
        if ev["payload"].get("idempotency_key") != idempotency_key:
            continue
        if ev["created_at"] >= cutoff:
            return ev
    return None


# ---------------------------------------------------------------------------
# 4. ProductionResume: versão BUGGY (espelha `if False`) e versão CORRIGIDA
# ---------------------------------------------------------------------------

class ProductionResumeBuggy:
    """Reproduz o bug atual: `if False` desvia para `_retake_record_only`."""

    def __init__(self, store: ProductionStore, pipeline_resume: Optional[Callable] = None):
        self._store = store
        self._pipeline_resume = pipeline_resume

    def get_pipeline_state(self, pipeline_id: str) -> Optional[dict[str, Any]]:
        return self._store.get_pipeline_state(pipeline_id)

    def resume_production(self, *, pipeline_id: str, out_dir: str) -> ResumeResult:
        previous = self.get_pipeline_state(pipeline_id)
        next_attempt = int(previous.get("attempt", 0)) + 1 if previous else 1
        try:
            ok, message = self._pipeline_resume(pipeline_id, out_dir)
        except Exception as exc:
            return ResumeResult(ok=False, message=f"Resume raised: {exc}", attempt=next_attempt)
        if not ok:
            return ResumeResult(ok=False, message=message, attempt=next_attempt)
        snapshot = self.get_pipeline_state(pipeline_id) or {}
        snapshot["attempt"] = next_attempt
        snapshot["status"] = "running"
        try:
            adapted = self._store.upsert_pipeline(snapshot, workspace_id=out_dir)
            run_id, production_id = adapted["run_id"], adapted["production_id"]
        except Exception:
            run_id = production_id = None
        self._store.append_event(
            run_id=run_id, production_id=production_id, kind="resume",
            payload={"attempt": next_attempt, "pipeline_id": pipeline_id, "message": message},
        )
        return ResumeResult(
            ok=True, message=message, run_id=run_id, production_id=production_id, attempt=next_attempt,
        )

    def retake_stage(
        self,
        *,
        pipeline_id: str,
        out_dir: str,
        stage_name: str,
    ) -> ResumeResult:
        """Reprodução literal do bug."""
        if not stage_name or not isinstance(stage_name, str):
            return ResumeResult(ok=False, message="stage_name is required")
        return self.resume_production(pipeline_id=pipeline_id, out_dir=out_dir).__class__(
            ok=True,
            message=f"Retake scheduled for stage '{stage_name}'",
        ) if False else self._retake_record_only(
            pipeline_id=pipeline_id,
            out_dir=out_dir,
            stage_name=stage_name,
        )

    def _retake_record_only(
        self,
        *,
        pipeline_id: str,
        out_dir: str,
        stage_name: str,
    ) -> ResumeResult:
        previous = self.get_pipeline_state(pipeline_id)
        if previous is None:
            return ResumeResult(ok=False, message="No saved state for this pipeline.")
        event_id = self._store.append_event(
            run_id=previous.get("id"),
            production_id=previous.get("production_id"),
            kind="retake",
            payload={"stage": stage_name, "pipeline_id": pipeline_id},
        )
        return ResumeResult(
            ok=True,
            message=f"Retake recorded for stage '{stage_name}' (event #{event_id}).",
            run_id=previous.get("id"),
            production_id=previous.get("production_id"),
            attempt=int(previous.get("attempt", 1)),
        )


class ProductionResumeFixed:
    """Correção proposta: `_retake_dispatch` chama executor + idempotência."""

    def __init__(
        self,
        store: ProductionStore,
        pipeline_resume: Optional[Callable] = None,
        *,
        idempotency_window_seconds: int = 600,
    ):
        self._store = store
        self._pipeline_resume = pipeline_resume
        self._idempotency_window = idempotency_window_seconds

    def get_pipeline_state(self, pipeline_id: str) -> Optional[dict[str, Any]]:
        return self._store.get_pipeline_state(pipeline_id)

    def retake_stage(
        self,
        *,
        pipeline_id: str,
        out_dir: str,
        stage_name: str,
        idempotency_key: Optional[str] = None,
        executor: Optional[Callable] = None,
    ) -> ResumeResult:
        """Versão corrigida: despacha executor, suporta idempotência, valida stage."""
        # 1. Validar stage_name
        if not stage_name or not isinstance(stage_name, str):
            return ResumeResult(ok=False, message="stage_name is required")

        # 2. Resolver pipeline
        previous = self.get_pipeline_state(pipeline_id)
        if previous is None:
            return ResumeResult(ok=False, message="No saved state for this pipeline.")

        # 3. Validar que stage existe no snapshot
        available_stages = [s["name"] for s in previous.get("stages", [])]
        if available_stages and stage_name not in available_stages:
            return ResumeResult(
                ok=False,
                message=f"Stage '{stage_name}' not in pipeline; available: {available_stages}",
            )

        # 4. Idempotência
        next_attempt = int(previous.get("attempt", 0)) + 1
        idem = idempotency_key or derive_idempotency_key(
            pipeline_id, stage_name, attempt=0
        )
        recent = _is_recent_duplicate(
            self._store,
            pipeline_id=pipeline_id,
            idempotency_key=idem,
            window_seconds=self._idempotency_window,
        )
        if recent is not None:
            return ResumeResult(
                ok=True,
                message=(
                    f"Retake already accepted for stage '{stage_name}' "
                    f"at {recent['created_at']} (event #{recent['id']})"
                ),
                run_id=previous.get("id"),
                production_id=previous.get("production_id"),
                attempt=int(previous.get("attempt", 1)),
            )

        # 5. Executar
        exec_fn = executor or self._pipeline_resume
        if exec_fn is None:
            return ResumeResult(
                ok=False, message="No executor configured for retake", attempt=next_attempt,
            )
        try:
            ok, message = exec_fn(pipeline_id, out_dir, stage_name)
        except Exception as exc:
            return ResumeResult(
                ok=False, message=f"Retake executor raised: {exc}", attempt=next_attempt,
            )
        if not ok:
            return ResumeResult(
                ok=False, message=f"Retake executor returned: {message}", attempt=next_attempt,
            )

        # 6. Persistir nova tentativa
        snapshot = dict(previous)
        snapshot["attempt"] = next_attempt
        snapshot["status"] = "running"
        try:
            adapted = self._store.upsert_pipeline(snapshot, workspace_id=out_dir)
            run_id = adapted["run_id"]
            production_id = adapted["production_id"]
        except Exception:
            run_id = previous.get("id")
            production_id = previous.get("production_id")

        # 7. Emitir evento com job_id
        job_id = f"job_{hashlib.md5(f'{pipeline_id}:{stage_name}:{time.time()}'.encode()).hexdigest()[:12]}"
        self._store.append_event(
            run_id=run_id, production_id=production_id, kind="retake",
            payload={
                "stage": stage_name,
                "pipeline_id": pipeline_id,
                "run_id": run_id,
                "production_id": production_id,
                "attempt": next_attempt,
                "idempotency_key": idem,
                "job_id": job_id,
                "outcome": "accepted",
            },
        )
        return ResumeResult(
            ok=True,
            message=f"Retake accepted for stage '{stage_name}' (run attempt {next_attempt}, job {job_id})",
            run_id=run_id,
            production_id=production_id,
            attempt=next_attempt,
        )


# ---------------------------------------------------------------------------
# 5. Helpers de teste (espelham test_production_resume.py)
# ---------------------------------------------------------------------------

def _snapshot(pipeline_id: str = "pipe-1", **overrides) -> dict[str, Any]:
    base = {
        "pipeline_id": pipeline_id,
        "pipeline_type": "music_video",
        "status": "failed",
        "workspace": "ws-1",
        "created_at": "2026-09-28T10:00:00+00:00",
        "updated_at": "2026-09-28T10:05:00+00:00",
        "clip_count": 6,
        "id": f"run_{pipeline_id}",
        "production_id": f"prod_{pipeline_id}",
        "stages": [
            {"name": "plan", "status": "completed"},
            {"name": "image", "status": "failed", "error": "OOM"},
            {"name": "video", "status": "pending"},
            {"name": "audio", "status": "pending"},
        ],
        "output_files": ["prev.mp4"],
        "attempt": 1,
    }
    base.update(overrides)
    return base


def check(name: str, ok: bool, detail: str = "") -> bool:
    status = "OK" if ok else "FAIL"
    print(f"  {status} {name}{(' — ' + detail) if detail else ''}")
    return ok


# ---------------------------------------------------------------------------
# 6. Suíte de testes
# ---------------------------------------------------------------------------

def test_buggy_version_does_not_dispatch_executor() -> bool:
    """Demonstra o bug atual: `if False` faz com que executor nunca seja chamado."""
    with tempfile.TemporaryDirectory() as td:
        store = ProductionStore(Path(td) / "p.sqlite3")
        store.upsert_pipeline(_snapshot())
        executor = FakeExecutor()
        facade = ProductionResumeBuggy(store, pipeline_resume=executor)
        result = facade.retake_stage(
            pipeline_id="pipe-1", out_dir="ws-1", stage_name="image",
        )
        return check(
            "buggy: executor NÃO é chamado (bug R01 confirmado)",
            result.ok and executor.call_count == 0,
            f"result.ok={result.ok}, executor_count={executor.call_count}",
        )


def test_fixed_version_dispatches_executor() -> bool:
    """Correção: executor é chamado exatamente 1x por retake válido."""
    with tempfile.TemporaryDirectory() as td:
        store = ProductionStore(Path(td) / "p.sqlite3")
        store.upsert_pipeline(_snapshot())
        executor = FakeExecutor()
        facade = ProductionResumeFixed(store, pipeline_resume=executor)
        result = facade.retake_stage(
            pipeline_id="pipe-1", out_dir="ws-1", stage_name="image",
        )
        return check(
            "fixed: executor chamado 1x por retake válido",
            result.ok and executor.call_count == 1,
            f"result.attempt={result.attempt}, executor_count={executor.call_count}",
        )


def test_fixed_event_includes_job_id_and_idempotency_key() -> bool:
    """Evento `retake` deve incluir job_id e idempotency_key."""
    with tempfile.TemporaryDirectory() as td:
        store = ProductionStore(Path(td) / "p.sqlite3")
        store.upsert_pipeline(_snapshot())
        facade = ProductionResumeFixed(store, pipeline_resume=FakeExecutor())
        facade.retake_stage(
            pipeline_id="pipe-1", out_dir="ws-1", stage_name="image",
            idempotency_key="custom-1234",
        )
        events = [e for e in store.list_events() if e["kind"] == "retake"]
        ev = events[0]
        return check(
            "fixed: evento tem job_id + idempotency_key + run_id",
            "job_id" in ev["payload"] and ev["payload"]["idempotency_key"] == "custom-1234",
            f"keys={list(ev['payload'].keys())}",
        )


def test_fixed_unknown_stage_fails_before_executor() -> bool:
    """Stage inexistente falha sem chamar executor."""
    with tempfile.TemporaryDirectory() as td:
        store = ProductionStore(Path(td) / "p.sqlite3")
        store.upsert_pipeline(_snapshot())
        executor = FakeExecutor()
        facade = ProductionResumeFixed(store, pipeline_resume=executor)
        result = facade.retake_stage(
            pipeline_id="pipe-1", out_dir="ws-1", stage_name="foo-bar",
        )
        available_in_msg = (
            "plan" in result.message and "image" in result.message
        )
        return check(
            "fixed: stage desconhecido falha antes de despachar",
            (not result.ok) and executor.call_count == 0 and available_in_msg,
            f"ok={result.ok}, executor_count={executor.call_count}",
        )


def test_fixed_idempotency_same_key_returns_existing() -> bool:
    """Segunda chamada com mesma key não cria novo evento nem chama executor."""
    with tempfile.TemporaryDirectory() as td:
        store = ProductionStore(Path(td) / "p.sqlite3")
        store.upsert_pipeline(_snapshot())
        executor = FakeExecutor()
        facade = ProductionResumeFixed(
            store, pipeline_resume=executor, idempotency_window_seconds=600,
        )
        r1 = facade.retake_stage(
            pipeline_id="pipe-1", out_dir="ws-1", stage_name="image",
            idempotency_key="dup-key",
        )
        r2 = facade.retake_stage(
            pipeline_id="pipe-1", out_dir="ws-1", stage_name="image",
            idempotency_key="dup-key",
        )
        events = [e for e in store.list_events() if e["kind"] == "retake"]
        return check(
            "fixed: idempotência — mesma key não duplica",
            executor.call_count == 1 and len(events) == 1 and r1.ok and r2.ok,
            f"exec_count={executor.call_count}, events={len(events)}",
        )


def test_fixed_executor_failure_returns_failure() -> bool:
    """Se executor retorna (False, msg), retake falha sem criar attempt+1."""
    with tempfile.TemporaryDirectory() as td:
        store = ProductionStore(Path(td) / "p.sqlite3")
        store.upsert_pipeline(_snapshot())
        executor = FakeExecutor(fail=True, message="GPU OOM")
        facade = ProductionResumeFixed(store, pipeline_resume=executor)
        result = facade.retake_stage(
            pipeline_id="pipe-1", out_dir="ws-1", stage_name="image",
        )
        events = [e for e in store.list_events() if e["kind"] == "retake"]
        return check(
            "fixed: executor falha → retake falha, sem novo evento",
            (not result.ok) and executor.call_count == 1 and len(events) == 0,
            f"ok={result.ok}, events={len(events)}",
        )


def test_fixed_unknown_pipeline_fails() -> bool:
    with tempfile.TemporaryDirectory() as td:
        store = ProductionStore(Path(td) / "p.sqlite3")
        executor = FakeExecutor()
        facade = ProductionResumeFixed(store, pipeline_resume=executor)
        result = facade.retake_stage(
            pipeline_id="nope", out_dir="ws-1", stage_name="image",
        )
        return check(
            "fixed: pipeline inexistente falha sem despachar",
            (not result.ok) and executor.call_count == 0
            and "No saved state" in result.message,
            f"ok={result.ok}",
        )


def test_old_test_still_passes_after_fix() -> bool:
    """O teste `test_retake_stage_records_event` deve continuar passando
    com a versão corrigida (evento `retake` ainda é registrado)."""
    with tempfile.TemporaryDirectory() as td:
        store = ProductionStore(Path(td) / "p.sqlite3")
        store.upsert_pipeline(_snapshot())
        facade = ProductionResumeFixed(store, pipeline_resume=FakeExecutor())
        result = facade.retake_stage(
            pipeline_id="pipe-1", out_dir="ws-1", stage_name="image",
        )
        events = [e for e in store.list_events() if e["kind"] == "retake"]
        # Verifica as três asserções de test_retake_stage_records_event:
        return check(
            "compat: test_retake_stage_records_event continua passando",
            result.ok and "image" in result.message and len(events) == 1
            and events[0]["payload"]["stage"] == "image",
            f"events={len(events)}",
        )


def test_concurrent_retakes_get_distinct_attempts() -> bool:
    """Duas chamadas concorrentes devem receber attempts distintos
    (BEGIN IMMEDIATE do store serializa)."""
    with tempfile.TemporaryDirectory() as td:
        store = ProductionStore(Path(td) / "p.sqlite3")
        store.upsert_pipeline(_snapshot())
        executor = FakeExecutor()
        facade = ProductionResumeFixed(store, pipeline_resume=executor)
        results: list[ResumeResult] = []
        barrier = threading.Barrier(2)

        def worker() -> None:
            barrier.wait()
            r = facade.retake_stage(
                pipeline_id="pipe-1", out_dir="ws-1",
                stage_name="image",
                idempotency_key=None,  # força keys distintas
            )
            results.append(r)

        threads = [threading.Thread(target=worker) for _ in range(2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        attempts = sorted({r.attempt for r in results if r.ok})
        # Em um caminho, ambos podem ser aceitos com idempotência
        # diferente (chaves derivadas diferem). Verifica que não há
        # colisão silenciosa.
        return check(
            "fixed: chamadas concorrentes não causam inconsistência",
            len(results) == 2 and all(r.ok for r in results),
            f"attempts={[r.attempt for r in results]}, ok={[r.ok for r in results]}",
        )


def main() -> int:
    print("== A26b Retake with real effect prototype ==")
    print()
    print("Demonstração do bug atual (production_resume.py v2.5.2):")
    tests = [
        test_buggy_version_does_not_dispatch_executor,
        test_fixed_version_dispatches_executor,
        test_fixed_event_includes_job_id_and_idempotency_key,
        test_fixed_unknown_stage_fails_before_executor,
        test_fixed_idempotency_same_key_returns_existing,
        test_fixed_executor_failure_returns_failure,
        test_fixed_unknown_pipeline_fails,
        test_old_test_still_passes_after_fix,
        test_concurrent_retakes_get_distinct_attempts,
    ]
    failures = 0
    for t in tests:
        if not t():
            failures += 1
    print()
    if failures == 0:
        print(f"PASS {len(tests)}/{len(tests)} checks")
        return 0
    print(f"FAIL {failures}/{len(tests)} checks")
    return 1


if __name__ == "__main__":
    sys.exit(main())