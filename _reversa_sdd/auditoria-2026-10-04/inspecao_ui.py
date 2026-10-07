"""Inspeção isolada: todas as chamadas de API usam fixtures em memória."""
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

OUT = Path(__file__).resolve().parent
sys.path.insert(0, str(OUT.parents[1]))
from app.services.editor_projects import create_editor_project
EDITOR = create_editor_project(name='Audit timeline', workspace='audit-fixture')
URL = "http://127.0.0.1:3001"
requests = []
errors = []

def api(route):
    path = urlparse(route.request.url).path
    requests.append({"path": path, "method": route.request.method})
    data = {}
    if '/editor/projects' in path:
        if route.request.method == 'GET' and path.endswith('/projects'):
            data = {'projects': [{**EDITOR, 'duration': 0, 'asset_count': 0}]}
        elif route.request.method == 'PUT':
            data = route.request.post_data_json.get('project', EDITOR)
        else:
            data = EDITOR
    elif path.endswith('/workspaces'):
        data = {"active": "audit-fixture", "workspaces": [
            {"name": "audit-fixture", "path": "fixture", "file_count": 0, "setup": {}}]}
    elif path.endswith('/setup'):
        data = {"setup": {"director_skill": "music_video", "aspect_ratio": "16:9",
                          "resolution": "720p", "music_source": "upload"}}
    elif path.endswith('/models'):
        data = {"models": [], "families": []}
    elif path.endswith('/outputs'):
        data = {"outputs": [], "total": 0}
    elif path.endswith('/pipelines'):
        data = {"pipelines": []}
    elif path.endswith('/jobs'):
        data = {"jobs": []}
    elif path.endswith('/projects'):
        data = {"projects": []}
    elif path.endswith('/productions'):
        data = {"productions": []}
    elif path.endswith('/queue'):
        data = {"entries": []}
    elif path.endswith('/active'):
        data = {"downloads": []}
    elif path.endswith('/skills'):
        data = {"skills": []}
    elif path.endswith('/system-stats'):
        data = {"cpu": {"percent": 12}, "ram": {"percent": 25, "used_gb": 8, "total_gb": 32},
                "gpu": {"available": True, "name": "Audit fixture", "percent": 0,
                        "vram_percent": 0, "vram_used_gb": 0, "vram_total_gb": 24}}
    elif '/loras/' in path:
        data = {"loras": [], "installed": []}
    elif path.endswith('/llm/status'):
        data = {"loaded": False, "provider": "local", "model_id": "", "device": "cpu"}
    elif path.endswith('/recipes'):
        data = {"recipes": []}
    elif path.endswith('/presets'):
        data = {"presets": []}
    elif path.endswith('/style-bibles'):
        data = {"bibles": []}
    route.fulfill(json=data)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 960})
    page.on("pageerror", lambda err: errors.append(str(err)))
    page.route("**/api/v1/**", api)
    page.route("**/health/**", lambda route: route.fulfill(json={"version": "2.5.2"}))
    page.add_init_script("""
      localStorage.setItem('cue-studio_welcome_seen_v1', '1');
      localStorage.setItem('maestro:director-tour', 'done');
      localStorage.setItem('cue-studio:director-tour', 'done');
    """)
    page.goto(URL, wait_until="networkidle")
    page.wait_for_timeout(700)
    rows = []
    for width, height in [(1440, 960), (390, 844)]:
        page.set_viewport_size({"width": width, "height": height})
        for name in ['Dashboard', 'Projects', 'Director', 'Studio', 'Editor', 'Medias', 'Queue', 'Configurations']:
            print(f'Inspecting {name} at {width}px', flush=True)
            if not page.locator('.application-content').count():
                page.goto(URL, wait_until='networkidle')
            before = len(errors)
            tab = page.get_by_role('tab', name=re.compile('^Queue,') if name == 'Queue' else name, exact=name != 'Queue')
            tab.click(timeout=5000)
            page.locator('.route-loading-shell').wait_for(state='hidden', timeout=15000)
            if name == 'Editor':
                page.get_by_role('textbox', name='Project name', exact=True).wait_for(state='visible', timeout=15000)
            page.wait_for_timeout(500)
            if not page.locator('.application-content').count():
                rows.append({'section': name, 'width': width, 'errors': errors[before:],
                             'fixtureRenderFailed': True})
                page.screenshot(path=str(OUT / f'ui-{name.lower()}-{width}.png'))
                continue
            geometry = page.evaluate("""() => {
              const panel = document.querySelector('.application-content');
              const nodes = [...panel.querySelectorAll('button, input, select, textarea')]
                .filter(e => e.getClientRects().length);
              return {width: innerWidth, documentWidth: document.documentElement.scrollWidth,
                selectedSection: document.querySelector('[role=tab][aria-selected=true]')?.textContent,
                visibleControls: nodes.length,
                controlsUnder24: nodes.filter(e => {const r=e.getBoundingClientRect(); return r.width<24 || r.height<24}).length,
                fontSizes: [...new Set(nodes.map(e => getComputedStyle(e).fontSize))],
                scrollContainers: [...panel.querySelectorAll('*')].filter(e => {
                  const s=getComputedStyle(e); return /auto|scroll/.test(s.overflowY) && e.scrollHeight>e.clientHeight+2;
                }).length,
                text: panel.innerText.slice(0, 1600)};
            }""")
            geometry['section'] = name
            geometry['errors'] = errors[before:]
            rows.append(geometry)
            page.screenshot(path=str(OUT / f"ui-{name.lower()}-{width}.png"))
    page.set_viewport_size({"width": 1440, "height": 960})
    page.get_by_role('tab', name='Projects', exact=True).click()
    button = page.get_by_role('button', name='New project', exact=True)
    button.focus()
    initial = page.evaluate("document.activeElement.outerHTML.slice(0, 200)")
    page.keyboard.press('Tab')
    after = page.evaluate("document.activeElement.outerHTML.slice(0, 200)")
    keyboard = {"focusBefore": initial, "focusAfterTab": after, "unchanged": initial == after}
    button.click()
    page.wait_for_timeout(250)
    page.screenshot(path=str(OUT / "ui-new-project-1440.png"))
    modal = page.evaluate("""() => ({dialogs: document.querySelectorAll('[role=dialog]').length,
       text: document.querySelector('[role=dialog]')?.innerText.slice(0, 1600),
       visibleControls: [...document.querySelectorAll('[role=dialog] button, [role=dialog] input')]
         .filter(e => e.getClientRects().length).length,
       activeElement: document.activeElement.tagName})""")
    token_capture = []
    page.route('https://audit.example.invalid/**', lambda route: (
        token_capture.append(route.request.headers.get('authorization')),
        route.fulfill(json={"audit": True}, headers={"Access-Control-Allow-Origin": URL})))
    page.evaluate("""async () => {
      localStorage.setItem('cue_api_key', 'audit-dummy-token');
      await window.fetch('https://audit.example.invalid/probe');
      localStorage.removeItem('cue_api_key');
    }""")
    payload = {"scope": "React UI with intercepted API fixtures, no backend or GPU generation",
               "screens": rows, "keyboard": keyboard, "newProjectModal": modal,
               "externalFetchAuthorization": token_capture, "pageErrors": errors,
               "requestCount": len(requests), "requests": requests}
    (OUT / 'ui-evidencias.json').write_text(json.dumps(payload, indent=2, ensure_ascii=False))
    print(json.dumps({"screens": [{k:v for k,v in r.items() if k != 'text'} for r in rows],
                      "keyboard": keyboard, "modal": modal,
                      "externalFetchAuthorization": token_capture, "errors": errors}, ensure_ascii=False))
    browser.close()
