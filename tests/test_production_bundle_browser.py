"""Exercise the emitted route chunks, including shared-store initialization."""
import os
from pathlib import Path

import pytest

pytestmark = pytest.mark.browser


def test_built_routes_mount_without_javascript_errors():
    url = os.environ.get("CUE_PRODUCTION_URL")
    if not url:
        pytest.skip("Set CUE_PRODUCTION_URL to a backend serving ui/dist")
    from playwright.sync_api import sync_playwright, expect

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 960})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.add_init_script("localStorage.setItem('cue-studio_welcome_seen_v1', '1')")
        # Read the live application, but never submit jobs or persist fixture
        # settings into the production used by the GPU acceptance run.
        page.route("**/api/v1/**", lambda route: route.continue_()
                   if route.request.method in {"GET", "HEAD"} else route.fulfill(json={}))
        # Select a fixture project so project-scoped tabs are enabled without
        # creating directories or altering the real generation workspace.
        def workspace_fixture(route):
            if route.request.url.endswith('/setup'):
                route.fulfill(json={"setup": {}})
            elif route.request.url.endswith('/director-draft'):
                route.fulfill(json={"draft": None})
            else:
                route.fulfill(json={"workspaces": [{"name": "bundle-fixture", "path": "fixture", "file_count": 0, "setup": {}}], "active": "bundle-fixture"})
        page.route("**/api/v1/workspaces**", workspace_fixture)
        page.route("**/api/v1/jobs", lambda route: route.fulfill(json={"jobs": []}))
        page.route("**/api/v1/director/pipelines", lambda route: route.fulfill(json={"pipelines": []}))
        page.goto(url, wait_until="networkidle")
        for section in ["projects", "director", "studio", "editor", "medias", "queue", "configurations"]:
            page.locator(f"#tab-{section}").click()
            expect(page.locator(f"#panel-{section}")).to_be_visible()
            # Allow lazy chunks and mount effects to run, then inspect errors.
            page.wait_for_timeout(300)
            assert not errors, errors
        loaded = page.evaluate("performance.getEntriesByType('resource').map(e => e.name)")
        assert any("/assets/EditorWorkspace-" in name for name in loaded)
        assert any("/assets/StudioPage-" in name for name in loaded)
        assert not any("/src/" in name for name in loaded), "Expected the production build"
        artifact_dir = os.environ.get("SHELL_TEST_ARTIFACTS")
        if artifact_dir:
            Path(artifact_dir).mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(Path(artifact_dir) / "production-bundle.png"))
        browser.close()
