#!/usr/bin/env python3
"""Verify a packaged desktop upgrades stale source with an unchanged lock.

Uses a disposable data directory and the already validated managed Python env;
never loads models or changes the user's projects. Supports AppImage without FUSE.
"""
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT=Path(__file__).resolve().parents[1]
BINARY=Path(sys.argv[1]).resolve()
managed=Path.home()/'.local/share/studio.cue.desktop/runtime'
with tempfile.TemporaryDirectory(prefix='source-upgrade-',dir=ROOT/'app/.cache') as temp:
    data=Path(temp)
    (data/'runtime/app/ckpts').mkdir(parents=True)
    (data/'runtime/env').symlink_to(managed/'env',target_is_directory=True)
    (data/'runtime/runtime-ready.json').write_bytes((managed/'runtime-ready.json').read_bytes())
    (data/'runtime/app/desktop_worker.py').write_text('# stale source, must be replaced before boot')
    (data/'runtime/app/ckpts/user.gguf').write_text('preserve user weights')
    (data/'config').mkdir()
    (data/'config/wgp_config.json').write_text(json.dumps({'upgrade_test_sentinel':'preserve settings','save_path':str(data/'outputs'),'services':{'projects_root_path':str(data/'projects')}}))
    (data/'last-folder.json').write_text(json.dumps(str(data)))
    env={**os.environ,'CUE_DESKTOP_DATA_DIR':str(data),'APPIMAGE_EXTRACT_AND_RUN':'1'}
    env.pop('CUE_DESKTOP_RUNTIME_ROOT',None);env.pop('CUE_DESKTOP_PYTHON',None)
    with (data/'host.log').open('w') as log:
        app=subprocess.Popen([str(BINARY)],env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
        worker_pid=None
        try:
            for _ in range(90):
                if app.poll() is not None:raise RuntimeError('Desktop exited: '+(data/'host.log').read_text()[-1200:])
                for ready in data.glob('worker-*.json'):
                    r=json.loads(ready.read_text());worker_pid=r['pid']
                    try:
                        token=dict(x.split(b'=',1) for x in (Path('/proc')/str(worker_pid)/'environ').read_bytes().split(b'\0') if b'=' in x)[b'CUE_DESKTOP_TOKEN'].decode()
                        req=urllib.request.Request(f"http://127.0.0.1:{r['port']}/__desktop/status",headers={'x-cue-desktop-token':token})
                        with urllib.request.urlopen(req,timeout=3) as response:assert response.status==200
                        break
                    except OSError:continue
                else:time.sleep(1);continue
                break
            else:raise RuntimeError('Updated desktop did not become ready: '+(data/'host.log').read_text()[-1200:])
            expected=hashlib.sha256((ROOT/'ui/src-tauri/runtime/app/runtime-code-manifest.json').read_bytes()).hexdigest()
            assert (data/'runtime/app/.runtime-code-revision').read_text().strip()==expected
            assert (data/'runtime/app/desktop_worker.py').read_bytes()==(ROOT/'app/desktop_worker.py').read_bytes()
            assert (data/'runtime/app/ckpts/user.gguf').read_text()=='preserve user weights'
            assert json.loads((data/'config/wgp_config.json').read_text())['upgrade_test_sentinel']=='preserve settings'
            assert json.loads((data/'last-folder.json').read_text())==str(data)
            print(json.dumps({'status':'passed','binary':str(BINARY),'source_revision':expected,'http_ready':True,'old_worker_replaced':True,'weights_settings_history_preserved':True}))
        finally:
            try:os.killpg(app.pid,signal.SIGTERM)
            except ProcessLookupError:pass
            try:app.wait(timeout=15)
            except subprocess.TimeoutExpired:os.killpg(app.pid,signal.SIGKILL);app.wait()
