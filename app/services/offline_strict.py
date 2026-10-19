"""Modo offline-strict e auditor de conexões (A31 / R08).

NetworkPolicy (offline/optional/required), ConnectionAuditor com hooks de
socket, lista de destinos permitidos (loopback + ::1), tentativa
block/allow, log estruturado, CI smoke.

Fonte: protótipo ``_reversa_forward/plano-2026-10-04/prototypes/a31_offline_strict.py``.
"""

from __future__ import annotations

from ipaddress import ip_address
from urllib.parse import urlsplit
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
        host = host.lower().strip("[]")
        if host in ("localhost", "0.0.0.0"):
            return True
        try:
            return ip_address(host).is_loopback
        except ValueError:
            return False

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


# ---------------------------------------------------------------------------
# Integração com safe_download (A31)
# ---------------------------------------------------------------------------

import os as _os


def is_offline_strict() -> bool:
    """Retorna True se o modo offline-strict está ativo."""
    return _os.environ.get("CUE_OFFLINE_STRICT", "").lower() in ("1", "true", "yes")


# ---------------------------------------------------------------------------
# Singleton auditor (usado por system_network router)
# ---------------------------------------------------------------------------

_auditor_instance: Optional[ConnectionAuditor] = None


def get_auditor() -> ConnectionAuditor:
    """Retorna o singleton ConnectionAuditor (criado na primeira chamada)."""
    global _auditor_instance
    if _auditor_instance is None:
        policy = NetworkPolicy.OFFLINE if is_offline_strict() else NetworkPolicy.OPTIONAL
        _auditor_instance = ConnectionAuditor(policy=policy)
    _auditor_instance.policy = (
        NetworkPolicy.OFFLINE if is_offline_strict() else NetworkPolicy.OPTIONAL
    )
    return _auditor_instance


def reset_auditor_singleton() -> None:
    global _auditor_instance
    _auditor_instance = None


def configure_offline_strict(enabled: bool) -> None:
    """Configure the process policy, preserving the connection audit log."""
    _os.environ["CUE_OFFLINE_STRICT"] = "1" if enabled else "0"
    get_auditor()  # synchronize an already-created auditor with the environment


def _destination(url: str) -> tuple[str, int]:
    parsed = urlsplit(url if "://" in url else "//" + url)
    return parsed.hostname or "", parsed.port or 0


def record_blocked(url: str, reason: str) -> ConnectionAttempt:
    """Record an egress operation rejected before opening a connection."""
    host, port = _destination(url)
    attempt = ConnectionAttempt(
        timestamp=datetime.now(timezone.utc).isoformat(),
        destination=f"{host}:{port}",
        protocol="http",
        blocked=True,
        reason=reason,
    )
    get_auditor().attempts.append(attempt)
    return attempt


def guard_egress(url: str, purpose: str = "") -> None:
    """Reject remote HTTP requests in strict mode and retain the audit entry."""
    if not is_offline_strict():
        return
    host, port = _destination(url)
    att = get_auditor().attempt(host, port, protocol="http")
    if att.blocked:
        raise RuntimeError(
            f"offline-strict bloqueia egress remoto ({purpose}): {url}"
        )
