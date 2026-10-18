"""Router REST do ProvenanceManifest por Take (A27).

Rotas (spec 32 seção 3.3):

  GET  /api/v1/takes/{take_id}/provenance                  → manifesto
  POST /api/v1/takes/{take_id}/provenance/revalidate       → revalida contra o disco
  GET  /api/v1/takes/{take_id}/provenance/bundle           → download .tar.gz
  POST /api/v1/takes/{take_id}/provenance/bundle           → importa bundle

O router localiza o manifesto varrendo ``takes_root`` por
``*.provenance.json`` cujo campo ``take_id`` casa com o pedido. Takes
legados sem manifesto mas com ``<take_id>.meta.json`` + artefato irmão são
retrofillados sob demanda (spec seção 2.1, backward compatibility).

Padrão ``routers/productions.py``: o app vivo o monta via
``api.include_router(build_productions_router())`` em ``launch.py``.
"""
from __future__ import annotations

import importlib
import importlib.util
import logging
import os
import sys
import tarfile
import tempfile
from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, HTTPException, Query, UploadFile, File
from fastapi.responses import FileResponse

# Dual-context import trick (routers/provenance.py vs app.routers.provenance.py)
def _resolve(short: str, full: str):
    for name in (full, short):
        if name in sys.modules:
            return sys.modules[name]
    for full_name in (full, short):
        spec = importlib.util.find_spec(full_name)
        if spec is not None:
            return importlib.import_module(full_name)
    raise ImportError(f"Cannot resolve {short}")


_prov_module = _resolve("app.services.provenance", "services.provenance")
ProvenanceValidationError = _prov_module.ProvenanceValidationError
export_bundle = _prov_module.export_bundle
import_bundle = _prov_module.import_bundle
load_manifest = _prov_module.load_manifest
manifest_path_for = _prov_module.manifest_path_for
manifest_to_dict = _prov_module.manifest_to_dict
retrofill_manifest = _prov_module.retrofill_manifest
validate_manifest = _prov_module.validate_manifest


_log = logging.getLogger("cue_studio.provenance.router")

# Guarda contra varreduras patológicas em árvores enormes.
_MAX_MANIFEST_SCAN = 5000

_MEDIA_SUFFIXES = (".mp4", ".webm", ".mov", ".mkv", ".png", ".jpg", ".wav")


def build_provenance_router(
    takes_root: Callable[[], str] | str | None = None,
) -> APIRouter:
    """Factory do router de proveniência.

    Parameters
    ----------
    takes_root:
        Raiz varrida procurando ``*.provenance.json``. Pode ser string ou
        callable (``launch.py`` injeta ``_projects_root``); testes injetam
        um ``tmp_path``. Default lê ``CUE_TAKES_ROOT`` ou ``outputs``.
    """
    router = APIRouter()

    def _root() -> Path:
        if callable(takes_root):
            return Path(takes_root())
        if takes_root:
            return Path(takes_root)
        return Path(os.environ.get("CUE_TAKES_ROOT") or "outputs")

    def _find_manifest(take_id: str) -> tuple[Path, Any] | None:
        root = _root()
        if not root.is_dir():
            return None
        scanned = 0
        for candidate in sorted(root.rglob(f"*{_prov_module.PROVENANCE_SUFFIX}")):
            scanned += 1
            if scanned > _MAX_MANIFEST_SCAN:
                _log.warning(
                    "[provenance] scan limit reached under %s", root,
                )
                break
            try:
                manifest = load_manifest(candidate)
            except (ProvenanceValidationError, OSError):
                continue
            if manifest.take_id == take_id:
                return candidate, manifest
        return None

    def _resolve_take(
        take_id: str, *, allow_retrofill: bool = False
    ) -> tuple[Path, Any]:
        found = _find_manifest(take_id)
        if found is not None:
            return found
        if allow_retrofill:
            root = _root()
            if root.is_dir():
                for sidecar in sorted(root.rglob(f"{take_id}.meta.json")):
                    output = None
                    for suffix in _MEDIA_SUFFIXES:
                        candidate = sidecar.parent / f"{take_id}{suffix}"
                        if candidate.is_file():
                            output = candidate
                            break
                    if output is not None:
                        manifest = retrofill_manifest(
                            output,
                            project_dir=sidecar.parent,
                            take_id=take_id,
                        )
                        return manifest_path_for(output), manifest
        raise HTTPException(
            status_code=404,
            detail=f"Provenance manifest not found for take {take_id!r}",
        )

    # ------------------------------------------------------------- read
    @router.get("/api/v1/takes/{take_id}/provenance")
    async def get_provenance(take_id: str) -> dict[str, Any]:
        path, manifest = _resolve_take(take_id, allow_retrofill=True)
        return {"take_id": take_id, "manifest_path": str(path),
                "manifest": manifest_to_dict(manifest)}

    # -------------------------------------------------------- revalidate
    @router.post("/api/v1/takes/{take_id}/provenance/revalidate")
    async def revalidate_provenance(take_id: str) -> dict[str, Any]:
        path, manifest = _resolve_take(take_id)
        status, issues = validate_manifest(manifest, _root())
        return {
            "take_id": take_id,
            "manifest_path": str(path),
            "status": status.value,
            "issues": issues,
        }

    # ----------------------------------------------------------- bundle
    @router.get("/api/v1/takes/{take_id}/provenance/bundle")
    async def download_bundle(
        take_id: str,
        include_refs: bool = Query(default=False),
    ) -> FileResponse:
        path, manifest = _resolve_take(take_id)
        handle, tmp_name = tempfile.mkstemp(
            prefix=f"{take_id}_", suffix=".tar.gz",
        )
        os.close(handle)
        try:
            export_bundle(
                manifest, path.parent, tmp_name, include_refs=include_refs,
            )
        except Exception as exc:
            raise HTTPException(
                status_code=500, detail=f"Bundle export failed: {exc}",
            ) from exc
        return FileResponse(
            tmp_name,
            media_type="application/gzip",
            filename=f"{take_id}.provenance.tar.gz",
        )

    @router.post("/api/v1/takes/{take_id}/provenance/bundle")
    async def upload_bundle(take_id: str, file: UploadFile = File(...)) -> dict[str, Any]:
        root = _root()
        root.mkdir(parents=True, exist_ok=True)
        handle, tmp_name = tempfile.mkstemp(
            prefix=f"{take_id}_", suffix=".tar.gz", dir=str(root),
        )
        try:
            with os.fdopen(handle, "wb") as stream:
                stream.write(await file.read())
            manifest, status, issues = import_bundle(tmp_name, root)
        except (ProvenanceValidationError, tarfile.TarError, OSError) as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        finally:
            if os.path.exists(tmp_name):
                try:
                    os.remove(tmp_name)
                except OSError:
                    pass
        return {
            "imported_take_id": manifest.take_id,
            "requested_take_id": take_id,
            "status": status.value,
            "issues": issues,
        }

    return router


__all__ = ["build_provenance_router"]
