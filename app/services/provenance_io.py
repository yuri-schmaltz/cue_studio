"""Disk and portable-bundle operations for provenance manifests."""
from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone
import io
import json
from pathlib import Path
import shutil
import tarfile
import tempfile
import uuid

PROVENANCE_SUFFIX = '.provenance.json'


def contained_file(root: Path, relative: str) -> Path:
    from .provenance import ProvenanceValidationError
    path = Path(relative)
    if not relative or '\\' in relative or path.is_absolute() or '..' in path.parts:
        raise ProvenanceValidationError('Provenance paths must be relative and stay inside the project')
    result = (root / path).resolve()
    if not result.is_relative_to(root.resolve()):
        raise ProvenanceValidationError('Provenance path escapes the project')
    return result


def manifest_path_for(output: Path) -> Path:
    return Path(output).with_suffix(PROVENANCE_SUFFIX)


def load_manifest(path: Path):
    from .provenance import ProvenanceValidationError, manifest_from_dict
    try:
        manifest = manifest_from_dict(json.loads(Path(path).read_text()))
        manifest.validate()
        return manifest
    except (KeyError, TypeError, ValueError) as exc:
        raise ProvenanceValidationError(f'Invalid provenance manifest: {exc}') from exc


def validate_manifest(manifest, project_dir):
    from .provenance import validate_against_disk
    return validate_against_disk(manifest, Path(project_dir))


def export_bundle(manifest, project_dir, out_path, *, include_refs=False):
    from .provenance import manifest_to_dict, ProvenanceValidationError
    manifest.validate()
    project_dir = Path(project_dir)
    paths = [a.relative_path for a in manifest.artifacts]
    paths.extend(manifest.sidecars)
    if include_refs:
        paths.extend(a.relative_path for a in manifest.references + manifest.audio_inputs)
    # Keep original relative paths; equal basenames in different directories
    # must never collide when exported or imported.
    with tarfile.open(out_path, 'w:gz') as archive:
        data = json.dumps(manifest_to_dict(manifest), ensure_ascii=False).encode()
        member = tarfile.TarInfo('manifest.provenance.json')
        member.size = len(data)
        archive.addfile(member, io.BytesIO(data))
        for relative in sorted(set(paths)):
            source = contained_file(project_dir, relative)
            if not source.is_file():
                raise ProvenanceValidationError(f'Missing bundle asset: {relative}')
            archive.add(source, arcname='payload/' + relative, recursive=False)


def import_bundle(bundle_path, project_dir):
    from .provenance import (
        ProvenanceValidationError, manifest_from_dict, validate_against_disk,
        write_manifest_atomic,
    )
    project_dir = Path(project_dir).resolve()
    project_dir.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix='.provenance-import-', dir=project_dir))
    try:
        with tarfile.open(bundle_path, 'r:gz') as archive:
            members = archive.getmembers()
            names = set()
            for member in members:
                contained_file(stage, member.name)
                if member.name in names or not member.isfile():
                    raise ProvenanceValidationError('Bundle contains duplicate or non-regular entries')
                names.add(member.name)
                if member.name != 'manifest.provenance.json' and not member.name.startswith('payload/'):
                    raise ProvenanceValidationError('Unexpected bundle member')
            if 'manifest.provenance.json' not in names:
                raise ProvenanceValidationError('Bundle has no manifest')
            for member in members:
                target = contained_file(stage, member.name)
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.extractfile(member) as source, target.open('wb') as dest:
                    shutil.copyfileobj(source, dest)
        manifest = load_manifest(stage / 'manifest.provenance.json')
        # Validate before publishing anything into the import collection.
        status, issues = validate_against_disk(manifest, stage / 'payload')
        if any('adulterado' in issue for issue in issues):
            raise ProvenanceValidationError('Bundle artifact hashes do not match the manifest')
        imports = project_dir / '_imports'
        imports.mkdir(exist_ok=True)
        import_dir = imports / uuid.uuid4().hex
        stage.rename(import_dir)
        stage = None
        prefix = str(import_dir.relative_to(project_dir) / 'payload')
        for field in ('artifacts', 'references', 'audio_inputs'):
            setattr(manifest, field, [replace(a, relative_path=prefix + '/' + a.relative_path)
                                      for a in getattr(manifest, field)])
        manifest.sidecars = {prefix + '/' + path: sha for path, sha in manifest.sidecars.items()}
        write_manifest_atomic(manifest, import_dir / 'manifest.provenance.json')
        status, issues = validate_against_disk(manifest, project_dir)
        return manifest, status, issues
    finally:
        if stage is not None:
            shutil.rmtree(stage, ignore_errors=True)


def retrofill_manifest(output, *, project_dir, take_id):
    from .provenance import (
        AssetRef, HardwareProfile, ModelRef, ProvenanceManifest, RuntimeRef,
        compute_sha256, write_manifest_atomic,
    )
    output, project_dir = Path(output).resolve(), Path(project_dir).resolve()
    relative = str(output.relative_to(project_dir))
    sidecar = output.with_suffix('.meta.json')
    params = {}
    if sidecar.is_file():
        metadata = json.loads(sidecar.read_text())
        params = metadata.get('params') if isinstance(metadata.get('params'), dict) else {}
    manifest = ProvenanceManifest(
        schema_version='1.0', take_id=take_id, project_id=project_dir.name,
        generation_timestamp=datetime.now(timezone.utc).isoformat(),
        adapter_id='legacy_unknown', adapter_revision='pre_manifest',
        model=ModelRef('unknown', '0' * 64, 'unknown', 'unknown'), seed=int(params.get('seed') or -1),
        profile=HardwareProfile('unknown', 0, 0, 'other'),
        runtime=RuntimeRef('unknown', 'unknown', 'pre_manifest'),
        artifacts=[AssetRef(take_id, 'output', compute_sha256(output), output.stat().st_size, relative)],
        sidecars={str(sidecar.relative_to(project_dir)): compute_sha256(sidecar)} if sidecar.is_file() else {},
        # Legacy metadata is deliberately not invented or declared verified.
        parameters={'provenance_incomplete': True},
    )
    write_manifest_atomic(manifest, manifest_path_for(output))
    return manifest


def emit_provenance(*, take_id, output_path, project_id, adapter_id,
                    adapter_revision, project_dir, parameters=None, seed=0,
                    sidecar_paths=(), model=None, profile=None, runtime=None):
    """Record actual output hashes; unknown checkpoint lineage stays unverified.

    Callers that know the loaded checkpoint can supply a ModelRef with its
    real hash. A model ID alone never becomes an invented checkpoint hash.
    """
    import platform
    import sys
    from .provenance import (
        AssetRef, HardwareProfile, ModelRef, ProvenanceManifest, RuntimeRef,
        compute_sha256, write_manifest_atomic,
    )
    root = Path(project_dir).resolve()
    output = Path(output_path).resolve()
    relative = str(output.relative_to(root))
    metadata = {}
    for sidecar in sidecar_paths:
        sidecar = Path(sidecar).resolve()
        if sidecar.is_file():
            metadata[str(sidecar.relative_to(root))] = compute_sha256(sidecar)
    clean = {key: value for key, value in (parameters or {}).items()
             if not any(word in key.lower() for word in ('token', 'password', 'secret', 'api_key', 'path', 'filename'))
             and isinstance(value, (str, int, float, bool))}
    torch = sys.modules.get('torch')
    torch_version = str(getattr(torch, '__version__', 'unknown'))
    manifest = ProvenanceManifest(
        schema_version='1.0', take_id=take_id, project_id=project_id,
        generation_timestamp=datetime.now(timezone.utc).isoformat(),
        adapter_id=adapter_id, adapter_revision=adapter_revision,
        model=model or ModelRef(adapter_id, '0' * 64, 'unknown', 'unknown'), seed=seed,
        profile=profile or HardwareProfile('unknown', 0, 0, {'Linux':'linux','Darwin':'macos','Windows':'windows'}.get(platform.system(), 'other')),
        runtime=runtime or RuntimeRef(platform.python_version(), torch_version, adapter_revision),
        artifacts=[AssetRef(take_id, 'output', compute_sha256(output), output.stat().st_size, relative)],
        sidecars=metadata, parameters=clean,
    )
    write_manifest_atomic(manifest, manifest_path_for(output))
    return manifest
