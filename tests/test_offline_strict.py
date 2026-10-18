"""A31 / R08 — modo offline estrito, auditoria de egress e guardas.

Reproduz a suíte do protótipo autoritativo ``a31_offline_strict.py`` (9
checks) e acrescenta as integrações de produção: ``guard_egress`` bloqueia
egress remoto e permite loopback/políticas não-estritas, o patch de
``requests`` propaga o bloqueio, o Web Push é suprimido no modo estrito, e os
endpoints ``/api/v1/system/*`` expõem política + log.
"""
from __future__ import annotations

import os

import pytest

from app.services.offline_strict import (
    ENV_FLAG,
    ConnectionAuditor,
    NetworkPolicy,
    OfflineStrictViolation,
    configure_offline_strict,
    get_auditor,
    guard_egress,
    guard_url,
    is_localhost,
    is_offline_strict,
    plugin_network_policy,
    record_blocked,
    reset_auditor,
)


@pytest.fixture(autouse=True)
def _fresh_auditor():
    """Garante singleton limpo e flag desligada por padrão."""
    for module in _live_offline_modules():
        module.reset_auditor()
    os.environ.pop(ENV_FLAG, None)
    yield
    for module in _live_offline_modules():
        module.reset_auditor()
    os.environ.pop(ENV_FLAG, None)


def _live_offline_modules():
    """Módulos offline_strict carregados (contexto ``app.services`` e ``services``)."""
    import sys

    return [
        module
        for name in ("app.services.offline_strict", "services.offline_strict")
        if (module := sys.modules.get(name)) is not None
    ]


def _total_blocked() -> int:
    return sum(m.get_auditor().blocked_count() for m in _live_offline_modules())


# ------------------------------------------------------------------
# Suíte do protótipo (9 checks)
# ------------------------------------------------------------------

def test_localhost_allowed_under_offline():
    auditor = ConnectionAuditor(NetworkPolicy.OFFLINE)
    result = auditor.attempt("127.0.0.1", 7860)
    assert not result.blocked
    assert "loopback" in result.reason


def test_public_ip_blocked_under_offline():
    auditor = ConnectionAuditor(NetworkPolicy.OFFLINE)
    result = auditor.attempt("8.8.8.8", 53)
    assert result.blocked
    assert "offline-strict" in result.reason


def test_dns_resolution_attempt_blocked():
    auditor = ConnectionAuditor(NetworkPolicy.OFFLINE)
    assert auditor.attempt("huggingface.co", 443).blocked
    assert auditor.attempt("civitai.com", 443).blocked


def test_ipv6_loopback_allowed():
    auditor = ConnectionAuditor(NetworkPolicy.OFFLINE)
    assert not auditor.attempt("::1", 7860).blocked


def test_optional_policy_allows_remote():
    auditor = ConnectionAuditor(NetworkPolicy.OPTIONAL)
    result = auditor.attempt("civitai.com", 443)
    assert not result.blocked
    assert "optional" in result.reason


def test_required_policy_allows_everything():
    auditor = ConnectionAuditor(NetworkPolicy.REQUIRED)
    for host, port in (("8.8.8.8", 53), ("huggingface.co", 443)):
        auditor.attempt(host, port)
    assert auditor.blocked_count() == 0


def test_log_is_structured_iso8601():
    auditor = ConnectionAuditor(NetworkPolicy.OFFLINE)
    auditor.attempt("127.0.0.1", 7860)
    auditor.attempt("8.8.8.8", 53)
    attempts = auditor.get_attempts()
    assert len(attempts) == 2
    for att in attempts:
        payload = att.to_dict()
        assert set(payload) == {
            "timestamp", "destination", "protocol", "blocked", "reason",
        }
        assert "T" in att.timestamp
        assert "+" in att.timestamp or "Z" in att.timestamp


def test_ci_smoke_5_allowed_5_blocked():
    """Mesmo smoke do protótipo: 5 loopback + 5 remotas → 5 bloqueios."""
    auditor = ConnectionAuditor(NetworkPolicy.OFFLINE)
    targets = [
        ("127.0.0.1", 7860), ("localhost", 7860), ("::1", 7860),
        ("0.0.0.0", 0), ("127.0.0.1", 22),
        ("8.8.8.8", 53), ("1.1.1.1", 443), ("huggingface.co", 443),
        ("civitai.com", 443), ("github.com", 443),
    ]
    for host, port in targets:
        auditor.attempt(host, port)
    assert auditor.allowed_count() == 5
    assert auditor.blocked_count() == 5
    assert len(auditor.get_attempts()) == 10


def test_is_localhost_covers_loopback_patterns():
    cases = [
        ("localhost", True),
        ("LOCALHOST", False),  # sockets são case-sensitive no Linux
        ("127.0.0.1", True),
        ("127.0.0.42", True),
        ("192.168.1.1", False),
        ("10.0.0.1", False),
        ("::1", True),
    ]
    for host, expected in cases:
        assert is_localhost(host) is expected, host


# ------------------------------------------------------------------
# Guardas de egress (integração de produção)
# ------------------------------------------------------------------

def test_guard_blocks_remote_and_allows_loopback_in_strict_mode():
    configure_offline_strict(True)
    assert is_offline_strict()
    with pytest.raises(OfflineStrictViolation):
        guard_url("https://huggingface.co/weights/model.safetensors")
    guard_url("http://127.0.0.1:7860/api/v1/jobs")  # não levanta
    auditor = get_auditor()
    assert auditor.blocked_count() == 1
    assert auditor.allowed_count() == 1


def test_guard_allows_remote_when_not_strict():
    configure_offline_strict(False)
    assert not is_offline_strict()
    entry = guard_url("https://civitai.com/api/v1/models")
    assert not entry.blocked
    assert get_auditor().blocked_count() == 0


def test_guard_records_purpose_and_port_from_url():
    configure_offline_strict(True)
    with pytest.raises(OfflineStrictViolation) as excinfo:
        guard_url("https://example.com:8443/x", purpose="checkpoint download")
    assert "checkpoint download" in str(excinfo.value)
    entry = get_auditor().get_attempts()[0]
    assert entry.destination == "example.com:8443"


def test_guard_egress_accepts_host_port_form():
    configure_offline_strict(True)
    with pytest.raises(OfflineStrictViolation):
        guard_egress("internal.host", port=8080, purpose="llm")
    entry = get_auditor().get_attempts()[0]
    assert entry.destination == "internal.host:8080"
    assert "llm" in entry.reason or entry.blocked


def test_env_var_enables_strict_mode(monkeypatch):
    monkeypatch.setenv(ENV_FLAG, "1")
    reset_auditor()
    assert is_offline_strict()
    assert get_auditor().policy is NetworkPolicy.OFFLINE
    with pytest.raises(OfflineStrictViolation):
        guard_egress("8.8.8.8", port=53)


def test_record_blocked_appends_without_raising():
    configure_offline_strict(False)
    entry = record_blocked(
        "https://push.example.com/x", reason="offline-strict: web push bloqueado",
    )
    assert entry.blocked
    assert get_auditor().blocked_count() == 1


def test_plugin_network_policy_parsing():
    assert plugin_network_policy({"network_policy": "offline"}) is NetworkPolicy.OFFLINE
    assert plugin_network_policy({"network_policy": "optional"}) is NetworkPolicy.OPTIONAL
    assert plugin_network_policy({"network_policy": "required"}) is NetworkPolicy.REQUIRED
    # Ausente/inválido → required (nunca rebaixa em silêncio para offline).
    assert plugin_network_policy({}) is NetworkPolicy.REQUIRED
    assert plugin_network_policy({"network_policy": "bogus"}) is NetworkPolicy.REQUIRED


# ------------------------------------------------------------------
# Integração requests (safe_download)
# ------------------------------------------------------------------

def test_requests_get_blocked_in_strict_mode():
    """Patch de requests propaga o bloqueio do guard (sem rede real)."""
    import requests

    from app.services import safe_download

    safe_download.install()
    for module in _live_offline_modules():
        module.configure_offline_strict(True)
    # A classe concreta varia conforme o contexto de import que instalou o
    # patch (launch importa `services.safe_download`); RuntimeError cobre
    # ambas as identidades de OfflineStrictViolation.
    with pytest.raises(RuntimeError) as excinfo:
        requests.get("https://huggingface.co/api/models")
    assert "offline-strict" in str(excinfo.value)
    assert _total_blocked() >= 1


def test_requests_allowed_when_mode_off():
    import requests

    from app.services import safe_download

    safe_download.install()
    for module in _live_offline_modules():
        module.configure_offline_strict(False)
    try:
        requests.request(
            "GET", "https://example.invalid/never-reached",
            timeout=(0.01, 0.01),
        )
    except RuntimeError as exc:
        # OfflineStrictViolation é RuntimeError; conexão real é outra classe.
        assert "offline-strict" not in str(exc)
    except Exception:
        pass  # erro de rede/DNS normal quando offline
    assert _total_blocked() == 0


# ------------------------------------------------------------------
# Web Push suprimido no modo estrito
# ------------------------------------------------------------------

def test_web_push_blocked_in_strict_mode(tmp_path, monkeypatch):
    from app.services.web_push import WebPushService

    service = WebPushService(tmp_path / "webpush.json")
    subscription = {
        "endpoint": "https://fcm.googleapis.com/x/y/z",
        "keys": {"p256dh": "A" * 87, "auth": "B" * 22},
    }
    service.subscribe(subscription, origin="http://localhost:7860")

    # Força dependência disponível para exercitar o guard, não o fallback.
    monkeypatch.setattr(
        WebPushService, "dependency_available", staticmethod(lambda: True),
    )
    configure_offline_strict(True)

    result = service.send_test()
    assert result.attempted == 0
    assert result.errors and "offline-strict" in result.errors[0]
    blocked = [a for a in get_auditor().get_attempts() if a.blocked]
    assert any("fcm.googleapis.com" in a.destination for a in blocked)


def test_web_push_not_blocked_when_mode_off(tmp_path, monkeypatch):
    from app.services.web_push import WebPushUnavailable, WebPushService

    service = WebPushService(tmp_path / "webpush.json")
    configure_offline_strict(False)
    # Sem pywebpush instalado o serviço cai no fallback de indisponibilidade
    # (não no guard de offline-strict); com ele, tenta entrega real.
    try:
        result = service.send_test()
    except WebPushUnavailable:
        return
    assert not result.errors or "offline-strict" not in " ".join(result.errors)


# ------------------------------------------------------------------
# Endpoints REST
# ------------------------------------------------------------------

@pytest.fixture()
def client():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.routers.system_network import build_system_network_router

    app = FastAPI()
    app.include_router(build_system_network_router())
    return TestClient(app)


def test_network_policy_endpoint(client):
    configure_offline_strict(True)
    resp = client.get("/api/v1/system/network-policy")
    assert resp.status_code == 200
    body = resp.json()
    assert body["policy"] == "offline"
    assert body["offline_strict"] is True
    assert body["localhost_allowed"] is True


def test_connections_endpoint_lists_attempts(client):
    configure_offline_strict(True)
    with pytest.raises(OfflineStrictViolation):
        guard_url("https://huggingface.co/x")
    guard_url("http://127.0.0.1:7860/ok")
    resp = client.get("/api/v1/system/connections")
    assert resp.status_code == 200
    body = resp.json()
    assert body["count"] == 2
    blocked = [c for c in body["connections"] if c["blocked"]]
    assert len(blocked) == 1
    assert "huggingface.co" in blocked[0]["destination"]


def test_connections_endpoint_blocked_only_filter(client):
    configure_offline_strict(True)
    with pytest.raises(OfflineStrictViolation):
        guard_url("https://a.example.com/x")
    guard_url("http://127.0.0.1:7860/ok")
    resp = client.get("/api/v1/system/connections", params={"blocked_only": True})
    assert resp.json()["count"] == 1


# ------------------------------------------------------------------
# CLI --offline-strict
# ------------------------------------------------------------------

def test_cli_offline_strict_flag_sets_env():
    from click.testing import CliRunner

    from app.cli import cli

    runner = CliRunner()
    before = os.environ.get(ENV_FLAG)
    try:
        result = runner.invoke(cli, ["--offline-strict", "status"])
        assert result.exit_code == 0
        assert os.environ.get(ENV_FLAG) == "1"
        assert "offline estrito" in result.output
    finally:
        if before is None:
            os.environ.pop(ENV_FLAG, None)
        else:
            os.environ[ENV_FLAG] = before


def test_cli_without_flag_leaves_env_untouched():
    from click.testing import CliRunner

    from app.cli import cli

    runner = CliRunner()
    before = os.environ.get(ENV_FLAG)
    try:
        result = runner.invoke(cli, ["status"])
        assert result.exit_code == 0
        assert os.environ.get(ENV_FLAG) == before
    finally:
        if before is None:
            os.environ.pop(ENV_FLAG, None)
        else:
            os.environ[ENV_FLAG] = before
