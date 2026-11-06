#!/usr/bin/env python3
"""Exercise the production GTK attachment handler with isolated fixture files."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
BINARY = ROOT / 'ui/src-tauri/target/debug/examples/file_dialog_smoke'


def window(title):
    for _ in range(100):
        result = subprocess.run(['xdotool', 'search', '--onlyvisible', '--name', title], capture_output=True, text=True)
        if result.returncode == 0: return result.stdout.splitlines()[-1]
        time.sleep(.1)
    raise AssertionError(f'Missing native window: {title}')


def main():
    if subprocess.run(['pgrep', '-x', 'pkexec'], stdout=subprocess.DEVNULL).returncode == 0:
        raise SystemExit('Finish pending administrator authentication before running desktop keyboard tests.')
    with tempfile.TemporaryDirectory(prefix='attachment-smoke-', dir=ROOT/'app/.cache') as tmp:
        root=Path(tmp); folder=root/'selected folder';folder.mkdir();data=root/'preferences';data.mkdir()
        for name in ['first.png','second.png']:(folder/name).write_bytes(b'fixture file, never uploaded')
        for restart in range(2):
            app=subprocess.Popen([str(BINARY),str(data)],env={**os.environ,'GTK_USE_PORTAL':'0'},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            try:
                for i,name in enumerate(['first.png','second.png'] if not restart else ['first.png']):
                    title='^Cue attachment fixture$' if i==0 else '^Selected: first.png$'
                    parent=window(title)
                    subprocess.run(['xdotool','windowactivate','--sync',parent],check=True)
                    time.sleep(.3)
                    # Focus the only visible control and activate with a real key event.
                    subprocess.run(['xdotool','key','--clearmodifiers','space'],check=True)
                    dialog=window('^Select files$')
                    subprocess.run(['xdotool','windowactivate','--sync',dialog,'key','--clearmodifiers','ctrl+l'],check=True)
                    selection=str(folder/name) if not restart and i==0 else name
                    subprocess.run(['xdotool','type','--clearmodifiers','--',selection],check=True)
                    subprocess.run(['xdotool','key','--clearmodifiers','Return'],check=True)
                    window('^Selected: '+name.replace('.','\\.')+'$')
                    assert json.loads((data/'last-folder.json').read_text()) == str(folder)
                    if not restart and i == 0:
                        # Cancel must not clear the previous successful choice.
                        subprocess.run(['xdotool','windowactivate','--sync',parent,'key','--clearmodifiers','space'],check=True)
                        cancelled = window('^Select files$')
                        subprocess.run(['xdotool','windowactivate','--sync',cancelled,'key','--clearmodifiers','Escape'],check=True)
                        time.sleep(.2)
                        assert json.loads((data/'last-folder.json').read_text()) == str(folder)
            finally:
                app.terminate();app.wait(timeout=10)
        print('PASS: file input receives selection, next selection reuses folder, cancel preserves it, restart restores folder')


if __name__=='__main__':main()
