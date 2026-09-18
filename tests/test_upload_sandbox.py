"""Tests for the upload sandbox helper."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "app") not in sys.path:
    sys.path.insert(0, str(ROOT / "app"))

from services import upload_sandbox  # noqa: E402


class SanitiseFilenameTests(unittest.TestCase):
    def test_none_returns_uuid(self) -> None:
        out = upload_sandbox.sanitise_filename(None)
        self.assertTrue(len(out) >= 8)

    def test_strips_directory_traversal(self) -> None:
        self.assertEqual(upload_sandbox.sanitise_filename("../../etc/passwd"), "passwd")
        self.assertEqual(upload_sandbox.sanitise_filename("/etc/passwd"), "passwd")

    def test_keeps_simple_names(self) -> None:
        self.assertEqual(upload_sandbox.sanitise_filename("song.mp3"), "song.mp3")

    def test_replaces_spaces(self) -> None:
        self.assertEqual(upload_sandbox.sanitise_filename("my song.mp3"), "my song.mp3")

    def test_drops_pathological_chars(self) -> None:
        out = upload_sandbox.sanitise_filename("$HOME; rm -rf;.mp3")
        # Dollar signs, semicolons, spaces, etc. get stripped; final stays
        # a valid stem.
        self.assertNotIn(";", out)
        self.assertNotIn("$", out)
        self.assertTrue(out.endswith(".mp3"))


class SplitExtensionTests(unittest.TestCase):
    def test_simple(self) -> None:
        self.assertEqual(upload_sandbox.split_extension("song.mp3"), ("song", ".mp3"))

    def test_double_dot(self) -> None:
        self.assertEqual(upload_sandbox.split_extension("archive.tar.gz"), ("archive.tar", ".gz"))

    def test_no_extension(self) -> None:
        self.assertEqual(upload_sandbox.split_extension("audio"), ("audio", ""))


class SaveUploadTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.target = Path(self.tmp.name) / "uploads"
        self.target.mkdir()

    def _png_bytes(self) -> bytes:
        # Minimal valid PNG (1x1 transparent pixel).
        import base64

        return base64.b64decode(
            b"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
        )

    def test_audio_upload_accepted(self) -> None:
        # WAV header magic; 16 bytes of garbage.
        content = b"RIFF" + b"\x00" * 4 + b"WAVE" + b"data" + b"\x00" * 8
        result = upload_sandbox.save_upload(
            content,
            target_dir=self.target,
            original_filename="song.wav",
            limits=upload_sandbox.UploadLimits.audio(),
        )
        self.assertTrue(result.path.exists())
        self.assertEqual(result.path.suffix, ".wav")
        self.assertEqual(len(result.sha256), 64)

    def test_image_upload_accepted(self) -> None:
        out = upload_sandbox.save_upload(
            self._png_bytes(),
            target_dir=self.target,
            original_filename="cover.png",
            limits=upload_sandbox.UploadLimits.image(),
        )
        self.assertTrue(out.path.exists())
        self.assertEqual(out.extension, ".png")

    def test_wrong_extension_rejected(self) -> None:
        with self.assertRaises(upload_sandbox.UploadValidationError) as cm:
            upload_sandbox.save_upload(
                self._png_bytes(),
                target_dir=self.target,
                original_filename="photo.exe",
                limits=upload_sandbox.UploadLimits.image(),
            )
        self.assertEqual(cm.exception.status_code, 400)

    def test_magic_sniff_rejects_mismatched_extension(self) -> None:
        # PNG bytes but claimed extension ".jpg" — sniff detects a
        # cross-family mismatch.
        with self.assertRaises(upload_sandbox.UploadValidationError) as cm:
            upload_sandbox.save_upload(
                self._png_bytes(),
                target_dir=self.target,
                original_filename="photo.jpg",
                limits=upload_sandbox.UploadLimits.image(),
            )
        self.assertIn("does not match", cm.exception.detail)

    def test_size_limit_enforced(self) -> None:
        big = b"RIFF" + b"\xff" * 1024 + b"WAVE"
        with self.assertRaises(upload_sandbox.UploadValidationError) as cm:
            upload_sandbox.save_upload(
                big,
                target_dir=self.target,
                original_filename="song.wav",
                limits=upload_sandbox.UploadLimits(max_bytes=128, allowed_extensions=upload_sandbox.AUDIO_EXTENSIONS),
            )
        self.assertEqual(cm.exception.status_code, 413)

    def test_advertised_extension_fallback(self) -> None:
        # filename has no extension, but advertised extension is supplied
        out = upload_sandbox.save_upload(
            self._png_bytes(),
            target_dir=self.target,
            original_filename="cover_no_ext",
            limits=upload_sandbox.UploadLimits.image(),
            advertised_extension="png",
        )
        self.assertEqual(out.extension, ".png")

    def test_path_traversal_neutralised(self) -> None:
        out = upload_sandbox.save_upload(
            self._png_bytes(),
            target_dir=self.target,
            original_filename="../../etc/passwd.png",
            limits=upload_sandbox.UploadLimits.image(),
        )
        # Result must still be inside target_dir.
        resolved_target = self.target.resolve()
        self.assertTrue(out.path.resolve().is_relative_to(resolved_target))


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
