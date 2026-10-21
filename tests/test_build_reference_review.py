"""The review page is the only interface the human reviewer has.

The page is what produces ``creative-review.json``, and the gate at the
end of F2 accepts or rejects that file. Nothing in between them was
tested: a renamed element, a dimension dropped from the page, or a page
built for a master that has since been re-rendered would only show up
after the reviewer had watched the whole film and filled the form.

These tests tie the page to the gate by construction: the keys the
page's script writes are compared against the keys the gate actually
reads, read from the gate's own source, so neither side can drift
without one of these tests failing.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from app.services.reference_acceptance import (
    ARTISTIC_DIMENSIONS, file_hash, validate_creative_review,
)
from scripts.build_reference_review import build_review

ACCEPTANCE_SOURCE = Path(__file__).resolve().parents[1] / 'app' / 'services' / 'reference_acceptance.py'


def _folder(tmp_path: Path, *, report_hash=None, checks=None) -> Path:
    """A validation folder with a master and its technical report."""
    folder = tmp_path / 'validation'
    folder.mkdir(exist_ok=True)
    master = folder / 'master.mp4'
    master.write_bytes(b'the measured master')
    report = {
        'master_sha256': report_hash or file_hash(master),
        'checks': checks if checks is not None else {'frames': True, 'loudness': True},
    }
    (folder / 'technical-report.json').write_text(json.dumps(report))
    for index in range(1, 5):
        (folder / f'V0{index}-raw.wav').write_bytes(b'RIFF')
    return folder


def _script_keys(page: str) -> set:
    """The top level keys the page's script writes into the review.

    Both spellings count: ``key:value`` and the shorthand ``key,`` that
    JavaScript uses for a property whose name matches the variable.
    """
    literal = re.search(r'const review=\{(.*?)\};', page, re.S)
    assert literal, 'the page must build the review in one object literal'
    keys = set()
    for part in literal.group(1).split(','):
        part = part.strip()
        if not part:
            continue
        name = re.match(r'([A-Za-z_][A-Za-z0-9_]*)\s*:', part)
        if name:
            keys.add(name.group(1))
        elif re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', part):
            keys.add(part)
    return keys


def _gate_keys() -> set:
    """The keys the gate reads, taken from the gate's own source."""
    source = ACCEPTANCE_SOURCE.read_text()
    body = source[source.index('def validate_creative_review'):]
    keys = set(re.findall(r"review\.get\('([A-Za-z_][A-Za-z0-9_]*)'", body))
    keys |= set(re.findall(r"review\.get\('scores'\)\s*\.get\('([A-Za-z_][A-Za-z0-9_]*)'", body))
    return keys


def test_the_page_writes_exactly_the_keys_the_gate_reads(tmp_path):
    page = (build_review(_folder(tmp_path))).read_text()
    missing = _gate_keys() - _script_keys(page)
    assert not missing, f'the review page does not write: {sorted(missing)}'


def test_the_page_offers_exactly_the_dimensions_the_gate_demands(tmp_path):
    page = (build_review(_folder(tmp_path))).read_text()
    offered = set(re.findall(r'data-score="([a-z_]+)"', page))
    assert offered == set(ARTISTIC_DIMENSIONS)
    assert not set(ARTISTIC_DIMENSIONS) - offered


def test_every_element_the_script_reads_exists_in_the_page(tmp_path):
    page = (build_review(_folder(tmp_path))).read_text()
    script = page[page.index('<script>'):]
    for element_id in set(re.findall(r"querySelector\('#([A-Za-z0-9_-]+)'\)", script)):
        assert f'id="{element_id}"' in page, f'the script reads #{element_id}, which the page does not have'


def test_the_review_the_page_builds_is_accepted_by_the_gate(tmp_path):
    """The page filled in as the gate wants it must pass the gate."""
    folder = _folder(tmp_path)
    page = (build_review(folder)).read_text()
    master = folder / 'master.mp4'
    # The reviewer fills every dimension with a 3 and ticks both boxes.
    scores = {key: 3 for key in re.findall(r'data-score="([a-z_]+)"', page)}
    review = {
        'master_sha256': file_hash(master),
        'reviewer': 'Yuri',
        'reviewed_at': '2026-10-21T17:00:00-03:00',
        'scores': scores,
        'critical_errors': [],
        'speech_correct_and_untruncated': True,
        'title_correct': True,
    }
    validate_creative_review(master, review)


def test_an_untouched_page_cannot_produce_an_accepted_review(tmp_path):
    """The page must never approve on its own."""
    folder = _folder(tmp_path)
    page = (build_review(folder)).read_text()
    master = folder / 'master.mp4'
    # Every select still holds its empty first option, and the two
    # boxes are unticked: exactly what the page exports untouched.
    scores = {key: 0 for key in re.findall(r'data-score="([a-z_]+)"', page)}
    review = {
        'master_sha256': file_hash(master),
        'reviewer': '',
        'reviewed_at': '2026-10-21T17:00:00-03:00',
        'scores': scores,
        'critical_errors': [],
        'speech_correct_and_untruncated': False,
        'title_correct': False,
    }
    with pytest.raises(ValueError):
        validate_creative_review(master, review)


def test_the_page_is_bound_to_the_master_it_was_built_for(tmp_path):
    folder = _folder(tmp_path)
    page = (build_review(folder)).read_text()
    assert json.loads(re.search(r'const masterHash=("(?:[^"\\]|\\.)*")', page).group(1)) == file_hash(folder / 'master.mp4')


def test_a_page_is_not_built_for_a_master_that_changed(tmp_path):
    folder = _folder(tmp_path, report_hash='0' * 64)
    with pytest.raises(ValueError, match='unchanged technically validated master'):
        build_review(folder)


def test_a_page_is_not_built_for_a_master_with_a_failing_check(tmp_path):
    folder = _folder(tmp_path, checks={'frames': True, 'loudness': False})
    with pytest.raises(ValueError, match='unchanged technically validated master'):
        build_review(folder)


def test_the_page_offers_the_speech_stems_that_exist(tmp_path):
    """A stem the reviewer cannot hear is a silence they must judge."""
    folder = _folder(tmp_path)
    (folder / 'V04-raw.wav').unlink()
    page = (build_review(folder)).read_text()
    assert 'V01-raw.wav' in page and 'V03-raw.wav' in page
    assert 'V04-raw.wav' not in page
    for source in re.findall(r'<audio[^>]*src="([^"]+)"', page):
        assert (folder / source).is_file(), f'the page offers {source}, which does not exist'
