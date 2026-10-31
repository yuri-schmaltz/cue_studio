"""Output browsing, metadata and favorites HTTP API with explicit storage dependencies."""
from __future__ import annotations

from dataclasses import dataclass
import json
import os
from typing import Callable

from fastapi import APIRouter, HTTPException


@dataclass(frozen=True)
class MediaLibraryDeps:
    workspace_dir: Callable[..., str]
    workspace_browse_dir: Callable[[str], str | None]
    active_workspace: Callable[[], str]
    projects_root: Callable[[], str]
    safe_join: Callable[..., str | None]
    extract_output_seed: Callable[[str], int | None]


class MediaLibrary:
    def __init__(self, deps: MediaLibraryDeps):
        self.deps = deps

    def _favorites_path(self, workspace: str | None = None) -> str:
        """Path to favorites JSON for the requested (or active) workspace."""
        return os.path.join(self.deps.workspace_dir(workspace), ".favorites.json")

    def _load_favorites(self, workspace: str | None = None) -> set:
        """Load favorites set for the requested (or active) workspace."""
        from services.win_safe_files import favorites_lock
        fp = self._favorites_path(workspace)
        if os.path.isfile(fp):
            try:
                with favorites_lock:
                    with open(fp, "r", encoding="utf-8") as f:
                        data = json.load(f)
                return set(data) if isinstance(data, list) else set()
            except Exception:
                pass
        return set()

    def _save_favorites(self, favs: set, workspace: str | None = None):
        """Save favorites set for the requested (or active) workspace.

        favorites_lock (shared with director_pipeline's delete sweep, which
        rewrites the same file) serializes read-modify-write cycles so a
        concurrent pipeline delete can't be clobbered by a stale write."""
        from services.win_safe_files import favorites_lock
        fp = self._favorites_path(workspace)
        with favorites_lock:
            with open(fp, "w", encoding="utf-8") as f:
                json.dump(sorted(favs), f)

    def list_favorites(self):
        """List all favorited filenames in the active workspace."""
        return {"favorites": sorted(self._load_favorites())}

    def toggle_favorite(self, name: str):
        """Toggle favorite status for a file. Returns new state."""
        from services.win_safe_files import favorites_lock
        # Hold across the whole read-modify-write so a concurrent pipeline
        # delete sweep can't be clobbered by this stale set (RLock — the
        # load/save helpers re-acquire internally).
        with favorites_lock:
            favs = self._load_favorites()
            if name in favs:
                favs.discard(name)
                is_fav = False
            else:
                favs.add(name)
                is_fav = True
            self._save_favorites(favs)
        return {"name": name, "favorite": is_fav}

    def list_outputs(self, limit: int = 0, offset: int = 0, favorites_only: bool = False, multiclip_only: bool = False, search: str = "", workspace: str = ""):
        """List generated output files (newest first) from the active workspace.

        Supports pagination via limit/offset query params.
        Returns {outputs, total} where total is the full count before pagination.
        When limit=0 (default), returns all items (backwards compatible).

        A named workspace browses that workspace without changing the active one.
        workspace="__uploads__" lists the uploads folder instead (the gallery's
        virtual "Uploads" view) so user-supplied media can be previewed and
        reused. Browse-only: the server-side active workspace is untouched and
        generations never save here. Uploads have no sidecars, so the metadata
        passes below fall through naturally.
        """
        requested_workspace = str(workspace or "").strip()
        if requested_workspace == "__uploads__":
            out_dir = os.path.join(os.getcwd(), "uploads")
            browsed_workspace = "__uploads__"
        elif requested_workspace:
            out_dir = self.deps.workspace_browse_dir(requested_workspace)
            if out_dir is None:
                raise HTTPException(status_code=400, detail="Invalid workspace name")
            browsed_workspace = requested_workspace
        else:
            out_dir = self.deps.workspace_dir()
            browsed_workspace = self.deps.active_workspace()
        if not os.path.isdir(out_dir):
            return {"outputs": [], "total": 0}

        media_exts = {".mp4", ".webm", ".gif", ".png", ".jpg", ".jpeg", ".webp", ".wav", ".mp3"}
        video_exts = {".mp4", ".webm", ".gif"}
        audio_exts = {".wav", ".mp3"}

        favs = set() if browsed_workspace == "__uploads__" else self._load_favorites(browsed_workspace)

        # Build a quick listing with mtime — avoid reading JSON for every file
        # We only read sidecar JSON for files in the visible page
        raw_entries = []
        for name in os.listdir(out_dir):
            if name.startswith(".trash_") or name.startswith("."):
                continue
            filepath = os.path.join(out_dir, name)
            if not os.path.isfile(filepath):
                continue
            ext = os.path.splitext(name)[1].lower()
            if ext not in media_exts:
                continue
            raw_entries.append((name, filepath, ext, os.path.getmtime(filepath)))

        # Sort by creation time (newest first) before any filtering
        raw_entries.sort(key=lambda e: e[3], reverse=True)

        # First pass: read sidecar JSON ONCE per file and cache the bits we need
        # downstream (clip group info, generation_mode, edit_sub_mode). Files
        # without a sidecar simply have no entry in the cache. We previously read
        # sidecars in two separate passes (once for clip groups, once for mode);
        # consolidating saves disk I/O and keeps the mode/edit_sub_mode populated
        # for ALL files — the prior code only set `mode` when a multi-clip group
        # existed, which meant the gallery's Edits filter never had data to
        # filter on for non-multiclip outputs.
        sidecar_cache: dict[str, dict] = {}
        clip_groups: dict[str, dict] = {}
        for name, filepath, ext, mtime in raw_entries:
            meta_path = os.path.join(out_dir, os.path.splitext(name)[0] + ".meta.json")
            if not os.path.isfile(meta_path):
                continue
            try:
                with open(meta_path, "r", encoding="utf-8") as mf:
                    meta = json.load(mf)
            except Exception:
                continue
            params = meta.get("params") if isinstance(meta.get("params"), dict) else {}
            sidecar_cache[name] = {
                "mode": meta.get("generation_mode"),
                "edit_sub_mode": params.get("edit_sub_mode"),
                "multi_clip_info": params.get("multi_clip_info"),
                # A media file can become visible while a multi-window job is
                # still writing it, before Cue Studio publishes the authoritative
                # sidecar.  Surface this transition so an already-mounted gallery
                # card can replace temporary embedded generation metadata with the
                # final source-prompt/window-plan provenance.
                "metadata_ready": True,
                "metadata_updated_at": os.path.getmtime(meta_path),
            }
            mci = sidecar_cache[name]["multi_clip_info"]
            if mci and mci.get("group_id"):
                gid = mci["group_id"]
                if gid not in clip_groups:
                    clip_groups[gid] = {"total": mci.get("total", 0), "highest_index": -1, "has_final": False}
                clip_groups[gid]["highest_index"] = max(clip_groups[gid]["highest_index"], mci.get("index", 0))

        for gid, info in clip_groups.items():
            if info["highest_index"] >= info["total"] - 1:
                info["has_final"] = True

        # Second pass: build the file list using the cached sidecar data.
        files = []
        for name, filepath, ext, mtime in raw_entries:
            ftype = "video" if ext in video_exts else ("audio" if ext in audio_exts else "image")
            cached = sidecar_cache.get(name) or {}
            mode = cached.get("mode")
            edit_sub_mode = cached.get("edit_sub_mode")
            mci = cached.get("multi_clip_info")
            is_intermediate_clip = False
            if mci and mci.get("group_id"):
                gid = mci["group_id"]
                group = clip_groups.get(gid, {})
                if group.get("has_final"):
                    is_intermediate_clip = True
                elif mci.get("index", 0) < group.get("highest_index", 0):
                    is_intermediate_clip = True

            if is_intermediate_clip:
                continue
            # The file may vanish between os.scandir() and here (temp files renamed
            # mid-generation, etc.). Skip the entry rather than crashing the endpoint.
            try:
                size = os.path.getsize(filepath)
            except (FileNotFoundError, OSError):
                continue
            files.append({
                "name": name,
                "type": ftype,
                "mode": mode,
                # Surface edit_sub_mode so the gallery's Edits filter can
                # identify retake/inpaint/outpaint/restyle/edit_anything outputs.
                "edit_sub_mode": edit_sub_mode,
                "favorite": name in favs,
                "workspace": browsed_workspace,
                "size": size,
                "created_at": mtime,
                "metadata_ready": bool(cached.get("metadata_ready")),
                "metadata_updated_at": cached.get("metadata_updated_at"),
                "url": f"/api/v1/file/{name}",
            })

        # Special filters: return ALL matches, bypass pagination
        if favorites_only:
            files = [f for f in files if f["favorite"]]
            return {"outputs": files, "total": len(files)}
        if multiclip_only:
            # 1. Explicit multiclip files
            multiclips = [f for f in files if "multiclip" in f["name"].lower() and f["type"] == "video"]
            multiclip_names = {f["name"] for f in multiclips}

            # 2. Sliding window final outputs: group videos by seed+prompt, keep only the largest
            # Filename pattern: datetime_seedNNNN_prompt_text.mp4
            import re as _re_mc
            seed_pattern = _re_mc.compile(r'^\d{4}-\d{2}-\d{2}-\d{2}h\d{2}m\d{2}s_(seed\d+_.+)\.(mp4|webm|mkv)$', _re_mc.IGNORECASE)
            groups: dict[str, list[dict]] = {}
            for f in files:
                if f["type"] != "video" or f["name"] in multiclip_names:
                    continue
                # Skip tmp files
                if "_tmp." in f["name"]:
                    continue
                m = seed_pattern.match(f["name"])
                if m:
                    group_key = m.group(1)  # seed123_prompt text
                    groups.setdefault(group_key, []).append(f)

            # From groups with multiple files (sliding window), keep only the largest
            sw_finals = []
            print(f"[Multiclip] Found {len(groups)} seed+prompt groups from {len(files)} total files")
            for group_key, group_files in groups.items():
                if len(group_files) > 1:
                    # Verify files are close in time (within 2 hours)
                    times = [f["created_at"] for f in group_files]
                    time_span = max(times) - min(times)
                    if time_span < 7200:
                        largest = max(group_files, key=lambda f: f["size"])
                        print(f"[Multiclip] SW group '{group_key[:60]}': {len(group_files)} files, span={time_span:.0f}s, largest={largest['name'][:60]}")
                        sw_finals.append(largest)
                    else:
                        print(f"[Multiclip] SW group '{group_key[:60]}': {len(group_files)} files, SKIPPED (time span {time_span:.0f}s > 7200)")

            combined = multiclips + sw_finals
            combined.sort(key=lambda f: f["created_at"], reverse=True)
            print(f"[Multiclip] Result: {len(multiclips)} multiclips + {len(sw_finals)} sliding window finals = {len(combined)} total")
            return {"outputs": combined, "total": len(combined)}
        if search:
            from services.search_index import get_search_index
            idx = get_search_index()
            matching_names = idx.search(search, out_dir)
            # Combine index results with filename fallback (in case index missed
            # a file that was created between index builds)
            query_lower = search.lower()
            files = [f for f in files if f["name"] in matching_names or query_lower in f["name"].lower()]
            return {"outputs": files, "total": len(files)}

        total = len(files)
        if limit > 0:
            files = files[offset:offset + limit]
        return {"outputs": files, "total": total}

    def serve_file(self, filename: str, workspace: str = ""):
        """Serve an output file. Checks active workspace first, then all workspaces.

        Uses share_delete_file_response so that on Windows the file can be
        deleted/renamed by the gallery delete button even while the browser
        is actively streaming it (e.g. mid-video playback). Without share-
        delete, Python's default open() locks the file for delete and the
        user has to close the entire app to clean up.
        """
        from services.win_safe_files import share_delete_file_response
        save_root = self.deps.projects_root()
        requested_workspace = str(workspace or "").strip()
        if requested_workspace:
            if requested_workspace == "__uploads__":
                requested_root = os.path.join(os.getcwd(), "uploads")
            else:
                requested_root = self.deps.workspace_browse_dir(requested_workspace)
                if requested_root is None:
                    raise HTTPException(status_code=400, detail="Invalid workspace name")
            filepath = self.deps.safe_join(requested_root, filename)
            if filepath and os.path.isfile(filepath):
                return share_delete_file_response(filepath)
            raise HTTPException(status_code=404, detail="File not found")
        # 1. Check active workspace
        filepath = self.deps.safe_join(self.deps.workspace_dir(), filename)
        if filepath and os.path.isfile(filepath):
            return share_delete_file_response(filepath)
        # 2. Check base save_path (pre-workspace files)
        filepath = self.deps.safe_join(save_root, filename)
        if filepath and os.path.isfile(filepath):
            return share_delete_file_response(filepath)
        # 3. Search all workspace subdirectories (Director pipeline may have saved
        #    to a different workspace than the one currently active in the browser)
        if os.path.isdir(save_root):
            for d in os.listdir(save_root):
                candidate = self.deps.safe_join(save_root, d, filename)
                if candidate and os.path.isfile(candidate):
                    return share_delete_file_response(candidate)
        # 4. Uploads folder — the gallery's virtual "Uploads" view lists these
        #    files with the same /api/v1/file/ URLs every other gallery flow
        #    builds (thumbnails, playback, send-to-input). Upload names are
        #    hash-uniquified at upload time, and outputs are checked first, so
        #    an output name can never be shadowed by an upload.
        filepath = self.deps.safe_join(os.path.join(os.getcwd(), "uploads"), filename)
        if filepath and os.path.isfile(filepath):
            return share_delete_file_response(filepath)
        raise HTTPException(status_code=404, detail="File not found")

    def get_output_metadata(self, name: str):
        """Get metadata for an output file. Tries sidecar first, then embedded."""
        out_dir = self.deps.workspace_dir()
        filepath = self.deps.safe_join(out_dir, name)
        if filepath is None or not os.path.isfile(filepath):
            raise HTTPException(status_code=404, detail="Output file not found")

        # Helper: read embedded metadata from the media file
        def _read_embedded():
            ext = os.path.splitext(name)[1].lower()
            try:
                if ext in (".mp4", ".mkv"):
                    from shared.utils.video_metadata import read_metadata_from_video
                    return read_metadata_from_video(filepath)
                elif ext in (".png", ".jpg", ".jpeg", ".webp"):
                    from shared.utils.audio_video import read_image_metadata
                    return read_image_metadata(filepath)
                elif ext in (".wav", ".mp3"):
                    from shared.utils.audio_metadata import read_audio_metadata
                    return read_audio_metadata(filepath)
            except Exception:
                pass
            return None

        # Strategy 1: Read sidecar .meta.json
        meta_path = os.path.join(out_dir, os.path.splitext(name)[0] + ".meta.json")
        if os.path.isfile(meta_path):
            try:
                with open(meta_path, "r", encoding="utf-8") as f:
                    sidecar = json.load(f)
                # Merge actual seed from embedded metadata if sidecar has seed=-1
                params = sidecar.get("params", {})
                if params.get("seed", -1) == -1:
                    embedded = _read_embedded()
                    if embedded and "seed" in embedded:
                        params["seed"] = embedded["seed"]
                    else:
                        resolved_seed = self.deps.extract_output_seed(name)
                        if resolved_seed is not None:
                            params["seed"] = resolved_seed
                return {"source": "sidecar", **sidecar}
            except Exception:
                pass

        # Strategy 2: Read embedded metadata from media file
        embedded = _read_embedded()
        if embedded:
            return {"source": "embedded", "params": embedded}

        return {"source": "none", "params": None}


def build_media_library_router(library: MediaLibrary) -> APIRouter:
    router = APIRouter(tags=["media"])
    router.add_api_route("/api/v1/favorites", library.list_favorites, methods=["GET"])
    router.add_api_route("/api/v1/favorites/{name}", library.toggle_favorite, methods=["POST"])
    router.add_api_route("/api/v1/outputs", library.list_outputs, methods=["GET"])
    router.add_api_route("/api/v1/file/{filename:path}", library.serve_file, methods=["GET"])
    router.add_api_route("/api/v1/outputs/{name}/metadata", library.get_output_metadata, methods=["GET"])
    return router
