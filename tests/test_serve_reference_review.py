"""Serving the review must not be the thing that breaks the review.

The reviewer reaches the film through a page served over HTTP. The
failure that hurts is the one that happens after they have already
watched it: a page bound to another master, a page offering a speech
file that is not there, a folder whose technical report describes a
different file. The preflight check exists to catch all of those
before the reviewer opens the page, and these tests pin it down.
"""
from __future__ import annotations

import json
import socket
import time
from pathlib import Path

from app.services.reference_acceptance import file_hash
from scripts.build_reference_review import build_review
from scripts.serve_reference_review import free_port, handler_for, preflight


def _folder(tmp_path: Path, *, with_page=True) -> Path:
    folder = tmp_path / 'validation'
    folder.mkdir(exist_ok=True)
    master = folder / 'master.mp4'
    master.write_bytes(b'the measured master')
    (folder / 'technical-report.json').write_text(json.dumps({
        'master_sha256': file_hash(master),
        'checks': {'frames': True, 'loudness': True},
    }))
    for index in range(1, 5):
        (folder / f'V0{index}-raw.wav').write_bytes(b'RIFF')
    if with_page:
        build_review(folder)
    return folder


def test_a_ready_folder_passes_the_check(tmp_path):
    state = preflight(_folder(tmp_path))
    assert state['ok'] is True
    assert state['problems'] == []
    assert any('technically validated' in repair for repair in state['repairs'])
    assert any('bound to this master' in repair for repair in state['repairs'])


def test_a_folder_without_a_master_is_refused(tmp_path):
    folder = tmp_path / 'empty'
    folder.mkdir()
    state = preflight(folder)
    assert state['ok'] is False
    assert 'no master.mp4' in state['problems'][0]


def test_a_page_bound_to_another_master_is_refused(tmp_path):
    folder = _folder(tmp_path)
    page = folder / 'review.html'
    page.write_text(page.read_text().replace(file_hash(folder / 'master.mp4'), '0' * 64))
    state = preflight(folder)
    assert state['ok'] is False
    assert any('belongs to another master' in problem for problem in state['problems'])
    assert any('rebuilt' in repair for repair in state['repairs'])


def test_a_master_that_changed_since_the_report_is_refused(tmp_path):
    folder = _folder(tmp_path)
    (folder / 'master.mp4').write_bytes(b'another take')
    state = preflight(folder)
    assert state['ok'] is False
    assert any('another master' in problem for problem in state['problems'])


def test_a_master_with_a_failing_check_is_refused(tmp_path):
    folder = _folder(tmp_path, with_page=False)
    report = json.loads((folder / 'technical-report.json').read_text())
    report['checks']['loudness'] = False
    (folder / 'technical-report.json').write_text(json.dumps(report))
    state = preflight(folder)
    assert state['ok'] is False
    assert any('failing technical checks' in problem for problem in state['problems'])


def test_a_speech_the_page_offers_but_the_folder_lacks_is_refused(tmp_path):
    folder = _folder(tmp_path)
    (folder / 'V03-raw.wav').unlink()
    state = preflight(folder)
    assert state['ok'] is False
    assert any('V03-raw.wav' in problem for problem in state['problems'])


def test_a_missing_page_is_refused_and_can_be_rebuilt(tmp_path):
    folder = _folder(tmp_path, with_page=False)
    state = preflight(folder)
    assert state['ok'] is False
    assert any('no review.html' in problem for problem in state['problems'])
    build_review(folder)
    assert preflight(folder)['ok'] is True


def test_a_busy_port_is_avoided_instead_of_failing():
    with socket.socket() as taken:
        taken.bind(('127.0.0.1', 0))
        taken.listen(1)
        busy = taken.getsockname()[1]
        chosen = free_port(busy)
        assert chosen != busy
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', chosen))  # the chosen port is really free


def test_the_server_serves_the_folder_and_not_the_working_directory(tmp_path):
    """The film has to be reachable, or the review cannot happen."""
    import http.server
    import threading
    import urllib.request

    folder = _folder(tmp_path)
    port = free_port(0)
    with http.server.ThreadingHTTPServer(('127.0.0.1', port), handler_for(folder)) as httpd:
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        try:
            bodies = {}
            for name in ('review.html', 'master.mp4', 'technical-report.json'):
                body = _fetch(port, name)
                assert body, f'{name} was served empty'
                bodies[name] = body
        finally:
            httpd.shutdown()
    assert 'const masterHash=' in bodies['review.html'].decode()


def _fetch(port: int, name: str, attempts: int = 40) -> bytes:
    """Fetch a file, waiting for the server to accept connections."""
    import urllib.error
    import urllib.request

    for _ in range(attempts):
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/{name}') as response:
                assert response.status == 200, f'{name} was not served'
                return response.read()
        except urllib.error.URLError:
            time.sleep(0.05)
    raise AssertionError(f'{name} was never served')