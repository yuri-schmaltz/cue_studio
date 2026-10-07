#!/usr/bin/env python3
"""Protótipo isolado do middleware de autenticação (A02).

Demonstra o comportamento esperado pelo middleware `AuthMiddleware`
proposto na spec `09-feature-a02-auth.md`, **sem importar código real de
`app/`** (que continua sob política `allowLegacyEdits: false`).

Cenários:
  - servidor em modo compartilhado (`--share`) exige token;
  - token ausente → 401 com payload estruturado;
  - token inválido → 401;
  - token válido → 200;
  - rota `/health` é pública.

Rodar:
  python3 _reversa_forward/plano-2026-10-04/prototypes/a02_auth.py
"""
from __future__ import annotations

import re
import sys
from dataclasses import dataclass, field
from typing import Callable
from uuid import uuid4


@dataclass
class Request:
    headers: dict[str, str] = field(default_factory=dict)
    path: str = "/api/projects"


@dataclass
class Response:
    status: int
    body: dict


PUBLIC_PATHS = (
    re.compile(r"^/health$"),
    re.compile(r"^/ready$"),
)


def is_public(path: str) -> bool:
    return any(p.match(path) for p in PUBLIC_PATHS)


@dataclass
class AuthPolicy:
    enabled: bool
    token: str | None
    header: str = "Authorization"
    scheme: str = "Bearer"

    def validate(self, req: Request) -> bool:
        if not self.enabled:
            return True
        if is_public(req.path):
            return True
        auth = req.headers.get(self.header, "")
        if not auth.startswith(f"{self.scheme} "):
            return False
        return auth.removeprefix(f"{self.scheme} ").strip() == self.token


def auth_middleware(policy: AuthPolicy) -> Callable[[Request, Callable[[], Response]], Response]:
    def handler(req: Request, downstream: Callable[[], Response]) -> Response:
        if not policy.validate(req):
            return Response(401, {
                "code": "auth.missing" if not req.headers.get(policy.header) else "auth.invalid",
                "message": "Token ausente ou inválido",
                "operationId": str(uuid4()),
            })
        return downstream()
    return handler


def app_endpoint() -> Response:
    return Response(200, {"projects": []})


def health_endpoint() -> Response:
    return Response(200, {"status": "ok"})


def make_handler(policy: AuthPolicy, downstream: Callable[[], Response]):
    return auth_middleware(policy)(Request, downstream)  # placeholder, ver testes


# ----- testes -----

def test_shared_no_token_returns_401() -> None:
    policy = AuthPolicy(enabled=True, token="secret-token")
    handler = auth_middleware(policy)
    resp = handler(Request(headers={}, path="/api/projects"), app_endpoint)
    assert resp.status == 401, resp
    assert resp.body["code"] == "auth.missing", resp.body
    assert resp.body["operationId"], resp.body
    print("OK shared_no_token_returns_401")


def test_shared_invalid_token_returns_401() -> None:
    policy = AuthPolicy(enabled=True, token="secret-token")
    handler = auth_middleware(policy)
    resp = handler(Request(headers={"Authorization": "Bearer wrong"}, path="/api/projects"), app_endpoint)
    assert resp.status == 401, resp
    assert resp.body["code"] == "auth.invalid", resp.body
    print("OK shared_invalid_token_returns_401")


def test_shared_valid_token_passes() -> None:
    policy = AuthPolicy(enabled=True, token="secret-token")
    handler = auth_middleware(policy)
    resp = handler(
        Request(headers={"Authorization": "Bearer secret-token"}, path="/api/projects"),
        app_endpoint,
    )
    assert resp.status == 200, resp
    print("OK shared_valid_token_passes")


def test_health_is_public() -> None:
    policy = AuthPolicy(enabled=True, token="secret-token")
    handler = auth_middleware(policy)
    resp = handler(Request(headers={}, path="/health"), health_endpoint)
    assert resp.status == 200, resp
    print("OK health_is_public")


def test_local_mode_skips_auth() -> None:
    policy = AuthPolicy(enabled=False, token=None)
    handler = auth_middleware(policy)
    resp = handler(Request(headers={}, path="/api/projects"), app_endpoint)
    assert resp.status == 200, resp
    print("OK local_mode_skips_auth")


def main() -> int:
    tests = [
        test_shared_no_token_returns_401,
        test_shared_invalid_token_returns_401,
        test_shared_valid_token_passes,
        test_health_is_public,
        test_local_mode_skips_auth,
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