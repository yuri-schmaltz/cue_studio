#!/usr/bin/env python3
"""Protótipo isolado do Lockfile reproduzível por perfil (A26c).

Valida `42-feature-a26c-lockfile-reproducible-builds.md` **sem** importar
de `app/`. Reproduz o que será implementado em
`app/services/build/lockfile.py` quando a política Reversa liberar
`allowedPaths`.

Conteúdo:
  1. Modelo de dados: Requirement, Lock, SourceManifest, DriftReport, UpgradeProposal
  2. Parser determinístico de `requirements.txt` com comment / pin / hash / extra
  3. `sha256_file(path) -> str` (sha256 do arquivo, real)
  4. `generate_lock(...)` — síntese do lock canônico por perfil
  5. `validate_lock(...)` — compara lock com observações
  6. `upgrade_proposal(...)` — classifica mudanças
  7. Suíte de testes (8 testes)

Rodar:
    python3 _reversa_forward/plano-2026-10-04/prototypes/a26c_lockfile_reproducible.py

Saída esperada: 8 checks OK.
"""
from __future__ import annotations

import dataclasses
import hashlib
import json
import re
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional


# ---------------------------------------------------------------------------
# 1. Modelo de dados
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Requirement:
    name: str
    version_spec: str                       # ex.: "==3.7.12", ">=1.0,<2.0"
    hashes: tuple[str, ...]
    markers: tuple[str, ...]
    extras: tuple[str, ...]
    index_url: Optional[str]


@dataclass(frozen=True)
class Lock:
    profile: str
    platform: str
    python_version: str
    generated_at: str
    requirements: tuple[Requirement, ...]
    extra_indexes: tuple[str, ...]
    excludes_from_source: tuple[str, ...]
    adds_for_profile: tuple[str, ...]


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
    notes: tuple[str, ...]


@dataclass(frozen=True)
class DriftReport:
    missing: tuple[str, ...]
    version_drift: tuple[tuple[str, str, str], ...]
    hash_drift: tuple[tuple[str, str, str], ...]
    extras: tuple[str, ...]
    source_manifest_stale: bool
    ok: bool


@dataclass(frozen=True)
class UpgradeProposal:
    safe_minor: tuple[tuple[str, str, str], ...]      # (pkg, old, new)
    risky_minor: tuple[tuple[str, str, str], ...]
    major: tuple[tuple[str, str, str], ...]
    dropped: tuple[tuple[str, str], ...]                # (pkg, old_version)
    added: tuple[str, ...]                              # pkg
    block_merge: bool
    summary: str


# ---------------------------------------------------------------------------
# 2. Helpers
# ---------------------------------------------------------------------------

def sha256_file(path: Path) -> str:
    """Calcula SHA-256 real do arquivo."""
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _normalize_version(v: str) -> tuple[int, ...]:
    """Quebra '1.2.3' ou '1.2' em (1,2,3) para comparação simples."""
    m = re.match(r"^\s*=?=?(\d+(?:\.\d+)*)", v)
    if not m:
        return ()
    return tuple(int(x) for x in m.group(1).split("."))


def _classify_bump(old: str, new: str) -> str:
    """Classifica uma mudança de versão."""
    o, n = _normalize_version(old), _normalize_version(new)
    if not o or not n:
        return "unknown"
    if n[0] != o[0]:
        return "major"
    if len(n) > 1 and len(o) > 1 and n[1] != o[1]:
        return "risky_minor"
    return "safe_minor"


# ---------------------------------------------------------------------------
# 3. Parser de requirements.txt
# ---------------------------------------------------------------------------

_LINE_RE = re.compile(r"^\s*(?P<name>[A-Za-z0-9_.\-]+)(?P<rest>.*?)\s*$")


def parse_requirements_txt(text: str) -> tuple[Requirement, ...]:
    """Parser determinístico. Aceita:
        - comentários iniciados por #
        - linhas em branco
        - linhas com pacote==versão
        - continuação com \\
        - hashes --hash=sha256:...
        - markers ; python_version >= "3.10"
        - extras [extra1,extra2]
    """
    reqs: list[Requirement] = []
    raw_lines = text.splitlines()
    joined_lines: list[str] = []
    for line in raw_lines:
        s = line.rstrip()
        if s.endswith("\\"):
            joined_lines.append(s[:-1])
            combined_buffer = "".join(joined_lines)
            if combined_buffer in (joined_lines and raw_lines[-len(joined_lines):][-1].rstrip().endswith("\\") or "") and not s.endswith("\\"):
                # terminou; processa abaixo
                pass
            # acumula
            continue
        if s.endswith("\\"):
            joined_lines.append(s[:-1])
            continue
        if joined_lines:
            joined_lines.append(s)
            s = "".join(joined_lines)
            joined_lines = []
        # pula comentário/blanco
        stripped = s.strip()
        if not stripped or stripped.startswith("#"):
            continue
        joined_lines = []  # reset
        m = _LINE_RE.match(s)
        if not m:
            continue
        name = m.group("name")
        rest = m.group("rest").strip()
        # extras — formato "package[extra1,extra2]"
        extras: tuple[str, ...] = ()
        if "[" in name:
            base, _, bracket = name.partition("[")
            name = base
            extras = tuple(bracket.rstrip("]").split(","))
        # tudo depois de "==" / ">=" / "<=" / "~="
        version_spec = ""
        v_match = re.search(r"(==|>=|<=|~=|!=|>|<)\s*([^\s;]+)", rest)
        if v_match:
            version_spec = v_match.group(0)
        # hashes
        hashes = tuple(re.findall(r"--hash=([A-Za-z0-9:]+)", rest))
        # markers
        markers: tuple[str, ...] = ()
        if ";" in rest:
            _, _, marker_part = rest.partition(";")
            markers = tuple(marker_part.strip() for _ in [0]) if marker_part.strip() else ()
        reqs.append(Requirement(
            name=name.lower(),
            version_spec=version_spec,
            hashes=hashes,
            markers=markers,
            extras=extras,
            index_url=None,
        ))
    return tuple(sorted(reqs, key=lambda r: r.name))


# ---------------------------------------------------------------------------
# 4. Gerador de lock
# ---------------------------------------------------------------------------

def generate_lock(
    *,
    profile: str,
    source_requirements: tuple[Requirement, ...],
    source_requirements_txt_sha: str,
    source_pyproject_sha: str,
    profile_additions: tuple[Requirement, ...] = (),
    profile_excludes: tuple[str, ...] = (),
    extra_indexes: tuple[str, ...] = (),
    platform: str,
    python_version: str,
    generated_at: str,
    commit_sha: str,
    pip_version: str,
    notes: tuple[str, ...] = (),
) -> tuple[Lock, SourceManifest]:
    """Sintetiza um lock canônico (determinístico) + manifest."""
    excludes_set = {e.lower() for e in profile_excludes}
    filtered = tuple(
        r for r in source_requirements if r.name.lower() not in excludes_set
    )
    union = filtered + tuple(
        r for r in profile_additions if r.name.lower() not in excludes_set
    )
    final_req = tuple(sorted(union, key=lambda r: r.name))
    lock = Lock(
        profile=profile,
        platform=platform,
        python_version=python_version,
        generated_at=generated_at,
        requirements=final_req,
        extra_indexes=extra_indexes,
        excludes_from_source=profile_excludes,
        adds_for_profile=tuple(r.name for r in profile_additions),
    )
    lock_bytes = json.dumps(
        _lock_to_jsonable(lock), sort_keys=True, indent=2
    ).encode("utf-8")
    manifest = SourceManifest(
        profile=profile,
        lock_sha256=sha256_bytes(lock_bytes),
        requirements_txt_sha256=source_requirements_txt_sha,
        pyproject_sha256=source_pyproject_sha,
        commit_sha=commit_sha,
        pip_version=pip_version,
        python_version=python_version,
        resolved_at=generated_at,
        notes=notes,
    )
    return lock, manifest


def _lock_to_jsonable(lock: Lock) -> dict:
    return {
        "profile": lock.profile,
        "platform": lock.platform,
        "python_version": lock.python_version,
        "generated_at": lock.generated_at,
        "extra_indexes": list(lock.extra_indexes),
        "excludes_from_source": list(lock.excludes_from_source),
        "adds_for_profile": list(lock.adds_for_profile),
        "requirements": [
            {
                "name": r.name,
                "version_spec": r.version_spec,
                "hashes": list(r.hashes),
                "markers": list(r.markers),
                "extras": list(r.extras),
                "index_url": r.index_url,
            }
            for r in lock.requirements
        ],
    }


# ---------------------------------------------------------------------------
# 5. Validação de drift
# ---------------------------------------------------------------------------

def validate_lock(
    lock: Lock,
    manifest: SourceManifest,
    observed_requirements: tuple[Requirement, ...],
    observed_requirements_txt_sha: str,
) -> DriftReport:
    """Compara lock com ambiente resolvido."""
    obs_by_name = {r.name: r for r in observed_requirements}
    lock_by_name = {r.name: r for r in lock.requirements}

    missing: list[str] = []
    version_drift: list[tuple[str, str, str]] = []
    hash_drift: list[tuple[str, str, str]] = []
    extras: list[str] = []

    for name, locked in lock_by_name.items():
        if name not in obs_by_name:
            missing.append(name)
            continue
        obs = obs_by_name[name]
        if obs.version_spec != locked.version_spec:
            version_drift.append((name, locked.version_spec, obs.version_spec))
        if locked.hashes and obs.hashes and set(locked.hashes) != set(obs.hashes):
            hash_drift.append((name, ",".join(sorted(locked.hashes)), ",".join(sorted(obs.hashes))))

    for name in obs_by_name:
        if name not in lock_by_name:
            extras.append(name)

    source_manifest_stale = (
        observed_requirements_txt_sha != manifest.requirements_txt_sha256
    )

    ok = (
        len(missing) == 0
        and len(version_drift) == 0
        and len(hash_drift) == 0
        and not source_manifest_stale
    )
    return DriftReport(
        missing=tuple(missing),
        version_drift=tuple(version_drift),
        hash_drift=tuple(hash_drift),
        extras=tuple(extras),
        source_manifest_stale=source_manifest_stale,
        ok=ok,
    )


# ---------------------------------------------------------------------------
# 6. Upgrade proposal
# ---------------------------------------------------------------------------

def _extract_version(version_spec: str) -> str:
    """Extrai '1.2.3' de '==1.2.3' ou '>=1.2'."""
    m = re.search(r"(\d+(?:\.\d+)*)", version_spec)
    return m.group(1) if m else ""


def upgrade_proposal(
    *,
    current_lock: Lock,
    new_requirements: tuple[Requirement, ...],
    new_requirements_txt_sha: str,
    previous_requirements_txt_sha: str,
) -> UpgradeProposal:
    """Classifica o diff entre lock atual e requirements.txt novo."""
    cur_by_name = {r.name: r for r in current_lock.requirements}
    new_by_name = {r.name: r for r in new_requirements}

    safe_minor: list[tuple[str, str, str]] = []
    risky_minor: list[tuple[str, str, str]] = []
    major: list[tuple[str, str, str]] = []
    dropped: list[tuple[str, str]] = []

    for name, cur in cur_by_name.items():
        if name not in new_by_name:
            dropped.append((name, _extract_version(cur.version_spec)))
            continue
        new = new_by_name[name]
        if new.version_spec == cur.version_spec:
            continue
        cls = _classify_bump(_extract_version(cur.version_spec), _extract_version(new.version_spec))
        item = (name, _extract_version(cur.version_spec), _extract_version(new.version_spec))
        if cls == "safe_minor":
            safe_minor.append(item)
        elif cls == "risky_minor":
            risky_minor.append(item)
        elif cls == "major":
            major.append(item)

    added = [name for name in new_by_name if name not in cur_by_name]

    block_merge = len(major) > 0 or new_requirements_txt_sha == previous_requirements_txt_sha and False  # noqa: E501
    summary_parts = []
    if safe_minor:
        summary_parts.append(f"{len(safe_minor)} safe_minor")
    if risky_minor:
        summary_parts.append(f"{len(risky_minor)} risky_minor")
    if major:
        summary_parts.append(f"{len(major)} major")
    if dropped:
        summary_parts.append(f"{len(dropped)} dropped")
    if added:
        summary_parts.append(f"{len(added)} added")
    if not summary_parts:
        summary_parts.append("no_changes")

    return UpgradeProposal(
        safe_minor=tuple(safe_minor),
        risky_minor=tuple(risky_minor),
        major=tuple(major),
        dropped=tuple(dropped),
        added=tuple(added),
        block_merge=bool(major),
        summary=", ".join(summary_parts),
    )


# ---------------------------------------------------------------------------
# 7. Suíte de testes (8 testes)
# ---------------------------------------------------------------------------

_SAMPLE_REQUIREMENTS = """\
# Maestro set — pinned against CUDA 12.8
mmgp==3.7.12 \\
    --hash=sha256:ab12cd34ef56 \\
    --hash=sha256:90ab78cd34ef \\
    ; python_version >= "3.10"

diffusers==0.36.0
transformers==4.57.1
tokenizers==0.22.1
accelerate==1.12.0
numpy==2.1.2
"""


def _req(name: str, version: str, hashes: tuple[str, ...] = ()) -> Requirement:
    return Requirement(
        name=name,
        version_spec=f"=={version}",
        hashes=hashes,
        markers=(),
        extras=(),
        index_url=None,
    )


def check(name: str, ok: bool, detail: str = "") -> bool:
    status = "OK" if ok else "FAIL"
    print(f"  {status} {name}{(' — ' + detail) if detail else ''}")
    return ok


def test_parse_requirements_with_comments_pins_and_hashes() -> bool:
    parsed = parse_requirements_txt(_SAMPLE_REQUIREMENTS)
    names = [r.name for r in parsed]
    return check(
        "parser: comment + pin + hash + marker",
        set(names) == {"mmgp", "diffusers", "transformers", "tokenizers", "accelerate", "numpy"}
        and any(r.hashes and r.markers for r in parsed if r.name == "mmgp"),
        f"names={names}",
    )


def test_generate_lock_is_deterministic_and_excludes() -> bool:
    source = parse_requirements_txt(_SAMPLE_REQUIREMENTS)
    lock_a, manifest_a = generate_lock(
        profile="E2",
        source_requirements=source,
        source_requirements_txt_sha="src_sha_aaa",
        source_pyproject_sha="pyp_sha_bbb",
        profile_additions=(_req("torch", "2.7.1", ("sha256:tt",)),),
        profile_excludes=("numpy",),
        extra_indexes=("https://download.pytorch.org/whl/cu121",),
        platform="linux-x86_64-cuda12.1",
        python_version="3.11",
        generated_at="2026-10-16T12:00:00Z",
        commit_sha="bf50b33",
        pip_version="pip 24.0",
    )
    lock_b, _ = generate_lock(
        profile="E2",
        source_requirements=source,
        source_requirements_txt_sha="src_sha_aaa",
        source_pyproject_sha="pyp_sha_bbb",
        profile_additions=(_req("torch", "2.7.1", ("sha256:tt",)),),
        profile_excludes=("numpy",),
        extra_indexes=("https://download.pytorch.org/whl/cu121",),
        platform="linux-x86_64-cuda12.1",
        python_version="3.11",
        generated_at="2026-10-16T12:00:00Z",
        commit_sha="bf50b33",
        pip_version="pip 24.0",
    )
    same_lock = _lock_to_jsonable(lock_a) == _lock_to_jsonable(lock_b)
    names = [r.name for r in lock_a.requirements]
    return check(
        "generate_lock: determinístico, exclui numpy, adiciona torch",
        same_lock and "numpy" not in names and "torch" in names,
        f"same_lock={same_lock}, names={names}",
    )


def test_drift_full_report_with_missing_version_hash_extras() -> bool:
    source = parse_requirements_txt(_SAMPLE_REQUIREMENTS)
    # Adiciona hash ao tokenizers no lock canônico para que o teste de hash drift seja significativo.
    source = tuple(
        dataclasses.replace(r, hashes=("sha256:hash_original_tok",)) if r.name == "tokenizers" else r
        for r in source
    )
    lock, manifest = generate_lock(
        profile="E2",
        source_requirements=source,
        source_requirements_txt_sha="sha_real",
        source_pyproject_sha="sha_py",
        profile_excludes=(),
        extra_indexes=(),
        platform="linux-x86_64-cuda12.1",
        python_version="3.11",
        generated_at="2026-10-16T12:00:00Z",
        commit_sha="bf50b33",
        pip_version="pip 24.0",
    )
    # Observado: mmgp sumiu, diffusers mudou versão, tokenizers hash mudou,
    # scipy apareceu como extra
    observed = (
        _req("diffusers", "0.37.0"),
        _req("tokenizers", "0.22.1", hashes=("sha256:hash_drift_tok",)),
        _req("transformers", "4.57.1"),
        _req("accelerate", "1.12.0"),
        _req("numpy", "2.1.2"),
        _req("scipy", "1.13.1"),
    )
    report = validate_lock(lock, manifest, observed, observed_requirements_txt_sha="sha_real")
    return check(
        "drift_full: missing + version + hash + extras detectados, ok=False",
        not report.ok
        and "mmgp" in report.missing
        and any(p == "diffusers" for p, _, _ in report.version_drift)
        and any(p == "tokenizers" for p, _, _ in report.hash_drift)
        and "scipy" in report.extras,
        f"missing={report.missing}, ver={report.version_drift}, hash={report.hash_drift}, extras={report.extras}",
    )


def test_drift_clean_when_observed_matches_lock() -> bool:
    source = parse_requirements_txt(_SAMPLE_REQUIREMENTS)
    lock, manifest = generate_lock(
        profile="E2",
        source_requirements=source,
        source_requirements_txt_sha="sha_real",
        source_pyproject_sha="sha_py",
        profile_excludes=(),
        extra_indexes=(),
        platform="linux-x86_64-cuda12.1",
        python_version="3.11",
        generated_at="2026-10-16T12:00:00Z",
        commit_sha="bf50b33",
        pip_version="pip 24.0",
    )
    observed = tuple(
        Requirement(name=r.name, version_spec=r.version_spec, hashes=r.hashes,
                    markers=r.markers, extras=r.extras, index_url=r.index_url)
        for r in lock.requirements
    )
    report = validate_lock(lock, manifest, observed, observed_requirements_txt_sha="sha_real")
    return check(
        "drift_clean: sem drift → ok=True",
        report.ok,
        f"missing={report.missing}, extras={report.extras}",
    )


def test_drift_source_manifest_stale_when_requirements_changed() -> bool:
    source = parse_requirements_txt(_SAMPLE_REQUIREMENTS)
    lock, manifest = generate_lock(
        profile="E2",
        source_requirements=source,
        source_requirements_txt_sha="sha_v1",
        source_pyproject_sha="sha_py",
        profile_excludes=(),
        extra_indexes=(),
        platform="linux-x86_64-cuda12.1",
        python_version="3.11",
        generated_at="2026-10-16T12:00:00Z",
        commit_sha="bf50b33",
        pip_version="pip 24.0",
    )
    observed = tuple(
        Requirement(name=r.name, version_spec=r.version_spec, hashes=r.hashes,
                    markers=r.markers, extras=r.extras, index_url=r.index_url)
        for r in lock.requirements
    )
    report = validate_lock(lock, manifest, observed, observed_requirements_txt_sha="sha_v2")
    return check(
        "drift_source_stale: requirements_txt mudou",
        report.source_manifest_stale and not report.ok,
        f"stale={report.source_manifest_stale}",
    )


def test_upgrade_safe_minor_classification() -> bool:
    source = parse_requirements_txt(_SAMPLE_REQUIREMENTS)
    lock, _ = generate_lock(
        profile="E2",
        source_requirements=source,
        source_requirements_txt_sha="sha_v1",
        source_pyproject_sha="sha_py",
        profile_excludes=(),
        extra_indexes=(),
        platform="linux-x86_64-cuda12.1",
        python_version="3.11",
        generated_at="2026-10-16T12:00:00Z",
        commit_sha="bf50b33",
        pip_version="pip 24.0",
    )
    new_req = (
        _req("diffusers", "0.36.1"),  # safe_minor
        _req("transformers", "4.57.1"),
        _req("tokenizers", "0.22.1"),
        _req("accelerate", "1.12.0"),
        _req("mmgp", "3.7.12"),
        _req("numpy", "2.1.2"),
    )
    prop = upgrade_proposal(
        current_lock=lock,
        new_requirements=new_req,
        new_requirements_txt_sha="sha_v2",
        previous_requirements_txt_sha="sha_v1",
    )
    return check(
        "upgrade: safe_minor reconhecido, sem block",
        any(p[0] == "diffusers" and p[1] == "0.36.0" and p[2] == "0.36.1" for p in prop.safe_minor)
        and not prop.block_merge
        and len(prop.major) == 0,
        f"safe={prop.safe_minor}, major={prop.major}, summary={prop.summary}",
    )


def test_upgrade_major_blocks_merge() -> bool:
    source = parse_requirements_txt(_SAMPLE_REQUIREMENTS)
    lock, _ = generate_lock(
        profile="E2",
        source_requirements=source,
        source_requirements_txt_sha="sha_v1",
        source_pyproject_sha="sha_py",
        profile_excludes=(),
        extra_indexes=(),
        platform="linux-x86_64-cuda12.1",
        python_version="3.11",
        generated_at="2026-10-16T12:00:00Z",
        commit_sha="bf50b33",
        pip_version="pip 24.0",
    )
    new_req = (
        _req("diffusers", "1.0.0"),  # major
        _req("transformers", "4.57.1"),
        _req("tokenizers", "0.22.1"),
        _req("accelerate", "1.12.0"),
        _req("mmgp", "3.7.12"),
        _req("numpy", "2.1.2"),
    )
    prop = upgrade_proposal(
        current_lock=lock,
        new_requirements=new_req,
        new_requirements_txt_sha="sha_v2",
        previous_requirements_txt_sha="sha_v1",
    )
    return check(
        "upgrade: major (diffusers 0.36 → 1.0) bloqueia merge",
        prop.block_merge
        and any(p[0] == "diffusers" and p[1] == "0.36.0" and p[2] == "1.0.0" for p in prop.major),
        f"major={prop.major}, block={prop.block_merge}, summary={prop.summary}",
    )


def test_source_manifest_records_real_sha256_of_files(tmp_dir: Path) -> bool:
    """Verifica que SourceManifest tem SHA-256 real dos arquivos-fontes."""
    req_path = tmp_dir / "requirements.txt"
    pyp_path = tmp_dir / "pyproject.toml"
    req_path.write_bytes(_SAMPLE_REQUIREMENTS.encode())
    pyp_path.write_bytes(b"[project]\nname = 'cue-studio'\nversion = '2.5.2'")
    source = parse_requirements_txt(_SAMPLE_REQUIREMENTS)
    lock, manifest = generate_lock(
        profile="E2",
        source_requirements=source,
        source_requirements_txt_sha=sha256_file(req_path),
        source_pyproject_sha=sha256_file(pyp_path),
        profile_excludes=(),
        extra_indexes=(),
        platform="linux-x86_64-cuda12.1",
        python_version="3.11",
        generated_at="2026-10-16T12:00:00Z",
        commit_sha="bf50b33",
        pip_version="pip 24.0",
    )
    expected_req_sha = sha256_file(req_path)
    expected_pyp_sha = sha256_file(pyp_path)
    return check(
        "manifest: SHA-256 real dos arquivos-fontes registrados",
        manifest.requirements_txt_sha256 == expected_req_sha
        and manifest.pyproject_sha256 == expected_pyp_sha
        and len(manifest.lock_sha256) == 64,
        f"req_sha[:8]={manifest.requirements_txt_sha256[:8]}, "
        f"lock_sha[:8]={manifest.lock_sha256[:8]}",
    )


def main() -> int:
    print("== A26c Lockfile reproduzível por perfil ==")
    with tempfile.TemporaryDirectory() as td:
        tmp_dir = Path(td)
        tests = [
            test_parse_requirements_with_comments_pins_and_hashes,
            test_generate_lock_is_deterministic_and_excludes,
            test_drift_full_report_with_missing_version_hash_extras,
            test_drift_clean_when_observed_matches_lock,
            test_drift_source_manifest_stale_when_requirements_changed,
            test_upgrade_safe_minor_classification,
            test_upgrade_major_blocks_merge,
        ]
        # teste que usa tmp_dir
        tests.append(lambda: test_source_manifest_records_real_sha256_of_files(tmp_dir))
        failures = 0
        for t in tests:
            if not t():
                failures += 1
    print()
    if failures == 0:
        print(f"PASS 8/8 checks")
        return 0
    print(f"FAIL {failures}/8 checks")
    return 1


if __name__ == "__main__":
    sys.exit(main())
