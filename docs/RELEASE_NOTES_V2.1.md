# Maestro v2.1

> **Update — 2026-09-15.** This document was originally written when
> the project was still named Maestro. As of the v2.1 patch release
> on 2026-09-15, the project has been renamed to **Cue Studio**. The
> product identity (Director / Studio / Editor modes, theme family,
> backend pipeline) is unchanged. See the [Rebrand](#rebrand)
> section below for the visual identity refresh and compatibility
> shims. The historical release notes below are preserved verbatim.

The v2.1 patch promotes the technical "Project Setup" choices from a
per-pipeline sidebar to a per-project configuration. Every project now
bakes in its own aspect ratio, resolution, workflow mode, video + image
models, audio default, default LoRAs and advanced defaults the moment
the project is created. The Director's right column is now strictly
per-take.

## Highlights

- **Project Setup lives on the workspace.** Aspect ratio, resolution,
  Seamless / Auto toggles, video + image model, music source, and
  Advanced defaults are now stored in `outputs/<project>/setup.json`.
  Old in-pipeline `director_ui_snapshot` values still load when you
  open a saved pipeline — the migration is automatic on first read.
- **The New project dialog collects setup up front.** No more flipping
  back to the right column after planning starts. The "Project setup
  is locked after planning begins" warning is gone — those choices
  are settled once, at creation.
- **Edit setup from the project card.** A gear icon next to each
  project lets the user change the project defaults at any time.
  Changes apply on the next workspace switch.
- **The right column is per-take.** Shows a "Project defaults" chip at
  the top with a Reset button so per-take overrides stay explicit.
  Removing the lock means the user can change aspect ratio or model
  mid-take without a separate "Edit project" detour.
- **Robust endpoint surface.** New `GET /api/v1/workspaces/<name>/setup`
  and `PUT /api/v1/workspaces/<name>/setup`. The list endpoint embeds
  the setup so the project card can render the "16:9 · 720p · LTX-2"
  chip without a second round-trip. Atomic temp-file write so a
  crashed save never corrupts setup.json.
- **Validation + forward-compat.** Bad payloads are rejected at the
  HTTP boundary (HTTP 400) with a clear message. Unknown keys are
  stripped before persist. Schema version 1 with a forward-compat path
  for v2 fields when the schema bumps.

## API changes

```
GET   /api/v1/workspaces                 # now embeds `setup` per workspace
GET   /api/v1/workspaces/<name>/setup    # 200 + setup defaults if absent
PUT   /api/v1/workspaces/<name>/setup    # 200 on success, 400 on bad shape
```

## Schema

`setup.json` shape (persisted at `outputs/<project>/setup.json`):

```json
{
  "schema_version": 1,
  "aspect_ratio": "16:9",
  "resolution": "720p",
  "seamless": false,
  "auto_mode": false,
  "video_model": "ltx2_22B_distilled_1_1",
  "image_model": "flux2_klein_9b",
  "music_source": "upload",
  "music_model": "",
  "default_image_loras": {},
  "default_video_loras": {},
  "advanced": {}
}
```

Field semantics:

| key                 | type    | meaning                                              |
|---------------------|---------|------------------------------------------------------|
| aspect_ratio        | string  | 16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9 (H3 only)      |
| resolution          | string  | 480p / 540p / 720p / 1080p (no `auto` — per-take)   |
| seamless            | bool    | Continuous sliding-window timeline                   |
| auto_mode           | bool    | Skip every review step                               |
| video_model         | string  | Project's default video model id (empty = inherit)   |
| image_model         | string  | Project's default image model id                     |
| music_source        | string  | "upload" or "generate"                               |
| music_model         | string  | Music model id when music_source = "generate"        |
| default_image_loras | object  | Activated + multipliers for image LoRAs              |
| default_video_loras | object  | Activated + multipliers for video LoRAs              |
| advanced            | object  | Free-form forward-compat blob                        |
| schema_version      | integer | Bump on breaking changes                             |

## Tests

- 13 new backend tests in `tests/test_project_setup.py` covering
  validation, atomic persist, partial-persist, traversal rejection,
  unknown-key stripping, future-schema resilience, and default-workspace
  refusal.
- All 13 pass in a clean venv. Full project test count went from 102
  → 115 (same 1 pre-existing Playwright failure remains; unrelated
  to this patch).

## Migration notes

- **For users opening an existing project for the first time after
  v2.1 lands**: the workspace falls back to schema defaults (16:9,
  720p, both toggles off, no model). Open the Edit setup dialog to
  fill in the values from your last run; subsequent runs use those.
- **For pipelines opened from `director_ui_snapshot`**: values from
  the snapshot still hydrate the runtime fields, so Open & Edit
  preserves whatever aspect ratio + resolution the user had when
  the pipeline ran. The new Project Setup applies only on the next
  fresh planning session.

## Rebrand

Cue Studio v2.1 also renames the project from **Maestro** to **Cue
Studio**. The product identity, feature set, theme family, and
backend pipeline are unchanged. This is a visual and naming refresh
that repositions the product as a cinematography-first local AI
studio.

### Why the rename

"Maestro" was evocative but generic — there are dozens of products in
finance, education, and music called Maestro. The product's actual
identity is **a cinematography-first local AI studio**: it plans
shots (Director Mode), writes screenplays, syncs generation to
musical beats, edits on a multi-track timeline, and ships a
warm-cinematic default theme called Golden Hour. The new name,
**Cue Studio**, signals that identity directly:

- **Cue** — the universal film/TV/audio signal for "this is your
  starting point". In the Director music-video workflow the LLM
  literally plans shots against musical cues; in the Short Film
  workflow it plans against story beats. The word is short, ownable,
  and immediately legible to anyone who has been on a film set or
  spent ten minutes in a DAW.
- **Studio** — the promise of a complete creation surface, not just a
  generator. The app already is a studio (Director + Studio + Editor
  modes), and the name makes that explicit.

### Visual identity

**Logo — Direction B (monogram + take marker).** The new glyph is a
rounded square with two primitives inside: an open circle bisected by
a horizontal bar. That shape reads as a **take marker** — the
universal symbol on a clapperboard for "this is the take we're
rolling". It is visually distinct from a play button (the circle is
open, not filled) and from a record dot (the bar is inside, not
above). The glyph scales cleanly from 16×16 (favicon) to 1024×1024
(PWA home icon) because it has no fine detail.

**Wordmark.** `Cue` is set in warm amber (`#f59e0b`) at bold weight,
paired with `Studio` in muted cream (`#9898a8`) at regular weight.
The two-color treatment keeps the brand readable when scaled down
and makes the "Cue" portion the recognizable element when the
wordmark is truncated.

### Default palette migration

The Classic theme now ships with **amber/gold accents** instead of
cool blue. This aligns the default theme with the warm-cinematic
identity already established by Golden Hour, eliminates the prior
tension between the blue accent and the warm Golden Hour default,
and creates a coherent brand color that runs through every theme:

| Theme | Accent family | Notes |
|---|---|---|
| Classic (default, dark) | Amber → gold | New brand default |
| Golden Hour | Red → orange → amber (sunset) | Unchanged |
| Daylight (Classic light) | Burnt orange → amber | Updated to match |
| Ivory (Golden Hour light) | Burnt orange → deep amber | Unchanged |
| Onyx | Monochrome | Unchanged |
| Pearl | Monochrome | Unchanged |

### Compatibility shims

The rebrand preserves all backwards-compatibility entry points so
existing installs and integrations don't break:

- **Console scripts:** `cue-studio`, `cue`, and `maestro` all
  delegate to the same entry point (`maestro_cli:main`).
- **PWA manifest:** the installable app's `name` and `short_name`
  are "Cue Studio" / "Cue". The `id` stays `/` so existing
  installations are recognized as the same app rather than as a new
  install.
- **localStorage theme keys:** legacy `maestro-theme*` keys continue
  to resolve. New writes go to `cue-theme*` keys. The boot script
  migrates them transparently.
- **API routes:** `/api/v1/*` paths are unchanged. The app-name
  reported in `/api/v1/settings` is now `Cue Studio`.
- **Window/document.title:** updated to "Cue Studio".
- **Favicon:** served from `/cue-studio-icon.svg` (the SVG is the
  canonical asset; the previous `maestro.svg` is preserved on disk
  as a legacy alias during the transition period).

### New assets

- `ui/public/cue-studio.svg` — wordmark (220×64).
- `ui/public/cue-studio-icon.svg` — favicon / PWA icon (64×64,
  vector, scales to any size).

### Validation

The rebrand was validated against:

- `npm run build` — clean build of the UI (TypeScript + Vite).
- `npm run lint` — clean ESLint pass.
- `node scripts/store-gauntlet.mjs` — six store suites pass.
- `node scripts/control-gauntlet.mjs` — two control phases pass.
- `pytest` — full Python test suite passes.
