"""Tests for the 2-stage 'Think-then-Emit' structured generation in BasePlanner."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
APP_ROOT = REPO_ROOT / "app"
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from services.director.planners.demo_skill import DemoSkillPlanner


class ThinkThenEmitTests(unittest.TestCase):
    """Validate the 2-stage Think-then-Emit planner workflow."""

    def test_think_then_emit_successful_two_stage(self):
        # Mock LLM that returns descriptive text on call 1 and strict JSON on call 2
        calls = []

        def mock_generate(**kwargs):
            calls.append(kwargs)
            if len(calls) == 1:
                # Stage 1: Narrative breakdown
                return "1. Shot 1 (0-4s): Introduction to character in rainy alley.\n2. Shot 2 (4-8s): Close-up of neon sign."
            else:
                # Stage 2: Strict JSON
                return json.dumps([
                    {"shot_id": "shot_01", "duration_sec": 4.0, "description": "Rainy alley"},
                    {"shot_id": "shot_02", "duration_sec": 4.0, "description": "Neon sign close-up"},
                ])

        planner = DemoSkillPlanner(llm_generate=mock_generate, llm_generate_streaming=None)
        results = planner._call_llm_think_then_emit(
            user_prompt="Create a 2-shot intro scene in cyberpunk city",
            system_prompt="You are a cinema director.",
            streaming=False,
        )

        self.assertEqual(len(calls), 2)
        # Verify call 1 had thinking enabled/temperature 0.7
        self.assertEqual(calls[0]["temperature"], 0.7)
        self.assertIn("STAGE 1 INSTRUCTION", calls[0]["system_prompt"])

        # Verify call 2 had temperature 0.2 and enable_thinking False
        self.assertEqual(calls[1]["temperature"], 0.2)
        self.assertFalse(calls[1]["enable_thinking"])
        self.assertIn("Director Plan:", calls[1]["prompt"])

        # Verify output
        self.assertEqual(len(results), 2)
        self.assertEqual(results[0]["shot_id"], "shot_01")
        self.assertEqual(results[1]["shot_id"], "shot_02")

    def test_think_then_emit_falls_back_when_stage2_fails(self):
        # If stage 2 fails to produce valid JSON, it falls back to _call_llm_json
        calls = []

        def mock_generate(**kwargs):
            calls.append(kwargs)
            if len(calls) == 1:
                return "Stage 1 Plan..."
            elif len(calls) == 2:
                return "Not valid json"
            elif len(calls) == 3:
                # Retry inside _call_llm_json
                return json.dumps([{"shot_id": "fallback_shot", "duration_sec": 3.0}])
            return "[]"

        planner = DemoSkillPlanner(llm_generate=mock_generate, llm_generate_streaming=None)
        results = planner._call_llm_think_then_emit(
            user_prompt="Fallback test",
            system_prompt="Director prompt",
            streaming=False,
        )

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["shot_id"], "fallback_shot")


if __name__ == "__main__":
    unittest.main()
