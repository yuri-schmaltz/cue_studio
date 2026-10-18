"""Classificação de jobs da fila e serviço de retomada idempotente (A19).

Fornece ``UNKNOWN`` e ``QueueResumeService``, consumidos por
``app.routers.queue``. Implementação mínima sobre ``ProductionStore``:
lista jobs persistidos com seu estado pós-reinício e permite retomada
idempotente de jobs interrompidos/fallidos.
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any, Callable, Mapping

from ..services.production_store import ProductionStore

UNKNOWN = "unknown"


class QueueResumeService:
    """Lista e retoma jobs da fila de produção."""

    def __init__(
        self,
        store: ProductionStore,
        fs_root: Path | str | Callable[[], Path | str] | None = None,
        resume: Callable[..., Any] | None = None,
    ) -> None:
        self.store = store
        self.fs_root = fs_root
        self.resume = resume

    def list_jobs(self, limit: int = 100) -> list[dict[str, Any]]:
        """Retorna jobs com estado pós-reinício (done/interrupted/failed/unknown)."""
        productions = self.store.catalog().get("productions", [])
        jobs: list[dict[str, Any]] = []
        for prod in productions[:limit]:
            runs = self.store.list_runs(prod["id"])
            for run in runs:
                status = run.get("status") or UNKNOWN
                jobs.append(
                    {
                        "id": run.get("id") or prod["id"],
                        "production_id": prod["id"],
                        "attempt": run.get("attempt", 1),
                        "status": status,
                        "phase": run.get("phase"),
                        "error": run.get("error"),
                        "updated_at": run.get("updated_at"),
                    }
                )
        return jobs

    def resume_job(
        self,
        job_id: str,
        out_dir: str = "default",
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        """Retoma um job interrompido/fallido de forma idempotente."""
        run = self.store.get_run(job_id)
        if run is None:
            # Tenta por production_id.
            prod = self.store.get_production(job_id)
            if prod is None:
                return {
                    "ok": False,
                    "status": UNKNOWN,
                    "message": f"job {job_id} not found",
                }
            runs = self.store.list_runs(prod["id"])
            run = runs[0] if runs else None
            if run is None:
                return {
                    "ok": False,
                    "status": UNKNOWN,
                    "message": f"job {job_id} has no runs",
                }

        status = run.get("status") or UNKNOWN
        if status in ("succeeded", "cancelled"):
            return {
                "ok": False,
                "status": status,
                "message": f"job {job_id} already in terminal state {status}",
            }

        if self.resume is not None:
            try:
                ok, message = self.resume(
                    run.get("correlations", {}),
                    out_dir,
                    idempotency_key=idempotency_key,
                )
            except TypeError:
                ok, message = self.resume(run.get("correlations", {}), out_dir)
            return {
                "ok": bool(ok),
                "status": "running" if ok else "failed",
                "message": message or "resumed",
            }

        return {
            "ok": False,
            "status": UNKNOWN,
            "message": "no resume callable configured",
        }
