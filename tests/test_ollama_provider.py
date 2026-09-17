"""Tests for the Ollama LLM provider.

Ollama is local-first (no API key by default) so it must behave like
Remote from a wiring standpoint: it lives in the same OpenAI-compatible
provider branch, picks up auth from the same ``llm_remote_api_key`` slot,
and is *not* in the public-provider set (NSFW stays available because
nothing leaves the box).

These tests don't need an Ollama daemon running — they exercise the URL
resolver, the credential lookup, the provider-aware payload filter, and
the offline model-list fallback so we don't regress on the basic
plumbing just because someone happens to have the daemon up.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "app") not in sys.path:
    sys.path.insert(0, str(ROOT / "app"))

from services import llm_service  # noqa: E402


class OllamaProviderTests(unittest.TestCase):
    """Lightweight coverage for the Ollama provider surface."""

    def test_default_base_url(self) -> None:
        # Canonical default — what the Settings panel shows when the user
        # hasn't overridden the URL field.
        assert llm_service.OLLAMA_DEFAULT_BASE_URL == "http://localhost:11434"

    def test_base_url_strips_trailing_v1(self) -> None:
        # Users frequently paste the OpenAI-style base (with /v1) into
        # the Remote URL field. The resolver has to strip it so the
        # /v1/chat/completions path we append doesn't double up.
        assert llm_service._ollama_base_url("http://gpu.lan:11434/v1") == "http://gpu.lan:11434"

    def test_base_url_preserves_custom_host(self) -> None:
        # Custom host/port passes through unchanged so users running
        # Ollama on a separate box (or behind a reverse proxy on a
        # different port) still work.
        assert (
            llm_service._ollama_base_url("http://10.0.0.5:9999")
            == "http://10.0.0.5:9999"
        )

    def test_base_url_defaults_when_empty(self) -> None:
        # Empty config falls back to localhost — same value the constant
        # advertises, but exercises the falsy branch explicitly.
        assert llm_service._ollama_base_url("") == llm_service.OLLAMA_DEFAULT_BASE_URL

    def test_api_key_slot_is_remote(self) -> None:
        # Single credential surface: Ollama shares the Remote API key
        # slot so the Settings UI doesn't grow another field.
        assert llm_service.PROVIDER_API_KEY_SETTING["ollama"] == "llm_remote_api_key"

    def test_provider_api_key_lookup(self) -> None:
        # Mirrors the helper used by launch.py — make sure the lookup
        # returns the value from the shared slot.
        services = {"llm_remote_api_key": "sk-test-xyz"}
        assert llm_service.provider_api_key("ollama", services) == "sk-test-xyz"

    def test_provider_api_key_missing_returns_empty(self) -> None:
        # No key set → empty string, not None / KeyError. Empty auth
        # is fine for Ollama defaults.
        assert llm_service.provider_api_key("ollama", {}) == ""

    def test_finalize_payload_drops_llama_cpp_only_fields(self) -> None:
        # Ollama's OpenAI shim accepts the standard chat-completions
        # surface but rejects llama.cpp-only knobs like cache_prompt.
        # Provider filter must engage for ollama, not just
        # remote/openai — regression guard for when someone refactors
        # the provider gate.
        llm_service._provider = "ollama"
        llm_service._model_id = "qwen2.5:3b"
        payload = {
            "model": "should_be_overwritten",
            "messages": [{"role": "user", "content": "hi"}],
            "temperature": 0.5,
            "cache_prompt": True,  # llama.cpp-only — must be dropped
            "min_p": 0.05,         # llama.cpp-only — must be dropped
        }
        cleaned = llm_service._finalize_payload(payload)
        assert "cache_prompt" not in cleaned
        assert "min_p" not in cleaned
        assert cleaned["model"] == "qwen2.5:3b"
        assert cleaned["temperature"] == 0.5

    def test_finalize_payload_local_passes_through(self) -> None:
        # Local llama-server accepts the full sampler surface, so the
        # filter must be a no-op for the local provider. Guards
        # against accidentally over-applying the OpenAI filter.
        llm_service._provider = "local"
        llm_service._model_id = "Abhiray/gemma-4-E4B-it-heretic-GGUF"
        payload = {
            "model": "should_not_be_overwritten",
            "messages": [{"role": "user", "content": "hi"}],
            "cache_prompt": True,
            "min_p": 0.05,
        }
        cleaned = llm_service._finalize_payload(payload)
        assert "cache_prompt" in cleaned
        assert "min_p" in cleaned

    def test_offline_model_fallback(self) -> None:
        # When the daemon is unreachable, get_available_models still
        # surfaces a usable list so the user can pick a tag manually
        # (and the picker isn't empty). We mock requests.get to raise
        # so the function hits its except branch.
        with mock.patch.object(llm_service.requests, "get", side_effect=Exception("offline")):
            models = llm_service._list_ollama_models("http://localhost:11434")
        assert models, "fallback list should be non-empty"
        assert all(m["provider"] == "ollama" for m in models)
        assert any("Ollama" in m["label"] for m in models)

    def test_online_models_normalize_size_and_family(self) -> None:
        # Happy path: daemon reachable, /api/tags returns shape we
        # expect. Labels must include the tag name and a human-readable
        # size; provider stays "ollama" so the UI filter keeps them
        # grouped with the other Ollama tags.
        fake_response = mock.Mock()
        fake_response.json.return_value = {
            "models": [
                {
                    "name": "qwen2.5:3b",
                    "size": 3 * 1024 ** 3,
                    "details": {
                        "family": "qwen2",
                        "parameter_size": "3B",
                    },
                },
            ]
        }
        fake_response.raise_for_status.return_value = None
        with mock.patch.object(llm_service.requests, "get", return_value=fake_response):
            models = llm_service._list_ollama_models("http://localhost:11434")
        assert len(models) == 1
        assert models[0]["id"] == "qwen2.5:3b"
        assert "qwen2.5:3b" in models[0]["label"]
        assert "3B" in models[0]["label"]
        assert "GB" in models[0]["label"]
        assert models[0]["provider"] == "ollama"

    def test_is_loaded_for_ollama(self) -> None:
        # is_loaded() used to gate generation on `_process is not None`
        # which is wrong for non-local providers (no subprocess). Make
        # sure ollama follows the same rule as remote/openai.
        llm_service._provider = "ollama"
        llm_service._model_id = "qwen2.5:3b"
        try:
            assert llm_service.is_loaded() is True
        finally:
            llm_service._provider = "local"
            llm_service._model_id = ""
