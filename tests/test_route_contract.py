"""A16 — HTTP route contract for the FastAPI app.

Iterates every route registered on ``launch.api`` (descending into the
lazily-included routers) and asserts the expected ``(method, path)``
set — proving the domain extraction moved code without changing any URL
or dropping any endpoint (spec acceptance:
``_reversa_forward/plano-2026-10-04/22-feature-a16-routers.md``).
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "app") not in sys.path:
    sys.path.insert(0, str(ROOT / "app"))

# Full contract: every (method, path) pair served by ``launch.api``.
# Regenerate with care — a missing entry means an endpoint was dropped.
EXPECTED_ROUTES = frozenset({
    ("DELETE", "/api/v1/characters/{character_id}"),
    ("DELETE", "/api/v1/director/pipelines/{pid}"),
    ("DELETE", "/api/v1/director/queue/{entry_id}"),
    ("DELETE", "/api/v1/editor/projects/{project_id}"),
    ("DELETE", "/api/v1/editor/projects/{project_id}"),
    ("DELETE", "/api/v1/editor/projects/{project_id}/clips/{clip_id}"),
    ("DELETE", "/api/v1/loras/file"),
    ("DELETE", "/api/v1/models/{model_type}"),
    ("DELETE", "/api/v1/notifications/push/subscribe"),
    ("DELETE", "/api/v1/outputs/{name}"),
    ("DELETE", "/api/v1/presets/{preset_id}"),
    ("DELETE", "/api/v1/recipes/{rid}"),
    ("DELETE", "/api/v1/style-bibles/{bible_id}"),
    ("DELETE", "/api/v1/wizard/workflows/{workflow_id}"),
    ("DELETE", "/api/v1/workspaces/{name}"),
    ("DELETE", "/api/v1/workspaces/{name}/cover"),
    ("GET", "/api/v1/audio/analyze/status"),
    ("GET", "/api/v1/characters"),
    ("GET", "/api/v1/characters/{character_id}/media/{slot}"),
    ("GET", "/api/v1/checkpoints/installed"),
    ("GET", "/api/v1/civitai/base-models"),
    ("GET", "/api/v1/civitai/checkpoint-architectures"),
    ("GET", "/api/v1/civitai/downloads"),
    ("GET", "/api/v1/civitai/model/{model_id}"),
    ("GET", "/api/v1/civitai/search"),
    ("GET", "/api/v1/defaults/{model_type}"),
    ("GET", "/api/v1/director/pipeline/{pid}"),
    ("GET", "/api/v1/director/pipelines"),
    ("GET", "/api/v1/director/pipelines/{pid}"),
    ("GET", "/api/v1/director/pipelines/{pid}/thumbnail"),
    ("GET", "/api/v1/director/queue"),
    ("GET", "/api/v1/director/queue/{entry_id}"),
    ("GET", "/api/v1/director/skills"),
    ("GET", "/api/v1/director/{pid}/negative-prompt"),
    ("GET", "/api/v1/downloads/active"),
    ("GET", "/api/v1/editor/export/capabilities"),
    ("GET", "/api/v1/editor/media/cache/{preview_id}/{kind}"),
    ("GET", "/api/v1/editor/projects"),
    ("GET", "/api/v1/editor/projects"),
    ("GET", "/api/v1/editor/projects/{project_id}"),
    ("GET", "/api/v1/editor/projects/{project_id}"),
    ("GET", "/api/v1/favorites"),
    ("GET", "/api/v1/file/{filename:path}"),
    ("GET", "/api/v1/generation-reviews/{review_id}"),
    ("GET", "/api/v1/h3-window-overrides"),
    ("GET", "/api/v1/jobs"),
    ("GET", "/api/v1/llm/models"),
    ("GET", "/api/v1/llm/roles"),
    ("GET", "/api/v1/llm/status"),
    ("GET", "/api/v1/llm/stream-status"),
    ("GET", "/api/v1/loras/directories"),
    ("GET", "/api/v1/loras/installed"),
    ("GET", "/api/v1/loras/preview/{filename}"),
    ("GET", "/api/v1/loras/scan-status/{scan_id}"),
    ("GET", "/api/v1/loras/update-manifest"),
    ("GET", "/api/v1/loras/{model_type}"),
    ("GET", "/api/v1/loras/{model_type}/details"),
    ("GET", "/api/v1/loras/{model_type}/{filename}/guide"),
    ("GET", "/api/v1/mcp"),
    ("GET", "/api/v1/model-folders/scan"),
    ("GET", "/api/v1/model-options/{model_type}"),
    ("GET", "/api/v1/model-visibility"),
    ("GET", "/api/v1/models"),
    ("GET", "/api/v1/models/downloads/status"),
    ("GET", "/api/v1/models/{model_type}/debug"),
    ("GET", "/api/v1/notifications/push/status"),
    ("GET", "/api/v1/outputs"),
    ("GET", "/api/v1/outputs/group/{group_id}"),
    ("GET", "/api/v1/outputs/{name}/metadata"),
    ("GET", "/api/v1/presets"),
    ("GET", "/api/v1/primary-settings"),
    ("GET", "/api/v1/productions"),
    ("GET", "/api/v1/productions/{production_id}"),
    ("GET", "/api/v1/productions/{production_id}/events"),
    ("GET", "/api/v1/productions/{production_id}/runs"),
    ("GET", "/api/v1/queue"),
    ("GET", "/api/v1/recipes"),
    ("GET", "/api/v1/recipes/{rid}"),
    ("GET", "/api/v1/recipes/{rid}/thumbnail"),
    ("GET", "/api/v1/resolutions"),
    ("GET", "/api/v1/sam/status"),
    ("GET", "/api/v1/services-config"),
    ("GET", "/api/v1/settings/projects-root"),
    ("GET", "/api/v1/status/{job_id}"),
    ("GET", "/api/v1/storage/duplicates"),
    ("GET", "/api/v1/storage/usage"),
    ("GET", "/api/v1/studio-preferences"),
    ("GET", "/api/v1/style-bibles"),
    ("GET", "/api/v1/style-bibles/{bible_id}"),
    ("GET", "/api/v1/system-config"),
    ("GET", "/api/v1/system-detect"),
    ("GET", "/api/v1/system-stats"),
    ("GET", "/api/v1/system/preflight"),
    ("GET", "/api/v1/uploads/audio/{filename}"),
    ("GET", "/api/v1/uploads/{filename}"),
    ("GET", "/api/v1/wizard/workflows"),
    ("GET", "/api/v1/wizard/workflows/{workflow_id}"),
    ("GET", "/api/v1/workspaces"),
    ("GET", "/api/v1/workspaces/{name}/cover"),
    ("GET", "/api/v1/workspaces/{name}/setup"),
    ("GET", "/cue-studio-icon.png"),
    ("GET", "/docs"),
    ("GET", "/docs/oauth2-redirect"),
    ("GET", "/favicon.ico"),
    ("GET", "/health/version"),
    ("GET", "/icon.png"),
    ("GET", "/maestro-icon.png"),
    ("GET", "/openapi.json"),
    ("GET", "/redoc"),
    ("HEAD", "/docs"),
    ("HEAD", "/docs/oauth2-redirect"),
    ("HEAD", "/openapi.json"),
    ("HEAD", "/redoc"),
    ("POST", "/api/v1/audio/analyze"),
    ("POST", "/api/v1/audio/mix"),
    ("POST", "/api/v1/audio/plan-structure"),
    ("POST", "/api/v1/audio/suggest-clips"),
    ("POST", "/api/v1/blend"),
    ("POST", "/api/v1/cancel/{job_id}"),
    ("POST", "/api/v1/characters"),
    ("POST", "/api/v1/checkpoints/check-updates"),
    ("POST", "/api/v1/checkpoints/{model_type}/generate-guide"),
    ("POST", "/api/v1/civitai/download"),
    ("POST", "/api/v1/director/cinema/evaluate"),
    ("POST", "/api/v1/director/cinema/evaluate"),
    ("POST", "/api/v1/director/classify-sections"),
    ("POST", "/api/v1/director/generate-music"),
    ("POST", "/api/v1/director/generate-negative-prompt"),
    ("POST", "/api/v1/director/pipeline/start"),
    ("POST", "/api/v1/director/pipeline/{pid}/continue"),
    ("POST", "/api/v1/director/pipeline/{pid}/resume"),
    ("POST", "/api/v1/director/pipeline/{pid}/review-image/{clip_index}"),
    ("POST", "/api/v1/director/pipeline/{pid}/stop"),
    ("POST", "/api/v1/director/pipelines/{pid}/clips/{clip_index}/rerun-image"),
    ("POST", "/api/v1/director/pipelines/{pid}/clips/{clip_index}/rerun-video"),
    ("POST", "/api/v1/director/pipelines/{pid}/rejoin"),
    ("POST", "/api/v1/director/pipelines/{pid}/repair"),
    ("POST", "/api/v1/director/pipelines/{pid}/repair/cancel"),
    ("POST", "/api/v1/director/plan-angle-prompts"),
    ("POST", "/api/v1/director/plan-dialogue-scenes"),
    ("POST", "/api/v1/director/plan-prompts"),
    ("POST", "/api/v1/director/plan-prompts-and-images"),
    ("POST", "/api/v1/director/plan-short-film-prompts"),
    ("POST", "/api/v1/director/plan-short-film-script"),
    ("POST", "/api/v1/director/queue"),
    ("POST", "/api/v1/director/queue/pause"),
    ("POST", "/api/v1/director/queue/reorder"),
    ("POST", "/api/v1/director/queue/start"),
    ("POST", "/api/v1/director/script/read"),
    ("POST", "/api/v1/director/v2/plan"),
    ("POST", "/api/v1/director/v2/plan/cancel"),
    ("POST", "/api/v1/director/{pid}/negative-prompt"),
    ("POST", "/api/v1/edit-anything"),
    ("POST", "/api/v1/editor/export"),
    ("POST", "/api/v1/editor/media/preview"),
    ("POST", "/api/v1/editor/media/probe"),
    ("POST", "/api/v1/editor/media/status"),
    ("POST", "/api/v1/editor/projects"),
    ("POST", "/api/v1/editor/projects"),
    ("POST", "/api/v1/editor/projects/{project_id}/clips"),
    ("POST", "/api/v1/editor/projects/{project_id}/clips/reorder"),
    ("POST", "/api/v1/editor/projects/{project_id}/clips/{clip_id}/split"),
    ("POST", "/api/v1/editor/projects/{project_id}/clips/{clip_id}/trim"),
    ("POST", "/api/v1/editor/projects/{project_id}/export"),
    ("POST", "/api/v1/extract-frames"),
    ("POST", "/api/v1/favorites/{name}"),
    ("POST", "/api/v1/force-cancel/{job_id}"),
    ("POST", "/api/v1/generate"),
    ("POST", "/api/v1/generation-reviews"),
    ("POST", "/api/v1/generation-reviews/{review_id}/confirm"),
    ("POST", "/api/v1/huggingface/import-lora"),
    ("POST", "/api/v1/inpaint"),
    ("POST", "/api/v1/jobs/queue/start"),
    ("POST", "/api/v1/llm/describe-image"),
    ("POST", "/api/v1/llm/enhance-prompt"),
    ("POST", "/api/v1/llm/generate"),
    ("POST", "/api/v1/llm/load"),
    ("POST", "/api/v1/llm/plan-h3-sequence"),
    ("POST", "/api/v1/llm/plan-h3-windows"),
    ("POST", "/api/v1/llm/roles"),
    ("POST", "/api/v1/llm/test-connection"),
    ("POST", "/api/v1/llm/unload"),
    ("POST", "/api/v1/llm/write-song"),
    ("POST", "/api/v1/loras/check-updates"),
    ("POST", "/api/v1/loras/generate-guide"),
    ("POST", "/api/v1/loras/nsfw-override"),
    ("POST", "/api/v1/loras/scan-and-generate-guides"),
    ("POST", "/api/v1/mcp"),
    ("POST", "/api/v1/models/reload"),
    ("POST", "/api/v1/models/{model_type}/download"),
    ("POST", "/api/v1/notification-sound/test"),
    ("POST", "/api/v1/notifications/push/subscribe"),
    ("POST", "/api/v1/notifications/push/test"),
    ("POST", "/api/v1/outpaint"),
    ("POST", "/api/v1/outputs/rejoin"),
    ("POST", "/api/v1/outputs/{name:path}/move"),
    ("POST", "/api/v1/presets"),
    ("POST", "/api/v1/productions/{production_id}/resume"),
    ("POST", "/api/v1/productions/{production_id}/retake"),
    ("POST", "/api/v1/queue/{job_id}/resume"),
    ("POST", "/api/v1/recast"),
    ("POST", "/api/v1/recast/preview"),
    ("POST", "/api/v1/recipes/import"),
    ("POST", "/api/v1/recipes/save-from-output"),
    ("POST", "/api/v1/repaint"),
    ("POST", "/api/v1/repaint/preview"),
    ("POST", "/api/v1/retake"),
    ("POST", "/api/v1/segment/preview"),
    ("POST", "/api/v1/storage/duplicates/reclaim"),
    ("POST", "/api/v1/storage/duplicates/remove-linked"),
    ("POST", "/api/v1/style-bibles"),
    ("POST", "/api/v1/style-bibles/{bible_id}/build"),
    ("POST", "/api/v1/system-detect/apply"),
    ("POST", "/api/v1/system/release-model"),
    ("POST", "/api/v1/tools/film-grain"),
    ("POST", "/api/v1/tools/revoice"),
    ("POST", "/api/v1/tools/upscale"),
    ("POST", "/api/v1/upload"),
    ("POST", "/api/v1/upload-audio"),
    ("POST", "/api/v1/wizard/workflows"),
    ("POST", "/api/v1/wizard/workflows/{workflow_id}/run"),
    ("POST", "/api/v1/wizard/workflows/{workflow_id}/run-all"),
    ("POST", "/api/v1/wizard/workflows/{workflow_id}/steps"),
    ("POST", "/api/v1/workspaces"),
    ("POST", "/api/v1/workspaces/{name}/cover"),
    ("PUT", "/api/v1/director/pipeline/{pid}/timing"),
    ("PUT", "/api/v1/director/pipelines/{pid}/clips/{clip_index}/tag"),
    ("PUT", "/api/v1/director/pipelines/{pid}/clips/{clip_index}/take"),
    ("PUT", "/api/v1/director/queue/{entry_id}"),
    ("PUT", "/api/v1/editor/projects/{project_id}"),
    ("PUT", "/api/v1/generation-reviews/{review_id}"),
    ("PUT", "/api/v1/h3-window-overrides"),
    ("PUT", "/api/v1/model-visibility"),
    ("PUT", "/api/v1/services-config"),
    ("PUT", "/api/v1/settings/projects-root"),
    ("PUT", "/api/v1/studio-preferences"),
    ("PUT", "/api/v1/style-bibles/{bible_id}"),
    ("PUT", "/api/v1/system-config"),
    ("PUT", "/api/v1/workspaces/active"),
    ("PUT", "/api/v1/workspaces/{name}/setup"),
})


def _collect(routes) -> set[tuple[str, str]]:
    """Flatten APIRoute/_IncludedRouter/Route/Mount entries into (method, path)."""
    pairs: set[tuple[str, str]] = set()
    for route in routes:
        if type(route).__name__ == "_IncludedRouter":
            pairs |= _collect(route.original_router.routes)
            continue
        path = getattr(route, "path", None)
        if path is None:
            continue
        for method in getattr(route, "methods", None) or ():
            pairs.add((method, path))
    return pairs


@pytest.fixture(scope="module")
def live_routes() -> set[tuple[str, str]]:
    try:
        import launch  # type: ignore
    except Exception as exc:  # pragma: no cover - lean environments
        pytest.skip(f"launch.py not importable in this environment: {exc}")
    return _collect(launch.api.routes)


def test_every_expected_route_still_resolves(live_routes):
    missing = sorted(EXPECTED_ROUTES - live_routes)
    assert missing == [], f"routes dropped from launch.api: {missing}"


def test_queue_routes_mounted(live_routes):
    # A19 additions must stay part of the contract too.
    assert ("GET", "/api/v1/queue") in live_routes
    assert ("POST", "/api/v1/queue/{job_id}/resume") in live_routes


def test_workspaces_domain_routes_unchanged(live_routes):
    expected = {
        ("GET", "/api/v1/workspaces"),
        ("PUT", "/api/v1/workspaces/active"),
        ("POST", "/api/v1/workspaces"),
        ("GET", "/api/v1/workspaces/{name}/setup"),
        ("PUT", "/api/v1/workspaces/{name}/setup"),
        ("POST", "/api/v1/workspaces/{name}/cover"),
        ("GET", "/api/v1/workspaces/{name}/cover"),
        ("DELETE", "/api/v1/workspaces/{name}/cover"),
        ("DELETE", "/api/v1/workspaces/{name}"),
    }
    assert expected <= live_routes


def test_router_packages_never_import_launch():
    # Spec acceptance: grep -rn "from app.launch import" app/routers/ → vazio.
    offenders = []
    for module in sorted((ROOT / "app" / "routers").rglob("*.py")):
        text = module.read_text(encoding="utf-8")
        for needle in ("from app.launch import", "from launch import", "\nimport launch"):
            if needle in text:
                offenders.append(f"{module.relative_to(ROOT)}: {needle!r}")
    assert offenders == []


def test_workspaces_router_factory_matches_contract():
    from app.routers.workspaces import WorkspaceDeps, build_workspaces_router

    deps = WorkspaceDeps(
        list_workspaces=lambda: [],
        get_active_workspace=lambda: "default",
        persist_active_workspace=lambda name, apply_save_paths=True: "/tmp",
        active_gen_states=lambda: {},
        jobs=lambda: {},
        projects_root=lambda: "/tmp",
        workspace_dir=lambda name: f"/tmp/{name}",
        load_workspace_setup=lambda name: {},
        persist_workspace_setup=lambda name, setup: setup,
        save_cover_image=lambda *a, **k: "",
        delete_cover_image=lambda *a, **k: None,
        cover_image_path=lambda *a, **k: None,
        safe_join=lambda base, name: f"{base}/{name}",
        workspace_setup_error=RuntimeError,
    )
    router = build_workspaces_router(deps)
    registered = {(method, route.path) for route in router.routes for method in route.methods}
    expected = {
        ("GET", "/api/v1/workspaces"),
        ("PUT", "/api/v1/workspaces/active"),
        ("POST", "/api/v1/workspaces"),
        ("GET", "/api/v1/workspaces/{name}/setup"),
        ("PUT", "/api/v1/workspaces/{name}/setup"),
        ("POST", "/api/v1/workspaces/{name}/cover"),
        ("GET", "/api/v1/workspaces/{name}/cover"),
        ("DELETE", "/api/v1/workspaces/{name}/cover"),
        ("DELETE", "/api/v1/workspaces/{name}"),
    }
    assert registered == expected
