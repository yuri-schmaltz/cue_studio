"""Tests for the Cue Studio CLI.

We use Click's CliRunner to test the in-process CLI directly. This
avoids spawning subprocesses for every assertion and gives us clean
isolation of the tempdir we use for the Style Bible registry.

The tests cover:
  - `cue-studio status` returns version + paths.
  - `cue-studio style-bible list` lists Bibles in the registry dir.
  - `cue-studio style-bible show ID` prints the full Bible JSON.
  - `cue-studio style-bible delete ID` removes the file (with -y to
    skip the confirm prompt).
  - `cue-studio style-bible validate PATH` accepts a valid Bible and
    rejects an invalid one.
  - `cue-studio style-bible delete __default__` is refused (reserved
    id).
"""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from click.testing import CliRunner

from app.cli import cli
from app.services.style_bible import (
    BIBLE_DEFAULT_DIR,
    StyleBible,
    BibleMetadata,
    PromptBuilder,
)


def _write_sample_bible(directory: Path) -> Path:
    """Write a small valid Bible to `directory` and return the path."""
    directory.mkdir(parents=True, exist_ok=True)
    bible = StyleBible(
        metadata=BibleMetadata(id="test-cli-bible", title="CLI Test Bible"),
        characters={
            "ana": __import__("app.services.style_bible", fromlist=["CharacterAnchor"]).CharacterAnchor(
                id="ana", name="Ana",
                physical_description="a woman in her 30s",
            ),
        },
    )
    path = directory / "test-cli-bible.json"
    path.write_text(json.dumps(bible.to_dict(), indent=2), encoding="utf-8")
    return path


class StatusCommandTests(unittest.TestCase):
    def test_status_prints_version_and_paths(self):
        runner = CliRunner()
        result = runner.invoke(cli, ["status"])
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("Cue Studio v", result.output)
        self.assertIn("Repo root:", result.output)
        self.assertIn("App root:", result.output)


class StyleBibleCommandTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)

    def _patch_default_dir(self):
        """Patch BIBLE_DEFAULT_DIR at every location so all registry
        calls land in our tempdir. The default value is captured at
        function-definition time on `registry.list_bibles` etc., so we
        have to patch both the package-level export and the
        module-level constant used by `list_bibles` etc."""
        import app.services.style_bible as sb_pkg
        import app.services.style_bible.registry as reg
        from contextlib import ExitStack
        stack = ExitStack()
        # Patch the module-level constant that list_bibles/load_bible
        # /save_bible/delete_bible read by default.
        stack.enter_context(patch.object(reg, "BIBLE_DEFAULT_DIR", self.dir))
        # Also patch the package's re-export so callers that import
        # `BIBLE_DEFAULT_DIR` from `app.services.style_bible` see the
        # new value.
        stack.enter_context(patch.object(sb_pkg, "BIBLE_DEFAULT_DIR", self.dir))
        return stack

    def test_list_with_no_bibles_prints_message(self):
        with self._patch_default_dir():
            runner = CliRunner()
            result = runner.invoke(cli, ["style-bible", "list"])
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("No Style Bibles", result.output)

    def test_list_shows_existing_bible(self):
        _write_sample_bible(self.dir)
        with self._patch_default_dir():
            runner = CliRunner()
            result = runner.invoke(cli, ["style-bible", "list"])
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("test-cli-bible", result.output)
        self.assertIn("CLI Test Bible", result.output)

    def test_show_prints_json(self):
        _write_sample_bible(self.dir)
        with self._patch_default_dir():
            runner = CliRunner()
            result = runner.invoke(cli, ["style-bible", "show", "test-cli-bible"])
        self.assertEqual(result.exit_code, 0, result.output)
        # Output is valid JSON
        parsed = json.loads(result.output)
        self.assertEqual(parsed["metadata"]["id"], "test-cli-bible")
        self.assertIn("ana", parsed["characters"])

    def test_show_missing_bible_exits_nonzero(self):
        with self._patch_default_dir():
            runner = CliRunner()
            result = runner.invoke(cli, ["style-bible", "show", "nonexistent"])
        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("not found", result.output.lower())

    def test_delete_with_yes_flag_removes_file(self):
        _write_sample_bible(self.dir)
        with self._patch_default_dir():
            runner = CliRunner()
            result = runner.invoke(cli, ["style-bible", "delete", "test-cli-bible", "--yes"])
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("Deleted", result.output)
        self.assertFalse((self.dir / "test-cli-bible.json").exists())

    def test_delete_refuses_reserved_id(self):
        with self._patch_default_dir():
            runner = CliRunner()
            result = runner.invoke(cli, ["style-bible", "delete", "__default__", "--yes"])
        self.assertEqual(result.exit_code, 2)
        self.assertIn("reserved", result.output.lower())

    def test_delete_missing_bible_exits_nonzero(self):
        with self._patch_default_dir():
            runner = CliRunner()
            result = runner.invoke(cli, ["style-bible", "delete", "nonexistent", "--yes"])
        self.assertNotEqual(result.exit_code, 0)

    def test_delete_confirms_without_yes_flag(self):
        _write_sample_bible(self.dir)
        with self._patch_default_dir():
            runner = CliRunner()
            # Without --yes, Click prompts. We feed "n" + newline to
            # cancel.
            result = runner.invoke(
                cli,
                ["style-bible", "delete", "test-cli-bible"],
                input="n\n",
            )
        self.assertIn("Aborted", result.output)
        self.assertTrue((self.dir / "test-cli-bible.json").exists())

    def test_validate_accepts_valid_bible(self):
        path = _write_sample_bible(self.dir)
        runner = CliRunner()
        result = runner.invoke(cli, ["style-bible", "validate", str(path)])
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("OK", result.output)
        self.assertIn("test-cli-bible", result.output)

    def test_validate_rejects_invalid_json(self):
        bad = self.dir / "broken.json"
        bad.write_text("{ not valid json", encoding="utf-8")
        runner = CliRunner()
        result = runner.invoke(cli, ["style-bible", "validate", str(bad)])
        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("INVALID", result.output)

    def test_validate_rejects_missing_metadata_key(self):
        # A file that parses as JSON but doesn't have the required
        # 'metadata' key.
        bad = self.dir / "no-metadata.json"
        bad.write_text('{"characters": {}}', encoding="utf-8")
        runner = CliRunner()
        result = runner.invoke(cli, ["style-bible", "validate", str(bad)])
        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("INVALID", result.output)


class GalleryCommandTests(unittest.TestCase):
    def test_gallery_no_outputs_dir_exits_nonzero(self):
        with tempfile.TemporaryDirectory() as td:
            fake_outputs = Path(td) / "outputs"
            runner = CliRunner()
            with patch("app.cli.APP_ROOT", Path(td)):
                result = runner.invoke(cli, ["gallery"])
        self.assertNotEqual(result.exit_code, 0)
        self.assertIn("No outputs directory", result.output)


class VersionFlagTests(unittest.TestCase):
    def test_version_flag_prints_version(self):
        runner = CliRunner()
        result = runner.invoke(cli, ["--version"])
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("cue-studio, version", result.output)

    def test_help_prints_subcommands(self):
        runner = CliRunner()
        result = runner.invoke(cli, ["--help"])
        self.assertEqual(result.exit_code, 0, result.output)
        for sub in ("gallery", "status", "style-bible"):
            self.assertIn(sub, result.output)


if __name__ == "__main__":
    unittest.main()
