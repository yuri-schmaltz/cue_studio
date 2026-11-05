#!/usr/bin/env python3
"""Run a no-inference smoke test against the packaged Tauri desktop binary.

Requires tauri-driver and WebKitWebDriver on Linux. It creates its own data
directory, never touches the user's backend, and removes its WebDriver session
before returning.
"""
from __future__ import annotations

import json
import os
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BINARY = Path(os.environ.get("CUE_DESKTOP_BINARY", ROOT / "ui/src-tauri/target/debug/cue-studio-desktop"))
DRIVER = Path(os.environ.get("TAURI_DRIVER", Path.home() / ".cargo/bin/tauri-driver"))
WEBKIT = Path(os.environ.get("WEBKIT_WEBDRIVER", ROOT / "app/.cache/desktop-tools/unpacked/usr/bin/WebKitWebDriver"))


def request(base: str, method: str, path: str, body: object | None = None, extra_headers: dict[str, str] | None = None) -> tuple[int, dict]:
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(base + path, data=data, method=method, headers={"Content-Type": "application/json", **(extra_headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            payload = response.read()
            return response.status, json.loads(payload or b"{}")
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read() or b"{}")


def main() -> int:
    if not BINARY.is_file() or not DRIVER.is_file() or not WEBKIT.is_file():
        raise SystemExit("build the desktop binary and provide tauri-driver/WebKitWebDriver first")
    cache = ROOT / 'app/.cache'
    cache.mkdir(parents=True, exist_ok=True)
    managed = os.environ.get('CUE_DESKTOP_MANAGED_DATA')
    data_dir = Path(managed) if managed else Path(tempfile.mkdtemp(prefix="cue-desktop-smoke-", dir=cache))
    runtime_env = {**os.environ, "CUE_DESKTOP_DATA_DIR": str(data_dir), "CUE_OFFLINE_STRICT": "1"}
    navigation_test = os.environ.get('CUE_DESKTOP_TEST_NAVIGATION') == '1'
    if navigation_test:
        data_dir.mkdir(parents=True, exist_ok=True)
        browser_log = data_dir / 'external-browser.log'
        browser_log.unlink(missing_ok=True)
        stub = data_dir / 'test-browser'
        stub.write_text('#!/usr/bin/env python3\nimport os,sys\nfrom pathlib import Path\nwith Path(os.environ["CUE_TEST_BROWSER_LOG"]).open("a") as f: f.write(sys.argv[1]+"\\n")\n')
        stub.chmod(0o700)
        runtime_env.update(BROWSER=str(stub), CUE_TEST_BROWSER_LOG=str(browser_log))
    expect_setup = os.environ.get("CUE_DESKTOP_EXPECT_SETUP") == "1"
    install_runtime = os.environ.get('CUE_DESKTOP_INSTALL') == '1'
    if not expect_setup and not managed and not install_runtime:
        runtime_env.setdefault("CUE_DESKTOP_RUNTIME_ROOT", str(ROOT))
        runtime_env.setdefault("CUE_DESKTOP_PYTHON", str(ROOT / "app/env/bin/python"))
    driver = subprocess.Popen([str(DRIVER), "--port", "4444", "--native-port", "4445", "--native-driver", str(WEBKIT)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=runtime_env)
    session = None
    worker_pid: int | None = None
    report: dict[str, object] = {"binary": str(BINARY), "dataDir": str(data_dir)}
    try:
        deadline = time.time() + 30
        while time.time() < deadline:
            try:
                code, payload = request("http://127.0.0.1:4444", "POST", "/session", {"capabilities": {"alwaysMatch": {"browserName": "wry", "tauri:options": {"application": str(BINARY)}}}})
                if code < 300:
                    session = payload["value"]["sessionId"]
                    break
            except (urllib.error.URLError, KeyError):
                pass
            time.sleep(.5)
        if not session:
            raise SystemExit("WebDriver session did not start")
        base = f"http://127.0.0.1:4444/session/{session}"
        script = lambda source: request(base, "POST", "/execute/sync", {"script": source, "args": []})[1].get("value")
        if install_runtime:
            for _ in range(60):
                if script("return !!document.querySelector('#install:not([hidden])')"):
                    script("document.querySelector('#install').click(); return true")
                    break
                time.sleep(.5)
            else:
                raise SystemExit('Runtime installation button was not available')
            deadline = time.monotonic() + 1800
            marker = data_dir / 'runtime/runtime-ready.json'
            while not marker.is_file() and time.monotonic() < deadline:
                message = script("return document.querySelector('#status')?.textContent || ''") or ''
                if 'Runtime installation failed' in message:
                    raise SystemExit(f'{message}; data directory: {data_dir}')
                time.sleep(2)
            if not marker.is_file():
                raise SystemExit(f'Runtime installation did not finish; see {data_dir}/desktop-install.log')
            report['runtimeInstalledFromUI'] = json.loads(marker.read_text())
        if expect_setup:
            for _ in range(30):
                body = script("return document.body ? document.body.innerText : ''") or ""
                if "Install AI runtime" in body:
                    report["setupScreenVisible"] = True
                    return 0
                time.sleep(.5)
            raise SystemExit("installed package did not show the runtime setup screen")
        ready_files = []
        for attempt in range(640):
            ready_files = [path for path in data_dir.glob('worker-*.json')
                           if Path(f"/proc/{json.loads(path.read_text())['pid']}").exists()]
            if ready_files:
                break
            if attempt % 10 == 0:
                message = script("return document.querySelector('#status')?.textContent || ''") or ''
                if 'AI engine exited' in message or 'startup timed out' in message:
                    raise SystemExit(message)
            time.sleep(.5)
        if not ready_files:
            raise SystemExit("desktop worker did not publish readiness")
        # A fresh profile opens Projects and shows onboarding. Navigate through
        # the real controls before asserting that the Studio is usable.
        for _ in range(90):
            if script("return !!document.querySelector('[data-testid=application-header]')"):
                break
            time.sleep(.5)
        script("for (const b of document.querySelectorAll('button')) { if (b.textContent.trim()==='Get started') b.click(); } document.querySelector('#tab-studio')?.click(); return true")
        for _ in range(60):
            body = script("return document.body ? document.body.innerText : ''") or ""
            if "Generate" in body:
                break
            time.sleep(.5)
        body = script("return document.body ? document.body.innerText : ''") or ""
        report["studioVisible"] = "Generate" in body
        report["controlsVisible"] = "Prompt" in body or "Model" in body
        if not report["studioVisible"] or not report['controlsVisible']:
            report['bodyPreview'] = body[:2000]
            raise SystemExit("desktop window did not reach the application UI")
        ready = json.loads(ready_files[-1].read_text())
        port = int(ready["port"])
        report["unauthenticatedStatus"] = request(f"http://127.0.0.1:{port}", "GET", "/api/models")[0]
        report["foreignOriginStatus"] = request(f"http://127.0.0.1:{port}", "GET", "/api/models", extra_headers={"Origin": "http://evil.invalid"})[0]
        assert report['unauthenticatedStatus'] == 401, report
        assert report['foreignOriginStatus'] == 403, report
        worker_pid = int(ready["pid"])
        report["workerPid"] = worker_pid
        if navigation_test:
            origin = script('return location.origin')
            for suffix, target in [('popup', '_blank'), ('navigation', '_self')]:
                script(f"document.querySelector('#cue-smoke-link')?.remove(); const a=document.createElement('a'); a.id='cue-smoke-link'; a.href='https://example.org/cue-desktop-{suffix}'; a.target='{target}'; a.textContent='Desktop navigation test'; a.style.cssText='position:fixed;top:0;left:0;z-index:2147483647;background:white;color:black;padding:10px'; document.body.prepend(a); return true")
                code, found = request(base, 'POST', '/element', {'using': 'css selector', 'value': '#cue-smoke-link'})
                assert code < 300, found
                element = next(iter(found['value'].values()))
                code, clicked = request(base, 'POST', f'/element/{element}/click', {})
                assert code < 300, clicked
            for _ in range(40):
                if browser_log.is_file() and len(browser_log.read_text().splitlines()) >= 2:
                    break
                time.sleep(.25)
            assert browser_log.is_file(), 'External links did not reach the browser handler'
            opened = browser_log.read_text().splitlines()
            assert set(opened) == {'https://example.org/cue-desktop-popup', 'https://example.org/cue-desktop-navigation'}, opened
            assert script('return location.origin') == origin, 'External page replaced the application'
            report['externalNavigationVerified'] = True
        if os.environ.get('CUE_DESKTOP_TEST_SINGLE_INSTANCE') == '1':
            second = subprocess.Popen([str(BINARY)], env=runtime_env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                assert second.wait(timeout=15) == 0, 'second instance failed'
                live = [path for path in data_dir.glob('worker-*.json') if Path(f"/proc/{json.loads(path.read_text())['pid']}").exists()]
                assert len(live) == 1, 'second instance started another worker'
                report['singleInstanceVerified'] = True
            finally:
                if second.poll() is None:
                    second.terminate()
        generation = os.environ.get('CUE_DESKTOP_GENERATION_JSON')
        if generation:
            def api(path, body=None):
                payload = request(base, 'POST', '/execute/async', {
                    'script': "const done=arguments[arguments.length-1]; fetch(arguments[0], arguments[1] === null ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(arguments[1])}).then(async r=>done({status:r.status,body:await r.json()})).catch(e=>done({error:String(e)}));",
                    'args': [path, body]})[1]['value']
                assert payload.get('status', 500) < 300, payload
                return payload['body']
            submitted = api('/api/v1/generate', json.loads(Path(generation).read_text()))
            job_id = submitted['job_id']
            deadline = time.monotonic() + 1800
            while time.monotonic() < deadline:
                job = api(f'/api/v1/status/{job_id}')
                if job['status'] in ('completed', 'done', 'failed', 'error', 'cancelled'):
                    break
                time.sleep(2)
            assert job['status'] in ('completed', 'done'), job
            assert job.get('output_files'), job
            report['generation'] = job
        return 0
    finally:
        if session:
            request("http://127.0.0.1:4444", "DELETE", f"/session/{session}")
        if worker_pid is not None:
            for _ in range(20):
                if not Path(f"/proc/{worker_pid}").exists():
                    break
                time.sleep(.5)
            report["workerStoppedAfterExit"] = not Path(f"/proc/{worker_pid}").exists()
            assert report['workerStoppedAfterExit'], report
        driver.terminate()
        try:
            driver.wait(timeout=5)
        except subprocess.TimeoutExpired:
            driver.kill()
        (data_dir / "report.json").write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report, indent=2))


if __name__ == "__main__":
    raise SystemExit(main())
