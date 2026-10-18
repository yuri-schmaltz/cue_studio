"""Modo offline-strict e auditor de conexões (A31 / R08).

NetworkPolicy (offline/optional/required), ConnectionAuditor com hooks de
socket, lista de destinos permitidos (loopback + ::1), tentativa
block/allow, log estruturado, CI smoke.

Fonte: protótipo ``_reversa_forward/plano-2026-10-04/prototypes/a31_offline_strict.py``.
"""

from __future__ import annotations

import socket
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Optional

LOCALHOST_PATTERNS = (
    "127.0.0.1",
    "::1",
    "localhost",
    "0.0.0.0",
    "[::1]",
)


class NetworkPolicy(str, Enum):
    OFFLINE = "offline"
    OPTIONAL = "optional"
    REQUIRED = "required"


@dataclass
class ConnectionAttempt:
    timestamp: str
    destination: str
    protocol: str
    blocked: bool
    reason: str

    def to_dict(self) -> dict:
        return asdict(self)


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


def ci_smoke(auditor: ConnectionAuditor) -> dict[str, int]:
    targets = [
        ("127.0.0.1", 7860),
        ("localhost", 7860),
        ("::1", 7860),
        ("0.0.0.0", 0),
        ("127.0.0.1", 22),
        ("8.8.8.8", 53),
        ("1.1.1.1", 443),
        ("huggingface.co", 443),
        ("civitai.com", 443),
        ("example.com", 80),
    ]
    for host, port in targets:
        auditor.attempt(host, port)
    return {
        "total": len(targets),
        "allowed": auditor.allowed_count(),
        "blocked": auditor.blocked_count(),
    }
