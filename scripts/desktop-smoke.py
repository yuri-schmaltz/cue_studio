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
    data_dir = Path(tempfile.mkdtemp(prefix="cue-desktop-smoke-", dir=ROOT / "app/.cache"))
    runtime_env = {**os.environ, "CUE_DESKTOP_DATA_DIR": str(data_dir), "CUE_OFFLINE_STRICT": "1"}
    expect_setup = os.environ.get("CUE_DESKTOP_EXPECT_SETUP") == "1"
    if not expect_setup:
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
        if expect_setup:
            for _ in range(30):
                body = script("return document.body ? document.body.innerText : ''") or ""
                if "Install AI runtime" in body:
                    report["setupScreenVisible"] = True
                    return 0
                time.sleep(.5)
            raise SystemExit("installed package did not show the runtime setup screen")
        ready_files = []
        for _ in range(120):
            ready_files = list(data_dir.glob("worker-*.json"))
            if ready_files:
                break
            time.sleep(.5)
        if not ready_files:
            raise SystemExit("desktop worker did not publish readiness")
        for _ in range(60):
            body = script("return document.body ? document.body.innerText : ''") or ""
            if "Generate" in body:
                break
            time.sleep(.5)
        body = script("return document.body ? document.body.innerText : ''") or ""
        report["studioVisible"] = "Generate" in body or "Studio" in body
        report["controlsVisible"] = "Prompt" in body or "Model" in body
        if not report["studioVisible"]:
            raise SystemExit("desktop window did not reach the application UI")
        ready = json.loads(ready_files[-1].read_text())
        port = int(ready["port"])
        report["unauthenticatedStatus"] = request(f"http://127.0.0.1:{port}", "GET", "/api/models")[0]
        report["foreignOriginStatus"] = request(f"http://127.0.0.1:{port}", "GET", "/api/models", extra_headers={"Origin": "http://evil.invalid"})[0]
        worker_pid = int(ready["pid"])
        report["workerPid"] = worker_pid
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
        driver.terminate()
        try:
            driver.wait(timeout=5)
        except subprocess.TimeoutExpired:
            driver.kill()
        (data_dir / "report.json").write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report, indent=2))


if __name__ == "__main__":
    raise SystemExit(main())
