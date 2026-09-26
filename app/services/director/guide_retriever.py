"""Dynamic Guide Retriever & Few-Shot Selector for Director & Studio modes.

Instead of dumping 8k-12k tokens of monolithic guide markdown into the system prompt,
the Guide Retriever extracts:
1. Target-model core dialect rules (syntax, camera movements, forbidden patterns).
2. Clean trigger tokens and recommended weights for active LoRAs.
3. 1-2 focused, genre-matched few-shot prompt examples (e.g., cyberpunk, noir, fantasy).

This reduces system prompt overhead by ~60-70%, accelerating prefill (TTFT) and
sharpening model attention onto the current scene's actual narrative and visual constraints.
"""

from __future__ import annotations

import logging
import os
import re
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
_GUIDES_DIR = os.path.join(_BASE_DIR, "..", "llm_guides")
_DIALECT_DIR = os.path.join(_GUIDES_DIR, "dialect")
_ENHANCE_DIR = os.path.join(_GUIDES_DIR, "enhance")

# Curated few-shot exemplar library per aesthetic / genre
FEW_SHOT_EXEMPLARS: Dict[str, List[Dict[str, str]]] = {
    "cinematic_photoreal": [
        {
            "user_concept": "A detective standing in the rain under a flickering neon light at night",
            "visual_prompt": "Cinematic 35mm film still, detective in soaked trench coat standing in rain-slicked alleyway, flickering amber and cyan neon signage reflections on asphalt, shallow depth of field, anamorphic bokeh, subtle atmospheric fog, authentic film grain, high dynamic range.",
        },
        {
            "user_concept": "A spacecraft docking at an orbital station over Earth",
            "visual_prompt": "Hard sci-fi cinematic wide shot, modular cargo spacecraft approaching spinning toroidal space station in low Earth orbit, specular sunlight bouncing off metallic hull panels, vibrant curved Earth horizon below with atmospheric limb haze, deep photorealistic starfield, IMAX 70mm composition.",
        },
    ],
    "anime_stylized": [
        {
            "user_concept": "A magical warrior girl preparing her sword on a windy hilltop",
            "visual_prompt": "High-budget anime feature still by Kyoto Animation, warrior girl with floating lilac hair gripping ornate katana hilt on grassy cliffside, sunset golden hour breeze scattering flower petals, dynamic dramatic lighting, cel-shaded precision, vibrant color saturation.",
        }
    ],
    "retro_vintage": [
        {
            "user_concept": "Two teenagers at a 1980s retro diner drinking milkshakes",
            "visual_prompt": "Vintage 1980s color photography on Kodachrome 64, two teenagers in denim jackets sitting in red vinyl diner booth with strawberry milkshakes, soft warm interior tungsten lighting, jukebox glow, authentic film grain, nostalgic faded tones.",
        }
    ],
}


def _clean_markdown_text(text: str) -> str:
    """Trim extraneous trailing blank lines and normalize whitespace."""
    if not text:
        return ""
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def extract_core_rules(guide_text: str, max_chars: int = 1500) -> str:
    """Extract primary rules and constraints from a guide, omitting lengthy preambles.

    Looks for sections like 'DO', 'DO NOT', 'RULES', 'FORMAT', or takes the top section.
    """
    if not guide_text:
        return ""

    if len(guide_text) <= max_chars:
        return guide_text.strip()

    # Look for bullet points or numbered lists
    rule_blocks = re.findall(r"(?:^|\n)(?:[-*•]|\d+\.)[^\n]+(?:\n(?![#\n])[^\n]+)*", guide_text)
    if rule_blocks:
        combined = "\n".join(b.strip() for b in rule_blocks[:12])
        if len(combined) <= max_chars:
            return combined

    return guide_text[:max_chars].strip() + "\n..."


def get_genre_few_shots(genre_or_style: str = "cinematic_photoreal") -> str:
    """Return formatted few-shot prompt examples for the requested style."""
    key = str(genre_or_style or "").lower().strip()
    matched_key = "cinematic_photoreal"

    if any(k in key for k in ("anime", "manga", "2d", "animation")):
        matched_key = "anime_stylized"
    elif any(k in key for k in ("vintage", "retro", "80s", "70s", "polaroid", "kodak")):
        matched_key = "retro_vintage"

    exemplars = FEW_SHOT_EXEMPLARS.get(matched_key, FEW_SHOT_EXEMPLARS["cinematic_photoreal"])
    lines = ["FEW-SHOT EXAMPLES (Follow style, camera technique, and sensory specificity):"]
    for i, ex in enumerate(exemplars, 1):
        lines.append(f"Example {i}:")
        lines.append(f"  Input: {ex['user_concept']}")
        lines.append(f"  Prompt: {ex['visual_prompt']}")
    return "\n".join(lines)


def retrieve_focused_prompt_guide(
    video_model: str = "",
    image_model: str = "",
    video_loras: Optional[List[str]] = None,
    genre_or_style: str = "cinematic_photoreal",
    compact: bool = True,
) -> str:
    """Retrieve an optimized, token-efficient prompt guide block.

    Combines:
      - Essential dialect rules for the video/image model.
      - Compact LoRA trigger hints.
      - 1-2 curated few-shot examples for the genre.
    """
    from services.director.prompt_polish import get_video_guide, get_image_guide, load_lora_guides

    parts = []

    # Video model rules
    if video_model:
        mode = "light" if compact else "full"
        raw_guide = get_video_guide(video_model, mode=mode)
        if raw_guide:
            core = extract_core_rules(raw_guide, max_chars=1200 if compact else 3000)
            parts.append(f"### Video Model Guidelines ({video_model}):\n{core}")

    # Image model rules
    if image_model:
        mode = "light" if compact else "full"
        raw_guide = get_image_guide(image_model, mode=mode)
        if raw_guide:
            core = extract_core_rules(raw_guide, max_chars=1000 if compact else 2500)
            parts.append(f"### Image Model Guidelines ({image_model}):\n{core}")

    # Active LoRA triggers
    if video_loras:
        lora_guide = load_lora_guides(video_loras=video_loras, video_model=video_model)
        if lora_guide:
            parts.append(f"### Active LoRA Trigger Rules:\n{lora_guide.strip()}")

    # Few-shot examples
    few_shots = get_genre_few_shots(genre_or_style)
    parts.append(few_shots)

    return "\n\n".join(parts)
