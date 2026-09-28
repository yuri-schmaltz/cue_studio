# Video Editor — backend timeline CRUD + ffmpeg concat export

> **Status:** Backend-only preview (v2.5.0, Phase D-min of the HocusPocus
> migration). The frontend timeline UI is a separate, multi-sprint
> follow-up. The HTTP surface is stable and tested; you can build a
> custom UI on top of it today.

The Video Editor is a **durable timeline of clips** plus a thin export
wrapper around the existing `wgp.concatenate_multi_clip_videos` helper.
This is the smallest, safest slice of the HocusPocus "editor" capability
that can ship without dragging in the 4-5 sprint UI effort.

---

## Surface

### HTTP (FastAPI router)

| Method | Path | Purpose |
|--------|------|---------|
| `GET`    | `/api/v1/editor/projects` | List projects (most-recent first). |
| `POST`   | `/api/v1/editor/projects` | Create a new project. |
| `GET`    | `/api/v1/editor/projects/{id}` | Get one project. |
| `DELETE` | `/api/v1/editor/projects/{id}` | Delete a project. |
| `POST`   | `/api/v1/editor/projects/{id}/clips` | Append a clip. |
| `DELETE` | `/api/v1/editor/projects/{id}/clips/{clip_id}` | Remove one clip. |
| `POST`   | `/api/v1/editor/projects/{id}/clips/reorder` | Reorder clips by id. |
| `POST`   | `/api/v1/editor/projects/{id}/clips/{clip_id}/trim` | Set clip start/end. |
| `POST`   | `/api/v1/editor/projects/{id}/clips/{clip_id}/split` | Split clip at seconds. |
| `POST`   | `/api/v1/editor/projects/{id}/export` | Concatenate to mp4. |

### MCP tools (`/api/v1/mcp`)

| Tool | Mode | Description |
|------|------|-------------|
| `editor_list_projects` | read-only | List projects (most-recent first). |
| `editor_export` | read-mostly | Export one project to mp4. |

---

## Data model

A project is a JSON document under `<CUE_CONFIG_DIR>/editor/<id>.json`:

```json
{
  "id": "abc123",
  "title": "Reel",
  "state": "prepared",
  "created_at": 1727560000.0,
  "updated_at": 1727560000.0,
  "output_path": null,
  "error": null,
  "clips": [
    {
      "id": "clip1",
      "media_path": "/path/to/shot.mp4",
      "start": 0.0,
      "end": 12.5,
      "label": "intro",
      "audio_gain": 1.0
    }
  ]
}
```

`state ∈ {prepared, running, completed, failed, cancelled}`. Only
`prepared` is written by client code today; `running`, `completed`,
`failed` are emitted by `export()`.

---

## Export path

`POST /api/v1/editor/projects/{id}/export` calls
`app.wgp.concatenate_multi_clip_videos(clip_paths, output_path)`. This
is the same ffmpeg concat-FILTER pipeline the Director already trusts,
so output is uniform across Director and Editor exports.

If `output_path` is omitted, the editor writes to
`<CUE_CONFIG_DIR>/editor/<id>.mp4`. If `ffmpeg` isn't on `$PATH`, the
router returns `400` with a descriptive message.

---

## Storage

- **Root:** `os.environ.get("CUE_CONFIG_DIR", "~/.cue_studio") + "/editor"`
- **Format:** one JSON file per project
- **Atomicity:** write to `.json.tmp`, `fsync`, `os.replace`
- **Permissions:** inherited from the process (no chmod)

---

## Security

- All endpoints are **read-or-write-the-project-tree only** — no
  arbitrary file access. `media_path` is stored verbatim and read by
  ffmpeg at export time; the editor itself never opens it.
- Project ids are validated to reject `/`, `\`, `..` to keep the
  filesystem store scoped to the editor root.
- JSON payloads are normalized on every load (`_clean_project`,
  `_clean_clip`) so a corrupt or hand-edited file can't poison the API.

---

## Failure modes

| Symptom | Cause | Fix |
|---------|-------|-----|
| `ffmpeg not on PATH` on export | The binary is missing | Install ffmpeg or set `FFMPEG_BINARY` |
| `Cannot export a project with no clips` | Empty timeline | Add at least one clip first |
| `Project not found` after create | File was deleted externally | Restore the JSON or re-create |
| `split point must lie strictly inside the clip` | Split at boundary | Pick a value strictly between `start` and `end` |

---

## Migration context

Phase D-min of the HocusPocus migration. See
[`MIGRATION_HOCUSPOCUS.md`](MIGRATION_HOCUSPOCUS.md) for the
roadmap of the original "video editor" work, why we shipped the
backend first, and what's left for the UI follow-up.

The backend ships in v2.5.0 with **50 dedicated tests** (33 service +
17 router) and an integration smoke test (MCP tools) that exercises
the full editor → ffmpeg pipeline.
