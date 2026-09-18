"""Tests for the lazy import proxy."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "app") not in sys.path:
    sys.path.insert(0, str(ROOT / "app"))

from services import _lazy  # noqa: E402


class LazyModuleTests(unittest.TestCase):
    def test_proxy_is_module_instance(self) -> None:
        proxy = _lazy.lazy("os")
        import types as _t

        self.assertIsInstance(proxy, _t.ModuleType)
        self.assertEqual(proxy.__name__, "os")

    def test_attribute_access_delegates_to_real_module(self) -> None:
        proxy = _lazy.lazy("json")
        # ``dumps`` is a real function on json.
        self.assertEqual(proxy.dumps({"a": 1}), '{"a": 1}')
        # The proxy should now be marked loaded.
        self.assertTrue(proxy._lazy_loaded)

    def test_proxy_replaces_sys_module(self) -> None:
        proxy = _lazy.lazy("pathlib")
        proxy.Path  # trigger import
        self.assertIn("pathlib", sys.modules)
        # The proxy should have replaced itself with the real module.
        self.assertIs(sys.modules["pathlib"], proxy._real_module)

    def test_promoted_subsequent_import(self) -> None:
        # Use a local dummy module that is NOT already in ``sys.modules``
        # so we can verify the proxy correctly references the same real module
        # and delegates attribute lookups through to it.
        proxy = _lazy.lazy("tests._lazy_test_pkg")
        # Before loading, ``_real_module`` is not set.
        self.assertFalse(proxy._lazy_loaded)
        # Trigger load via attribute access.
        self.assertEqual(proxy.SENTINEL, "test-only-module-loaded")
        # After loading, the proxy exposes the same functions.
        self.assertEqual(proxy.hello(), "test-only-module-loaded")
        # The ``_real_module`` reference points at the real module.
        self.assertTrue(proxy._lazy_loaded)
        self.assertIsNotNone(proxy._real_module)
        self.assertEqual(proxy._real_module.SENTINEL, "test-only-module-loaded")

    def test_missing_attribute_raises_attribute_error(self) -> None:
        proxy = _lazy.lazy("os")
        with self.assertRaises(AttributeError):
            proxy.this_does_not_exist

    def test_preload_warms_up_modules(self) -> None:
        import threading

        proxies = [_lazy.lazy("secrets"), _lazy.lazy("uuid")]
        threads = _lazy.preload(proxies)
        # preload returns the worker threads so tests can deterministically
        # wait for the warm-up to finish.
        for t in threads:
            t.join(timeout=5.0)
        for proxy in proxies:
            self.assertTrue(proxy._lazy_loaded)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
