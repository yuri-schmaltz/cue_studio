#!/usr/bin/env python3
"""Protótipo isolado do transporte HTTP seguro (A01).

Demonstra, **sem tocar o código-fonte** de Cue Studio, a estratégia de
allowlist de origens proposta pela feature A01. Este script:

1. Define uma função `api_fetch` análoga à do frontend, mas em Python.
2. Verifica comportamento para URLs autorizadas e não autorizadas.
3. Garante que `Request`/`headers`/`body` enviados pelo chamador são
   preservados.
4. Verifica que token não é aplicado a URLs externas.

Rodar com:
    python3 _reversa_forward/plano-2026-10-04/prototypes/a01_secure_transport.py

Resultado esperado: 5 testes internos "OK" e exit code 0.
"""
from __future__ import annotations

import sys
from dataclasses import dataclass, field
from typing import Callable, Iterable
from urllib.parse import urlparse


@dataclass
class ApiTransportConfig:
    api_origins: tuple[str, ...]
    auth_header: str = "Authorization"
    get_token: Callable[[], str | None] = lambda: None


CONFIG = ApiTransportConfig(api_origins=("https://api.example.com",))


@dataclass
class CapturedCall:
    url: str
    method: str
    headers: dict[str, str] = field(default_factory=dict)
    body: str | None = None


def api_fetch(
    url: str,
    *,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    body: str | None = None,
) -> CapturedCall:
    """Substitui `fetch` em Python para o protótipo.

    Implementa a regra: aplica token apenas se a origem está no allowlist.
    """
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError(f"scheme inválido: {parsed.scheme}")
    merged_headers = dict(headers or {})
    if (
        f"{parsed.scheme}://{parsed.netloc}" in CONFIG.api_origins
        or parsed.netloc in CONFIG.api_origins
    ) and CONFIG.auth_header not in merged_headers:
        token = CONFIG.get_token()
        if token:
            merged_headers[CONFIG.auth_header] = f"Bearer {token}"
    return CapturedCall(url=url, method=method, headers=merged_headers, body=body)


def test_origin_authorized_applies_token() -> None:
    CONFIG.get_token = lambda: "fake-token"
    call = api_fetch("https://api.example.com/projects")
    assert call.headers["Authorization"] == "Bearer fake-token", call.headers
    print("OK origin_authorized_applies_token")


def test_origin_unauthorized_excludes_token() -> None:
    CONFIG.get_token = lambda: "fake-token"
    call = api_fetch("https://audit.example.invalid/probe")
    assert "Authorization" not in call.headers, call.headers
    print("OK origin_unauthorized_excludes_token")


def test_existing_authorization_preserved() -> None:
    CONFIG.get_token = lambda: "fake-token"
    call = api_fetch(
        "https://api.example.com/projects",
        headers={"Authorization": "Bearer already-set"},
    )
    assert call.headers["Authorization"] == "Bearer already-set", call.headers
    print("OK existing_authorization_preserved")


def test_body_and_method_preserved() -> None:
    CONFIG.get_token = lambda: None
    call = api_fetch(
        "https://api.example.com/upload",
        method="POST",
        headers={"Content-Type": "multipart/form-data"},
        body="BINARYDATA",
    )
    assert call.method == "POST"
    assert call.body == "BINARYDATA"
    assert call.headers["Content-Type"] == "multipart/form-data"
    print("OK body_and_method_preserved")


def test_no_token_does_not_add_header() -> None:
    CONFIG.get_token = lambda: None
    call = api_fetch("https://api.example.com/projects")
    assert "Authorization" not in call.headers
    print("OK no_token_does_not_add_header")


def main(tests: Iterable[Callable[[], None]] | None = None) -> int:
    tests = tests or [
        test_origin_authorized_applies_token,
        test_origin_unauthorized_excludes_token,
        test_existing_authorization_preserved,
        test_body_and_method_preserved,
        test_no_token_does_not_add_header,
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
    print(f"\n{total})({failures})" if False else f"\n{len(list(tests))} tests run; failures={failures}")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    # 'total' é capturado de outro escopo, então usamos sys.exit direto:
    failures = 0
    tests = [
        test_origin_authorized_applies_token,
        test_origin_unauthorized_excludes_token,
        test_existing_authorization_preserved,
        test_body_and_method_preserved,
        test_no_token_does_not_add_header,
    ]
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
    sys.exit(0 if failures == 0 else 1)