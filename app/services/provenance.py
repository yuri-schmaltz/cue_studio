"""ProvenanceManifest — rastreabilidade integral por Take (A27).

Manifesto versionado (``schema_version = "1.0"``) gravado ao lado de cada
artefato como ``<output>.provenance.json``, registrando modelo/LoRAs/refs
com SHA-256 real, parâmetros, seed, perfil de hardware e runtime.
Convive com o sidecar ``<output>.meta.json`` existente (spec 32 seção 2.2);
nunca o substitui.

Portado do protótipo autoritativo
``_reversa_forward/plano-2026-10-04/prototypes/a27_provenance.py``.

Principais APIs:
  - :func:`compute_sha256` — hash real dos bytes de um arquivo.
  - :func:`emit_provenance` — gera e grava o manifesto de um Take novo.
  - :func:`retrofill_manifest` — manifesto retroativo para Take legado.
  - :func:`validate_manifest` — compara manifesto contra o disco e
    classifica em ``verified`` / ``needs_review`` / ``incomplete`` /
    ``corrupt``.
  - :func:`export_bundle` / :func:`import_bundle` — bundle ``.tar.gz``
    portátil com manifesto + sidecars + artefatos.
  - :func:`find_takes_using` — query reversa para o Storage Manager.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import platform
import sys
import tarfile
import tempfile
import warnings
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Iterable, Mapping, Optional, Sequence


PROVENANCE_SCHEMA_VERSION = "1.0"
PROVENANCE_SUPPORTED_VERSIONS = (PROVENANCE_SCHEMA_VERSION,)
PROVENANCE_SUFFIX = ".provenance.json"

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


class ProvenanceValidationError(ValueError):
    """Erro de validação do manifesto de proveniência."""


class ValidationStatus(str, Enum):
    """Status de um Take ao abrir (spec 32 seção 2.1)."""

    VERIFIED = "verified"
    NEEDS_REVIEW = "needs_review"
    INCOMPLETE = "incomplete"
    CORRUPT = "corrupt"


class ValidationPolicy(str, Enum):
    """Política de validação configurável por produção."""

    STRICT = "strict"
    WARN = "warn"
    OFF = "off"


def _ensure(value: Any, allowed: tuple, name: str) -> None:
    if value not in allowed:
        raise ProvenanceValidationError(
            f"{name}={value!r} não está em {allowed}"
        )


def _ensure_sha256(value: str, name: str) -> None:
    if not (len(value) == 64 and all(c in "0123456789abcdef" for c in value)):
        raise ProvenanceValidationError(
            f"{name}={value!r} não é SHA-256 hex de 64 chars"
        )


_SHA256_ZERO = "0" * 64


def compute_sha256(path: str | os.PathLike[str]) -> str:
    """Calcula SHA-256 real sobre os bytes do arquivo (em blocos)."""
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 16), b""):
            digest.update(chunk)
    return digest.hexdigest()


# ------------------------------------------------------------------
# Schema
# ------------------------------------------------------------------

@dataclass
class AssetRef:
    """Referência a qualquer arquivo envolvido no Take."""

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
    """LoRA aplicado ao Take, com hash do peso."""

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
    """Modelo (checkpoint) usado no Take."""

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
    """Perfil de hardware onde o Take foi gerado."""

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
    """Runtime Python/PyTorch/CUDA e revisão do Cue Studio."""

    python: str
    pytorch: str
    cue_studio_revision: str
    cuda: Optional[str] = None
    attention_backend: Optional[str] = None
    mmgp_version: Optional[str] = None


@dataclass
class ProvenanceManifest:
    """Manifesto de proveniência completo de um Take (schema 1.0)."""

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
    schema_version: str = PROVENANCE_SCHEMA_VERSION

    SUPPORTED_VERSIONS = PROVENANCE_SUPPORTED_VERSIONS

    def validate(self) -> None:
        if self.schema_version not in self.SUPPORTED_VERSIONS:
            raise ProvenanceValidationError(
                f"schema_version={self.schema_version} não suportada"
            )
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


# ------------------------------------------------------------------
# Serialização round-trip
# ------------------------------------------------------------------

def manifest_to_dict(manifest: ProvenanceManifest) -> dict:
    """Converte o manifesto em dict JSON-serializável."""

    def _to_dict(obj: Any) -> Any:
        if hasattr(obj, "__dataclass_fields__"):
            return {k: _to_dict(v) for k, v in asdict(obj).items()}
        if isinstance(obj, list):
            return [_to_dict(x) for x in obj]
        if isinstance(obj, dict):
            return {k: _to_dict(v) for k, v in obj.items()}
        return obj

    return _to_dict(manifest)


def _filter_known(cls: type, payload: Mapping[str, Any]) -> dict:
    """Mantém apenas campos conhecidos do dataclass (leitura legado)."""
    known = {f for f in cls.__dataclass_fields__}  # noqa: SIM118
    return {k: v for k, v in payload.items() if k in known}


def manifest_from_dict(payload: Mapping[str, Any]) -> ProvenanceManifest:
    """Reconstrói o manifesto a partir de dict (tolerante a legado).

    ``schema_version`` desconhecida emite warning e a leitura segue.
    """
    version = payload.get("schema_version")
    if version not in PROVENANCE_SUPPORTED_VERSIONS:
        warnings.warn(
            f"provenance schema_version={version!r} desconhecida; "
            "tentando ler como legado",
            stacklevel=2,
        )
    model = ModelRef(**_filter_known(ModelRef, payload.get("model") or {}))
    profile = HardwareProfile(
        **_filter_known(HardwareProfile, payload.get("profile") or {})
    )
    runtime = RuntimeRef(
        **_filter_known(RuntimeRef, payload.get("runtime") or {})
    )
    loras = [
        LoRARef(**_filter_known(LoRARef, item))
        for item in payload.get("loras") or []
    ]
    references = [
        AssetRef(**_filter_known(AssetRef, item))
        for item in payload.get("references") or []
    ]
    audio_inputs = [
        AssetRef(**_filter_known(AssetRef, item))
        for item in payload.get("audio_inputs") or []
    ]
    artifacts = [
        AssetRef(**_filter_known(AssetRef, item))
        for item in payload.get("artifacts") or []
    ]
    manifest = ProvenanceManifest(
        schema_version=str(payload.get("schema_version") or ""),
        take_id=str(payload.get("take_id") or ""),
        project_id=str(payload.get("project_id") or ""),
        generation_timestamp=str(payload.get("generation_timestamp") or ""),
        adapter_id=str(payload.get("adapter_id") or "unknown"),
        adapter_revision=str(payload.get("adapter_revision") or "unknown"),
        model=model,
        seed=int(payload.get("seed") or 0),
        profile=profile,
        runtime=runtime,
        artifacts=artifacts,
        sidecars=dict(payload.get("sidecars") or {}),
        loras=loras,
        references=references,
        audio_inputs=audio_inputs,
        parameters=dict(payload.get("parameters") or {}),
        redaction_policy=str(payload.get("redaction_policy") or "strip_personal"),
    )
    if manifest.schema_version in PROVENANCE_SUPPORTED_VERSIONS:
        manifest.validate()
    return manifest


def manifest_path_for(output_path: str | os.PathLike[str]) -> Path:
    """``<output>.provenance.json`` ao lado do artefato (spec 32 seção 2.1)."""
    return Path(os.path.splitext(str(output_path))[0]).with_suffix(PROVENANCE_SUFFIX)


def write_manifest_atomic(manifest: ProvenanceManifest, path: str | os.PathLike[str]) -> Path:
    """Valida e grava o manifesto de forma atômica (temp + rename)."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    manifest.validate()
    payload = manifest_to_dict(manifest)
    fd, tmp = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent)
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    except Exception:
        if Path(tmp).exists():
            Path(tmp).unlink()
        raise
    return path


def load_manifest(path: str | os.PathLike[str]) -> ProvenanceManifest:
    """Lê um manifesto do disco; JSON corrompido levanta erro de validação."""
    path = Path(path)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ProvenanceValidationError(
            f"manifesto de proveniência corrompido: {path}: {exc}"
        ) from exc
    if not isinstance(payload, dict):
        raise ProvenanceValidationError(f"manifesto inválido: {path}")
    return manifest_from_dict(payload)


# ------------------------------------------------------------------
# Validação contra o disco
# ------------------------------------------------------------------

def validate_manifest(
    manifest: ProvenanceManifest,
    project_dir: str | os.PathLike[str],
) -> tuple[ValidationStatus, list[str]]:
    """Compara o manifesto contra os arquivos em ``project_dir``.

    Precedência de status (protótipo): ausente → ``incomplete``; apenas
    hash divergente → ``corrupt``; sem issues → ``verified``.
    """
    manifest.validate()
    project_dir = Path(project_dir)
    issues: list[str] = []

    def _check(asset: AssetRef, kind: str) -> None:
        target = project_dir / asset.relative_path
        if not target.exists():
            issues.append(
                f"{kind} ausente: {asset.asset_id} ({asset.relative_path})"
            )
            return
        actual = compute_sha256(target)
        if actual != asset.sha256:
            issues.append(
                f"{kind} adulterado: {asset.asset_id} "
                f"(esperado {asset.sha256[:12]}…, atual {actual[:12]}…)"
            )

    for asset in manifest.artifacts:
        _check(asset, "artefato")
    for asset in manifest.references:
        _check(asset, "referência")
    for asset in manifest.audio_inputs:
        _check(asset, "áudio")

    for sidecar_rel, expected_sha in manifest.sidecars.items():
        target = project_dir / sidecar_rel
        if not target.exists():
            issues.append(f"sidecar ausente: {sidecar_rel}")
            continue
        actual = compute_sha256(target)
        if actual != expected_sha:
            issues.append(
                f"sidecar adulterado: {sidecar_rel} "
                f"(esperado {expected_sha[:12]}…, atual {actual[:12]}…)"
            )

    if any("ausente" in issue for issue in issues):
        return ValidationStatus.INCOMPLETE, issues
    if any("adulterado" in issue for issue in issues):
        return ValidationStatus.CORRUPT, issues
    if not issues:
        return ValidationStatus.VERIFIED, []
    return ValidationStatus.NEEDS_REVIEW, issues


# ------------------------------------------------------------------
# Emissão e retrofill
# ------------------------------------------------------------------

def _rel(path: str | os.PathLike[str], root: Path) -> str:
    """Caminho relativo ao ``root`` quando possível; senão absoluto."""
    try:
        return os.path.relpath(str(path), str(root))
    except ValueError:  # Windows: drives diferentes
        return str(path)


def asset_ref_from_path(
    path: str | os.PathLike[str],
    *,
    asset_id: str,
    role: str,
    project_dir: str | os.PathLike[str],
    source_url: Optional[str] = None,
    license_id: Optional[str] = None,
) -> AssetRef:
    """Cria um :class:`AssetRef` com SHA-256 real calculado do arquivo."""
    path = Path(path)
    return AssetRef(
        asset_id=asset_id,
        role=role,
        sha256=compute_sha256(path),
        size_bytes=path.stat().st_size,
        relative_path=_rel(path, Path(project_dir)),
        source_url=source_url,
        license_id=license_id,
    )


def default_hardware_profile() -> HardwareProfile:
    """Melhor esforço do perfil da máquina atual (CUDA opcional)."""
    gpu_name, vram, cuda = "unknown", 0, None
    try:
        import torch

        if torch.cuda.is_available():
            properties = torch.cuda.get_device_properties(0)
            gpu_name = properties.name
            vram = int(properties.total_memory // (1024 * 1024))
            cuda = getattr(torch.version, "cuda", None)
    except Exception:
        pass
    system_ram = 0
    try:
        system_ram = int(
            os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")
            // (1024 * 1024)
        )
    except (ValueError, OSError, AttributeError):
        pass
    system = platform.system().lower()
    os_name = (
        "linux" if system == "linux"
        else "windows" if system == "windows"
        else "macos" if system == "darwin"
        else "other"
    )
    return HardwareProfile(
        gpu_name=gpu_name,
        gpu_vram_mb=vram,
        system_ram_mb=system_ram,
        os=os_name,
        cuda_version=cuda,
    )


def default_runtime_ref() -> RuntimeRef:
    """Runtime atual (Python real; PyTorch quando importável)."""
    python = ".".join(str(part) for part in sys.version_info[:3])
    pytorch, cuda = "unknown", None
    try:
        import torch

        pytorch = getattr(torch, "__version__", "unknown")
        cuda = getattr(torch.version, "cuda", None)
    except Exception:
        pass
    return RuntimeRef(
        python=python,
        pytorch=pytorch,
        cuda=cuda,
        cue_studio_revision=os.environ.get("CUE_STUDIO_REVISION") or "unknown",
    )


def emit_provenance(
    *,
    take_id: str,
    output_path: str | os.PathLike[str],
    project_id: str = "unknown",
    adapter_id: str = "unknown",
    adapter_revision: str = "unknown",
    project_dir: str | os.PathLike[str] | None = None,
    model: Optional[ModelRef] = None,
    model_path: str | os.PathLike[str] | None = None,
    loras: Sequence[LoRARef] = (),
    references: Sequence[AssetRef] = (),
    audio_inputs: Sequence[AssetRef] = (),
    parameters: Optional[Mapping[str, Any]] = None,
    seed: int = 0,
    profile: Optional[HardwareProfile] = None,
    runtime: Optional[RuntimeRef] = None,
    sidecar_paths: Iterable[str | os.PathLike[str]] = (),
    redaction_policy: str = "strip_personal",
    write: bool = True,
) -> ProvenanceManifest:
    """Gera (e grava) o ``<output>.provenance.json`` de um Take bem-sucedido.

    Calcula SHA-256 real do artefato de saída, dos sidecars informados e —
    quando ``model_path`` é fornecido — dos pesos do modelo. Os hashes de
    LoRAs/referências devem vir prontos nos objetos recebidos (o hash de
    pesos de 10–20 GB é feito em background no download, spec 32 §7).
    """
    output_path = Path(output_path)
    root = Path(project_dir) if project_dir else output_path.parent

    if model is None:
        if model_path is not None and Path(model_path).is_file():
            model = ModelRef(
                model_id=Path(model_path).stem,
                sha256=compute_sha256(model_path),
                quantization="fp16",
                precision="full",
            )
        else:
            model = ModelRef(
                model_id="unknown",
                sha256=_SHA256_ZERO,
                quantization="fp16",
                precision="full",
            )

    artifacts: list[AssetRef] = []
    if output_path.is_file():
        artifacts.append(
            asset_ref_from_path(
                output_path,
                asset_id=f"output_{take_id}",
                role="output",
                project_dir=root,
            )
        )

    sidecars: dict[str, str] = {}
    for sidecar in sidecar_paths:
        sidecar = Path(sidecar)
        if sidecar.is_file():
            sidecars[_rel(sidecar, root)] = compute_sha256(sidecar)

    manifest = ProvenanceManifest(
        take_id=take_id,
        project_id=project_id,
        generation_timestamp=datetime.now(timezone.utc).isoformat(),
        adapter_id=adapter_id,
        adapter_revision=adapter_revision,
        model=model,
        seed=int(seed),
        profile=profile or default_hardware_profile(),
        runtime=runtime or default_runtime_ref(),
        artifacts=artifacts,
        sidecars=sidecars,
        loras=list(loras),
        references=list(references),
        audio_inputs=list(audio_inputs),
        parameters=dict(parameters or {}),
        redaction_policy=redaction_policy,
    )
    if write:
        write_manifest_atomic(manifest, manifest_path_for(output_path))
    return manifest


def retrofill_manifest(
    output_path: str | os.PathLike[str],
    *,
    project_dir: str | os.PathLike[str] | None = None,
    take_id: Optional[str] = None,
    project_id: str = "legacy",
) -> ProvenanceManifest:
    """Manifesto retroativo para Take antigo que só tem ``<output>.meta.json``.

    Preenche os campos com defaults ``legacy_*``; os hashes dos artefatos e
    do sidecar são reais (spec 32 seção 2.1, backward compatibility).
    """
    output_path = Path(output_path)
    root = Path(project_dir) if project_dir else output_path.parent
    take_id = take_id or output_path.stem

    sidecar_path = output_path.with_suffix(".meta.json")
    adapter_id = "legacy_unknown"
    seed = 0
    parameters: dict[str, Any] = {}
    if sidecar_path.is_file():
        try:
            sidecar = json.loads(sidecar_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            sidecar = {}
        params = sidecar.get("params") if isinstance(sidecar, Mapping) else None
        params = params if isinstance(params, Mapping) else {}
        adapter_id = str(params.get("model_type") or sidecar.get("tool") or "legacy_unknown")
        seed = int(params.get("seed") or 0)
        parameters = dict(params)

    sidecar_map: dict[str, str] = {}
    if sidecar_path.is_file():
        sidecar_map[_rel(sidecar_path, root)] = compute_sha256(sidecar_path)

    manifest = ProvenanceManifest(
        take_id=take_id,
        project_id=project_id,
        generation_timestamp=datetime.now(timezone.utc).isoformat(),
        adapter_id=str(adapter_id),
        adapter_revision="pre_manifest",
        model=ModelRef(
            model_id="legacy",
            sha256=_SHA256_ZERO,
            quantization="fp16",
            precision="full",
        ),
        seed=seed,
        profile=HardwareProfile(
            gpu_name="unknown",
            gpu_vram_mb=0,
            system_ram_mb=0,
            os="linux",
        ),
        runtime=RuntimeRef(
            python="unknown",
            pytorch="unknown",
            cue_studio_revision="pre_manifest",
        ),
        artifacts=(
            [
                asset_ref_from_path(
                    output_path,
                    asset_id=f"asset_{take_id}",
                    role="output",
                    project_dir=root,
                )
            ]
            if output_path.is_file()
            else []
        ),
        sidecars=sidecar_map,
        parameters=parameters,
        redaction_policy="strip_personal",
    )
    write_manifest_atomic(manifest, manifest_path_for(output_path))
    return manifest


# ------------------------------------------------------------------
# Bundle export/import
# ------------------------------------------------------------------

def export_bundle(
    manifest: ProvenanceManifest,
    project_dir: str | os.PathLike[str],
    out_path: str | os.PathLike[str],
    *,
    include_refs: bool = False,
) -> Path:
    """Empacota manifesto + artefatos + sidecars em ``.tar.gz``.

    Com ``include_refs=True`` inclui também referências visuais e entradas
    de áudio no bundle (spec 32 seção 3.3, query ``include_refs``).
    """
    manifest.validate()
    project_dir = Path(project_dir)
    out_path = Path(out_path)
    with tarfile.open(out_path, "w:gz") as tar:
        buffer = json.dumps(
            manifest_to_dict(manifest), ensure_ascii=False, indent=2
        ).encode("utf-8")
        info = tarfile.TarInfo(name=f"{manifest.take_id}.provenance.json")
        info.size = len(buffer)
        tar.addfile(info, io.BytesIO(buffer))
        bundled: list[AssetRef] = list(manifest.artifacts)
        if include_refs:
            bundled.extend(manifest.references)
            bundled.extend(manifest.audio_inputs)
        for asset in bundled:
            source = project_dir / asset.relative_path
            if source.exists():
                tar.add(source, arcname=f"{manifest.take_id}_payload/{source.name}")
        for sidecar_rel in manifest.sidecars:
            source = project_dir / sidecar_rel
            if source.exists():
                tar.add(source, arcname=f"{manifest.take_id}_payload/{source.name}")
    return out_path


def import_bundle(
    bundle_path: str | os.PathLike[str],
    project_dir: str | os.PathLike[str],
) -> tuple[ProvenanceManifest, ValidationStatus, list[str]]:
    """Importa bundle, revalida hashes e retorna ``(manifesto, status, issues)``."""
    bundle_path = Path(bundle_path)
    project_dir = Path(project_dir)
    bundle_name = bundle_path.name
    for suffix in (".tar.gz", ".tgz", ".tar"):
        if bundle_name.endswith(suffix):
            bundle_name = bundle_name[: -len(suffix)]
            break
    payload_dir = project_dir / "_imports" / bundle_name
    payload_dir.mkdir(parents=True, exist_ok=True)
    with tarfile.open(bundle_path, "r:gz") as tar:
        # "data" é o filtro permissivo compatível com 3.11+; o default
        # mudou em 3.14 e exige filter explícito.
        tar.extractall(payload_dir, filter="data")
    manifest_path = next(payload_dir.glob(f"*{PROVENANCE_SUFFIX}"), None)
    if manifest_path is None:
        raise ProvenanceValidationError(
            "manifesto de proveniência não encontrado no bundle"
        )
    manifest = manifest_from_dict(
        json.loads(manifest_path.read_text(encoding="utf-8"))
    )
    # O bundle arquiva payloads em "{take_id}_payload/<nome>"; reapontamos
    # relative_path para os arquivos extraídos antes de revalidar.
    extracted_prefix = f"_imports/{bundle_name}/{manifest.take_id}_payload"
    manifest.artifacts = [
        AssetRef(
            asset_id=asset.asset_id,
            role=asset.role,
            sha256=asset.sha256,
            size_bytes=asset.size_bytes,
            relative_path=f"{extracted_prefix}/{Path(asset.relative_path).name}",
            source_url=asset.source_url,
            license_id=asset.license_id,
        )
        for asset in manifest.artifacts
    ]
    manifest.sidecars = {
        f"{extracted_prefix}/{Path(rel).name}": sha
        for rel, sha in manifest.sidecars.items()
    }
    status, issues = validate_manifest(manifest, project_dir)
    return manifest, status, issues


# ------------------------------------------------------------------
# Query reversa (Storage Manager)
# ------------------------------------------------------------------

def find_takes_using(
    asset_sha256: str,
    search_root: str | os.PathLike[str],
) -> list[ProvenanceManifest]:
    """Takes cujo manifesto referencia o SHA-256 informado (modelo/LoRA).

    Usado pelo Storage Manager antes de deletar pesos (spec 32 seção 3.4).
    Manifestos ilegíveis são ignorados (nunca derrubam a varredura).
    """
    search_root = Path(search_root)
    found: list[ProvenanceManifest] = []
    for manifest_path in sorted(search_root.rglob(f"*{PROVENANCE_SUFFIX}")):
        try:
            manifest = load_manifest(manifest_path)
        except (ProvenanceValidationError, OSError):
            continue
        if manifest.model.sha256 == asset_sha256:
            found.append(manifest)
            continue
        if any(lora.sha256 == asset_sha256 for lora in manifest.loras):
            found.append(manifest)
    return found


__all__ = [
    "PROVENANCE_SCHEMA_VERSION",
    "ProvenanceValidationError",
    "ValidationStatus",
    "ValidationPolicy",
    "AssetRef",
    "LoRARef",
    "ModelRef",
    "HardwareProfile",
    "RuntimeRef",
    "ProvenanceManifest",
    "compute_sha256",
    "manifest_to_dict",
    "manifest_from_dict",
    "manifest_path_for",
    "write_manifest_atomic",
    "load_manifest",
    "validate_manifest",
    "asset_ref_from_path",
    "default_hardware_profile",
    "default_runtime_ref",
    "emit_provenance",
    "retrofill_manifest",
    "export_bundle",
    "import_bundle",
    "find_takes_using",
]
