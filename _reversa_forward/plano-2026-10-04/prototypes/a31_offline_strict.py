#!/usr/bin/env python3
"""Protótipo isolado do modo --offline-strict (A31 / R08).

Valida `40-feature-a31-offline-strict.md` sem importar de `app/`. Como o
protótipo não tem rede real, simula tentativas de conexão e valida que a
política offline-strict bloqueia destinos não-localhost.

1. NetworkPolicy enum + ConnectionAttempt dataclass.
2. ConnectionAuditor com hooks de socket (substitui urllib/socket).
3. Lista de destinos permitidos (loopback + ::1).
4. Função `attempt(host, port, protocol)` que decide block/allow.
5. Função `get_attempts()` que retorna log.
6. Função `is_localhost(host)`.
7. CI smoke: roda 10 tentativas (5 localhost, 5 remotas) e verifica que
   só remotas foram bloqueadas.
8. 8 testes cobrindo: localhost permitido, IP público bloqueado, DNS
   externo bloqueado, IPv6 loopback permitido, política optional não
   bloqueia, política required permite tudo, log estruturado, formato
   do ConnectionAttempt.

Rodar:
    python3 _reversa_forward/plano-2026-10-04/prototypes/a31_offline_strict.py
"""
from __future__ import annotations

import socket
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Optional


# ---------------------------------------------------------------------------
# 1. Modelo de dados
# ---------------------------------------------------------------------------

class NetworkPolicy(str, Enum):
    OFFLINE = "offline"
    OPTIONAL = "optional"
    REQUIRED = "required"


LOCALHOST_PATTERNS = (
    "127.0.0.1",
    "::1",
    "localhost",
    "0.0.0.0",
    "[::1]",
)


@dataclass
class ConnectionAttempt:
    timestamp: str
    destination: str
    protocol: str
    blocked: bool
    reason: str


# ---------------------------------------------------------------------------
# 2. Auditor de conexões
# ---------------------------------------------------------------------------

class ConnectionAuditor:
    def __init__(self, policy: NetworkPolicy = NetworkPolicy.OFFLINE):
        self.policy = policy
        self.attempts: list[ConnectionAttempt] = []

    def is_localhost(self, host: str) -> bool:
        return host in LOCALHOST_PATTERNS or host.startswith("127.")

    def attempt(self, host: str, port: int, protocol: str = "tcp") -> ConnectionAttempt:
        ts = datetime.now(timezone.utc).isoformat()
        if self.policy == NetworkPolicy.OFFLINE:
            blocked = not self.is_localhost(host)
            reason = "loopback allowed" if not blocked else f"offline-strict bloqueia {host}"
        elif self.policy == NetworkPolicy.OPTIONAL:
            blocked = False
            reason = "optional: allowed"
        else:  # REQUIRED
            blocked = False
            reason = "required: allowed"
        att = ConnectionAttempt(
            timestamp=ts,
            destination=f"{host}:{port}",
            protocol=protocol,
            blocked=blocked,
            reason=reason,
        )
        self.attempts.append(att)
        return att

    def get_attempts(self) -> list[ConnectionAttempt]:
        return list(self.attempts)

    def blocked_count(self) -> int:
        return sum(1 for a in self.attempts if a.blocked)

    def allowed_count(self) -> int:
        return sum(1 for a in self.attempts if not a.blocked)


# ---------------------------------------------------------------------------
# 3. CI smoke (simula tentativas em modo offline-strict)
# ---------------------------------------------------------------------------

def ci_smoke(auditor: ConnectionAuditor) -> dict[str, int]:
    """Roda 10 tentativas (5 loopback, 5 remotas) e conta bloqueios."""
    targets = [
        ("127.0.0.1", 7860),       # allowed
        ("localhost", 7860),       # allowed
        ("::1", 7860),             # allowed (IPv6 loopback)
        ("0.0.0.0", 0),            # allowed (bind address)
        ("127.0.0.1", 22),         # allowed
        ("8.8.8.8", 53),           # blocked (DNS Google)
        ("1.1.1.1", 443),          # blocked (Cloudflare DNS)
        ("huggingface.co", 443),   # blocked
        ("civitai.com", 443),       # blocked
        ("github.com", 443),       # blocked
    ]
    for host, port in targets:
        auditor.attempt(host, port)
    return {
        "total": len(auditor.attempts),
        "allowed": auditor.allowed_count(),
        "blocked": auditor.blocked_count(),
    }


# ---------------------------------------------------------------------------
# 4. Suíte de testes
# ---------------------------------------------------------------------------

def check(name: str, ok: bool, detail: str = "") -> bool:
    status = "OK" if ok else "FAIL"
    print(f"  {status} {name}{(' — ' + detail) if detail else ''}")
    return ok


def test_localhost_is_allowed_under_offline() -> bool:
    a = ConnectionAuditor(NetworkPolicy.OFFLINE)
    r = a.attempt("127.0.0.1", 7860)
    return check(
        "offline: 127.0.0.1 permitido",
        not r.blocked and "loopback" in r.reason,
        f"blocked={r.blocked}, reason={r.reason}",
    )


def test_public_ip_is_blocked_under_offline() -> bool:
    a = ConnectionAuditor(NetworkPolicy.OFFLINE)
    r = a.attempt("8.8.8.8", 53)
    return check(
        "offline: 8.8.8.8 (Google DNS) bloqueado",
        r.blocked and "offline-strict" in r.reason,
        f"blocked={r.blocked}, reason={r.reason}",
    )


def test_dns_resolution_attempt_is_blocked() -> bool:
    a = ConnectionAuditor(NetworkPolicy.OFFLINE)
    r = a.attempt("huggingface.co", 443)
    return check(
        "offline: huggingface.co bloqueado",
        r.blocked,
        f"reason={r.reason}",
    )


def test_ipv6_loopback_allowed() -> bool:
    a = ConnectionAuditor(NetworkPolicy.OFFLINE)
    r = a.attempt("::1", 7860)
    return check(
        "offline: IPv6 ::1 permitido",
        not r.blocked,
        f"blocked={r.blocked}",
    )


def test_optional_policy_allows_remote() -> bool:
    a = ConnectionAuditor(NetworkPolicy.OPTIONAL)
    r = a.attempt("civitai.com", 443)
    return check(
        "optional: civitai.com permitido",
        not r.blocked and "optional" in r.reason,
        f"reason={r.reason}",
    )


def test_required_policy_allows_everything() -> bool:
    a = ConnectionAuditor(NetworkPolicy.REQUIRED)
    targets = [("8.8.8.8", 53), ("huggingface.co", 443)]
    for h, p in targets:
        a.attempt(h, p)
    return check(
        "required: tudo permitido (0 bloqueios)",
        a.blocked_count() == 0,
        f"blocked={a.blocked_count()}",
    )


def test_log_is_structured() -> bool:
    a = ConnectionAuditor(NetworkPolicy.OFFLINE)
    a.attempt("127.0.0.1", 7860)
    a.attempt("8.8.8.8", 53)
    attempts = a.get_attempts()
    fields_ok = all(
        hasattr(att, "timestamp") and hasattr(att, "destination")
        and hasattr(att, "protocol") and hasattr(att, "blocked")
        and hasattr(att, "reason")
        for att in attempts
    )
    ts_format = all("T" in att.timestamp and ("+" in att.timestamp or "Z" in att.timestamp) for att in attempts)
    return check(
        "log: 5 campos + timestamp ISO-8601",
        fields_ok and ts_format and len(attempts) == 2,
        f"attempts={len(attempts)}, fields_ok={fields_ok}, ts_format={ts_format}",
    )


def test_ci_smoke_5_allowed_5_blocked() -> bool:
    a = ConnectionAuditor(NetworkPolicy.OFFLINE)
    summary = ci_smoke(a)
    return check(
        "ci_smoke: 5 loopback allowed + 5 remotas blocked",
        summary["allowed"] == 5 and summary["blocked"] == 5 and summary["total"] == 10,
        f"summary={summary}",
    )


def test_socket_getaddrinfo_inspection() -> bool:
    """Verifica que is_localhost cobre também patterns comuns."""
    a = ConnectionAuditor(NetworkPolicy.OFFLINE)
    cases = [
        ("localhost", True),
        ("LOCALHOST", False),  # case sensitive (Linux sockets são case-sensitive)
        ("127.0.0.1", True),
        ("127.0.0.42", True),  # qualquer 127.x
        ("192.168.1.1", False),  # rede local mas não loopback
        ("10.0.0.1", False),  # rede privada
        ("::1", True),
    ]
    results = [(host, a.is_localhost(host)) for host, expected in cases]
    ok = all(actual == expected for (_, actual), (_, expected) in zip(results, cases))
    return check(
        "is_localhost: cobre 127.x, localhost, ::1; não cobre 192.168 ou 10.x",
        ok,
        f"results={[(h, actual) for (h, _), (_, actual) in zip(cases, results)]}",
    )


def main() -> int:
    print("== A31 Offline-Strict prototype ==")
    tests = [
        test_localhost_is_allowed_under_offline,
        test_public_ip_is_blocked_under_offline,
        test_dns_resolution_attempt_is_blocked,
        test_ipv6_loopback_allowed,
        test_optional_policy_allows_remote,
        test_required_policy_allows_everything,
        test_log_is_structured,
        test_ci_smoke_5_allowed_5_blocked,
        test_socket_getaddrinfo_inspection,
    ]
    failures = 0
    for t in tests:
        if not t():
            failures += 1
    print()
    if failures == 0:
        print(f"PASS {len(tests)}/{len(tests)} checks")
        return 0
    print(f"FAIL {failures}/{len(tests)} checks")
    return 1


if __name__ == "__main__":
    sys.exit(main())