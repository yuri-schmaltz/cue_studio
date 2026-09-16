"""Project setup UI contracts with all mutations intercepted before navigation."""
import os
import re
from urllib.parse import urlparse

import pytest

pytestmark = pytest.mark.browser


def test_create_edit_and_reopen_project_setup():
    from playwright.sync_api import sync_playwright, expect

    workspaces = [{'name': 'existing', 'path': 'fixture', 'file_count': 0, 'setup': {}}]
    active = 'existing'
    errors = []

    def api(route):
        nonlocal active
        request = route.request
        path = urlparse(request.url).path
        if path.startswith('/api/v1/workspaces'):
            payload = request.post_data_json if request.method in ('POST', 'PUT') else {}
            if path.endswith('/setup'):
                name = path.split('/')[-2]
                workspace = next(item for item in workspaces if item['name'] == name)
                if request.method == 'PUT':
                    workspace['setup'] = payload['setup']
                route.fulfill(json={'setup': workspace['setup']})
            elif request.method == 'POST':
                workspaces.append({'name': payload['name'], 'path': 'fixture', 'file_count': 0, 'setup': {}})
                route.fulfill(json={})
            elif request.method == 'PUT':
                active = payload['name']
                route.fulfill(json={})
            else:
                route.fulfill(json={'workspaces': workspaces, 'active': active})
        elif request.method == 'GET':
            route.continue_()
        else:
            route.fulfill(json={})

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1440, 'height': 960})
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.add_init_script("localStorage.setItem('cue_studio_welcome_seen_v1','1')")
        page.route('**/api/v1/**', api)
        page.goto(os.environ.get('SHELL_TEST_URL', 'http://127.0.0.1:3000'), wait_until='networkidle')
        page.get_by_role('tab', name='Projects', exact=True).click()
        page.get_by_role('button', name='New project', exact=True).click()
        page.get_by_role('textbox', name='Project name', exact=True).fill('Setup contract')
        page.get_by_role('radio', name=re.compile(r'^9:16')).click()
        page.get_by_role('radio', name='480p', exact=True).click()
        page.get_by_role('button', name='Generate a track', exact=True).click()
        page.get_by_role('button', name='Create project', exact=True).click()
        expect(page.get_by_role('tab', name='Director', exact=True)).to_have_attribute('aria-selected', 'true')
        state = page.evaluate("""async () => {
            const {useStore} = await import('/src/stores/useStore.ts');
            const s = useStore.getState();
            return [s.activeWorkspace, s.directorAspectRatio, s.directorResolution, s.directorMusicSource];
        }""")
        assert state == ['Setup-contract', '9:16', '480p', 'generate']
        page.get_by_role('tab', name='Projects', exact=True).click()
        page.get_by_role('button', name='Edit Setup-contract setup', exact=True).click()
        expect(page.get_by_role('radio', name=re.compile(r'^9:16'))).to_have_attribute('aria-checked', 'true')
        page.get_by_role('radio', name=re.compile(r'^1:1')).click()
        page.get_by_role('button', name='Save setup', exact=True).click()
        expect(page.get_by_role('dialog')).to_have_count(0)
        page.get_by_role('button', name='Edit Setup-contract setup', exact=True).click()
        expect(page.get_by_role('radio', name=re.compile(r'^1:1'))).to_have_attribute('aria-checked', 'true')
        assert next(item for item in workspaces if item['name'] == 'Setup-contract')['setup']['aspect_ratio'] == '1:1'
        assert not errors, errors
        browser.close()
