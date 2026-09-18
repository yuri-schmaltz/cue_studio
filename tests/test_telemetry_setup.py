"""Tests for the OTel exporter setup helper."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "app") not in sys.path:
    sys.path.insert(0, str(ROOT / "app"))

from services import telemetry_setup  # noqa: E402


class TelemetrySetupTests(unittest.TestCase):
    def setUp(self) -> None:
        telemetry_setup._setup_done = False

    def tearDown(self) -> None:
        telemetry_setup._setup_done = False

    def test_noop_when_sdk_missing(self) -> None:
        with mock.patch.object(telemetry_setup, "_import_otel_sdk", return_value=None):
            active = telemetry_setup.setup_telemetry(exporter="console")
        self.assertFalse(active)
        self.assertFalse(telemetry_setup.is_telemetry_active())

    def test_noop_when_exporter_none(self) -> None:
        # We still flip the internal flag so callers don't re-attempt
        # setup on every boot.
        sdk = {"trace": mock.MagicMock()}
        with mock.patch.object(telemetry_setup, "_import_otel_sdk", return_value=sdk):
            active = telemetry_setup.setup_telemetry(exporter="none")
        self.assertFalse(active)
        self.assertTrue(telemetry_setup.is_telemetry_active())

    def test_setup_is_idempotent(self) -> None:
        # Provide a complete SDK mock so the first call succeeds.
        sdk = {
            "trace": mock.MagicMock(),
            "Resource": mock.MagicMock(create=lambda attrs: attrs),
            "TracerProvider": lambda resource: mock.MagicMock(add_span_processor=mock.MagicMock()),
            "SimpleSpanProcessor": mock.MagicMock(),
            "ConsoleSpanExporter": mock.MagicMock(),
        }
        with mock.patch.object(telemetry_setup, "_import_otel_sdk", return_value=sdk):
            first = telemetry_setup.setup_telemetry(exporter="console")
        with mock.patch.object(telemetry_setup, "_import_otel_sdk", return_value=None):
            # Second call should NOT try to re-import — it returns the
            # cached ``True`` because setup already ran.
            second = telemetry_setup.setup_telemetry()
        self.assertTrue(first)
        self.assertTrue(second)

    def test_console_exporter_wires_simple_processor(self) -> None:
        captured_processors: list[Any] = []

        class FakeProvider:
            def add_span_processor(self, processor: Any) -> None:
                captured_processors.append(processor)

        sdk = {
            "trace": mock.MagicMock(),
            "Resource": mock.MagicMock(create=lambda attrs: attrs),
            "TracerProvider": lambda resource: FakeProvider(),
            "SimpleSpanProcessor": mock.MagicMock(),
            "ConsoleSpanExporter": mock.MagicMock(),
        }
        with mock.patch.object(telemetry_setup, "_import_otel_sdk", return_value=sdk):
            active = telemetry_setup.setup_telemetry(exporter="console")
        self.assertTrue(active)
        self.assertEqual(len(captured_processors), 1)

    def test_unknown_exporter_marks_setup_done_without_processor(self) -> None:
        sdk = {
            "trace": mock.MagicMock(),
            "Resource": mock.MagicMock(create=lambda attrs: attrs),
            "TracerProvider": lambda resource: mock.MagicMock(add_span_processor=mock.MagicMock()),
        }
        with mock.patch.object(telemetry_setup, "_import_otel_sdk", return_value=sdk):
            active = telemetry_setup.setup_telemetry(exporter="bogus")
        self.assertTrue(active)
        self.assertTrue(telemetry_setup.is_telemetry_active())

    def test_shutdown_resets_state(self) -> None:
        sdk = {"trace": mock.MagicMock()}
        with mock.patch.object(telemetry_setup, "_import_otel_sdk", return_value=sdk):
            telemetry_setup.setup_telemetry(exporter="none")
        telemetry_setup.shutdown_telemetry()
        self.assertFalse(telemetry_setup.is_telemetry_active())


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
