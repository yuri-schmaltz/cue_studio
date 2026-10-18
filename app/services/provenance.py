"""ProvenanceManifest por Take (A27).

Manifesto de proveniência verificável: SHA-256 de artefatos, modelos,
LoRAs, referências, runtime, hardware. Validação contra disco, bundle
export/import, retrofill.

Fonte: protótipo ``_reversa_forward/plano-2026-10-04/prototypes/a27_provenance.py``.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import tarfile
import tempfile
import warnings
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

PROVENANCE_SCHEMA_VERSION = "1.0"

VALID_ROLES = (
    "checkpoint", "lora", "vae", "text_encoder",
    "first_frame", "last_frame", "reference_image",
    "reference_audio", "soundtrack", "sidecar_meta", "output",
)
VALID_QUANTIZATIONS = (
    "fp8", "fp16", "bf16", "int8", "int4",
    "gguf_q4", "gguf_q2", "nvfp4_awq", "quanto_int8",
)
VALID_PRECISIONS = ("full", "pruned", "distilled")
VALID_OS = ("windows", "linux", "macos", "other")
VALID_REDACTION = ("none", "strip_personal", "hash_paths")
VALID_STATUS = ("verified", "needs_review", "incomplete", "corrupt")


class ProvenanceValidationError(ValueError):
    pass


def _ensure(value, allowed, name):
    if value not in allowed:
        raise ProvenanceValidationError(f"{name}={value!r} não está em {allowed}")


def _ensure_sha256(value, name):
    if not (len(value) == 64 and all(c in "0123456789abcdef" for c in value)):
        raise ProvenanceValidationError(f"{name}={value!r} não é SHA-256 hex de 64 chars")


def compute_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


@dataclass
class AssetRef:
    asset_id: str
    role: str
    sha256: str
    size_bytes: int
    relative_path: str
    source_url: Optional[str] = None
    license_id: Optional[str] = None

    def validate(self) -> None:
        if not self.asset_id:
            raise ProvenanceValidationError("asset.asset_id vazio")
        _ensure(self.role, VALID_ROLES, "asset.role")
        _ensure_sha256(self.sha256, f"asset({self.asset_id}).sha256")
        if self.size_bytes < 0:
            raise ProvenanceValidationError("asset.size_bytes negativo")


@dataclass
class LoRARef:
    lora_id: str
    sha256: str
    strength: float
    trigger_phrase: Optional[str] = None

    def validate(self) -> None:
        if not (0 <= self.strength <= 2.0):
            raise ProvenanceValidationError("lora.strength fora de [0, 2]")
        _ensure_sha256(self.sha256, f"lora({self.lora_id}).sha256")


@dataclass
class ModelRef:
    model_id: str
    sha256: str
    quantization: str
    precision: str

    def validate(self) -> None:
        _ensure(self.quantization, VALID_QUANTIZATIONS, "model.quantization")
        _ensure(self.precision, VALID_PRECISIONS, "model.precision")
        _ensure_sha256(self.sha256, "model.sha256")


@dataclass
class HardwareProfile:
    gpu_name: str
    gpu_vram_mb: int
    system_ram_mb: int
    os: str
    driver_version: Optional[str] = None
    cuda_version: Optional[str] = None

    def validate(self) -> None:
        _ensure(self.os, VALID_OS, "profile.os")
        if self.gpu_vram_mb < 0 or self.system_ram_mb < 0:
            raise ProvenanceValidationError("VRAM/RAM negativos")


@dataclass
class RuntimeRef:
    python: str
    pytorch: str
    cue_studio_revision: str
    cuda: Optional[str] = None
    attention_backend: Optional[str] = None
    mmgp_version: Optional[str] = None


@dataclass
class ProvenanceManifest:
    schema_version: str
    take_id: str
    project_id: str
    generation_timestamp: str
    adapter_id: str
    adapter_revision: str
    model: ModelRef
    seed: int
    profile: HardwareProfile
    runtime: RuntimeRef
    artifacts: list[AssetRef]
    sidecars: dict[str, str]
    loras: list[LoRARef] = field(default_factory=list)
    references: list[AssetRef] = field(default_factory=list)
    audio_inputs: list[AssetRef] = field(default_factory=list)
    parameters: dict = field(default_factory=dict)
    redaction_policy: str = "strip_personal"

    SUPPORTED_VERSIONS = ("1.0",)

    def validate(self) -> None:
        if self.schema_version not in self.SUPPORTED_VERSIONS:
            raise ProvenanceValidationError(f"schema_version={self.schema_version} não suportada")
        if not self.take_id or not self.project_id:
            raise ProvenanceValidationError("take_id/project_id vazios")
        self.model.validate()
        self.profile.validate()
        for lora in self.loras:
            lora.validate()
        for asset in self.artifacts + self.references + self.audio_inputs:
            asset.validate()
        for path, sha in self.sidecars.items():
            _ensure_sha256(sha, f"sidecar({path})")
        _ensure(self.redaction_policy, VALID_REDACTION, "redaction_policy")


# ---------------------------------------------------------------------------
# Serialização
# ---------------------------------------------------------------------------

def manifest_to_dict(m: ProvenanceManifest) -> dict:
    def _to_dict(obj: Any) -> Any:
        if hasattr(obj, "__dataclass_fields__"):
            return {k: _to_dict(v) for k, v in asdict(obj).items()}
        if isinstance(obj, list):
            return [_to_dict(x) for x in obj]
        if isinstance(obj, dict):
            return {k: _to_dict(v) for k, v in obj.items()}
        return obj
    return _to_dict(m)


def manifest_from_dict(payload: dict) -> ProvenanceManifest:
    def _make(cls, d):
        if not isinstance(d, dict):
            return d
        kwargs = {}
        for k, v in d.items():
            if hasattr(cls, "__dataclass_fields__") and k in cls.__dataclass_fields__:
                fld = cls.__dataclass_fields__[k]
                if isinstance(v, list) and fld.type.startswith("list["):
                    inner_name = fld.type[5:-1]
                    inner_cls = globals().get(inner_name)
                    if inner_cls and hasattr(inner_cls, "__dataclass_fields__"):
                        kwargs[k] = [_make(inner_cls, x) for x in v]
                    else:
                        kwargs[k] = v
                else:
                    inner_cls = globals().get(fld.type)
                    if inner_cls and hasattr(inner_cls, "__dataclass_fields__"):
                        kwargs[k] = _make(inner_cls, v)
                    else:
                        kwargs[k] = v
        return cls(**kwargs)

    sv = payload["schema_version"]
    if sv not in ProvenanceManifest.SUPPORTED_VERSIONS:
        import warnings
        warnings.warn(f"schema_version={sv!r} desconhecida; tentando ler como legado", stacklevel=2)
    m = _make(ProvenanceManifest, payload)
    return m


def write_manifest_atomic(m: ProvenanceManifest, path: Path) -> None:
    m.validate()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = manifest_to_dict(m)
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent))
    try:
        with open(fd, "w", encoding="utf-8") as fh:
            import json
            json.dump(payload, fh, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    except Exception:
        if Path(tmp).exists():
            Path(tmp).unlink()
        raise


def validate_against_disk(m: ProvenanceManifest, project_dir: Path) -> tuple[str, list[str]]:
    m.validate()
    issues: list[str] = []

    def _check(asset: AssetRef, kind: str) -> None:
        target = project_dir / asset.relative_path
        if not target.exists():
            issues.append(f"{kind} ausente: {asset.asset_id} ({asset.relative_path})")
            return
        actual_sha = compute_sha256(target)
        if actual_sha != asset.sha256:
            issues.append(f"{kind} adulterado: {asset.asset_id} (esperado {asset.sha256[:12]}…, atual {actual_sha[:12]}…)")

    for asset in m.artifacts:
        _check(asset, "artefato")
    for asset in m.references:
        _check(asset, "referência")
    for asset in m.audio_inputs:
        _check(asset, "áudio")

    for sidecar_path, expected_sha in m.sidecars.items():
        target = project_dir / sidecar_path
        if not target.exists():
            issues.append(f"sidecar ausente: {sidecar_path}")
            continue
        actual_sha = compute_sha256(target)
        if actual_sha != expected_sha:
            issues.append(f"sidecar adulterado: {sidecar_path} (esperado {expected_sha[:12]}…, atual {actual_sha[:12]}…)")

    if any("ausente" in i for i in issues):
        return "incomplete", issues
    if any("adulterado" in i for i in issues):
        return "corrupt", issues
    if not issues:
        return "verified", []
    return "needs_review", issues
