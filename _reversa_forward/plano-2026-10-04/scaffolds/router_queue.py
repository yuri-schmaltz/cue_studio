"""Scaffold do router Queue (A14, A19)."""

from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "contracts"))

from fastapi import APIRouter  # noqa: E402

from api_errors import ApiError, ErrorCode  # noqa: E402
from projects import QueueItem  # noqa: E402


class QueueServiceProto:
    def list(self) -> list[QueueItem]:
        return []

    def cancel(self, job_id: str) -> bool:
        # Substituir por lógica real
        return False

    def resume(self, job_id: str) -> QueueItem:
        raise ApiError(
            ErrorCode.QUEUE_RESUME_NOT_ALLOWED,
            "Job não está em estado retomável",
            status=409,
        )


_service = QueueServiceProto()


def build_queue_router() -> APIRouter:
    r = APIRouter(prefix="/api/queue", tags=["queue"])

    @r.get("", response_model=list[QueueItem])
    def list_queue() -> list[QueueItem]:
        return _service.list()

    @r.delete("/{job_id}", status_code=204)
    def cancel_job(job_id: str) -> None:
        if not _service.cancel(job_id):
            raise ApiError(
                ErrorCode.QUEUE_CANCEL_NOT_ALLOWED,
                "Job não pode ser cancelado nesse estado",
                status=409,
            )

    @r.post("/{job_id}/resume", response_model=QueueItem, status_code=202)
    def resume_job(job_id: str) -> QueueItem:
        return _service.resume(job_id)

    return r


if __name__ == "__main__":
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from api_errors import install_api_error_handler

    app = FastAPI()
    install_api_error_handler(app)
    app.include_router(build_queue_router())
    c = TestClient(app)

    # GET deve passar (lista vazia)
    r = c.get("/api/queue")
    assert r.status_code == 200, r.text

    # DELETE stub retorna False → 409 com payload
    r = c.delete("/api/queue/j1")
    assert r.status_code == 409, r.text
    body = r.json()
    assert body["code"] == "queue.cancel.not_allowed", body
    assert "operationId" in body, body

    print("OK scaffold/router_queue.py")