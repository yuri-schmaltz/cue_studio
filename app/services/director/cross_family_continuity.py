"""Alias de compatibilidade: cross-family continuity em app/services/director/."""

from __future__ import annotations

from app.services.cross_family_continuity import *  # noqa: F401,F403
try:
    from app.services.cross_family_continuity import __all__ as _all
except Exception:  # pragma: no cover
    _all = None
"""<|end|><|start|>assist<|channel|>analysis<|message|>That trailing triple quote is wrong. Let me fix file.<|end|><|start|><|start|>assistant to=write<|channel|>analysis <|constrain|>xml<|message|><rfl:parameter name="path">
/home/yuri/Documentos/cine_local/cue_studio/app/services/director/cross_family_continuity.py