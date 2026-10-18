"""Modo offline estrito + auditoria de egress (A31 / R08).

Implementa o ``--offline-strict`` (ativado por flag da CLI ou pela variável
de ambiente ``CUE_OFFLINE_STRICT=1``): bloqueia egress remoto dos workers
sob controle do app, registrando cada tentativa num :class:`ConnectionAuditor`
estruturado. Loopback (``127.*``, ``::1``, ``localhost``) é sempre permitido.

Portado do protótipo autoritativo
``_reversa_forward/plano-2026-10-04/prototypes/a31_offline_strict.py``.

Diferenças do protótipo (deliberadas, para produção):
  - O estado é um **singleton por processo** (``get_auditor``) com lock,
    para que os patches de ``requests``/Web Push concorrentes registrem
    no mesmo log.
  - O bloqueio real acontece nos pontos de egress existentes
    (:mod:`services.safe_download` para downloads de modelo/CivitAI e
    :mod:`services.web_push` para notificações remotas), que chamam
    :func:`guard_egress` antes de sair na rede.

Escopo (spec 40 §2.2): não garante isolamento de subprocessos nem bloqueia
tráfego de SO fora do app — o auditor cobre os caminhos de rede que o próprio
Cue Studio controla.
"""
from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Iterable, Mapping, Optional
from urllib.parse import urlparse


_log = logging.getLogger("cue_studio.offline_strict")


class NetworkPolicy(str, Enum):
    """Política de rede de um plugin ou do app (spec 40 §3)."""

    OFFLINE = "offline"
    OPTIONAL = "optional"
    REQUIRED = "required"


#: Hosts sempre permitidos (loopback) — idêntico ao protótipo.
LOCALHOST_PATTERNS = (
    "127.0.0.1",
    "::1",
    "localhost",
    "0.0.0.0",
    "[::1]",
)

ENV_FLAG = "CUE_OFFLINE_STRICT"


@dataclass
class ConnectionAttempt:
    """Uma tentativa de conexão auditada (spec 40 §3)."""

    timestamp: str
    destination: str  # "host:port"
    protocol: str
    blocked: bool
    reason: str

    def to_dict(self) -> dict[str, Any]:
        """Representação JSON-serializável para ``/api/v1/system/connections``."""
        return {
            "timestamp": self.timestamp,
            "destination": self.destination,
            "protocol": self.protocol,
            "blocked": self.blocked,
            "reason": self.reason,
        }


class OfflineStrictViolation(RuntimeError):
    """Levantada quando um egress remoto é bloqueado no modo offline estrito."""


def is_localhost(host: str) -> bool:
    """True para loopback (``127.*``, ``::1``, ``localhost``).

    Case-sensitive de propósito: sockets são case-sensitive no Linux
    (``LOCALHOST`` ≠ ``localhost``), reproduzindo o protótipo.
    """
    return host in LOCALHOST_PATTERNS or host.startswith("127.")


class ConnectionAuditor:
    """Registra e decide ``block``/``allow`` por tentativa de conexão."""

    def __init__(self, policy: NetworkPolicy = NetworkPolicy.OFFLINE):
        self.policy = policy
        self._lock = threading.Lock()
        self.attempts: list[ConnectionAttempt] = []

    def is_localhost(self, host: str) -> bool:
        return is_localhost(host)

    def attempt(
        self, host: str, port: int, protocol: str = "tcp"
    ) -> ConnectionAttempt:
        """Registra e decide uma tentativa; retorna o registro."""
        timestamp = datetime.now(timezone.utc).isoformat()
        if self.policy == NetworkPolicy.OFFLINE:
            blocked = not self.is_localhost(host)
            reason = (
                "loopback allowed" if not blocked
                else f"offline-strict bloqueia {host}"
            )
        elif self.policy == NetworkPolicy.OPTIONAL:
            blocked = False
            reason = "optional: allowed"
        else:  # REQUIRED
            blocked = False
            reason = "required: allowed"
        entry = ConnectionAttempt(
            timestamp=timestamp,
            destination=f"{host}:{port}",
            protocol=protocol,
            blocked=blocked,
            reason=reason,
        )
        with self._lock:
            self.attempts.append(entry)
        if blocked:
            _log.warning("[offline-strict] bloqueado %s (%s)", entry.destination, reason)
        return entry

    def get_attempts(self) -> list[ConnectionAttempt]:
        """Cópia do log de tentativas."""
        with self._lock:
            return list(self.attempts)

    def record(self, entry: ConnectionAttempt) -> ConnectionAttempt:
        """Insere um registro já construído (usado por :func:`record_blocked`)."""
        with self._lock:
            self.attempts.append(entry)
        return entry

    def blocked_count(self) -> int:
        with self._lock:
            return sum(1 for a in self.attempts if a.blocked)

    def allowed_count(self) -> int:
        with self._lock:
            return sum(1 for a in self.attempts if not a.blocked)

    def clear(self) -> None:
        """Zera o log (testes / botão 'limpar auditoria')."""
        with self._lock:
            self.attempts.clear()


# ------------------------------------------------------------------
# Singleton por processo
# ------------------------------------------------------------------

_auditor_lock = threading.Lock()
_auditor: Optional[ConnectionAuditor] = None


def is_offline_strict() -> bool:
    """True quando ``CUE_OFFLINE_STRICT`` está ativo (``1``/``true``/``yes``)."""
    import os

    return os.environ.get(ENV_FLAG, "").strip().lower() in {"1", "true", "yes", "on"}


def get_auditor() -> ConnectionAuditor:
    """Auditor singleton (política derivada do flag ``CUE_OFFLINE_STRICT``)."""
    global _auditor
    with _auditor_lock:
        if _auditor is None:
            _auditor = ConnectionAuditor(
                NetworkPolicy.OFFLINE if is_offline_strict() else NetworkPolicy.OPTIONAL
            )
        return _auditor


def configure_offline_strict(enabled: bool) -> ConnectionAuditor:
    """Ativa/desativa o modo e recria o auditor com a política resultante."""
    global _auditor
    import os

    os.environ[ENV_FLAG] = "1" if enabled else "0"
    with _auditor_lock:
        _auditor = ConnectionAuditor(
            NetworkPolicy.OFFLINE if enabled else NetworkPolicy.OPTIONAL
        )
        return _auditor


def reset_auditor() -> None:
    """Descarta o singleton (testes); o próximo acesso recria do env."""
    global _auditor
    with _auditor_lock:
        _auditor = None


# ------------------------------------------------------------------
# Guardas de egress (chamadas pelos caminhos de rede existentes)
# ------------------------------------------------------------------

def _split_host_port(url_or_host: str, port: int | None) -> tuple[str, int]:
    """Extrai ``(host, port)`` de uma URL ou de um host literal."""
    if "://" in url_or_host:
        parsed = urlparse(url_or_host)
        host = parsed.hostname or url_or_host
        return host, port or parsed.port or 443
    if url_or_host.startswith("["):  # IPv6 literal "[::1]:8080"
        host, _, rest = url_or_host[1:].partition("]")
        return host, port or (int(rest[1:]) if rest.startswith(":") else 80)
    if ":" in url_or_host:
        host, _, tail = url_or_host.rpartition(":")
        try:
            return host, port or int(tail)
        except ValueError:
            return url_or_host, port or 80
    return url_or_host, port or 443


def guard_egress(
    url_or_host: str,
    *,
    port: int | None = None,
    protocol: str = "tcp",
    purpose: str = "",
) -> ConnectionAttempt:
    """Audita e (no modo offline estrito) bloqueia um egress remoto.

    Levanta :class:`OfflineStrictViolation` quando o destino é remoto e a
    política é ``offline``; loopback e políticas ``optional``/``required``
    seguem adiante. Sempre registra a tentativa no auditor.
    """
    host, final_port = _split_host_port(url_or_host, port)
    entry = get_auditor().attempt(host, final_port, protocol)
    if entry.blocked:
        raise OfflineStrictViolation(
            f"offline-strict bloqueia egress remoto para {entry.destination}"
            + (f" ({purpose})" if purpose else "")
        )
    return entry


def guard_url(url: str, *, purpose: str = "") -> ConnectionAttempt:
    """Atalho de :func:`guard_egress` para URLs HTTP(S)."""
    return guard_egress(url, protocol="https", purpose=purpose)


def record_blocked(url_or_host: str, *, port: int | None = None, reason: str = "") -> ConnectionAttempt:
    """Registra um bloqueio já decidido em outro ponto (ex.: Web Push)."""
    host, final_port = _split_host_port(url_or_host, port)
    entry = ConnectionAttempt(
        timestamp=datetime.now(timezone.utc).isoformat(),
        destination=f"{host}:{final_port}",
        protocol="tcp",
        blocked=True,
        reason=reason or "blocked upstream",
    )
    get_auditor().record(entry)
    return entry


# ------------------------------------------------------------------
# Política de rede de plugins (spec 40 §2.1)
# ------------------------------------------------------------------

def plugin_network_policy(manifest: Mapping[str, Any]) -> NetworkPolicy:
    """Lê ``network_policy`` de um manifesto de plugin.

    Valores aceitos: ``offline`` | ``optional`` | ``required``. Qualquer
    outro valor (ou ausência) vira ``required`` — um plugin sem declaração
    explícita não pode forçar modo offline, mas também não é rebaixado em
    silêncio para ``offline``.
    """
    raw = str(manifest.get("network_policy") or "").strip().lower()
    try:
        return NetworkPolicy(raw)
    except ValueError:
        return NetworkPolicy.REQUIRED


__all__ = [
    "ENV_FLAG",
    "LOCALHOST_PATTERNS",
    "NetworkPolicy",
    "ConnectionAttempt",
    "ConnectionAuditor",
    "OfflineStrictViolation",
    "is_localhost",
    "is_offline_strict",
    "get_auditor",
    "configure_offline_strict",
    "reset_auditor",
    "guard_egress",
    "guard_url",
    "record_blocked",
    "plugin_network_policy",
]
