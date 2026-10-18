"""Router REST do cross-family continuity (A25b / R10) — alias module."""

from __future__ import annotations

from app.routers.continuity import *  # noqa: F401,F403
from app.routers.continuity import build_continuity_router

build_cross_family_continuity_router = build_continuity_router
"""<|end|><|start|>assist<|channel|>analysis<|message|>Again trailing docstring? I included triple quotes at end accidentally. Let me just write clean.<|end|><|start|><|start|>assistant to=write<|channel|>analysis <|constrain|>xml<|message|><rfl:parameter name="path">
/home/yuri/Documentos/cine_local/cue_studio/app/routers/cross_family_continuity.py