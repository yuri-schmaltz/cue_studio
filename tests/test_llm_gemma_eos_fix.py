"""Regression tests for the Gemma 4 EOS-removal fix.

Bug history (2026-09-28)
------------------------
The default model, ``Abhiray/gemma-4-E4B-it-heretic-GGUF``, hung the
``/api/v1/director/v2/plan`` endpoint indefinitely. The llama-server
log showed:

    special_eog_ids contains '<|tool_response>', removing '</s>' token
    from EOG list

llama.cpp's tokenizer removes ``</s>`` from the EOG list when it
detects ``<|tool_response>`` as another EOG token. With no EOS marker
the model emits tokens until ``max_new_tokens`` is reached — observed
empirically as 1,300+ tokens at 8.5 t/s with no termination.

Fix
---
Each Gemma 4 registry entry now declares ``default_stop_tokens`` (the
canonical Gemma 4 turn-end markers ``<|im_end|>`` and
``<end_of_turn>``). ``generate()``, ``generate_streaming()``, and the
Director planner's ``_call_llm_json`` all layer those tokens onto the
OpenAI ``stop=`` field. llama-server's ``/v1/chat/completions`` honors
``stop=`` and ends generation cleanly when any of them appear.

These tests verify:
  1. Registry entries for Gemma 4 variants declare the stop tokens.
  2. Non-Gemma models are NOT affected.
  3. ``generate()`` injects the registry stops into the payload.
  4. ``generate_streaming()`` does the same.
  5. ``_finalize_payload`` preserves ``stop=`` for hosted providers.
  6. The Director planner forwards ``stop=`` to the LLM call.

The tests use ``unittest.mock`` to avoid actually loading llama-server.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

REPO_ROOT = Path(__file__).resolve().parent.parent
APP_ROOT = REPO_ROOT / "app"
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))


class GemmaRegistryStopTokensTests(unittest.TestCase):
    """Registry entries for Gemma 4 must declare ``default_stop_tokens``."""

    def _get_entry(self, model_id: str) -> dict:
        from services import llm_service
        return llm_service.MODEL_REGISTRY.get(model_id, {})

    def test_gemma4_e2b_registry_has_default_stop_tokens(self):
        entry = self._get_entry("Nesuwka/gemma-4-E2B-it-heretic-ara-Q4_K_M-GGUF")
        self.assertIn("default_stop_tokens", entry)
        self.assertIn("<|im_end|>", entry["default_stop_tokens"])
        self.assertIn("<end_of_turn>", entry["default_stop_tokens"])

    def test_gemma4_e4b_default_model_has_default_stop_tokens(self):
        # The default model — this is the one that hung the planner.
        entry = self._get_entry("Abhiray/gemma-4-E4B-it-heretic-GGUF")
        self.assertIn("default_stop_tokens", entry)
        self.assertIn("<|im_end|>", entry["default_stop_tokens"])
        self.assertIn("<end_of_turn>", entry["default_stop_tokens"])

    def test_gemma4_31b_has_default_stop_tokens(self):
        entry = self._get_entry("paperscarecrow/Gemma-4-31B-it-abliterated-gguf")
        self.assertIn("default_stop_tokens", entry)
        self.assertIn("<|im_end|>", entry["default_stop_tokens"])

    def test_gemma4_12b_experimental_has_default_stop_tokens(self):
        entry = self._get_entry("mradermacher/gemma-4-12B-it-abliterated-uncensored-i1-GGUF")
        self.assertIn("default_stop_tokens", entry)
        self.assertIn("<|im_end|>", entry["default_stop_tokens"])

    def test_non_gemma_qwen_models_have_no_default_stop_tokens(self):
        # Qwen uses different chat-template markers and isn't affected by
        # the Gemma 4 EOS-removal bug. We MUST NOT touch their behavior.
        from services import llm_service
        qwen_ids = [
            k for k in llm_service.MODEL_REGISTRY
            if "qwen" in k.lower() and "gemma" not in k.lower()
        ]
        self.assertTrue(qwen_ids, "No Qwen entries found in registry")
        for model_id in qwen_ids:
            entry = llm_service.MODEL_REGISTRY[model_id]
            self.assertNotIn(
                "default_stop_tokens", entry,
                f"Qwen entry {model_id} should not declare Gemma 4 stop tokens",
            )

    def test_default_stop_tokens_never_empty_strings(self):
        # An empty string in `stop=` makes llama-server terminate
        # generation immediately (every token matches ""). Defense
        # against accidental "" entries from upstream registry edits.
        from services import llm_service
        for model_id, entry in llm_service.MODEL_REGISTRY.items():
            stops = entry.get("default_stop_tokens")
            if stops is None:
                continue
            self.assertNotIn(
                "", stops,
                f"{model_id} has an empty string in default_stop_tokens "
                "— that would terminate generation on the first token.",
            )


class GenerateStopInjectionTests(unittest.TestCase):
    """``generate()`` and ``generate_streaming()`` must inject registry stops."""

    def _stub_loaded(self, llm_service, model_id: str):
        """Make ``is_loaded()`` return True and pin the active model id."""
        llm_service._model_id = model_id
        llm_service._provider = "local"
        # is_loaded() for local provider checks _process.poll(); we don't
        # want a real subprocess, so patch the function instead.
        return patch.object(llm_service, "is_loaded", return_value=True)

    def _capture_payload(self, llm_service, fn_name: str, **kwargs) -> dict:
        """Patch ``requests.post`` and return the payload that would be sent."""
        fake_response = MagicMock()
        fake_response.json.return_value = {
            "choices": [{"message": {"content": "ok"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
        }
        fake_response.raise_for_status = MagicMock()
        with patch.object(llm_service.requests, "post",
                          return_value=fake_response) as mock_post:
            getattr(llm_service, fn_name)(**kwargs)
        self.assertTrue(mock_post.called, f"{fn_name} never called requests.post")
        return mock_post.call_args.kwargs["json"]

    def test_generate_injects_default_stop_tokens_for_gemma4(self):
        from services import llm_service
        llm_service._begin_request = MagicMock()
        with self._stub_loaded(llm_service, "Abhiray/gemma-4-E4B-it-heretic-GGUF"):
            payload = self._capture_payload(
                llm_service, "generate", prompt="test", max_new_tokens=64,
            )
        self.assertIn("stop", payload)
        self.assertIn("<|im_end|>", payload["stop"])
        self.assertIn("<end_of_turn>", payload["stop"])

    def test_generate_streaming_injects_default_stop_tokens_for_gemma4(self):
        from services import llm_service
        llm_service._begin_request = MagicMock()
        fake_response = MagicMock()
        fake_response.raise_for_status = MagicMock()
        fake_response.iter_lines.return_value = iter([
            'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}],'
            '"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}',
            "data: [DONE]",
        ])
        with self._stub_loaded(llm_service, "Abhiray/gemma-4-E4B-it-heretic-GGUF"):
            with patch.object(llm_service.requests, "post",
                              return_value=fake_response) as mock_post:
                llm_service.generate_streaming(prompt="test", max_new_tokens=64)
        payload = mock_post.call_args.kwargs["json"]
        self.assertIn("stop", payload)
        self.assertIn("<|im_end|>", payload["stop"])
        self.assertIn("<end_of_turn>", payload["stop"])

    def test_generate_does_not_inject_stop_for_non_gemma_models(self):
        from services import llm_service
        llm_service._begin_request = MagicMock()
        with self._stub_loaded(llm_service, "Qwen/Qwen2.5-Coder-14B-Instruct-GGUF"):
            payload = self._capture_payload(
                llm_service, "generate", prompt="test", max_new_tokens=64,
            )
        # Qwen entry has no default_stop_tokens; if any leaked, this fails.
        if "stop" in payload:
            self.assertNotIn("<|im_end|>", payload["stop"])
            self.assertNotIn("<end_of_turn>", payload["stop"])

    def test_generate_preserves_caller_supplied_stop_tokens(self):
        from services import llm_service
        llm_service._begin_request = MagicMock()
        with self._stub_loaded(llm_service, "Abhiray/gemma-4-E4B-it-heretic-GGUF"):
            payload = self._capture_payload(
                llm_service,
                "generate",
                prompt="test",
                max_new_tokens=64,
                stop=["MY_CUSTOM_END"],
            )
        self.assertIn("stop", payload)
        self.assertIn("MY_CUSTOM_END", payload["stop"])
        self.assertIn("<|im_end|>", payload["stop"])


class FinalizePayloadStopTests(unittest.TestCase):
    """Hosted-provider ``_finalize_payload`` must preserve the ``stop`` field."""

    def test_finalize_payload_keeps_stop_for_openai_provider(self):
        from services import llm_service
        llm_service._provider = "openai"
        llm_service._model_id = "gpt-4o"
        payload = {
            "messages": [{"role": "user", "content": "hi"}],
            "max_tokens": 64,
            "stop": ["<|im_end|>", "<end_of_turn>"],
            "cache_prompt": False,  # llama.cpp-only — must be stripped
            "min_p": 0.05,          # llama.cpp-only — must be stripped
        }
        out = llm_service._finalize_payload(payload)
        self.assertIn("stop", out)
        self.assertEqual(out["stop"], ["<|im_end|>", "<end_of_turn>"])
        self.assertNotIn("cache_prompt", out)
        self.assertNotIn("min_p", out)
        self.assertEqual(out["model"], "gpt-4o")


class PlannerStopForwardingTests(unittest.TestCase):
    """``BasePlanner._call_llm_json`` must forward ``stop=`` to the LLM."""

    def test_call_llm_json_forwards_stop_to_generate(self):
        from services import llm_service
        from services.director.planners.base import BasePlanner

        # We don't need a real LLM here — capture the kwargs that the
        # planner passes to its generate function.
        captured_kwargs: dict = {}

        def fake_generate(**kwargs):
            captured_kwargs.update(kwargs)
            return "{}"

        # Build a minimal subclass that doesn't need to implement ``plan``
        class _ProbePlanner(BasePlanner):
            def plan(self, **kwargs):
                raise NotImplementedError

        planner = _ProbePlanner(
            llm_generate=fake_generate,
            llm_generate_streaming=None,
        )

        # Force the registry entry to look like a Gemma 4 model.
        with patch.object(llm_service, "_active_registry_entry",
                          return_value={
                              "thinking_style": "gemma",
                              "default_stop_tokens": ["<|im_end|>", "<end_of_turn>"],
                          }):
            try:
                planner._call_llm_json(
                    user_prompt="hi",
                    system_prompt="",
                    max_tokens=64,
                )
            except Exception:
                # The fake returns "{}" — the planner's JSON parser may
                # complain, that's fine; we only care about captured kwargs.
                pass

        self.assertIn("stop", captured_kwargs,
                      "Planner should forward stop= to the LLM call")
        self.assertIn("<|im_end|>", captured_kwargs["stop"])
        self.assertIn("<end_of_turn>", captured_kwargs["stop"])


if __name__ == "__main__":
    unittest.main()