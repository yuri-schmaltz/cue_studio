"""Private desktop worker: Rust owns its process, port and authentication.

The HTTP interface stays same-origin, including media, uploads and streams.
Nothing here installs dependencies or loads a model on behalf of the user.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import secrets
import socket
import signal
import threading
import time
import sys


class DesktopSessionMiddleware:
    """One process-scoped secret; bootstrap exchanges it for an HttpOnly cookie."""

    def __init__(self, app, *, token: str, port: int, instance: str):
        self.app = app
        self.token = token
        self.cookie_name = f"cue_desktop_{port}"
        self.instance = instance
        self.port = port

    async def __call__(self, scope, receive, send):
        from starlette.requests import Request
        from starlette.responses import JSONResponse, HTMLResponse

        if scope['type'] not in {'http', 'websocket'}:
            return await self.app(scope, receive, send)
        if scope['type'] == 'websocket':
            # Existing application streams use HTTP. Do not silently grant a
            # new unauthenticated WebSocket transport.
            await send({'type': 'websocket.close', 'code': 1008})
            return
        request = Request(scope)
        supplied = request.headers.get('x-cue-desktop-token', '')
        cookie = request.cookies.get(self.cookie_name, '')
        path = request.url.path
        bootstrap = path.removeprefix('/__desktop/bootstrap/') if path.startswith('/__desktop/bootstrap/') else ''
        origin = request.headers.get('origin')
        allowed_origin = f'http://127.0.0.1:{self.port}'
        if origin and origin != allowed_origin:
            return await JSONResponse({'error': 'Desktop origin rejected'}, status_code=403)(scope, receive, send)
        if request.method == 'GET' and bootstrap and secrets.compare_digest(bootstrap, self.token):
            # Commit a document on the HTTP origin before setting a Strict
            # cookie. WebKit rejects it in the initial cross-site redirect
            # from Tauri's custom protocol. The second document is same-site.
            authorize = request.query_params.get('stage') == 'authorize'
            target = '/' if authorize else '?stage=authorize'
            response = HTMLResponse('<!doctype html><html><head><meta name="referrer" content="no-referrer">'
                                    f'<meta http-equiv="refresh" content="0;url={target}"></head>'
                                    '<body>Opening Cue Studio…</body></html>')
            if authorize:
                response.set_cookie(self.cookie_name, self.token, httponly=True, samesite='strict', path='/')
            response.headers['Cache-Control'] = 'no-store'
            response.headers['Referrer-Policy'] = 'no-referrer'
            return await response(scope, receive, send)
        authorized = (supplied and secrets.compare_digest(supplied, self.token)) or (cookie and secrets.compare_digest(cookie, self.token))
        if not authorized:
            return await JSONResponse({'error': 'Private desktop session required'}, status_code=401)(scope, receive, send)
        if path == '/__desktop/status':
            return await JSONResponse({'instance': self.instance, 'pid': os.getpid()})(scope, receive, send)
        return await self.app(scope, receive, send)


def _watch_parent(parent_pid: int):
    """On Unix, reap this worker group if the native host crashes or is killed."""
    while os.getppid() == parent_pid:
        time.sleep(0.5)
    if os.name == 'posix' and os.getpgrp() == os.getpid():
        os.killpg(os.getpgrp(), signal.SIGTERM)
        time.sleep(3)
        os.killpg(os.getpgrp(), signal.SIGKILL)
    else:
        os.kill(os.getpid(), signal.SIGTERM)


def main():
    token = os.environ.get('CUE_DESKTOP_TOKEN', '')
    instance = os.environ.get('CUE_DESKTOP_INSTANCE', '')
    if len(token) < 32 or not instance:
        raise SystemExit('Desktop worker requires a private session from the Rust supervisor')
    parent = int(os.environ.get('CUE_DESKTOP_PARENT_PID', '0'))
    if os.name == 'posix' and parent:
        threading.Thread(target=_watch_parent, args=(parent,), daemon=True).start()
    data = Path(os.environ['CUE_DESKTOP_DATA']).resolve()
    ready = Path(os.environ['CUE_DESKTOP_READY']).resolve()
    data.mkdir(parents=True, exist_ok=True)
    for name in ('config', 'cache', 'outputs', 'projects', 'models', 'loras'):
        (data / name).mkdir(exist_ok=True)
    os.environ['CUE_CONFIG_DIR'] = str(data / 'config')
    os.environ['APP_CACHE_DIR'] = str(data / 'cache')
    os.environ['APP_SQLITE_PATH'] = str(data / 'app_state.sqlite3')
    # Create defaults only on the first launch; never replace user settings.
    config = data / 'config' / 'wgp_config.json'
    if not config.exists():
        with config.open('x') as handle:
            json.dump({'save_path': str(data / 'outputs'), 'image_save_path': str(data / 'outputs'),
                       'audio_save_path': str(data / 'outputs'), 'projects_root_path': str(data / 'projects'),
                       'checkpoints_paths': [str(data / 'models')], 'loras_root': str(data / 'loras')}, handle)
    # Bind before importing the large runtime. No close/rebind race and no
    # attachment to a pre-existing web instance on a guessed port.
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
        sys.argv = [str(Path(__file__).with_name('launch.py'))]
        import launch
        import uvicorn
        app = DesktopSessionMiddleware(launch.api, token=token, port=port, instance=instance)
        ready.parent.mkdir(parents=True, exist_ok=True)
        tmp = ready.with_suffix('.tmp')
        with tmp.open('w') as handle:
            json.dump({'port': port, 'pid': os.getpid(), 'instance': instance}, handle)
        tmp.replace(ready)
        # Access logs would contain the bootstrap secret. Diagnostic runtime
        # logs remain available in the private application data directory.
        server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=port, access_log=False))
        server.run(sockets=[sock])


if __name__ == '__main__':
    main()
