"""Testes de integração do lockfile reproduzível (A26c)."""

from __future__ import annotations

import hashlib
import pytest
import tempfile
from pathlib import Path

from app.services.lockfile import (
    DriftReport,
    Lock,
    Requirement,
    SourceManifest,
    UpgradeProposal,
    generate_lock,
    parse_requirements,
    sha256_bytes,
    sha256_file,
    upgrade_proposal,
    validate_lock,
)


def test_sha256_file():
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "test.txt"
        p.write_text("hello")
        sha = sha256_file(p)
        assert len(sha) == 64
        assert all(c in "0123456789abcdef" for c in sha)


def test_sha256_bytes():
    sha = sha256_bytes(b"hello")
    assert len(sha) == 64
    assert sha == hashlib.sha256(b"hello").hexdigest()


def test_parse_requirements():
    text = """
# comment
numpy==2.1.2
torch>=2.7.0
mmgp==3.7.12; python_version >= "3.11"
gradio[extra]==5.29.0
"""
    reqs = parse_requirements(text)
    assert len(reqs) == 4
    names = [r.name for r in reqs]
    assert "numpy" in names
    assert "torch" in names
    assert "mmgp" in names
    assert "gradio" in names


def test_parse_requirements_markers():
    text = 'mmgp==3.7.12; python_version >= "3.11"'
    reqs = parse_requirements(text)
    assert len(reqs) == 1
    assert reqs[0].markers == ('python_version >= "3.11"',)


def test_generate_lock():
    reqs = [Requirement(name="numpy", version_spec="==2.1.2")]
    lock = generate_lock(
        profile="E2",
        platform="linux",
        python_version="3.12",
        requirements=reqs,
        extra_indexes=("https://example.com/simple/",),
    )
    assert lock.profile == "E2"
    assert lock.platform == "linux"
    assert len(lock.requirements) == 1
    assert lock.extra_indexes == ("https://example.com/simple/",)


def test_validate_lock_ok():
    reqs = [Requirement(name="numpy", version_spec="==2.1.2")]
    lock = generate_lock(profile="E2", platform="linux", python_version="3.12", requirements=reqs)
    observed = {"numpy": {"version": "2.1.2"}}
    report = validate_lock(lock, observed)
    assert report.ok is True
    assert report.missing == ()
    assert report.version_drift == ()


def test_validate_lock_missing():
    reqs = [Requirement(name="numpy", version_spec="==2.1.2")]
    lock = generate_lock(profile="E2", platform="linux", python_version="3.12", requirements=reqs)
    observed = {}
    report = validate_lock(lock, observed)
    assert report.ok is False
    assert "numpy" in report.missing


def test_validate_lock_version_drift():
    reqs = [Requirement(name="numpy", version_spec="==2.1.2")]
    lock = generate_lock(profile="E2", platform="linux", python_version="3.12", requirements=reqs)
    observed = {"numpy": {"version": "2.2.0"}}
    report = validate_lock(lock, observed)
    assert report.ok is False
    assert len(report.version_drift) == 1


def test_upgrade_proposal_safe():
    old_reqs = [Requirement(name="numpy", version_spec="==2.1.2")]
    old_lock = generate_lock(profile="E2", platform="linux", python_version="3.12", requirements=old_reqs)
    new_reqs = [Requirement(name="numpy", version_spec="==2.1.3")]
    proposal = upgrade_proposal(old_lock, new_reqs)
    assert len(proposal.safe_minor) == 1
    assert proposal.block_merge is False


def test_upgrade_proposal_major():
    old_reqs = [Requirement(name="numpy", version_spec="==2.1.2")]
    old_lock = generate_lock(profile="E2", platform="linux", python_version="3.12", requirements=old_reqs)
    new_reqs = [Requirement(name="numpy", version_spec="==3.0.0")]
    proposal = upgrade_proposal(old_lock, new_reqs)
    assert len(proposal.major) == 1
    assert proposal.block_merge is True


def test_upgrade_proposal_dropped():
    old_reqs = [Requirement(name="numpy", version_spec="==2.1.2"), Requirement(name="torch", version_spec="==2.7.1")]
    old_lock = generate_lock(profile="E2", platform="linux", python_version="3.12", requirements=old_reqs)
    new_reqs = [Requirement(name="numpy", version_spec="==2.1.2")]
    proposal = upgrade_proposal(old_lock, new_reqs)
    assert len(proposal.dropped) == 1
    assert proposal.block_merge is True


def test_upgrade_proposal_added():
    old_reqs = [Requirement(name="numpy", version_spec="==2.1.2")]
    old_lock = generate_lock(profile="E2", platform="linux", python_version="3.12", requirements=old_reqs)
    new_reqs = [Requirement(name="numpy", version_spec="==2.1.2"), Requirement(name="torch", version_spec="==2.7.1")]
    proposal = upgrade_proposal(old_lock, new_reqs)
    assert "torch" in proposal.added


def test_drift_report_defaults():
    report = DriftReport()
    assert report.ok is True
    assert report.missing == ()
    assert report.version_drift == ()


def test_requirements_preserve_extras_hashes_and_continuations():
    digest = "a" * 64
    req, = parse_requirements("My_Package[z,a]==1.2 \\\n    --hash=sha256:" + digest + " # verified wheel")
    assert req.name == "my-package"
    assert req.extras == ("a", "z")
    assert req.version_spec == "==1.2"
    assert req.hashes == ("sha256:" + digest,)


@pytest.mark.parametrize("declaration", ["--requirement other.txt", "broken !!!", "pkg==1 --hash=sha256:bad"])
def test_unsupported_requirements_fail_explicitly(declaration):
    with pytest.raises(ValueError):
        parse_requirements(declaration)


@pytest.mark.parametrize("version,ok", [("1.5", True), ("2.0", False), ("", False)])
def test_validate_ranges_and_normalized_names(version, ok):
    lock = generate_lock("E2", "linux", "3.12", [Requirement("My_Package", ">=1,<2")])
    report = validate_lock(lock, {"my-package": {"version": version}})
    assert report.ok is ok
    assert bool(report.version_drift) is not ok


@pytest.mark.parametrize("digest,ok", [("a" * 64, True), ("b" * 64, False), ("", False)])
def test_hash_drift_requires_verified_artifact(digest, ok):
    lock = generate_lock("E2", "linux", "3.12", [Requirement("pkg", "==1", hashes=("sha256:" + "a" * 64,))])
    report = validate_lock(lock, {"pkg": {"version": "1", "sha256": digest}})
    assert report.ok is ok
    assert bool(report.hash_drift) is not ok


def test_validate_markers_for_explicit_target_environment():
    lock = generate_lock("E2", "linux", "3.12", [Requirement("windows-only", "==1", markers=('sys_platform == "win32"',))])
    assert validate_lock(lock, {}, environment={"sys_platform": "linux"}).ok
    assert not validate_lock(lock, {}, environment={"sys_platform": "win32"}).ok


def test_direct_url_source_is_preserved_and_checked():
    req, = parse_requirements('pkg @ https://example.test/pkg.whl ; sys_platform == "linux"')
    assert req.url == 'https://example.test/pkg.whl'
    lock = generate_lock("E2", "linux", "3.12", [req])
    observed = {"pkg": {"version": "1", "url": req.url}}
    assert validate_lock(lock, observed, environment={"sys_platform": "linux"}).ok
    observed['pkg']['url'] = 'https://other.test/pkg.whl'
    report = validate_lock(lock, observed, environment={"sys_platform": "linux"})
    assert not report.ok and report.source_drift


def test_actual_project_requirements_are_not_silently_lost():
    text = (Path(__file__).resolve().parents[1] / 'app/requirements.txt').read_text()
    reqs = parse_requirements(text)
    assert any(req.url and req.name == 'chumpy' for req in reqs)
    assert any(req.extras == ('gpu',) for req in reqs if req.name == 'rembg')
    assert any(req.markers for req in reqs if req.name == 'onnxruntime-gpu')
    # Every dependency declaration must survive parsing, including URL wheels.
    declarations = [line for line in text.splitlines() if line.strip() and not line.lstrip().startswith(('#', '--'))]
    assert len(reqs) == len(declarations)


def test_manifest_source_changes_invalidate_lock(tmp_path):
    from dataclasses import replace
    paths = [tmp_path / name for name in ('lock.txt', 'requirements.txt', 'pyproject.toml')]
    for path in paths:
        path.write_text('original')
    manifest = SourceManifest('E2', *(sha256_file(path) for path in paths), 'commit', 'pip', '3.12', 'date')
    lock = generate_lock('E2', 'linux', '3.12', [])
    kwargs = dict(source_manifest=manifest, lock_path=paths[0], requirements_path=paths[1], pyproject_path=paths[2])
    assert validate_lock(lock, {}, **kwargs).ok
    assert validate_lock(lock, {}, source_manifest=manifest).source_manifest_stale
    assert validate_lock(lock, {}, **{**kwargs, 'source_manifest': replace(manifest, profile='E4')}).source_manifest_stale
    paths[1].write_text('changed')
    report = validate_lock(lock, {}, **kwargs)
    assert report.source_manifest_stale and not report.ok


def test_observed_extra_packages_are_reported_without_blocking():
    lock = generate_lock('E2', 'linux', '3.12', [Requirement('pkg', '==1')])
    report = validate_lock(lock, {'pkg': {'version': '1'}, 'extra-package': {'version': '2'}})
    assert report.ok and report.extras == ('extra-package',)
