"""Fallback mínimo para a dependência opcional `audiotools`.

O codec neural xcodec (usado pelo YuE) traz uma cópia do DAC da Descript
embutida em `descriptaudiocodec/`, e o inicializador desse pacote importa
`audiotools` — uma distribuição da Descript que não é publicada no PyPI.

As partes do codec que o YuE realmente instancia (`Encoder` e `Decoder` do
DAC) são `torch.nn.Module` comuns e nunca chamam a API do `audiotools`; o que
o pacote precisa é apenas ser importável, porque o `dac/__init__.py` registra
algumas listas em `audiotools.ml.BaseModel` no momento do import.

Quando o `audiotools` real está instalado, nada muda. Quando não está, este
módulo instala um substituto permissivo no `sys.modules` para que a cadeia de
imports do codec feche.
"""

from __future__ import annotations

import sys
import types


class _Stub:
    """Placeholder que aceita qualquer chamada e devolve outro placeholder."""

    def __init__(self, *args, **kwargs):
        pass

    def __call__(self, *args, **kwargs):
        return _Stub()


def _make_module(name: str) -> types.ModuleType:
    """Módulo que devolve uma classe-placeholder para qualquer atributo."""
    module = types.ModuleType(name)

    def __getattr__(attribute: str):
        if attribute.startswith("__"):
            raise AttributeError(attribute)
        return type(attribute, (_Stub,), {})

    module.__getattr__ = __getattr__
    return module


def ensure_audiotools() -> bool:
    """Garante que `audiotools` seja importável. Devolve True se o substituto
    foi instalado (ou seja, o pacote real não existe no ambiente)."""
    try:
        import audiotools  # noqa: F401
        return False
    except Exception:
        pass

    package = _make_module("audiotools")
    ml_module = _make_module("audiotools.ml")
    core_module = _make_module("audiotools.core")
    util_module = _make_module("audiotools.core.util")

    class BaseModel(_Stub):
        INTERN: list = []
        EXTERN: list = []

    ml_module.BaseModel = BaseModel
    core_module.util = util_module
    package.ml = ml_module
    package.core = core_module

    sys.modules.setdefault("audiotools", package)
    sys.modules.setdefault("audiotools.ml", ml_module)
    sys.modules.setdefault("audiotools.core", core_module)
    sys.modules.setdefault("audiotools.core.util", util_module)
    return True
