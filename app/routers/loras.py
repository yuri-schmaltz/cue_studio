"""Router de gerenciamento de LoRAs (/api/v1/loras).

Fornece endpoints para:
- Status de escaneamento de guias (/api/v1/loras/scan-status/{scan_id})
- Listagem de diretórios de LoRA (/api/v1/loras/directories)
- Visualização de previews locais (/api/v1/loras/preview/{filename})
- Catálogo geral de LoRAs instaladas (/api/v1/loras/installed)
- Remoção segura de arquivos de LoRA (/api/v1/loras/file)
- Listagem de LoRAs por modelo e detalhes (/api/v1/loras/{model_type})
- Override de NSFW (/api/v1/loras/nsfw-override)
- Verificação de atualizações e manifesto (/api/v1/loras/check-updates, /api/v1/loras/update-manifest)
- Geração e consulta de guias (/api/v1/loras/generate-guide, /api/v1/loras/{model_type}/{filename}/guide)
- Escaneamento em lote para geração de guias (/api/v1/loras/scan-and-generate-guides)
"""
from __future__ import annotations

import logging
from typing import Any, Callable
from fastapi import APIRouter, HTTPException, Request

_log = logging.getLogger("cue_studio.routers.loras")


def build_loras_router(
    *,
    scan_status_fn: Callable[[str], Any],
    list_directories_fn: Callable[[], Any],
    preview_fn: Callable[[str], Any],
    installed_fn: Callable[[], Any],
    delete_file_fn: Callable[[str, str], Any],
    list_loras_fn: Callable[[str], Any],
    list_loras_details_fn: Callable[[str], Any],
    nsfw_override_fn: Callable[[Request], Any],
    check_updates_fn: Callable[[bool], Any],
    update_manifest_fn: Callable[[], Any],
    generate_guide_fn: Callable[[Request], Any],
    get_guide_fn: Callable[[str, str], Any],
    scan_and_generate_guides_fn: Callable[[Request], Any],
) -> APIRouter:
    router = APIRouter(tags=["loras"])

    @router.get("/api/v1/loras/scan-status/{scan_id}")
    def scan_status(scan_id: str):
        """Get the status of a LoRA scan operation."""
        return scan_status_fn(scan_id)

    @router.get("/api/v1/loras/directories")
    def list_lora_directories():
        """Return all available LoRA directories for target selection during download."""
        return list_directories_fn()

    @router.get("/api/v1/loras/preview/{filename}")
    def serve_lora_preview(filename: str):
        """Serve a locally downloaded LoRA preview file (video or image)."""
        return preview_fn(filename)

    @router.get("/api/v1/loras/installed")
    def list_all_installed_loras():
        """List ALL installed LoRAs across all directories with CivitAI metadata."""
        return installed_fn()

    @router.delete("/api/v1/loras/file")
    def delete_lora_file(directory: str, filename: str):
        """Delete an installed LoRA plus its sidecar, guide, and preview files."""
        return delete_file_fn(directory, filename)

    @router.post("/api/v1/loras/nsfw-override")
    async def set_lora_nsfw_override(request: Request):
        """Manually flag a LoRA as SFW or NSFW, overriding CivitAI's nsfw value."""
        res = nsfw_override_fn(request)
        if hasattr(res, "__await__"):
            return await res
        return res

    @router.post("/api/v1/loras/check-updates")
    def check_lora_updates(force: bool = False):
        """Query CivitAI for newer versions of installed LoRAs."""
        return check_updates_fn(force)

    @router.get("/api/v1/loras/update-manifest")
    def get_lora_update_manifest():
        """Return the cached manifest without hitting CivitAI."""
        return update_manifest_fn()

    @router.get("/api/v1/loras/{model_type}")
    def list_loras(model_type: str):
        """List available LoRA files for a model type."""
        return list_loras_fn(model_type)

    @router.get("/api/v1/loras/{model_type}/details")
    def list_loras_details(model_type: str):
        """List LoRAs with metadata from .civitai.json sidecars."""
        return list_loras_details_fn(model_type)

    @router.post("/api/v1/loras/generate-guide")
    async def generate_lora_guide(request: Request):
        """Generate a .guide.md for a LoRA by feeding its CivitAI metadata to the LLM."""
        res = generate_guide_fn(request)
        if hasattr(res, "__await__"):
            return await res
        return res

    @router.get("/api/v1/loras/{model_type}/{filename}/guide")
    def get_lora_guide(model_type: str, filename: str):
        """Get the generated guide for a LoRA, if it exists."""
        return get_guide_fn(model_type, filename)

    @router.post("/api/v1/loras/scan-and-generate-guides")
    async def scan_and_generate_guides(request: Request):
        """Scan all local LoRAs, fetch CivitAI metadata by hash, and generate guides."""
        res = scan_and_generate_guides_fn(request)
        if hasattr(res, "__await__"):
            return await res
        return res

    return router
