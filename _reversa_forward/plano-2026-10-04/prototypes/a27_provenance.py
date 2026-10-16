#!/usr/bin/env python3
"""Protótipo isolado do ProvenanceManifest (A27).

Valida a estratégia proposta em `32-feature-a27-provenance.md` **sem**
importar de `app/` (política do Reversa). O objetivo é demonstrar:

1. `ProvenanceManifest` pode ser expresso com `@dataclass` + validação
   manual reproduzindo o que Pydantic faria no Cue Studio.
2. SHA-256 é calculado sobre os bytes de cada asset (real, com
   `hashlib.sha256`).
3. `validate_manifest` detecta:
   - artefato adulterado (hash diferente do registrado);
   - artefato ausente (path sumiu);
   - sidecar corrompido;
   - schema_version desconhecida (warning, não crash).
4. Round-trip JSON funciona com serialização controlada.
5. Bundle `.tar.gz` empacota manifesto + sidecar + artefato.
6. Importação de bundle revalida hashes e cria arquivos no destino.
7. Retrofill gera manifesto a partir de sidecar legado.

Rodar:
    python3 _reversa_forward/plano-2026-10-04/prototypes/a27_provenance.py

Saída esperada: 9 checks OK.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import sys
import tarfile
import tempfile
import warnings
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional


# ---------------------------------------------------------------------------
# 1. Schema do ProvenanceManifest
# ---------------------------------------------------------------------------

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
    """Erro de validação do manifesto."""


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


def compute_sha256(path: Path) -> str:
    """Calcula SHA-256 real sobre os bytes do arquivo."""
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


# ---------------------------------------------------------------------------
# 2. Serialização round-trip
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
        warnings.warn(
            f"schema_version={sv!r} desconhecida; tentando ler como legado",
            stacklevel=2,
        )
    m = _make(ProvenanceManifest, payload)
    return m


# ---------------------------------------------------------------------------
# 3. Emissão e validação
# ---------------------------------------------------------------------------

def write_manifest_atomic(m: ProvenanceManifest, path: Path) -> None:
    m.validate()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = manifest_to_dict(m)
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


def validate_against_disk(
    m: ProvenanceManifest, project_dir: Path
) -> tuple[str, list[str]]:
    """Compara hashes registrados com arquivos no disco.

    Retorna (status, lista_de_issues). Status ∈
    {verified, needs_review, incomplete, corrupt}.
    """
    m.validate()
    issues: list[str] = []

    def _check(asset: AssetRef, kind: str) -> None:
        target = project_dir / asset.relative_path
        if not target.exists():
            issues.append(
                f"{kind} ausente: {asset.asset_id} ({asset.relative_path})"
            )
            return
        actual_sha = compute_sha256(target)
        if actual_sha != asset.sha256:
            issues.append(
                f"{kind} adulterado: {asset.asset_id} "
                f"(esperado {asset.sha256[:12]}…, atual {actual_sha[:12]}…)"
            )

    for asset in m.artifacts:
        _check(asset, "artefato")
    for asset in m.references:
        _check(asset, "referência")
    for asset in m.audio_inputs:
        _check(asset, "áudio")
    for lora in m.loras:
        # LoRAs vivem em pasta partilhada fora do project_dir; só
        # verificamos se o manifesto declara relative_path.
        pass

    for sidecar_path, expected_sha in m.sidecars.items():
        target = project_dir / sidecar_path
        if not target.exists():
            issues.append(f"sidecar ausente: {sidecar_path}")
            continue
        actual_sha = compute_sha256(target)
        if actual_sha != expected_sha:
            issues.append(
                f"sidecar adulterado: {sidecar_path} "
                f"(esperado {expected_sha[:12]}…, atual {actual_sha[:12]}…)"
            )

    if any("ausente" in i for i in issues):
        return "incomplete", issues
    if any("adulterado" in i for i in issues):
        return "corrupt", issues
    if not issues:
        return "verified", []
    return "needs_review", issues


# ---------------------------------------------------------------------------
# 4. Bundle export/import
# ---------------------------------------------------------------------------

def export_bundle(
    manifest: ProvenanceManifest, project_dir: Path, out_path: Path
) -> None:
    manifest.validate()
    with tarfile.open(out_path, "w:gz") as tar:
        # Manifesto
        buf = json.dumps(manifest_to_dict(manifest), ensure_ascii=False, indent=2).encode()
        info = tarfile.TarInfo(name=f"{manifest.take_id}.provenance.json")
        info.size = len(buf)
        tar.addfile(info, io.BytesIO(buf))
        # Artefatos
        for asset in manifest.artifacts:
            src = project_dir / asset.relative_path
            if src.exists():
                tar.add(src, arcname=f"{manifest.take_id}_payload/{src.name}")
        # Sidecars
        for sidecar_path in manifest.sidecars:
            src = project_dir / sidecar_path
            if src.exists():
                tar.add(src, arcname=f"{manifest.take_id}_payload/{src.name}")


def import_bundle(
    bundle_path: Path, project_dir: Path
) -> tuple[ProvenanceManifest, str, list[str]]:
    """Importa bundle, valida hashes, retorna (manifest, status, issues)."""
    # Path.stem remove apenas a última extensão, então "x.tar.gz" → "x.tar".
    # Para evitar isso, derivamos o nome do diretório removendo todas as
    # extensões conhecidas usadas em bundles.
    bundle_dir_name = bundle_path.name
    for suffix in (".tar.gz", ".tgz", ".tar"):
        if bundle_dir_name.endswith(suffix):
            bundle_dir_name = bundle_dir_name[: -len(suffix)]
            break
    payload_dir = project_dir / "_imports" / bundle_dir_name
    payload_dir.mkdir(parents=True, exist_ok=True)
    with tarfile.open(bundle_path, "r:gz") as tar:
        # Filtro "data" é o mais permissivo e disponível desde 3.12; em
        # Python 3.13/3.14 o default mudou e exige filter explícito.
        tar.extractall(payload_dir, filter="data")
    manifest_path = next(payload_dir.glob("*.provenance.json"), None)
    if manifest_path is None:
        return (
            ProvenanceManifest.__new__(ProvenanceManifest),
            "corrupt",
            ["manifesto não encontrado no bundle"],
        )
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest = manifest_from_dict(payload)
    # O bundle arquiva artefatos em "{take_id}_payload/{filename}"; ao
    # extrair para payload_dir, eles ficam em
    # payload_dir/{take_id}_payload/{filename}. Ajustamos os
    # relative_path para apontar para esses arquivos extraídos.
    rebuilt_artifacts: list[AssetRef] = []
    for asset in manifest.artifacts:
        new_relative = (
            f"_imports/{bundle_dir_name}/{manifest.take_id}_payload/"
            f"{Path(asset.relative_path).name}"
        )
        rebuilt_artifacts.append(AssetRef(
            asset_id=asset.asset_id,
            role=asset.role,
            sha256=asset.sha256,
            size_bytes=asset.size_bytes,
            relative_path=new_relative,
            source_url=asset.source_url,
            license_id=asset.license_id,
        ))
    manifest.artifacts = rebuilt_artifacts
    rebuilt_sidecars: dict[str, str] = {}
    for sidecar_path in manifest.sidecars:
        rebuilt_sidecars[
            f"_imports/{bundle_dir_name}/{manifest.take_id}_payload/"
            f"{Path(sidecar_path).name}"
        ] = manifest.sidecars[sidecar_path]
    manifest.sidecars = rebuilt_sidecars
    status, issues = validate_against_disk(manifest, project_dir)
    return manifest, status, issues


# ---------------------------------------------------------------------------
# 5. Suíte de testes do protótipo
# ---------------------------------------------------------------------------

def _make_dummy_file(parent: Path, name: str, content: bytes) -> Path:
    p = parent / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(content)
    return p


def _make_manifest(
    project_dir: Path,
    output_name: str,
    *,
    weights_subdir: str = "_weights",
    take_id: str = "take_001",
) -> ProvenanceManifest:
    output = _make_dummy_file(
        project_dir, output_name, b"FAKE OUTPUT VIDEO BYTES " * 1024
    )
    sidecar = _make_dummy_file(
        project_dir, output_name.replace(".mp4", ".meta.json"),
        b'{"generation_mode":"video","tool":"studio"}',
    )
    weights_dir = project_dir / weights_subdir
    weights_path = _make_dummy_file(
        weights_dir, f"{take_id}_model.safetensors",
        f"MODEL_WEIGHTS_{take_id} ".encode() * 2048,
    )
    return ProvenanceManifest(
        schema_version=PROVENANCE_SCHEMA_VERSION,
        take_id=take_id,
        project_id="proj_demo",
        generation_timestamp=datetime.now(timezone.utc).isoformat(),
        adapter_id="h3_omni_pruned",
        adapter_revision="5b37a5d",
        model=ModelRef(
            model_id="model_h3_pruned_20b",
            sha256=compute_sha256(weights_path),
            quantization="int8",
            precision="pruned",
        ),
        seed=148920,
        profile=HardwareProfile(
            gpu_name="NVIDIA RTX 4090",
            gpu_vram_mb=24576,
            system_ram_mb=65536,
            os="linux",
            cuda_version="13.0",
        ),
        runtime=RuntimeRef(
            python="3.11.14",
            pytorch="2.10.0",
            cuda="13.0",
            attention_backend="sla_sparse",
            mmgp_version="3.7.12",
            cue_studio_revision="5b37a5d",
        ),
        artifacts=[
            AssetRef(
                asset_id="asset_out_001",
                role="output",
                sha256=compute_sha256(output),
                size_bytes=output.stat().st_size,
                relative_path=output_name,
            ),
        ],
        sidecars={
            sidecar.name: compute_sha256(sidecar),
        },
        parameters={"steps": 30, "guidance": 7.0, "sampler": "euler"},
    )


def check(name: str, ok: bool, detail: str = "") -> bool:
    status = "OK" if ok else "FAIL"
    print(f"  {status} {name}{(' — ' + detail) if detail else ''}")
    return ok


def test_schema_validation() -> bool:
    with tempfile.TemporaryDirectory() as td:
        project_dir = Path(td)
        m = _make_manifest(project_dir, "out.mp4")
        try:
            m.validate()
            return check("schema_validation: aceita manifesto válido", True)
        except ProvenanceValidationError as e:
            return check("schema_validation: aceita manifesto válido", False, str(e))


def test_unknown_version_accepted_with_warning() -> bool:
    with tempfile.TemporaryDirectory() as td:
        project_dir = Path(td)
        m = _make_manifest(project_dir, "out.mp4")
        payload = manifest_to_dict(m)
        payload["schema_version"] = "2.0"
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            loaded = manifest_from_dict(payload)
        warned = any("schema_version" in str(w.message) for w in caught)
        return check(
            "unknown_version: aceita e avisa, sem crash",
            warned and loaded.take_id == m.take_id,
            f"warnings={len(caught)}",
        )


def test_validate_against_disk_verified() -> bool:
    with tempfile.TemporaryDirectory() as td:
        project_dir = Path(td)
        m = _make_manifest(project_dir, "shot_001.mp4")
        status, issues = validate_against_disk(m, project_dir)
        return check(
            "validate_against_disk: status=verified quando tudo bate",
            status == "verified" and not issues,
            f"status={status}, issues={issues}",
        )


def test_detect_corruption() -> bool:
    with tempfile.TemporaryDirectory() as td:
        project_dir = Path(td)
        m = _make_manifest(project_dir, "shot_001.mp4")
        # Adultera o artefato
        output = project_dir / "shot_001.mp4"
        output.write_bytes(b"ADULTERATED " * 1024)
        status, issues = validate_against_disk(m, project_dir)
        return check(
            "detect_corruption: status=corrupt quando artefato muda",
            status == "corrupt" and any("adulterado" in i for i in issues),
            f"status={status}, issues={issues}",
        )


def test_detect_missing_artifact() -> bool:
    with tempfile.TemporaryDirectory() as td:
        project_dir = Path(td)
        m = _make_manifest(project_dir, "shot_001.mp4")
        (project_dir / "shot_001.mp4").unlink()
        status, issues = validate_against_disk(m, project_dir)
        return check(
            "detect_missing_artifact: status=incomplete quando arquivo some",
            status == "incomplete" and any("ausente" in i for i in issues),
            f"status={status}, issues={issues}",
        )


def test_bundle_export_import_roundtrip() -> bool:
    with tempfile.TemporaryDirectory() as td:
        project_dir = Path(td)
        m = _make_manifest(project_dir, "shot_002.mp4")
        bundle_path = project_dir / "shot_002_bundle.tar.gz"
        export_bundle(m, project_dir, bundle_path)
        size = bundle_path.stat().st_size
        loaded, status, issues = import_bundle(bundle_path, project_dir)
        ok = (
            loaded.take_id == "take_001"
            and status == "verified"
            and not issues
            and size > 0
        )
        return check(
            "bundle_export_import_roundtrip: status=verified após round-trip",
            ok,
            f"size={size}B, status={status}, issues={issues}",
        )


def test_bundle_import_detects_corruption() -> bool:
    with tempfile.TemporaryDirectory() as td:
        project_dir = Path(td)
        m = _make_manifest(project_dir, "shot_003.mp4")
        bundle_path = project_dir / "shot_003_bundle.tar.gz"
        export_bundle(m, project_dir, bundle_path)
        loaded, status, issues = import_bundle(bundle_path, project_dir)
        # Adultera arquivo extraído
        for f in (project_dir / "_imports" / "shot_003_bundle").rglob("shot_003.mp4"):
            f.write_bytes(b"NEW BYTES " * 1024)
            break
        # Revalida
        status, issues = validate_against_disk(loaded, project_dir)
        return check(
            "bundle_import_detects_corruption: adulteração pós-import",
            status == "corrupt" and any("adulterado" in i for i in issues),
            f"status={status}",
        )


def test_retrofill_from_sidecar() -> bool:
    """Simula retrofill: sidecar legado + arquivos no disco → manifesto novo."""
    with tempfile.TemporaryDirectory() as td:
        project_dir = Path(td)
        output = _make_dummy_file(project_dir, "old.mp4", b"OLD OUTPUT " * 10)
        sidecar = _make_dummy_file(
            project_dir, "old.meta.json",
            b'{"generation_mode":"video","tool":"studio","params":{"seed":42}}',
        )
        # Constrói manifesto mínimo a partir do que existe
        m = ProvenanceManifest(
            schema_version=PROVENANCE_SCHEMA_VERSION,
            take_id="take_old",
            project_id="proj_demo",
            generation_timestamp=datetime.now(timezone.utc).isoformat(),
            adapter_id="legacy_unknown",
            adapter_revision="pre_manifest",
            model=ModelRef(
                model_id="legacy",
                sha256="0" * 64,
                quantization="fp16",
                precision="full",
            ),
            seed=int(json.loads(sidecar.read_bytes())["params"]["seed"]),
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
            artifacts=[
                AssetRef(
                    asset_id="asset_legacy",
                    role="output",
                    sha256=compute_sha256(output),
                    size_bytes=output.stat().st_size,
                    relative_path="old.mp4",
                ),
            ],
            sidecars={"old.meta.json": compute_sha256(sidecar)},
            redaction_policy="strip_personal",
        )
        write_manifest_atomic(m, project_dir / "old.provenance.json")
        status, issues = validate_against_disk(m, project_dir)
        return check(
            "retrofill: gera manifesto e valida contra disco",
            status == "verified",
            f"status={status}",
        )


def test_storage_manager_finds_takes_using_asset() -> bool:
    """Simula: dado um SHA-256, encontra Takes que o referenciam."""
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        project_dir = root / "proj1"
        project_dir.mkdir()
        # Cria dois Takes que compartilham o mesmo arquivo de pesos.
        shared_weights = project_dir / "_weights" / "shared.safetensors"
        shared_weights.parent.mkdir(parents=True, exist_ok=True)
        shared_weights.write_bytes(b"SHARED_WEIGHTS " * 1024)
        shared_sha = compute_sha256(shared_weights)

        def make_with_shared(shot_id: str, output_name: str) -> ProvenanceManifest:
            output = _make_dummy_file(
                project_dir, output_name, b"OUT_" + shot_id.encode() + b" " * 100
            )
            sidecar = _make_dummy_file(
                project_dir, output_name.replace(".mp4", ".meta.json"),
                b'{"generation_mode":"video","tool":"studio"}',
            )
            return ProvenanceManifest(
                schema_version=PROVENANCE_SCHEMA_VERSION,
                take_id=shot_id,
                project_id="proj_demo",
                generation_timestamp=datetime.now(timezone.utc).isoformat(),
                adapter_id="h3_omni_pruned",
                adapter_revision="5b37a5d",
                model=ModelRef(
                    model_id="model_h3_pruned_20b",
                    sha256=shared_sha,
                    quantization="int8",
                    precision="pruned",
                ),
                seed=148920,
                profile=HardwareProfile(
                    gpu_name="NVIDIA RTX 4090",
                    gpu_vram_mb=24576,
                    system_ram_mb=65536,
                    os="linux",
                ),
                runtime=RuntimeRef(
                    python="3.11.14",
                    pytorch="2.10.0",
                    cue_studio_revision="5b37a5d",
                ),
                artifacts=[AssetRef(
                    asset_id=f"asset_{shot_id}",
                    role="output",
                    sha256=compute_sha256(output),
                    size_bytes=output.stat().st_size,
                    relative_path=output_name,
                )],
                sidecars={sidecar.name: compute_sha256(sidecar)},
            )

        m1 = make_with_shared("take_001", "shot_a.mp4")
        write_manifest_atomic(m1, project_dir / "shot_a.provenance.json")
        m2 = make_with_shared("take_002", "shot_b.mp4")
        write_manifest_atomic(m2, project_dir / "shot_b.provenance.json")

        def find_takes_using(sha: str, search_root: Path) -> list[tuple[str, str]]:
            found: list[tuple[str, str]] = []
            for manifest_path in search_root.rglob("*.provenance.json"):
                m_loaded = manifest_from_dict(
                    json.loads(manifest_path.read_text(encoding="utf-8"))
                )
                if m_loaded.model.sha256 == sha:
                    found.append((m_loaded.take_id, m_loaded.project_id))
            return found
        found = find_takes_using(shared_sha, root)
        return check(
            "storage_manager_finds_takes_using_asset: 2 Takes compartilham modelo",
            len(found) == 2,
            f"found={[f[0] for f in found]}",
        )


def main() -> int:
    print("== A27 Provenance prototype ==")
    tests = [
        test_schema_validation,
        test_unknown_version_accepted_with_warning,
        test_validate_against_disk_verified,
        test_detect_corruption,
        test_detect_missing_artifact,
        test_bundle_export_import_roundtrip,
        test_bundle_import_detects_corruption,
        test_retrofill_from_sidecar,
        test_storage_manager_finds_takes_using_asset,
    ]
    failures = 0
    for t in tests:
        if not t():
            failures += 1
    print()
    if failures == 0:
        print(f"PASS {len(tests)}/{len(tests)} checks")
        return 0
    print(f"FAIL {failures}/{len(tests)} checks")
    return 1


if __name__ == "__main__":
    sys.exit(main())