"""Lockfile reproduzível por perfil (A26c).

Parser determinístico de requirements.txt, geração de lock canônico por
perfil, validação de drift, proposta de upgrade.

Fonte: protótipo ``_reversa_forward/plano-2026-10-04/prototypes/a26c_lockfile_reproducible.py``.
"""

from __future__ import annotations

import dataclasses
import hashlib
import json
import os
import re
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from packaging.requirements import Requirement as ParsedRequirement
from packaging.utils import canonicalize_name


@dataclass(frozen=True)
class Requirement:
    name: str
    version_spec: str
    hashes: tuple[str, ...] = ()
    markers: tuple[str, ...] = ()
    extras: tuple[str, ...] = ()
    index_url: Optional[str] = None
    url: Optional[str] = None


@dataclass(frozen=True)
class Lock:
    profile: str
    platform: str
    python_version: str
    generated_at: str
    requirements: tuple[Requirement, ...]
    extra_indexes: tuple[str, ...] = ()
    excludes_from_source: tuple[str, ...] = ()
    adds_for_profile: tuple[str, ...] = ()


@dataclass(frozen=True)
class SourceManifest:
    profile: str
    lock_sha256: str
    requirements_txt_sha256: str
    pyproject_sha256: str
    commit_sha: str
    pip_version: str
    python_version: str
    resolved_at: str
    notes: tuple[str, ...] = ()


@dataclass(frozen=True)
class DriftReport:
    missing: tuple[str, ...] = ()
    version_drift: tuple[tuple[str, str, str], ...] = ()
    hash_drift: tuple[tuple[str, str, str], ...] = ()
    source_drift: tuple[tuple[str, str, str], ...] = ()
    extras: tuple[str, ...] = ()
    source_manifest_stale: bool = False
    ok: bool = True


@dataclass(frozen=True)
class UpgradeProposal:
    safe_minor: tuple[tuple[str, str, str], ...] = ()
    risky_minor: tuple[tuple[str, str, str], ...] = ()
    major: tuple[tuple[str, str, str], ...] = ()
    dropped: tuple[tuple[str, str], ...] = ()
    added: tuple[str, ...] = ()
    block_merge: bool = False
    summary: str = ""


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _normalize_version(v: str) -> tuple[int, ...]:
    m = __import__("re").match(r"^\s*=?=?(\d+(?:\.\d+)*)", v)
    if not m:
        return ()
    return tuple(int(x) for x in m.group(1).split("."))


def parse_requirements(text: str) -> list[Requirement]:
    """Parse PEP 508 requirements and pip hash continuations without resolving.

    Invalid or unsupported dependency declarations fail instead of silently
    disappearing from an apparent lock. Index options are lock metadata.
    """
    reqs = []
    logical = re.sub(r"\\\r?\n\s*", " ", text)
    for line in logical.splitlines():
        line = re.split(r"\s+#", line, maxsplit=1)[0].strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith(("--index-url ", "--extra-index-url ", "--trusted-host ")):
            continue
        hashes = tuple(re.findall(r"--hash[= ](sha256:[0-9a-fA-F]{64})(?=\s|$)", line))
        declaration = re.sub(r"\s+--hash[= ]\S+", "", line).strip()
        if line.count("--hash") != len(hashes):
            raise ValueError("Only complete SHA-256 requirement hashes are supported")
        parsed = ParsedRequirement(declaration)
        reqs.append(Requirement(
            name=canonicalize_name(parsed.name),
            version_spec=str(parsed.specifier),
            hashes=tuple(h.lower() for h in hashes),
            markers=(str(parsed.marker),) if parsed.marker else (),
            extras=tuple(sorted(parsed.extras)),
            url=parsed.url,
        ))
    return reqs


def generate_lock(
    profile: str,
    platform: str,
    python_version: str,
    requirements: list[Requirement],
    extra_indexes: tuple[str, ...] = (),
    excludes: tuple[str, ...] = (),
    adds: tuple[str, ...] = (),
) -> Lock:
    return Lock(
        profile=profile,
        platform=platform,
        python_version=python_version,
        generated_at="",
        requirements=tuple(requirements),
        extra_indexes=extra_indexes,
        excludes_from_source=excludes,
        adds_for_profile=adds,
    )


def validate_lock(
    lock: Lock, observed: dict, *, environment: Optional[dict] = None,
    source_manifest: Optional[SourceManifest] = None,
    lock_path: Optional[Path] = None, requirements_path: Optional[Path] = None,
    pyproject_path: Optional[Path] = None,
) -> DriftReport:
    """Check installed versions and recorded artifact hashes, without resolving.

    Hash observations must come from artifact verification, not pip's installed
    version string. A missing hash cannot prove a hash-pinned requirement.
    """
    from packaging.markers import Marker
    from packaging.specifiers import SpecifierSet

    missing, version_drift, hash_drift, source_drift = [], [], [], []
    expected_names = set()
    normalized = {canonicalize_name(name): value for name, value in observed.items()}
    for req in lock.requirements:
        if req.markers and not all(Marker(marker).evaluate(environment) for marker in req.markers):
            continue
        name = canonicalize_name(req.name)
        expected_names.add(name)
        if name not in normalized:
            missing.append(req.name)
            continue
        obs = normalized[name]
        if req.url and obs.get("url") != req.url:
            source_drift.append((req.name, req.url, str(obs.get("url") or "")))
        version = obs.get("version", "")
        if req.version_spec and (not version or not SpecifierSet(req.version_spec).contains(version, prereleases=None)):
            version_drift.append((req.name, req.version_spec, version))
        if req.hashes:
            digest = str(obs.get("sha256", "")).lower()
            actual = digest if digest.startswith("sha256:") else "sha256:" + digest if digest else ""
            if actual not in req.hashes:
                hash_drift.append((req.name, "|".join(req.hashes), actual))
    stale = False
    if source_manifest is not None:
        stale = source_manifest.profile != lock.profile
        for path, expected in (
            (lock_path, source_manifest.lock_sha256),
            (requirements_path, source_manifest.requirements_txt_sha256),
            (pyproject_path, source_manifest.pyproject_sha256),
        ):
            if not path or not path.is_file() or not expected or sha256_file(path) != expected:
                stale = True
    return DriftReport(
        missing=tuple(missing), version_drift=tuple(version_drift),
        hash_drift=tuple(hash_drift), source_drift=tuple(source_drift),
        extras=tuple(sorted(set(normalized) - expected_names)),
        source_manifest_stale=stale,
        ok=not (missing or version_drift or hash_drift or source_drift or stale),
    )


def upgrade_proposal(
    old_lock: Lock,
    new_requirements: list[Requirement],
) -> UpgradeProposal:
    """Classifica mudanças entre lock antigo e novos requirements."""
    old_names = {r.name: r.version_spec for r in old_lock.requirements}
    new_names = {r.name: r.version_spec for r in new_requirements}

    safe_minor = []
    risky_minor = []
    major = []
    dropped = []
    added = []

    for name, new_spec in new_names.items():
        if name not in old_names:
            added.append(name)
            continue
        old_spec = old_names[name]
        old_ver = _normalize_version(old_spec)
        new_ver = _normalize_version(new_spec)
        if old_ver == new_ver:
            continue
        # Classificar por mudança de versão
        if len(old_ver) >= 1 and len(new_ver) >= 1:
            if old_ver[0] != new_ver[0]:
                major.append((name, old_spec, new_spec))
            elif len(old_ver) >= 2 and len(new_ver) >= 2 and old_ver[1] != new_ver[1]:
                risky_minor.append((name, old_spec, new_spec))
            else:
                safe_minor.append((name, old_spec, new_spec))

    for name, old_spec in old_names.items():
        if name not in new_names:
            dropped.append((name, old_spec))

    block_merge = len(major) > 0 or len(dropped) > 0
    summary = (
        f"safe={len(safe_minor)}, risky={len(risky_minor)}, "
        f"major={len(major)}, dropped={len(dropped)}, added={len(added)}"
    )
    return UpgradeProposal(
        safe_minor=tuple(safe_minor),
        risky_minor=tuple(risky_minor),
        major=tuple(major),
        dropped=tuple(dropped),
        added=tuple(added),
        block_merge=block_merge,
        summary=summary,
    )
