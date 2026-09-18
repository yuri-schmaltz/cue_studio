"""Lazy-import proxy for the heaviest Cue Studio modules.

Why this exists
---------------
Several Cue Studio service modules pull in heavy third-party
dependencies the moment they are imported:

* ``services.director_pipeline`` — 8K LOC orchestrator that brings
  ``director_orchestrator``, every planner, validators, renderers, the
  schema module, and a swathe of LLM utilities. Importing it costs
  several hundred milliseconds on a warm venv.
* ``services.llm_service`` — the multi-provider LLM client. Pulls in
  ``requests``, ``cryptography``, the Ollama payload filter, and a
  long chain of helper modules. It is the biggest single import in the
  boot path.
* ``services.h3_story_ledger`` — the H3 narrative continuity ledger.
  ~6K LOC, mostly self-contained but heavy.

Today ``app/launch.py`` imports all three at module top level because
the route handlers reference symbols from them. That means the entire
generation stack is loaded into memory on every cold start, even when
the caller is just polling ``/api/v1/system/preflight`` or browsing the
gallery.

This module exposes a thin ``LazyModule`` proxy that delays the actual
import until the first attribute access. Callers see the same public
surface (``director_pipeline.something``) but pay the import cost
exactly once and only when they actually need it.

Usage
-----
Wrap the existing module imports behind ``LazyModule`` and the public
callers keep working unchanged::

    from services._lazy import lazy

    director_pipeline = lazy("services.director_pipeline")
    llm_service = lazy("services.llm_service")

    def some_handler():
        return director_pipeline.run(...)  # first access imports the real module

The first ``__getattr__`` call imports the underlying module and binds
it to ``sys.modules`` so subsequent imports of the same name go through
the normal fast path.

Caveats
-------
* Static analysers cannot tell which names the lazy module exposes;
  downstream type hints and linters may complain. Keep a thin ``# type:
  ignore`` or a ``from __future__ import annotations`` if necessary.
* The lazy proxy is *not* a perfect drop-in for every use case. Code
  that does ``director_pipeline = __import__("services.director_pipeline")``
  or uses ``isinstance(x, director_pipeline.SomeClass)`` works because
  the proxy transparently delegates attribute access, but ``repr()``
  on the proxy returns a placeholder string instead of the module's
  real repr.
"""

from __future__ import annotations

import importlib
import logging
import sys
import threading
import time
import types
from typing import Any


log = logging.getLogger("cue_studio.lazy_import")


class LazyModule(types.ModuleType):
    """Module proxy that defers the real ``import`` to first attribute access.

    The class extends ``types.ModuleType`` so ``isinstance(proxy, ModuleType)``
    stays true. ``__getattr__`` is the only hook Python calls for
    missing attributes on module instances, which makes it the natural
    interception point.
    """

    def __init__(self, module_name: str) -> None:
        # Initialise as a synthetic module so the proxy behaves like a
        # real module before the underlying one is loaded.
        super().__init__(module_name)
        self.__dict__["_lazy_target_name"] = module_name
        self.__dict__["_lazy_loaded"] = False
        self.__dict__["_lazy_lock"] = threading.RLock()
        self.__dict__["_lazy_loaded_at"] = None

    def __getattr__(self, name: str) -> Any:
        # ``__getattr__`` is only invoked when normal lookup fails, so
        # the dunder attributes stored above don't trigger the
        # re-import.
        if name.startswith("_lazy_"):
            raise AttributeError(name)

        with self._lazy_lock:
            if not self._lazy_loaded:
                self._load_real_module()

        # Delegate to the real module's namespace; if the requested
        # attribute is genuinely missing, ``__getattr__`` on the
        # underlying module will raise ``AttributeError`` for us.
        return getattr(self._real_module, name)

    def _load_real_module(self) -> None:
        target = self._lazy_target_name
        started = time.monotonic()
        try:
            module = importlib.import_module(target)
        except Exception:
            log.exception("[lazy-import] failed to import %s", target)
            raise
        elapsed_ms = int((time.monotonic() - started) * 1000)
        log.info("[lazy-import] %s loaded in %d ms", target, elapsed_ms)

        # Promote this proxy to the real module's slot in ``sys.modules``
        # so any subsequent ``import target`` returns the already-loaded
        # module rather than constructing a new one.
        sys.modules[target] = module

        # Mutate our own dict so future attribute lookups go through
        # the real module directly. We do NOT re-assign ``self`` here;
        # callers that still hold a reference to the proxy continue
        # to see this object, and the ``__getattr__`` path picks up
        # the populated namespace from the very next call.
        self.__dict__.update(module.__dict__)
        self.__dict__["_lazy_loaded"] = True
        self.__dict__["_lazy_loaded_at"] = time.time()
        self.__dict__["_real_module"] = module


def lazy(module_name: str) -> LazyModule:
    """Return a :class:`LazyModule` proxy for ``module_name``.

    Subsequent attribute access on the proxy triggers the import.
    """

    return LazyModule(module_name)


def preload(module_proxies: list[LazyModule]) -> None:
    """Convenience helper to trigger a parallel warm-up of several modules.

    Useful at boot right after the FastAPI app is constructed: we
    start the imports in background threads so subsequent first
    requests don't pay the import cost. The module is loaded into
    ``sys.modules`` by the time the threads finish; ``preload`` is a
    no-op if the proxy is already loaded.
    """

    threads: list[threading.Thread] = []

    def _trigger(proxy: LazyModule) -> None:
        if proxy._lazy_loaded:
            return
        try:
            proxy._load_real_module()
        except Exception:
            # Errors are logged inside ``_load_real_module``; a failed
            # warm-up must never crash the boot path.
            pass

    for proxy in module_proxies:
        thread = threading.Thread(target=_trigger, args=(proxy,), daemon=True)
        thread.start()
        threads.append(thread)

    # Return the worker threads so callers that DO want to wait (e.g.
    # boot-time tests) can ``thread.join()`` deterministically. The
    # default expectation is that the warm-up completes in the
    # background; production boot paths simply discard the return value.
    return threads


__all__ = ["LazyModule", "lazy", "preload"]
