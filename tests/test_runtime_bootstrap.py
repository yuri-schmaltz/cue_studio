import hashlib
import json
from pathlib import Path
import subprocess
import sys
import os
import signal
import time
import pytest

SCRIPT = Path(__file__).resolve().parents[1] / 'app/runtime_bootstrap.py'


def test_manifest_tampering_is_rejected_before_environment_creation(tmp_path):
    app = tmp_path / 'package'
    app.mkdir()
    (app / 'requirements.txt').write_text('some-dependency==1\n')
    (app / 'runtime_manifest.json').write_text(json.dumps({'requirementsSha256': '0' * 64}))
    target = tmp_path / 'runtime'
    result = subprocess.run([sys.executable, str(SCRIPT), '--app-dir', str(app), '--runtime-dir', str(target)], capture_output=True, text=True)
    assert result.returncode != 0
    assert 'checksum' in result.stderr
    assert not target.exists()


def test_check_validates_lock_content_without_installing(tmp_path):
    (tmp_path / 'requirements.txt').write_bytes(b'')
    (tmp_path / 'lock.txt').write_bytes(b'different')
    manifest = {'runtimeVersion': 'test', 'requirementsSha256': hashlib.sha256(b'').hexdigest(),
                'locks': {'E0': {'path': 'lock.txt', 'sha256': hashlib.sha256(b'expected').hexdigest()}}}
    (tmp_path / 'runtime_manifest.json').write_text(json.dumps(manifest))
    result = subprocess.run([sys.executable, str(SCRIPT), '--app-dir', str(tmp_path), '--runtime-dir', str(tmp_path / 'env'), '--check'], capture_output=True, text=True)
    assert result.returncode != 0
    assert 'lock checksum' in result.stderr
    assert not (tmp_path / 'env').exists()


@pytest.mark.skipif(sys.platform != 'linux', reason='Linux installer process group lifecycle')
def test_installer_stops_its_child_when_native_parent_exits(tmp_path):
    app, runtime = tmp_path / 'package', tmp_path / 'runtime'
    (app / 'runtime_tools').mkdir(parents=True)
    (runtime / 'installer/bin').mkdir(parents=True)
    empty_hash = hashlib.sha256(b'').hexdigest()
    (app / 'requirements.txt').write_bytes(b'')
    (app / 'lock.txt').write_bytes(b'')
    (app / 'runtime_manifest.json').write_text(json.dumps({'requirementsSha256': empty_hash,
        'locks': {'E0': {'path': 'lock.txt', 'sha256': empty_hash}}}))
    (app / 'runtime_tools/build_decord_wheel.py').write_text('')
    uv = runtime / 'installer/bin/uv'
    uv.write_text(f'#!{sys.executable}\nimport os,time\nfrom pathlib import Path\nPath(__file__).with_suffix(".pid").write_text(str(os.getpid()))\ntime.sleep(60)\n')
    uv.chmod(0o700)
    parent_code = '''import subprocess,os,sys,time
env={**os.environ, 'CUE_DESKTOP_PARENT_PID':str(os.getpid())}
child=subprocess.Popen(sys.argv[1:],env=env,start_new_session=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
print(child.pid,flush=True)
time.sleep(60)
'''
    parent = subprocess.Popen([sys.executable, '-c', parent_code, sys.executable, str(SCRIPT),
        '--app-dir', str(app), '--runtime-dir', str(runtime), '--profile', 'E0'], stdout=subprocess.PIPE, text=True)
    installer_pid = int(parent.stdout.readline())
    def running(pid):
        stat = Path(f'/proc/{pid}/stat')
        return stat.exists() and stat.read_text().split()[2] != 'Z'
    try:
        deadline = time.monotonic() + 10
        while not uv.with_suffix('.pid').is_file() and time.monotonic() < deadline:
            time.sleep(.05)
        child_pid = int(uv.with_suffix('.pid').read_text())
        parent.terminate()
        parent.wait(timeout=5)
        deadline = time.monotonic() + 5
        while (running(installer_pid) or running(child_pid)) and time.monotonic() < deadline:
            time.sleep(.05)
        assert not running(installer_pid)
        assert not running(child_pid)
        assert not (runtime / 'runtime-ready.json').exists()
    finally:
        if parent.poll() is None:
            parent.terminate()
            parent.wait(timeout=5)
        if running(installer_pid):
            os.killpg(installer_pid, signal.SIGKILL)
