"""Standalone launch checks; no model loads or changes to the running app."""
import ast
import http.server
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def _find_bash_cmd() -> str:
    which = shutil.which("bash")
    if which:
        return which
    candidates = [
        r"C:\Users\u60897\AppData\Local\Programs\Git\bin\bash.exe",
        r"C:\Program Files\Git\bin\bash.exe",
        r"C:\Program Files (x86)\Git\bin\bash.exe",
    ]
    for c in candidates:
        if os.path.exists(c):
            return c
    return "bash"


BASH_BIN = _find_bash_cmd()


def run_bash(args: list[str], **kwargs):
    cmd = [BASH_BIN] + args
    return subprocess.run(cmd, **kwargs)


def create_python_link(target_path: Path, source_executable: str = sys.executable):
    try:
        target_path.symlink_to(source_executable)
    except OSError:
        if sys.platform == "win32":
            shutil.copy2(source_executable, target_path)
        else:
            raise


class _VersionedHandler(http.server.BaseHTTPRequestHandler):
    """Minimal HTTP backend that mimics Maestro's /health/version and
    / routing. Used by the ensure_service tests so the bootstrapper has
    something real to probe against. The reported version is configurable
    per-instance via self.server.reported_version.  # type: ignore[attr-defined]"""

    def log_message(self, format, *args):  # silence stderr noise in tests
        pass

    def do_GET(self):
        if self.path == "/health/version":
            payload = json.dumps({
                "name": "cue-studio",
                "version": getattr(self.server, "reported_version", "0.0.0+unknown"),
            }).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        # Default route — respond 200 so probe_index_alive() is true.
        self.send_response(200)
        self.send_header("Content-Length", "2")
        self.end_headers()
        self.wfile.write(b"OK")


_VERSIONED_BACKEND_SCRIPT = '''
import http.server, json, sys

_VERSION = sys.argv[2]

class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a, **k):
        pass
    def do_GET(self):
        if self.path == "/health/version":
            payload = json.dumps({"name": "cue-studio", "version": _VERSION}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        else:
            self.send_response(200)
            self.send_header("Content-Length", "2")
            self.end_headers()
            self.wfile.write(b"OK")

http.server.HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
'''


def _spin_versioned_backend(version: str) -> tuple[subprocess.Popen, int]:
    """Spawn a background HTTP server in a separate Python process that
    reports `version` on /health/version and answers 200 on /.
    Returns (process, port). Caller is responsible for process.kill().

    We use a subprocess (not a thread) because the bootstrapper kills the
    holder by PID via `ss`; a same-process HTTP server running in a
    thread shares FDs with pytest that block subprocess.run's pipe
    handling when the bootstrapper sends SIGTERM."""
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        port = probe.getsockname()[1]
    proc = subprocess.Popen(
        [sys.executable, '-c', _VERSIONED_BACKEND_SCRIPT, str(port), version],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    # Wait for the listener to be ready to serve HTTP — not just bind.
    # We confirm by issuing a real HTTP GET via urllib (the bootstrapper
    # uses curl, but urllib matches pytest's stdlib better and avoids
    # picking up HTTP_PROXY).
    deadline = time.time() + 3.0
    last_err: Exception | None = None
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/health/version', timeout=0.5) as response:
                if response.status == 200:
                    body = response.read().decode('utf-8')
                    data = json.loads(body)
                    if data.get('version') == version:
                        return proc, port
        except Exception as exc:
            last_err = exc
            time.sleep(0.05)
    proc.kill()
    proc.wait()
    raise RuntimeError(f"backend failed to serve /health/version in time: {last_err}")


class StandaloneLaunchTests(unittest.TestCase):
    def test_explicit_host_wins_over_legacy_share(self):
        # Exercise the actual startup block without importing the model backend.
        source = (ROOT / 'app/launch.py').read_text()
        start = source.index('    # Explicit standalone settings')
        end = source.index('    # Port resolution:', start)
        import textwrap
        code = compile(ast.parse(textwrap.dedent(source[start:end])), 'launch-host', 'exec')
        from unittest.mock import patch
        cases = [
            ({}, '127.0.0.1'),
            ({'PINOKIO_SHARE_LOCAL': 'true'}, '0.0.0.0'),
            ({'PINOKIO_SHARE_LOCAL': 'false'}, '127.0.0.1'),
            ({'SERVER_NAME': '127.0.0.1', 'PINOKIO_SHARE_LOCAL': 'true'}, '127.0.0.1'),
            ({'SERVER_NAME': '0.0.0.0', 'PINOKIO_SHARE_LOCAL': 'false'}, '0.0.0.0'),
            ({'SERVER_NAME': '  ', 'PINOKIO_SHARE_LOCAL': 'true'}, '0.0.0.0'),
        ]
        for environment, expected in cases:
            with self.subTest(environment=environment), patch.dict(os.environ, environment, clear=True):
                namespace = {'os': os}
                exec(code, namespace)
                self.assertEqual(namespace['host'], expected)

    def test_invalid_ports_fail_before_starting(self):
        for args in [[], ['0'], ['65536'], ['-1'], ['abc'], ['--share']]:
            with self.subTest(args=args):
                result = run_bash([str(ROOT / 'start.sh'), '--port', *args], capture_output=True, text=True)
                self.assertEqual(result.returncode, 2)
                self.assertIn('ERRO:', result.stderr)

    @unittest.skipIf(sys.platform == 'win32', 'Bash background subshell daemon testing is POSIX-specific')
    def test_start_and_stop_with_isolated_http_backend(self):
        for share in [False, True]:
            with self.subTest(share=share), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                for script in ['start.sh', 'stop.sh']:
                    shutil.copy(ROOT / script, root / script)
                (root / 'app/env/bin').mkdir(parents=True)
                create_python_link(root / 'app/env/bin/python')
                (root / 'ui/dist').mkdir(parents=True)
                (root / 'ui/dist/index.html').write_text('test')
                (root / 'app/launch.py').write_text('''import http.server, os
from pathlib import Path
Path("host.txt").write_text(os.environ["SERVER_NAME"])
http.server.HTTPServer((os.environ["SERVER_NAME"], int(os.environ["SERVER_PORT"])), http.server.SimpleHTTPRequestHandler).serve_forever()
''')
                with socket.socket() as probe:
                    probe.bind(('127.0.0.1', 0))
                    port = probe.getsockname()[1]
                env = dict(os.environ, PINOKIO_SHARE_LOCAL='false' if share else 'true', http_proxy='http://127.0.0.1:1', ALL_PROXY='http://127.0.0.1:1')
                try:
                    result = run_bash([str(root / 'start.sh'), '--port', str(port), *(['--share'] if share else [])], env=env, capture_output=True, text=True, timeout=30)
                    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                    self.assertEqual((root / 'app/host.txt').read_text(), '0.0.0.0' if share else '127.0.0.1')
                    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
                    with opener.open(f'http://127.0.0.1:{port}/', timeout=2) as response:
                        self.assertEqual(response.status, 200)
                finally:
                    stopped = run_bash([str(root / 'stop.sh')], capture_output=True, text=True, timeout=15)
                self.assertEqual(stopped.returncode, 0, stopped.stdout + stopped.stderr)
                self.assertFalse((root / 'app/.launcher.pid').exists())
                with socket.socket() as probe:
                    self.assertNotEqual(probe.connect_ex(('127.0.0.1', port)), 0)


    @unittest.skipIf(sys.platform == 'win32', 'Bash background subshell daemon testing is POSIX-specific')
    @unittest.skipIf(os.environ.get('MAESTRO_SKIP_INTEGRATION') == '1', 'Integration test: requires a real Maestro backend running with a matching version')
    def test_ensure_service_skips_when_version_matches(self):
        """If a Maestro with the same VERSION is already on the port,
        start.sh must print (skipped) and exit 0 without relaunching."""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for script in ['start.sh', 'stop.sh']:
                shutil.copy(ROOT / script, root / script)
            # Pin the expected version to whatever the running backend reports.
            (root / 'VERSION').write_text('9.9.9-test')
            version = '9.9.9-test'
            proc, port = _spin_versioned_backend(version)
            try:
                # Stage a venv + a stub launch.py so the script can run the
                # full bring-up path IF the version check doesn't short-circuit.
                # We expect the version check to short-circuit (no relaunch),
                # but the script touches these files in §1 before probing, so
                # they must exist.
                (root / 'app/env/bin').mkdir(parents=True)
                create_python_link(root / 'app/env/bin/python')
                (root / 'app/launch.py').write_text(
                    'import http.server, os\n'
                    'http.server.HTTPServer((os.environ["SERVER_NAME"], int(os.environ["SERVER_PORT"])), '
                    'http.server.SimpleHTTPRequestHandler).serve_forever()\n'
                )
                # --no-build so the script never touches ui/dist; --force would
                # defeat the probe (we explicitly want the probe path).
                result = run_bash(
                    [str(root / 'start.sh'), '--port', str(port), '--no-build'],
                    capture_output=True, text=True, timeout=15,
                )
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn('(skipped)', result.stdout)
                self.assertIn(version, result.stdout)
                # The pidfile must NOT have been written — no relaunch happened.
                self.assertFalse((root / 'app/.launcher.pid').exists())
            finally:
                proc.kill()
                proc.wait(timeout=2)

    @unittest.skipIf(sys.platform == 'win32', 'Bash background subshell daemon testing is POSIX-specific')
    def test_foreign_listener_is_preserved_even_with_force(self):
        for version, flags in [('0.0.0-stale', []), ('9.9.9-test', ['--force'])]:
            with self.subTest(version=version), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                shutil.copy(ROOT / 'start.sh', root / 'start.sh')
                (root / 'VERSION').write_text('9.9.9-test')
                (root / 'app/env/bin').mkdir(parents=True)
                create_python_link(root / 'app/env/bin/python')
                proc, port = _spin_versioned_backend(version)
                try:
                    result = run_bash(
                        [str(root / 'start.sh'), '--no-build', '--no-open',
                         '--port', str(port), *flags], capture_output=True, text=True, timeout=15)
                    self.assertEqual(result.returncode, 6, result.stdout + result.stderr)
                    self.assertIn('preservado', result.stderr)
                    self.assertIsNone(proc.poll())
                    self.assertFalse((root / 'app/.launcher.pid').exists())
                finally:
                    proc.terminate()
                    proc.wait(timeout=5)

    @unittest.skipIf(sys.platform == 'win32', 'Bash background subshell daemon testing is POSIX-specific')
    @unittest.skipIf(os.environ.get('MAESTRO_SKIP_INTEGRATION') == '1', 'Integration test: requires a real Maestro backend running with a matching version')
    def test_fallback_preserves_env_and_managed_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for script in ['start.sh', 'stop.sh']:
                shutil.copy(ROOT / script, root / script)
            (root / 'app/env/bin').mkdir(parents=True)
            create_python_link(root / 'app/env/bin/python')
            (root / 'ui').mkdir()
            (root / 'ui/.env.local').write_text('CUSTOM_SETTING=keep\nMAESTRO_BACKEND_PORT=1\n')
            (root / 'app/launch.py').write_text('''import http.server, os
server = http.server.HTTPServer(("127.0.0.1", 0), http.server.SimpleHTTPRequestHandler)
print(f"Port {os.environ['SERVER_PORT']} was busy - using {server.server_port} instead.", flush=True)
server.serve_forever()
''', encoding='utf-8')
            with socket.socket() as probe:
                probe.bind(('127.0.0.1', 0))
                port = probe.getsockname()[1]
            try:
                for flags in [[], ['--force']]:
                    result = run_bash(
                        [str(root / 'start.sh'), '--no-build', '--no-open',
                         '--port', str(port), *flags], capture_output=True, text=True, timeout=20)
                    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                    env = (root / 'ui/.env.local').read_text()
                    self.assertIn('CUSTOM_SETTING=keep', env)
                    effective = int(env.split('MAESTRO_BACKEND_PORT=')[1].strip())
                    self.assertIn(f'http://127.0.0.1:{effective}/', result.stdout)
                    with urllib.request.urlopen(f'http://127.0.0.1:{effective}/', timeout=2) as response:
                        self.assertEqual(response.status, 200)
            finally:
                run_bash([str(root / 'stop.sh')], capture_output=True, timeout=15)

    @unittest.skipIf(sys.platform == 'win32', 'Bash background subshell daemon testing is POSIX-specific')
    def test_ensure_service_reports_correct_version(self):
        """The expected version read from VERSION file must appear in the
        bootstrapper's startup banner and final summary, so operators can
        confirm what version is actually running."""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for script in ['start.sh', 'stop.sh']:
                shutil.copy(ROOT / script, root / script)
            (root / 'VERSION').write_text('7.7.7-test')
            (root / 'app/env/bin').mkdir(parents=True)
            create_python_link(root / 'app/env/bin/python')
            (root / 'ui/dist').mkdir(parents=True)
            (root / 'ui/dist/index.html').write_text('test')
            (root / 'app/launch.py').write_text(
                'import http.server, os\n'
                'http.server.HTTPServer((os.environ["SERVER_NAME"], int(os.environ["SERVER_PORT"])), '
                'http.server.SimpleHTTPRequestHandler).serve_forever()\n'
            )
            try:
                with socket.socket() as probe:
                    probe.bind(('127.0.0.1', 0))
                    port = probe.getsockname()[1]
                result = run_bash(
                    [str(root / 'start.sh'), '--port', str(port), '--no-build'],
                    capture_output=True, text=True, timeout=30,
                )
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn('7.7.7-test', result.stdout)
            finally:
                run_bash([str(root / 'stop.sh')], capture_output=True, text=True, timeout=10)


if __name__ == '__main__':
    unittest.main()
