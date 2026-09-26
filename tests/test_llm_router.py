"""Unit tests for the LLM Multi-Role Router."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

REPO_ROOT = Path(__file__).resolve().parent.parent
APP_ROOT = REPO_ROOT / "app"
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from services import llm_router


class LlmRouterTests(unittest.TestCase):
    """Validate LLM multi-role routing and fallback behaviors."""

    def setUp(self):
        llm_router.reset_role_configs()

    def tearDown(self):
        llm_router.reset_role_configs()

    def test_default_fallback_when_routing_disabled(self):
        self.assertFalse(llm_router.is_role_routing_enabled())
        target = llm_router.resolve_role_target(llm_router.ROLE_CREATIVE)
        self.assertEqual(target["role"], llm_router.ROLE_CREATIVE)
        self.assertFalse(target["is_override"])
        self.assertIn("model_id", target)

    def test_role_configuration_override(self):
        llm_router.set_role_routing_enabled(True)
        llm_router.set_role_config(
            llm_router.ROLE_CREATIVE,
            provider="anthropic",
            model_id="claude-sonnet-4-6",
            api_key="test-key",
        )
        llm_router.set_role_config(
            llm_router.ROLE_TECHNICAL,
            provider="local",
            model_id="Qwen/Qwen2.5-Coder-14B-Instruct-GGUF",
        )

        creative_target = llm_router.resolve_role_target(llm_router.ROLE_CREATIVE)
        self.assertTrue(creative_target["is_override"])
        self.assertEqual(creative_target["provider"], "anthropic")
        self.assertEqual(creative_target["model_id"], "claude-sonnet-4-6")
        self.assertEqual(creative_target["api_key"], "test-key")

        technical_target = llm_router.resolve_role_target(llm_router.ROLE_TECHNICAL)
        self.assertTrue(technical_target["is_override"])
        self.assertEqual(technical_target["provider"], "local")
        self.assertEqual(technical_target["model_id"], "Qwen/Qwen2.5-Coder-14B-Instruct-GGUF")

        # Unconfigured role falls back to global default
        polish_target = llm_router.resolve_role_target(llm_router.ROLE_POLISH)
        self.assertFalse(polish_target["is_override"])

    @patch("services.llm_service.generate")
    def test_generate_for_role_routes_to_local_when_not_remote(self, mock_generate):
        mock_generate.return_value = "generated text"
        llm_router.set_role_routing_enabled(False)

        res = llm_router.generate_for_role(
            llm_router.ROLE_TECHNICAL,
            prompt="Plan shots",
            system_prompt="Director system",
        )

        self.assertEqual(res, "generated text")
        mock_generate.assert_called_once()


if __name__ == "__main__":
    unittest.main()
