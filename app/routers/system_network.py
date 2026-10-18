"""Router de sistema: política de rede + auditoria de egress (A31 / R08).

Rotas (spec 40 §4):

  GET /api/v1/system/network-policy   → estado atual da política
  GET /api/v1/system/connections      → log de tentativas de conexão

O router NÃO se registra no app vivo — isso acontece via
``api.include_router(build_system_network_router())`` em ``launch.py``
(padrão de ``routers/productions.py``). O auditor é injetável para teste.
"""
from __future__ import annotations

import importlib
import importlib.util
import logging
import sys
from typing import Any, Callable

from fastapi import APIRouter, Query


def _resolve(short: str, full: str):
    for name in (full, short):
        if name in sys.modules:
            return sys.modules[name]
    for full_name in (full, short):
        spec = importlib.util.find_spec(full_name)
        if spec is not None:
            return importlib.import_module(full_name)
    raise ImportError(f"Cannot resolve {short}")


_offline_module = _resolve(
    "app.services.offline_strict", "services.offline_strict"
)
NetworkPolicy = _offline_module.NetworkPolicy


_log = logging.getLogger("cue_studio.system_network.router")


def _loaded_offline_modules() -> list:
    """Todos os módulos offline_strict carregados (``app.services.*`` e ``services.*``).

    ``launch.py`` importa como ``services.offline_strict`` e os testes como
    ``app.services.offline_strict``; num mesmo processo os dois singletons
    podem existir. As leituras somam os dois para o log ficar completo.
    """
    modules = [
        sys.modules[name]
        for name in ("app.services.offline_strict", "services.offline_strict")
        if name in sys.modules
    ]
    return modules or [_offline_module]


def _merged_attempt_dicts() -> tuple[str, list]:
    """(política atual, tentativas mescladas em ordem cronológica)."""
    entries: list[dict[str, Any]] = []
    strict = False
    for module in _loaded_offline_modules():
        auditor = module.get_auditor()
        entries.extend(a.to_dict() for a in auditor.get_attempts())
        strict = strict or module.is_offline_strict()
    entries.sort(key=lambda item: item["timestamp"])
    policy = "offline" if strict else "optional"
    return policy, entries


def build_system_network_router(
    auditor_provider: Callable[[], Any] | None = None,
    *,
    policy_provider: Callable[[], str] | None = None,
) -> APIRouter:
    """Factory do router de política de rede.

    Parameters
    ----------
    auditor_provider:
        Devolve o :class:`ConnectionAuditor` atual. Default usa o singleton
        do serviço (:func:`services.offline_strict.get_auditor`).
    policy_provider:
        Devolve o nome da política (``"offline"``/``"optional"``). Default
        deriva do estado do auditor singleton.
    """
    router = APIRouter()

    def _auditor():
        if auditor_provider is not None:
            return auditor_provider()
        return None  # sinaliza "usar visão mesclada"

    def _policy_name() -> str:
        if policy_provider is not None:
            return policy_provider()
        return _merged_attempt_dicts()[0]

    @router.get("/api/v1/system/network-policy")
    async def network_policy() -> dict[str, Any]:
        if policy_provider is not None or auditor_provider is not None:
            auditor = _auditor()
            attempts = auditor.get_attempts()
            return {
                "policy": _policy_name(),
                "offline_strict": bool(
                    _offline_module.is_offline_strict()
                ),
                "localhost_allowed": True,
                "blocked_count": auditor.blocked_count(),
                "allowed_count": auditor.allowed_count(),
                "attempt_count": len(attempts),
            }
        policy, entries = _merged_attempt_dicts()
        blocked = sum(1 for e in entries if e["blocked"])
        return {
            "policy": policy,
            "offline_strict": bool(_offline_module.is_offline_strict()),
            "localhost_allowed": True,
            "blocked_count": blocked,
            "allowed_count": len(entries) - blocked,
            "attempt_count": len(entries),
        }

    @router.get("/api/v1/system/connections")
    async def connection_log(
        limit: int = Query(default=200, ge=1, le=2000),
        blocked_only: bool = Query(default=False),
    ) -> dict[str, Any]:
        auditor = _auditor()
        if auditor is None:
            policy, entries = _merged_attempt_dicts()
            if blocked_only:
                entries = [e for e in entries if e["blocked"]]
            entries = entries[-limit:]
            return {
                "count": len(entries),
                "policy": policy,
                "connections": entries,
            }
        attempts = auditor.get_attempts()
        if blocked_only:
            attempts = [a for a in attempts if a.blocked]
        attempts = attempts[-limit:]
        return {
            "count": len(attempts),
            "policy": _policy_name(),
            "connections": [a.to_dict() for a in attempts],
        }

    return router


__all__ = ["build_system_network_router"]
