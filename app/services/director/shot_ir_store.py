"""Persistência atômica do sidecar Shot IR (A25).

Sidecar por plano em ``<project_dir>/director/<production_id>/shots/
<shot_id>.shot_ir.json`` (spec 31 seção 3.2). Escrita atômica
(write-to-temp + rename), leitura tolerante a ``schema_version``
desconhecida (warning, não crash) e conveniências de lista/ordem por
plano. Portado do protótipo autoritativo ``a25_shot_ir.py``.
"""
from __future__ import annotations

import json
import os
import tempfile
import warnings
from pathlib import Path
from typing import Optional

from .shot_ir_schema import (
    SHOT_IR_SUPPORTED_VERSIONS,
    ShotIR,
    ShotIRValidationError,
    dict_to_shotir,
    shotir_to_dict,
)


def shot_ir_sidecar_path(shots_dir: Path, shot_id: str) -> Path:
    """Caminho do sidecar ``<shot_id>.shot_ir.json`` dentro de ``shots_dir``."""
    return Path(shots_dir) / f"{shot_id}.shot_ir.json"


def save_shot_ir_atomic(shot: ShotIR, path: Path) -> Path:
    """Valida e grava o Shot IR de forma atômica em ``path``.

    Levanta :class:`ShotIRValidationError` se o IR for inválido; nunca
    deixa um sidecar parcial para trás.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    shot.validate()
    payload = shotir_to_dict(shot)
    fd, tmp = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent)
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    except Exception:
        if Path(tmp).exists():
            Path(tmp).unlink()
        raise
    return path


def load_shot_ir(path: Path) -> ShotIR:
    """Lê um sidecar Shot IR.

    ``schema_version`` desconhecida gera ``warnings.warn`` e a leitura
    segue como legado (sem crash), conforme a spec seção 5.
    """
    path = Path(path)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ShotIRValidationError(
            f"sidecar Shot IR corrompido: {path}: {exc}"
        ) from exc
    if not isinstance(payload, dict):
        raise ShotIRValidationError(f"sidecar Shot IR inválido: {path}")
    version = payload.get("schema_version")
    if version not in SHOT_IR_SUPPORTED_VERSIONS:
        warnings.warn(
            f"Shot IR schema_version={version!r} desconhecida em {path.name}; "
            "lendo como legado",
            stacklevel=2,
        )
    return dict_to_shotir(payload)


def list_shot_ir_ids(shots_dir: Path) -> list[str]:
    """Lista os ``shot_id`` presentes em ``shots_dir``, em ordem estável."""
    shots_dir = Path(shots_dir)
    if not shots_dir.is_dir():
        return []
    return sorted(p.name[: -len(".shot_ir.json")] for p in shots_dir.glob("*.shot_ir.json"))


class ShotIRStore:
    """Sidecars Shot IR de uma produção, ancorados em ``shots_dir``.

    Parameters
    ----------
    shots_dir:
        Diretório ``<project_dir>/director/<production_id>/shots``.
    """

    def __init__(self, shots_dir: Path | str) -> None:
        self.shots_dir = Path(shots_dir)

    # ------------------------------------------------------------ paths
    def path_for(self, shot_id: str) -> Path:
        """Sidecar do plano ``shot_id``."""
        return shot_ir_sidecar_path(self.shots_dir, shot_id)

    def exists(self, shot_id: str) -> bool:
        """True quando o plano já tem sidecar persistido."""
        return self.path_for(shot_id).is_file()

    # -------------------------------------------------------------- io
    def save(self, shot: ShotIR) -> Path:
        """Persiste (atomicamente) o Shot IR; retorna o caminho gravado."""
        return save_shot_ir_atomic(shot, self.path_for(shot.shot_id))

    def load(self, shot_id: str) -> ShotIR:
        """Carrega o Shot IR do plano; ``FileNotFoundError`` se ausente."""
        path = self.path_for(shot_id)
        if not path.is_file():
            raise FileNotFoundError(f"Shot IR não encontrado: {shot_id}")
        return load_shot_ir(path)

    def load_optional(self, shot_id: str) -> Optional[ShotIR]:
        """Carrega o Shot IR ou ``None`` quando o sidecar não existe."""
        try:
            return self.load(shot_id)
        except FileNotFoundError:
            return None

    def delete(self, shot_id: str) -> bool:
        """Remove o sidecar do plano; True se algo foi apagado."""
        path = self.path_for(shot_id)
        if path.is_file():
            path.unlink()
            return True
        return False

    def list_shots(self) -> list[ShotIR]:
        """Carrega todos os Shot IR da produção (ordem por ``shot_id``)."""
        shots: list[ShotIR] = []
        for shot_id in list_shot_ir_ids(self.shots_dir):
            try:
                shots.append(self.load(shot_id))
            except ShotIRValidationError:
                # Sidecar corrompido não derruba a leitura da produção.
                continue
        return shots


def shots_dir_for(project_dir: Path | str, production_id: str) -> Path:
    """``<project_dir>/director/<production_id>/shots`` (spec seção 3.2)."""
    return Path(project_dir) / "director" / production_id / "shots"


__all__ = [
    "ShotIRStore",
    "shot_ir_sidecar_path",
    "shots_dir_for",
    "save_shot_ir_atomic",
    "load_shot_ir",
    "list_shot_ir_ids",
]
