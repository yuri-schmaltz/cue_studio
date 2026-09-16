"""Cue Studio CLI — small companion to the GUI for status / inspection tasks.

Pattern lifted from directo_studio v1.1.5: a `directo` console script
exposes a Click group with subcommands like `directo status`,
`directo gallery list`, `directo backup queue`. We mirror the shape
here for the Cue Studio side: a `cue-studio` console script (with
`cue` as a shorter alias) with subcommands for the things that are
useful from a terminal.

The CLI deliberately stays small. Anything that needs the running
backend (generation, Director, Editor) lives in the FastAPI app; the
CLI is for read-only inspection and local config management that
doesn't need the model stack loaded.

Subcommands:
  - cue-studio status                : print Cue Studio version + env summary
  - cue-studio gallery list [--limit]: list recent generated media
  - cue-studio style-bible list      : list saved Style Bibles
  - cue-studio style-bible show ID   : print a Bible's full JSON
  - cue-studio style-bible delete ID : delete a Bible (refuses reserved ids)
  - cue-studio style-bible validate PATH: validate a Bible file (JSON or YAML)

Why Click: the project's existing deps already include Click (used by
setup.py for the env manager). No new dependency is required.

Run ``cue-studio --help`` or ``cue-studio SUBCOMMAND --help`` for usage.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Optional

import click

# Cue Studio root paths — same convention used by app/launch.py and
# app/setup.py. We resolve them once at import time so every
# subcommand gets the same view of "where the data lives".
APP_ROOT = Path(__file__).resolve().parent  # .../app/
REPO_ROOT = APP_ROOT.parent
VERSION_FILE = REPO_ROOT / "VERSION"


def _read_version() -> str:
    try:
        return VERSION_FILE.read_text(encoding="utf-8").strip() or "0.0.0+unknown"
    except OSError:
        return "0.0.0+unknown"


# Lazy imports inside subcommand handlers — we don't want `cue-studio
# status` to require importing torch / diffusers / etc. The CLI is
# a lightweight entry point and should stay fast.


@click.group()
@click.version_option(_read_version(), prog_name="cue-studio")
def cli() -> None:
    """Cue Studio — companion CLI for status, gallery, and Style Bible tasks."""


@cli.command()
def status() -> None:
    """Print Cue Studio version, repo root, and a few key paths."""
    version = _read_version()
    click.echo(f"Cue Studio v{version}")
    click.echo(f"Repo root:  {REPO_ROOT}")
    click.echo(f"App root:   {APP_ROOT}")
    click.echo(f"Settings:   {APP_ROOT / 'settings'}")
    click.echo(f"Outputs:    {APP_ROOT / 'outputs'}")
    click.echo(f"LoRAs:      {APP_ROOT / 'loras'}")


@cli.command("gallery")
@click.option("--limit", default=10, show_default=True, type=int,
              help="Maximum number of entries to print.")
@click.option("--workspace", default=None,
              help="Workspace name under app/outputs/ (defaults to the first one found).")
def gallery_cmd(limit: int, workspace: Optional[str]) -> None:
    """List recent generated media (best-effort, no model stack)."""
    outputs_root = APP_ROOT / "outputs"
    if not outputs_root.is_dir():
        click.echo(f"No outputs directory at {outputs_root}; nothing to list.", err=True)
        sys.exit(1)

    if workspace is None:
        candidates = sorted(p for p in outputs_root.iterdir() if p.is_dir())
        if not candidates:
            click.echo(f"No workspaces under {outputs_root}.", err=True)
            sys.exit(1)
        workspace_path = candidates[0]
        click.echo(f"# (no --workspace given; using {workspace_path.name})")
    else:
        workspace_path = outputs_root / workspace
        if not workspace_path.is_dir():
            click.echo(f"Workspace not found: {workspace_path}", err=True)
            sys.exit(1)

    media_exts = {".png", ".jpg", ".jpeg", ".webp", ".mp4", ".webm", ".gif", ".wav", ".mp3"}
    files: list[Path] = []
    for ext in media_exts:
        files.extend(workspace_path.rglob(f"*{ext}"))
    # Sort by mtime descending so the most recent is first.
    files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    files = files[:limit]
    if not files:
        click.echo(f"No media found under {workspace_path}.")
        return
    click.echo(f"# {len(files)} most recent file(s) in {workspace_path.name}:")
    for path in files:
        try:
            size = path.stat().st_size
        except OSError:
            size = 0
        rel = path.relative_to(workspace_path)
        click.echo(f"  {rel}  ({_human_size(size)})")


@cli.group()
def style_bible() -> None:
    """Inspect and manage local Style Bibles."""


@style_bible.command("list")
def style_bible_list() -> None:
    """List every Style Bible saved under app/settings/style_bibles/."""
    from app.services.style_bible import list_bibles
    bibles = list_bibles()
    if not bibles:
        click.echo("No Style Bibles found.")
        return
    click.echo(f"# {len(bibles)} Style Bible(s):")
    for bible in bibles:
        n_chars = len(bible.characters)
        n_envs = len(bible.environments)
        n_loras = len(bible.loras)
        tags = ", ".join(bible.metadata.tags) if bible.metadata.tags else ""
        click.echo(
            f"  {bible.metadata.id:30s}  {bible.metadata.title:40s}  "
            f"chars={n_chars} envs={n_envs} loras={n_loras}"
            + (f"  [tags: {tags}]" if tags else "")
        )


@style_bible.command("show")
@click.argument("bible_id")
def style_bible_show(bible_id: str) -> None:
    """Print a Bible's full contents as JSON to stdout."""
    from app.services.style_bible import load_bible
    try:
        bible = load_bible(bible_id)
    except FileNotFoundError as exc:
        click.echo(str(exc), err=True)
        sys.exit(1)
    click.echo(json.dumps(bible.to_dict(), indent=2, ensure_ascii=False))


@style_bible.command("delete")
@click.argument("bible_id")
@click.option("--yes", "-y", is_flag=True, help="Skip the confirmation prompt.")
def style_bible_delete(bible_id: str, yes: bool) -> None:
    """Delete a Style Bible by id (refuses reserved ids like __default__)."""
    from app.services.style_bible import delete_bible
    if not yes:
        if not click.confirm(f"Delete Style Bible {bible_id!r}?", default=False):
            click.echo("Aborted.")
            return
    try:
        removed = delete_bible(bible_id)
    except ValueError as exc:
        click.echo(f"Refusing to delete: {exc}", err=True)
        sys.exit(2)
    if removed:
        click.echo(f"Deleted {bible_id}.")
    else:
        click.echo(f"No Style Bible named {bible_id!r} found.", err=True)
        sys.exit(1)


@style_bible.command("validate")
@click.argument("path", type=click.Path(exists=True, dir_okay=False, path_type=Path))
def style_bible_validate(path: Path) -> None:
    """Validate a Bible file (JSON or YAML) and report shape errors."""
    from app.services.style_bible import load_bible_from_path
    try:
        bible = load_bible_from_path(path)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        click.echo(f"INVALID: {path}: {exc}", err=True)
        sys.exit(1)
    except Exception as exc:  # PyYAML raises its own type
        click.echo(f"INVALID: {path}: {exc}", err=True)
        sys.exit(1)
    click.echo(
        f"OK: {path} — id={bible.metadata.id!r} title={bible.metadata.title!r} "
        f"characters={len(bible.characters)} environments={len(bible.environments)} "
        f"loras={len(bible.loras)}"
    )


def _human_size(num_bytes: int) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if num_bytes < 1024:
            return f"{num_bytes:.0f} {unit}" if unit == "B" else f"{num_bytes:.1f} {unit}"
        num_bytes /= 1024
    return f"{num_bytes:.1f} PB"


def main() -> None:
    """Console-script entry point. Defined separately so the function
    is importable for tests (we can call it directly with a
    Click.testing.CliRunner instead of going through the
    cue-studio console script).

    This function assumes the repo root is already on sys.path.
    The actual pip-installed wrapper at cli/__init__.py
    handles that — we keep this function side-effect-free for ease
    of testing."""
    cli()


if __name__ == "__main__":
    main()
