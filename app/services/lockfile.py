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


@dataclass(frozen=True)
class Requirement:
    name: str
    version_spec: str
    hashes: tuple[str, ...] = ()
    markers: tuple[str, ...] = ()
    extras: tuple[str, ...] = ()
    index_url: Optional[str] = None


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
    """Parser determinístico de requirements.txt."""
    import re
    reqs = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("--"):
            continue
        # Parse name + version spec
        m = re.match(r"^([A-Za-z0-9_.-]+)(.*)$", line)
        if not m:
            continue
        name = m.group(1)
        rest = m.group(2).strip()
        # Extract markers (after ;)
        markers = ()
        if ";" in rest:
            rest, marker = rest.split(";", 1)
            markers = (marker.strip(),)
            rest = rest.strip()
        # Extract extras
        extras = ()
        if "[" in name:
            name, extras_str = name.split("[", 1)
            extras_str = extras_str.rstrip("]")
            extras = tuple(e.strip() for e in extras_str.split(","))
        # version spec
        version_spec = rest.strip() if rest else ""
        # hashes
        hashes = ()
        reqs.append(Requirement(
            name=name,
            version_spec=version_spec,
            hashes=hashes,
            markers=markers,
            extras=extras,
            index_url=None,
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


def validate_lock(lock: Lock, observed: dict) -> DriftReport:
    """Compara lock com observações (installed packages)."""
    missing = []
    version_drift = []
    hash_drift = []
    extras = []
    for req in lock.requirements:
        if req.name not in observed:
            missing.append(req.name)
            continue
        obs_version = observed[req.name].get("version", "")
        if req.version_spec and obs_version:
            # Simplificado: compara versão exata se == presente
            spec = req.version_spec.strip()
            if spec.startswith("==") and obs_version != spec[2:]:
                version_drift.append((req.name, spec, obs_version))
    ok = len(missing) == 0 and len(version_drift) == 0 and len(hash_drift) == 0
    return DriftReport(
        missing=tuple(missing),
        version_drift=tuple(version_drift),
        hash_drift=tuple(hash_drift),
        extras=tuple(extras),
        source_manifest_stale=False,
        ok=ok,
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
