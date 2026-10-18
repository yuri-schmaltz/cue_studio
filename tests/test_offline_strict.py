"""Testes de integração do modo offline-strict (A31 / R08)."""

from __future__ import annotations

from app.services.offline_strict import (
    ConnectionAuditor,
    NetworkPolicy,
    ci_smoke,
)


def test_localhost_allowed():
    aud = ConnectionAuditor(NetworkPolicy.OFFLINE)
    att = aud.attempt("127.0.0.1", 7860)
    assert att.blocked is False
    assert "loopback" in att.reason


def test_public_ip_blocked():
    aud = ConnectionAuditor(NetworkPolicy.OFFLINE)
    att = aud.attempt("8.8.8.8", 53)
    assert att.blocked is True
    assert "bloqueia" in att.reason


def test_external_dns_blocked():
    aud = ConnectionAuditor(NetworkPolicy.OFFLINE)
    att = aud.attempt("huggingface.co", 443)
    assert att.blocked is True


def test_ipv6_loopback_allowed():
    aud = ConnectionAuditor(NetworkPolicy.OFFLINE)
    att = aud.attempt("::1", 7860)
    assert att.blocked is False


def test_optional_allows_all():
    aud = ConnectionAuditor(NetworkPolicy.OPTIONAL)
    att = aud.attempt("8.8.8.8", 53)
    assert att.blocked is False
    assert "optional" in att.reason


def test_required_allows_all():
    aud = ConnectionAuditor(NetworkPolicy.REQUIRED)
    att = aud.attempt("8.8.8.8", 53)
    assert att.blocked is False
    assert "required" in att.reason


def test_log_structured():
    aud = ConnectionAuditor(NetworkPolicy.OFFLINE)
    aud.attempt("127.0.0.1", 7860)
    aud.attempt("8.8.8.8", 53)
    attempts = aud.get_attempts()
    assert len(attempts) == 2
    for a in attempts:
        d = a.to_dict()
        assert "timestamp" in d
        assert "destination" in d
        assert "protocol" in d
        assert "blocked" in d
        assert "reason" in d


def test_counts():
    aud = ConnectionAuditor(NetworkPolicy.OFFLINE)
    aud.attempt("127.0.0.1", 7860)
    aud.attempt("8.8.8.8", 53)
    assert aud.allowed_count() == 1
    assert aud.blocked_count() == 1


def test_ci_smoke():
    aud = ConnectionAuditor(NetworkPolicy.OFFLINE)
    summary = ci_smoke(aud)
    assert summary["total"] == 10
    assert summary["allowed"] == 5
    assert summary["blocked"] == 5


def test_is_localhost():
    aud = ConnectionAuditor(NetworkPolicy.OFFLINE)
    assert aud.is_localhost("127.0.0.1") is True
    assert aud.is_localhost("localhost") is True
    assert aud.is_localhost("::1") is True
    assert aud.is_localhost("127.0.0.42") is True
    assert aud.is_localhost("192.168.1.1") is False
    assert aud.is_localhost("10.0.0.1") is False
    assert aud.is_localhost("8.8.8.8") is False
