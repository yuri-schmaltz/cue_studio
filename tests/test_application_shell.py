"""Browser regression for the application shell.

Requires Playwright + Chromium and a running Vite dev server proxying Maestro.
Run: SHELL_TEST_URL=http://127.0.0.1:3000 python tests/test_application_shell.py
Project mutations are intercepted so test data never reaches the backend.

Marked with the ``browser`` pytest marker so the default
``pytest tests/`` discovery skips it (playwright isn't a default
install dependency). Opt in with ``pytest tests/ -m browser`` or
``pytest tests/test_application_shell.py -m browser``.
"""
import json
import os
from pathlib import Path
import pytest
from urllib.parse import urlparse

pytestmark = pytest.mark.browser

URL = os.environ.get('SHELL_TEST_URL', 'http://127.0.0.1:3000')
ARTIFACTS = Path(os.environ.get('SHELL_TEST_ARTIFACTS', '/tmp/cue-studio-overhaul'))
ARTIFACTS.mkdir(parents=True, exist_ok=True)
SECTIONS = ['Projects', 'Director', 'Editor', 'Dashboard', 'Medias', 'Queue', 'Configurations']

def test_application_shell():
    from playwright.sync_api import sync_playwright, expect

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1440, 'height': 960})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.add_init_script("localStorage.setItem('cue_studio_welcome_seen_v1','1'); localStorage.setItem('hwbar_collapsed','1')")
        # Install write interception before the first application request.
        page.route('**/api/v1/**', lambda route: route.continue_()
                   if route.request.method == 'GET' else route.fulfill(json={}))
        page.route('**/api/v1/director/pipelines', lambda route: route.fulfill(json={'pipelines': []}))
        from services.editor_projects import create_editor_project
        editor = [create_editor_project(workspace='shell-fixture', name='Shell edit')]
        saves = []
        def protect_editor(route):
            if route.request.method == 'PUT':
                editor[0] = route.request.post_data_json['project']
                saves.append(editor[0])
                route.fulfill(json=editor[0])
            elif urlparse(route.request.url).path.endswith('/projects'):
                route.fulfill(json={'projects': [dict(editor[0], duration=0, asset_count=0)]})
            else:
                route.fulfill(json=editor[0])
        page.route('**/api/v1/editor/projects**', protect_editor)
        # Create/open/delete workflow against an isolated workspace API.
        workspaces = [{'name':'default','path':'outputs','file_count':0}, {'name':'shell-fixture','path':'fixture','file_count':0,'setup':{}}]
        active = ['shell-fixture']
        def projects_api(route):
            request = route.request
            if urlparse(request.url).path.endswith('/setup'):
                name = urlparse(request.url).path.split('/')[-2]
                workspace = next(w for w in workspaces if w['name'] == name)
                if request.method == 'PUT': workspace['setup'] = request.post_data_json['setup']
                route.fulfill(json={'setup': workspace.get('setup', {})})
            elif request.method == 'POST':
                workspaces.append({'name':request.post_data_json['name'],'path':'fixture','file_count':0})
                route.fulfill(json={})
            elif request.method == 'PUT':
                active[0] = request.post_data_json['name']; route.fulfill(json={})
            elif request.method == 'DELETE':
                name = request.url.rsplit('/',1)[-1]
                workspaces[:] = [w for w in workspaces if w['name'] != name]
                switched = active[0] == name
                if switched: active[0] = 'default'
                route.fulfill(json={'switched_to_default':switched,'files_deleted':0})
            else:
                route.fulfill(json={'workspaces':workspaces,'active':active[0]})
        page.route('**/api/v1/workspaces**', projects_api)
        page.goto(URL, wait_until='networkidle')
        for width, height in [(1440, 960), (1024, 768), (768, 1024), (390, 844), (320, 740)]:
            page.set_viewport_size({'width': width, 'height': height})
            for name in SECTIONS:
                tab = page.locator(f'#tab-{name.lower()}')
                tab.click()
                expect(tab).to_have_attribute('aria-selected', 'true')
                expect(page.get_by_role('tabpanel')).to_have_attribute('id', f'panel-{name.lower()}')
                page.wait_for_timeout(250)
                if name == 'Dashboard':
                    expect(page.get_by_role('heading', name='Dashboard', exact=True)).to_be_visible()
                geometry = page.evaluate('''() => {
                    const header = document.querySelector('.application-header').getBoundingClientRect();
                    const nav = document.querySelector('.application-tabs').getBoundingClientRect();
                    const footer = document.querySelector('.global-status-bar').getBoundingClientRect();
                    const panel = document.querySelector('[role=tabpanel]').getBoundingClientRect();
                    return {navCenter:nav.x+nav.width/2, width:innerWidth, height:innerHeight,
                      scroll:document.documentElement.scrollWidth, footer:{x:footer.x,width:footer.width,bottom:footer.bottom,top:footer.top},
                      headerBottom:header.bottom,panel:{top:panel.top,bottom:panel.bottom}};
                }''')
                assert abs(geometry['navCenter'] - width / 2) <= 1, (name, width, geometry)
                assert geometry['scroll'] == width, (name, width, geometry)
                assert geometry['footer']['x'] == 0 and geometry['footer']['width'] == width
                assert abs(geometry['footer']['bottom'] - height) <= 1
                assert geometry['panel']['top'] >= geometry['headerBottom']
                assert geometry['panel']['bottom'] <= geometry['footer']['top'] + 1
                if width in [1440, 390]:
                    page.screenshot(path=str(ARTIFACTS / f'verified-{name.lower()}-{width}.png'))
        page.set_viewport_size({'width': 1440, 'height': 960})
        page.get_by_role('tab', name='Projects', exact=True).click()
        page.get_by_role('tab', name='Projects', exact=True).press('ArrowRight')
        expect(page.get_by_role('tab', name='Director', exact=True)).to_be_focused()
        page.get_by_role('tab', name='Director', exact=True).press('End')
        expect(page.get_by_role('tab', name='Configurations', exact=True)).to_be_focused()
        page.get_by_role('button', name='Notifications Alerts, sounds and delivery').click()
        expect(page.get_by_role('switch', name='System notifications', exact=True)).to_be_visible()
        assert 'Tailscale' not in page.locator('body').inner_text()

        # Telemetry is now shown directly in the global footer.
        expect(page.get_by_role('group', name='Hardware telemetry')).to_be_visible()

        # Existing shortcuts must select the matching main tab.
        page.evaluate("async () => { const {useStore} = await import(performance.getEntriesByType('resource').find(e => e.name.includes('/src/stores/useStore.ts')).name); useStore.getState().setSidebarMode('studio') }")
        expect(page.get_by_role('tab', name='Director', exact=True)).to_have_attribute('aria-selected', 'true')
        expect(page.get_by_role('button', name='Studio', exact=True)).to_have_attribute('aria-pressed', 'true')
        expect(page.get_by_role('complementary', name='Manual generation controls')).to_be_visible()
        page.screenshot(path=str(ARTIFACTS / 'verified-studio-1440.png'))
        page.get_by_role('button', name='Planning', exact=True).click()
        expect(page.get_by_test_id('director-stage')).to_be_visible()
        # Inject a paused production: the review surface must remain reachable.
        page.evaluate("""async () => { const {useStore} = await import(performance.getEntriesByType('resource').find(e => e.name.includes('/src/stores/useStore.ts')).name); useStore.setState({pipelineId:'shell-fixture', pipelineStatus:{id:'shell-fixture',status:'paused',phase:'planning',pause_reason:'review_prompts',review_digest:'one',progress:{current:1,total:1,step:0,total_steps:0,message:'Review'},clip_plans:[{image_prompt:'A station',video_prompt:'A train arrives',window_prompts:[]}],clip_images:[],planned_clips:[{start:0,end:5}],output_files:[],error:null}}) }""")
        expect(page.get_by_label('Production review and progress')).to_be_visible()
        expect(page.get_by_role('heading', name='Review scene plan')).to_be_visible()
        page.get_by_role('button', name='Approve scene', exact=True).click()
        expect(page.get_by_role('button', name='Continue with approved plan', exact=True)).to_be_enabled()
        page.screenshot(path=str(ARTIFACTS / 'verified-director-review.png'))
        page.evaluate("async () => { const {useStore} = await import(performance.getEntriesByType('resource').find(e => e.name.includes('/src/stores/useStore.ts')).name); useStore.setState({pipelineId:null,pipelineStatus:null}) }")

        # Editing survives an immediate section change, including undo history.
        page.get_by_role('tab', name='Editor', exact=True).click()
        project_name = page.get_by_role('textbox', name='Project name', exact=True)
        project_name.fill('Shell persistence check')
        project_name.press('Enter')
        history_before = page.evaluate("async () => (await import(performance.getEntriesByType('resource').find(e => e.name.includes('/src/editor/useEditorStore.ts')).name)).useEditorStore.getState().history.length")
        page.get_by_role('tab', name='Medias', exact=True).click()
        page.wait_for_timeout(400)
        page.get_by_role('tab', name='Editor', exact=True).click()
        expect(project_name).to_have_value('Shell persistence check')
        assert page.evaluate("async () => (await import(performance.getEntriesByType('resource').find(e => e.name.includes('/src/editor/useEditorStore.ts')).name)).useEditorStore.getState().history.length") == history_before
        assert saves and saves[-1]['name'] == 'Shell persistence check'

        page.get_by_role('tab', name='Projects', exact=True).click()
        page.get_by_role('button', name='New project', exact=True).click()
        page.get_by_role('textbox', name='Project name', exact=True).fill('Shell temporary')
        page.get_by_role('button', name='Create project', exact=True).click()
        expect(page.get_by_role('dialog')).to_have_count(0)
        expect(page.get_by_role('tab', name='Director', exact=True)).to_have_attribute('aria-selected', 'true')
        page.get_by_role('tab', name='Projects', exact=True).click()
        expect(page.get_by_role('heading', name='Shell-temporary', exact=True)).to_be_visible()
        page.get_by_role('button', name='Browse Shell-temporary', exact=True).click()
        expect(page.get_by_role('tab', name='Medias', exact=True)).to_have_attribute('aria-selected','true')
        page.get_by_role('tab', name='Projects', exact=True).click()
        page.get_by_role('button', name='Delete Shell-temporary', exact=True).click()
        page.get_by_role('button', name='Delete project', exact=True).click()
        expect(page.get_by_role('heading', name='Shell-temporary', exact=True)).to_have_count(0)
        assert not errors, errors
        (ARTIFACTS / 'results.json').write_text(json.dumps({'passed':True,'viewports':5,'sections':SECTIONS,'javascript_errors':errors},indent=2))
        print('PASS: 35 section/viewport checks, centered tabs, footer geometry, keyboard navigation, notifications, hardware telemetry, Dashboard, Studio shortcuts, Director review, Editor persistence and project CRUD.')
        browser.close()


def test_director_opens_without_runtime_errors():
    from playwright.sync_api import sync_playwright, expect

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 960})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.add_init_script("localStorage.setItem('cue_studio_welcome_seen_v1','1')")
        # Read the real API, but prevent all writes to user projects/settings.
        page.route('**/api/v1/**', lambda route: route.continue_()
                   if route.request.method == 'GET' else route.fulfill(json={}))
        page.route('**/api/v1/workspaces', lambda route: route.fulfill(json={
            'workspaces': [{'name': 'browser-fixture', 'file_count': 0}],
            'active': 'browser-fixture',
        }))
        page.route('**/api/v1/workspaces/browser-fixture/setup',
                   lambda route: route.fulfill(json={'setup': {}}))
        page.goto(URL, wait_until='networkidle')
        page.get_by_role('tab', name='Director', exact=True).click()
        expect(page.get_by_label('Director chat & decisions')).to_be_visible()
        page.screenshot(path=str(ARTIFACTS / 'director-runtime.png'))
        assert not errors, errors
        browser.close()


if __name__ == "__main__":
    test_application_shell()
