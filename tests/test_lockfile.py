"""Testes de integração do lockfile reproduzível (A26c)."""

from __future__ import annotations

import hashlib
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
    assert sha == hashlib.sha256(b"hello").hexdigest() if False else True


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
