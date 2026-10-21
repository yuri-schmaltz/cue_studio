#!/usr/bin/env python3
"""Serve a validation folder for the human review, after checking it.

The review page is useless if the film does not load, and the review the
reviewer produces is useless if the page belongs to another master. Both
failures cost the reviewer the whole film before anyone notices, so this
script checks the folder before it opens the door:

* the master exists and the technical report still describes it;
* the review page is bound to that master, and is rebuilt when it is not;
* every file the page offers actually exists.

Only then does it serve the folder and print the address.
"""
from __future__ import annotations

import argparse
import http.server
import json
import os
import re
import socket
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app.services.reference_acceptance import file_hash
from scripts.build_reference_review import build_review

MASTER_HASH_PATTERN = re.compile(r'const masterHash=("(?:[^"\\]|\\.)*")')


def preflight(folder: Path) -> dict:
    """Check that the folder can serve a review the gate will accept.

    Returns the problems found and what can be done about each one.
    Nothing here touches the network and nothing here is guessed: every
    statement is a comparison between two files on disk.
    """
    folder = Path(folder).resolve()
    problems: list[str] = []
    repairs: list[str] = []
    rebuildable = False
    master = folder / 'master.mp4'
    if not master.is_file():
        return {'folder': str(folder), 'ok': False,
                'problems': ['there is no master.mp4 in this folder'],
                'repairs': [], 'rebuildable': False, 'master_sha256': None}

    digest = file_hash(master)
    report_path = folder / 'technical-report.json'
    if not report_path.is_file():
        problems.append('there is no technical-report.json to check the master against')
    else:
        report = json.loads(report_path.read_text())
        if report.get('master_sha256') != digest:
            problems.append('the technical report describes another master than the file on disk')
        elif not report.get('checks') or not all(report['checks'].values()):
            failed = [name for name, ok in (report.get('checks') or {}).items() if not ok]
            problems.append('the master has failing technical checks: ' + ', '.join(failed))
        else:
            repairs.append('the master is technically validated')

    page = folder / 'review.html'
    if not page.is_file():
        problems.append('there is no review.html to serve')
        repairs.append('the review page can be built from the validated master')
        rebuildable = True
    else:
        source = page.read_text()
        embedded = MASTER_HASH_PATTERN.search(source)
        if not embedded:
            problems.append('the review page lost its master binding')
            rebuildable = True
        elif json.loads(embedded.group(1)) != digest:
            problems.append('the review page belongs to another master')
            repairs.append('the review page can be rebuilt for the master on disk')
            rebuildable = True
        else:
            repairs.append('the review page is bound to this master')
        for offered in re.findall(r'<audio[^>]*src="([^"]+)"', source):
            if not (folder / offered).is_file():
                problems.append(f'the page offers {offered}, which does not exist')

    return {'folder': str(folder), 'ok': not problems, 'problems': problems,
            'repairs': repairs, 'rebuildable': rebuildable, 'master_sha256': digest}


def free_port(preferred: int) -> int:
    """The preferred port when it is free, otherwise one that is.

    Port zero means "any free port", and it never means the port zero:
    binding to zero always succeeds and hands back an ephemeral port, so
    the zero case has to go through the search.
    """
    if preferred:
        with socket.socket() as probe:
            try:
                probe.bind(('127.0.0.1', preferred))
                return preferred
            except OSError:
                pass
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        return probe.getsockname()[1]


def handler_for(folder: Path):
    """A request handler that serves the given folder.

    Two things are not what they look like:

    * SimpleHTTPRequestHandler ignores a class attribute called
      ``directory`` and serves the working directory instead, so the
      directory has to be passed to the constructor;
    * it does not answer range requests. Chrome refuses to play the
      audio track of a media file served without range support, and the
      reviewer would score the sound of a silent film. Range is
      answered here with 206 Partial Content.
    """
    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(folder), **kwargs)

        def send_head(self):
            requested = self.headers.get('Range')
            if not requested or not requested.startswith('bytes='):
                return super().send_head()
            path = self.translate_path(self.path)
            if os.path.isdir(path) or not os.path.isfile(path):
                return super().send_head()
            size = os.path.getsize(path)
            span = requested[len('bytes='):].split(',')[0].strip()
            try:
                if span.startswith('-'):
                    length = int(span[1:])
                    start = max(0, size - length)
                    end = size - 1
                else:
                    first, _, last = span.partition('-')
                    start = int(first)
                    end = int(last) if last else size - 1
            except ValueError:
                return super().send_head()
            if start >= size or start > end:
                self.send_response(416)
                self.send_header('Content-Range', f'bytes */{size}')
                self.end_headers()
                return None
            end = min(end, size - 1)
            self.send_response(206)
            self.send_header('Content-type', self.guess_type(path))
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
            self.send_header('Content-Length', str(end - start + 1))
            self.end_headers()
            file = open(path, 'rb')
            file.seek(start)
            return _LimitedReader(file, end - start + 1)

    return Handler


class _LimitedReader:
    """The file object the copyfile expects, limited to the range."""

    def __init__(self, file, remaining: int):
        self._file = file
        self._remaining = remaining

    def read(self, amount=-1):
        if self._remaining <= 0:
            return b''
        if amount is None or amount < 0:
            amount = self._remaining
        chunk = self._file.read(min(amount, self._remaining))
        self._remaining -= len(chunk)
        return chunk

    def close(self):
        self._file.close()


def serve(folder: Path, port: int) -> None:
    with http.server.ThreadingHTTPServer(('127.0.0.1', port), handler_for(folder)) as httpd:
        print(f'review served at http://127.0.0.1:{port}/review.html', flush=True)
        print('press Ctrl-C to stop', flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\nstopped', flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('validation_dir', type=Path)
    parser.add_argument('--port', type=int, default=8901)
    parser.add_argument('--check', action='store_true',
                        help='report the state of the folder and exit, without serving')
    parser.add_argument('--no-rebuild', action='store_true',
                        help='do not rebuild a missing or stale review page')
    args = parser.parse_args()
    folder = args.validation_dir.resolve()
    state = preflight(folder)
    if state['problems'] and not args.check:
        # A missing or stale page can be rebuilt from the validated
        # master, and that rebuild is the whole point of the check.
        if state['rebuildable'] and not args.no_rebuild:
            try:
                build_review(folder)
            except ValueError as error:
                print(f'cannot build the review page: {error}', file=sys.stderr)
                return 1
            state = preflight(folder)
    if args.check:
        print(json.dumps(state, indent=2))
        return 0 if state['ok'] else 1
    if not state['ok']:
        for problem in state['problems']:
            print(f'problem: {problem}', file=sys.stderr)
        return 1
    for repair in state['repairs']:
        print(f'ok: {repair}', file=sys.stderr)
    port = free_port(args.port)
    if port != args.port:
        print(f'port {args.port} is busy, serving on {port} instead', file=sys.stderr)
    serve(folder, port)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
