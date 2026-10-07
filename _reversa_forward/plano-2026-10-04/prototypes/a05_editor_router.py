#!/usr/bin/env python3
"""Protótipo isolado da correção do router do Editor (A05).

Reproduz a falha observada pelo diagnóstico D05 com `inspect.signature(...).bind()`,
e demonstra a forma canônica esperada pela feature A05.

Este script **não** importa `app.routers.video_editor` (porque o estado de origem
não foi alterado: a auditoria constatou TypeError no bind, o que é o problema
a ser corrigido). Em vez disso, ele define uma factory local que reproduz
o cenário e mostra que a forma proposta funciona.

Rodar com:
    python3 _reversa_forward/plano-2026-10-04/prototypes/a05_editor_router.py
"""
from __future__ import annotations

import inspect
import sys
from typing import Callable


class EditorService:
    """Stub de serviço; apenas para satisfazer a forma esperada."""


# Forma canônica proposta por A05.
def build_video_editor_router(
    get_editor: Callable[[], EditorService],
) -> "FakeRouter":
    editor = get_editor()
    router = FakeRouter()
    router.add(
        "GET",
        "/api/editor/projects",
        lambda: {"items": [], "editor": type(editor).__name__},
    )
    router.add(
        "POST",
        "/api/editor/projects",
        lambda: {"created": True, "editor": type(editor).__name__},
    )
    router.add(
        "GET",
        "/api/editor/projects/{project_id}",
        lambda: {"id": "demo"},
    )
    return router


class FakeRouter:
    def __init__(self) -> None:
        self.routes: list[tuple[str, str, Callable[[], dict]]] = []

    def add(self, method: str, path: str, handler: Callable[[], dict]) -> None:
        self.routes.append((method, path, handler))


def test_signature_has_one_arg_named_get_editor() -> None:
    sig = inspect.signature(build_video_editor_router)
    params = list(sig.parameters.values())
    assert len(params) == 1, f"expected 1 param, got {params!r}"
    assert params[0].name == "get_editor", params[0].name
    print("OK signature_has_one_arg_named_get_editor")


def test_bind_does_not_raise() -> None:
    sig = inspect.signature(build_video_editor_router)
    sig.bind(get_editor=lambda: EditorService())
    print("OK bind_does_not_raise")


def test_factory_builds_router_with_routes() -> None:
    router = build_video_editor_router(lambda: EditorService())
    assert router.routes, "router should not be empty"
    methods = [m for m, _, _ in router.routes]
    assert "GET" in methods and "POST" in methods
    print(f"OK factory_builds_router_with_routes ({len(router.routes)} routes)")


def test_routes_do_not_share_method_path_conflicts() -> None:
    router = build_video_editor_router(lambda: EditorService())
    seen: set[tuple[str, str]] = set()
    for method, path, _ in router.routes:
        key = (method, path)
        assert key not in seen, f"conflito: {key}"
        seen.add(key)
    print("OK routes_do_not_share_method_path_conflicts")


def main() -> int:
    tests = [
        test_signature_has_one_arg_named_get_editor,
        test_bind_does_not_raise,
        test_factory_builds_router_with_routes,
        test_routes_do_not_share_method_path_conflicts,
    ]
    failures = 0
    for t in tests:
        try:
            t()
        except AssertionError as e:
            failures += 1
            print(f"FAIL {t.__name__}: {e}")
        except Exception as e:  # noqa: BLE001
            failures += 1
            print(f"ERROR {t.__name__}: {e}")
    print(f"\n{len(tests)} tests run; failures={failures}")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())