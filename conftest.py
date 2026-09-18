"""Pytest configuration — adds app/ to sys.path so absolute imports
like `from services.director.cinema import ...` resolve.

Why this lives at the repo root and not in tests/: pytest's
sys.path manipulation order is rootdir-first; a tests/conftest.py
runs AFTER the rootdir conftest has already been processed, which
is too late to influence collection of tests/ siblings. By sitting
at the repo root, this conftest hooks the sys.path before any test
module gets imported.

Maestro's standalone launcher (start.sh) `cd`s into app/
and runs `python launch.py`, so its absolute imports (e.g. `from
services import safe_download`) resolve relative to that cwd. We
mirror that behaviour here: any test that needs `launch.py` (or
modules that import it directly) gets `app/` on sys.path so the
same absolute imports keep working.

We also prepend the repo root so `import cli` (the
pip-installed console-script shim package) is importable from the
test-suite.

Missing-dependency shims
------------------------
Some transitive imports in `app/shared/utils/*.py` reach for heavy
GPU/runtime libraries (rembg, soundfile, onnxruntime, decord,
imageio, …) that are NOT in `requirements.txt` because Maestro
degrades gracefully when they are missing. Those modules guard
their actual use behind feature flags, but the import statements
themselves raise `ModuleNotFoundError` at collection time, which
kills test suites that don't actually exercise those code paths.

To keep tests runnable on a lean install, we register a
`FakeModule` shim for any of these well-known packages BEFORE the
test modules get imported. The shim only intercepts `import x`;
attribute lookups return a callable that records its arguments.
This is intentionally *not* a full mock — it just lets the import
succeed so unrelated tests can collect and run.
"""
from __future__ import annotations

import sys
import types
from pathlib import Path
from typing import Any

_REPO_ROOT = Path(__file__).resolve().parent
_APP_DIR = _REPO_ROOT / "app"

for _path in (str(_APP_DIR), str(_REPO_ROOT)):
    if _path not in sys.path:
        sys.path.insert(0, _path)


# Modules that Maestro treats as optional. If the real package isn't
# installed we inject a permissive stub so collection succeeds.
_OPTIONAL_MODULES = (
    # audio / video IO
    "soundfile",
    "imageio",
    "imageio_ffmpeg",
    "moviepy",
    "moviepy.editor",
    # ML runtime
    "rembg",
    "onnxruntime",
    "onnx",
    "onnxruntime.capi",
    "onnxruntime.capi._pybind_state",
    "torch",
    "torch.nn",
    "torch.nn.functional",
    "torchvision",
    "torchvision.transforms",
    "torchvision.transforms.functional",
    # diffusers / huggingface glue
    "diffusers",
    "transformers",
    "accelerate",
    # git / shell
    "git",
    # media decoding
    "decord",
    "av",
    "cv2",
    # misc heavy
    "flash_attn",
    "sageattention",
    "sageattention.triton",
    "sageattention.triton.quant_per_block",
    # body models
    "smplfitter",
    "smplfitter.pt",
)


class _ShimCallable:
    """A callable that swallows every argument and returns itself.

    Used so that statements like
        from rembg import remove, new_session
        remove(image)
    keep working even when rembg isn't installed: `remove` is a
    shim callable, `new_session()` returns the same shim callable,
    and `remove(image)` returns it again. The shim never raises.

    A small whitelist of names returns False / None / 0 instead of
    a Shim — this keeps CUDA init probes (`torch.cuda.is_available`,
    `is_initialized`) and friends returning sensible defaults
    during tests even when no real CUDA build is present.
    """

    __slots__ = ("_name",)

    _BOOL_NAMES = frozenset({
        "is_available",
        "is_initialized",
        "has_cuda",
        "has_mps",
        "has_mlu",
        "is_built",
        "available",
        "enabled",
        "is_loaded",
        "is_attached",
        "ok",
        "is_floating_point",
        "is_complex",
        "is_cuda",
        "requires_grad",
        "is_leaf",
    })
    _INT_NAMES = frozenset({
        "device_count",
        "_cuda_getDeviceCount",
        "current_device",
        "numel",
        "nelement",
        "dim",
        "ndim",
        "rank",
        "world_size",
    })

    def __init__(self, name: str) -> None:
        self._name = name

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        last = self._name.rsplit(".", 1)[-1]
        if last in self._BOOL_NAMES:
            return False
        if last in self._INT_NAMES:
            return 0
        # Returning *another* shim is the right default: it lets
        # chained attribute access and method chaining continue
        # without raising — most importantly, chained .cuda()
        # / .to() / .float() calls don't blow up the test suite.
        return self

    def __getattr__(self, item: str) -> "_ShimCallable":
        return _ShimCallable(f"{self._name}.{item}")

    def __iter__(self):  # type: ignore[no-untyped-def]
        return iter(())

    def __len__(self) -> int:
        return 0

    def __bool__(self) -> bool:
        return False

    def __int__(self) -> int:
        return 0

    def __index__(self) -> int:
        return 0

    def __repr__(self) -> str:  # pragma: no cover - debug helper
        return f"<Shim {self._name}>"


def _make_shim(name: str) -> types.ModuleType:
    """Build a fake module that absorbs every attribute lookup
    AND every sub-import. The trick is to set ``__path__`` to an
    empty list so Python's import machinery treats the module as
    a package and successfully records child modules in
    ``sys.modules``. The sentinel ``__getattr__`` returns a
    fresh shim for every sub-module reference, so chained imports
    like ``from sageattention.triton import foo`` resolve without
    erroring."""
    module = types.ModuleType(name)
    module.__file__ = f"<shim for {name}>"
    module.__path__ = []  # makes the shim act as a package
    module.__package__ = name.rsplit(".", 1)[0] if "." in name else ""
    # Leave `__spec__` unset; downstream libraries (e.g.
    # `optimum.quanto`) probe `importlib.util.find_spec(name)`. If
    # the shim has no spec the probe raises ValueError, which our
    # ``_install_optional_stubs`` wrapper converts to None, which
    # those libraries treat as "absent". Setting `__spec__` here
    # would cause feature-detection code to attempt real use of
    # the package and explode at runtime.
    module.__getattr__ = lambda attr: _ShimCallable(f"{name}.{attr}")  # type: ignore[attr-defined]
    return module


def _install_optional_stubs() -> None:
    """Register shim modules for any optional dependency that is
    NOT already importable. Idempotent — re-running is a no-op.

    Three layers:
      1. Pre-shim the well-known heavy modules (transformers,
         mmgp, etc.) so the cold-import path of `app/wgp.py` etc.
         can resolve them.
      2. Install a MetaPathFinder that claims any optional
         prefix (`transformers.*`, `torch.*`, etc.) so the
         `import system` can resolve nested packages without
         hitting the filesystem.
      3. Wrap `__import__` so any `ModuleNotFoundError` raised
         *outside* our control is replaced with a shim instead
         of bubbling up. This makes `import matplotlib` succeed
         even when no finder claims the name.
      4. Patch the *real* `torch.cuda` module when torch is
         installed as CPU-only. Many test-time imports trigger
         class-body statements like `device=torch.cuda.current_device()`,
         which raises `AssertionError: Torch not compiled with CUDA
         enabled`. We override those probes so they return safe
         defaults (0 / False) without touching GPU code paths.
    """
    import importlib.util as _il_util
    import importlib.abc as _il_abc
    import importlib.machinery as _il_machinery

    # Downstream feature-detection code (e.g. `optimum.quanto`)
    # calls `importlib.util.find_spec("transformers")` and treats a
    # None return as "package absent". Our shim modules live in
    # `sys.modules` but intentionally have no `__spec__`, which
    # makes `find_spec` raise `ValueError: <name>.__spec__ is None`.
    # Wrap the call so shims are reported as absent instead.
    _original_find_spec = _il_util.find_spec

    def _patched_find_spec(name, package=None):  # type: ignore[no-untyped-def]
        try:
            return _original_find_spec(name, package)
        except ValueError:
            return None

    _il_util.find_spec = _patched_find_spec  # type: ignore[assignment]

    for module_name in _OPTIONAL_MODULES:
        if module_name in sys.modules:
            continue
        try:
            __import__(module_name)
        except Exception:  # noqa: BLE001 - we WANT to catch every failure
            sys.modules[module_name] = _make_shim(module_name)

    # Catch-all MetaPathFinder for module names that aren't in
    # our explicit list. We only react to namespaced modules
    # belonging to clearly-optional stacks so we never paper
    # over a real bug in user code.
    _OPTIONAL_PREFIXES = (
        "transformers",
        "diffusers",
        "accelerate",
        "optimum",
        "flash_attn",
        "sageattention",
        "rembg",
        "onnxruntime",
        "smplfitter",
        "trimesh",
        "chumpy",
        "matplotlib",
        "matplotlib.colors",
        "matplotlib.pyplot",
        "librosa",
        "scipy.signal",
        "scipy.io.wavfile",
        "scipy.io",
        "torch",
        "torchvision",
        "mmcv",
        "mmseg",
        "mmdet",
        "taming",
        "einops",
        "kornia",
        "scipy.spatial",
        "scipy.interpolate",
        "pyrender",
        "PIL.ImageDraw",
        "PIL.ImageFont",
        "google",
        "google.protobuf",
        "av",
        "cv2",
    )

    class _OptionalFinder(_il_abc.MetaPathFinder):
        def find_spec(self, name, path=None, target=None):  # type: ignore[no-untyped-def]
            top = name.split(".", 1)[0]
            if top not in _OPTIONAL_PREFIXES and name not in _OPTIONAL_PREFIXES:
                return None
            if name in sys.modules:
                # Already a shim or a real module — return its spec
                existing = sys.modules[name]
                spec = getattr(existing, "__spec__", None)
                if spec is not None:
                    return spec
                # Existing module with no spec (e.g. another shim) —
                # synthesise one so import machinery is happy.
                spec = _il_machinery.ModuleSpec(name, loader=None)
                existing.__spec__ = spec
                return spec
            shim = _make_shim(name)
            sys.modules[name] = shim
            return shim.__spec__

    # NOTE: The MetaPathFinder approach was retired because diffusers'
    # `_LazyModule` returns the parent module itself when an attribute
    # is missing. That turns `from diffusers.loaders import <X>` into
    # `<X> = <module 'diffusers.loaders'>`, which later explodes with
    # `TypeError: __mro_entries__ must return a tuple` when the user
    # code tries `class Foo(SomeMixin, X)`. The __import__ patcher
    # below is sufficient on its own — we let real ImportError flow
    # through for the diffusers/transformers/accelerate namespaces
    # so their own try/except handlers can do the right thing.
    # sys.meta_path.insert(0, _OptionalFinder())  # disabled

    # Last-resort: hook into `__import__` so a `ModuleNotFoundError`
    # raised by any finder — including the default ones — is
    # turned into a shim instead of bubbling up. This is the
    # catch-all that lets `import matplotlib` succeed even when no
    # MetaPathFinder claims the name.
    _builtins = __builtins__
    if isinstance(_builtins, dict):
        _orig_import = _builtins["__import__"]
    else:
        _orig_import = _builtins.__import__

    def _patched_import(name, globals=None, locals=None, fromlist=(), level=0):  # type: ignore[no-untyped-def]
        try:
            return _orig_import(name, globals, locals, fromlist, level)
        except ModuleNotFoundError:
            # Diffusers ships a `_LazyModule` that swallows
            # `AttributeError` on missing names by returning the
            # parent module itself. That module is *not* a class,
            # so `class Foo(SomeMixin, ...)` later raises
            # `TypeError: __mro_entries__ must return a tuple`.
            # Always let real ImportError through for the
            # `diffusers` family — the upstream code has its own
            # try/except for the missing attribute, and falling
            # through to that path is correct.
            top = name.split(".", 1)[0]
            if top in ("diffusers", "transformers", "accelerate"):
                raise
            if top not in _OPTIONAL_PREFIXES and name not in _OPTIONAL_PREFIXES:
                raise
            shim = sys.modules.get(name) or _make_shim(name)
            sys.modules[name] = shim
            # For `from x import y`, also register the child
            if fromlist:
                for sub in fromlist:
                    sub_full = f"{name}.{sub}"
                    if sub_full not in sys.modules:
                        sys.modules[sub_full] = _make_shim(sub_full)
            return shim

    if isinstance(__builtins__, dict):
        __builtins__["__import__"] = _patched_import
    else:
        __builtins__.__import__ = _patched_import
    # Layer 4: tame a real torch.cuda that was built without CUDA.
    # The collection-time imports in `app/models/wan/modules/t5.py`
    # call `torch.cuda.current_device()` inside a class body, which
    # raises AssertionError on CPU-only builds. We don't want test
    # collection to fail on hardware that lacks a GPU, so we wrap
    # the relevant torch.cuda functions with safe shims that
    # pretend CUDA exists with device count 0. This only takes
    # effect when torch.cuda is real but CUDA is uncompiled; on
    # a properly built GPU runtime nothing changes.
    try:
        import torch as _torch_probe  # noqa: WPS433

        if hasattr(_torch_probe, "cuda") and not getattr(
            _torch_probe.cuda, "_maestro_shimmed", False
        ):
            _cuda = _torch_probe.cuda

            def _safe_current_device(*_args, **_kwargs):  # type: ignore[no-untyped-def]
                return 0

            def _safe_device_count(*_args, **_kwargs):  # type: ignore[no-untyped-def]
                return 0

            def _safe_is_available(*_args, **_kwargs):  # type: ignore[no-untyped-def]
                return False

            def _safe_set_device(*_args, **_kwargs):  # type: ignore[no-untyped-def]
                return None

            def _safe_synchronize(*_args, **_kwargs):  # type: ignore[no-untyped-def]
                return None

            def _safe_empty_cache(*_args, **_kwargs):  # type: ignore[no-untyped-def]
                return None

            def _safe_init(*_args, **_kwargs):  # type: ignore[no-untyped-def]
                return None

            def _safe_get_device_capability(*_args, **_kwargs):  # type: ignore[no-untyped-def]
                return (0, 0)

            def _safe_get_device_properties(*_args, **_kwargs):  # type: ignore[no-untyped-def]
                class _FakeProps:
                    name = "stub"
                    major = 0
                    minor = 0
                    total_memory = 0
                return _FakeProps()

            def _safe_get_device_name(*_args, **_kwargs):  # type: ignore[no-untyped-def]
                return "stub"

            def _safe_memory_allocated(*_args, **_kwargs):  # type: ignore[no-untyped-def]
                return 0

            def _safe_memory_reserved(*_args, **_kwargs):  # type: ignore[no-untyped-def]
                return 0

            for _name, _fn in (
                ("current_device", _safe_current_device),
                ("device_count", _safe_device_count),
                ("is_available", _safe_is_available),
                ("set_device", _safe_set_device),
                ("synchronize", _safe_synchronize),
                ("empty_cache", _safe_empty_cache),
                ("init", _safe_init),
                ("get_device_capability", _safe_get_device_capability),
                ("get_device_properties", _safe_get_device_properties),
                ("get_device_name", _safe_get_device_name),
                ("memory_allocated", _safe_memory_allocated),
                ("memory_reserved", _safe_memory_reserved),
            ):
                if hasattr(_cuda, _name):
                    try:
                        setattr(_cuda, _name, _fn)
                    except (AttributeError, TypeError):
                        # Some torch builds expose the C function
                        # read-only. That's fine — the test
                        # environment will not invoke it.
                        pass
            _cuda._maestro_shimmed = True  # type: ignore[attr-defined]
    except ImportError:
        # torch not installed at all; the layer-3 __import__
        # patcher will shim it on demand.
        pass

_install_optional_stubs()
