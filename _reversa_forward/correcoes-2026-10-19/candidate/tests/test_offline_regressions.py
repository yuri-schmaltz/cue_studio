"""Regression coverage for the proposed offline implementation.

Loads the review candidate while legacy writes are disabled. Once applied,
these tests should import app.services.offline_strict directly.
"""
import importlib.util
from pathlib import Path
import sys

import pytest
from click.testing import CliRunner

_spec = importlib.util.spec_from_file_location(
    "offline_review_candidate",
    Path(__file__).resolve().parents[1] / "app/services/offline_strict.py",
)
offline = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = offline
_spec.loader.exec_module(offline)


@pytest.fixture(autouse=True)
def isolated_policy(monkeypatch):
    monkeypatch.setenv("CUE_OFFLINE_STRICT", "0")
    offline.reset_auditor_singleton()
    yield
    offline.reset_auditor_singleton()


def test_cli_offline_flag_runs_status(monkeypatch):
    from app.cli import cli

    monkeypatch.setitem(sys.modules, "app.services.offline_strict", offline)
    result = CliRunner().invoke(cli, ["--offline-strict", "status"])
    assert result.exit_code == 0, result.exception
    assert "Cue Studio v" in result.output
    assert offline.is_offline_strict()


def test_policy_switch_keeps_audit():
    offline.configure_offline_strict(True)
    with pytest.raises(RuntimeError):
        offline.guard_egress("https://example.com:443/model", "download")
    offline.configure_offline_strict(False)
    offline.guard_egress("https://example.com/model", "download")
    assert offline.get_auditor().policy == offline.NetworkPolicy.OPTIONAL
    assert offline.get_auditor().blocked_count() == 1


def test_environment_change_updates_existing_auditor(monkeypatch):
    auditor = offline.get_auditor()
    monkeypatch.setenv("CUE_OFFLINE_STRICT", "1")
    with pytest.raises(RuntimeError):
        offline.guard_egress("https://example.com")
    assert offline.get_auditor() is auditor
    assert auditor.policy == offline.NetworkPolicy.OFFLINE
    assert auditor.blocked_count() == 1


@pytest.mark.parametrize("url", [
    "http://127.0.0.1:7860/api", "http://[::1]:7860/api",
    "http://LOCALHOST:7860/api", "http://127.0.0.42:7860/api",
])
def test_loopback_requests_are_logged_and_allowed(url):
    offline.configure_offline_strict(True)
    offline.guard_egress(url)
    assert offline.get_auditor().allowed_count() == 1


@pytest.mark.parametrize("url", [
    "https://huggingface.co/model", "https://127.evil.example/model",
    "https://localhost@evil.example/model", "https://[2001:db8::1]/model",
])
def test_remote_destinations_are_logged_and_blocked(url):
    offline.configure_offline_strict(True)
    with pytest.raises(RuntimeError, match="offline-strict"):
        offline.guard_egress(url)
    assert offline.get_auditor().blocked_count() == 1


def test_web_push_can_record_blocked_delivery():
    offline.configure_offline_strict(True)
    entry = offline.record_blocked("https://push.example:443/sub", "web push blocked")
    assert entry.blocked
    assert entry.destination == "push.example:443"
    assert offline.get_auditor().get_attempts() == [entry]
