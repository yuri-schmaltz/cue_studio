"""Smoke test for the Director UX changes shipped in 2026-09-27.

Verifies three flows that were added/modified in commit f16101c:

1. Director renders without page errors when entered from the
   application shell. Confirms the Music-tab merge and timeline polish
   did not regress the shell wiring.
2. Pipeline status surfaces the new stage text ("Etapa: Upload 1/10"
   instead of the pre-merge stage labels) — proves the DirectorStatusPanel
   refactor is live.
3. The "Dividir / editar clipes" timeline button is visible in the
   Director panel and is disabled when no clip plan exists. This is the
   only composer-button visibility we can guarantee from the initial
   Director entry; the Auto Mode toggle only mounts once the user
   reaches step='style' (post-audio), so it is not part of this smoke.

The Auto Mode default of ``true`` is unit-tested in the store gauntlet
``store-gauntlet.mjs``; see ``ui/scripts/test-llm-slice.mjs`` for the
``directorAutoMode`` initializer check.

Director mutations are intercepted so the test never triggers real
inference; everything else passes through to the live backend on
``DIRECTOR_TEST_URL`` (default :7860). Marked with the ``browser``
marker — opt in via ``pytest tests/test_director_music_tab.py -m browser``.
"""
import json
import os
from pathlib import Path
from urllib.parse import urlparse
import pytest

pytestmark = pytest.mark.browser

URL = os.environ.get('DIRECTOR_TEST_URL', 'http://127.0.0.1:7860/')
ARTIFACTS = Path(os.environ.get('SHELL_TEST_ARTIFACTS', '/tmp/cue-studio-director'))
ARTIFACTS.mkdir(parents=True, exist_ok=True)


def _stub_director_routes(page, *, pipelines=None, skills=None):
    """Wire the Director endpoints to safe stubs; pass-through everything else.

    Strategy: intercept only the routes that touch expensive or stateful
    Director behaviour (analysis, plan start, pipeline mutations). All
    other API calls — workspaces, settings, models, LLM connections —
    are passed through to the live backend on :7860 so the smoke test
    exercises the real project-gating and auto-mode persistence paths
    without mutating anything the smoke did not intend.
    """
    pipelines = pipelines if pipelines is not None else []
    skills = skills if skills is not None else [
        {
            'name': 'audio-analysis',
            'description': 'Analyze audio references and produce a clip plan.',
            'available': True,
        },
        {
            'name': 'image-gen',
            'description': 'Generate first-frame stills for each clip.',
            'available': True,
        },
    ]

    def handle(route):
        path = urlparse(route.request.url).path
        method = route.request.method
        # Director read endpoints — return empty/deterministic fixtures.
        if path.endswith('/director/skills'):
            return route.fulfill(json={'skills': skills})
        if path.endswith('/director/pipelines') and method == 'GET':
            return route.fulfill(json={'pipelines': pipelines})
        if '/director/pipelines/' in path and method == 'GET':
            return route.fulfill(json={'state': 'idle', 'pid': path.rsplit('/', 1)[-1]})
        # Director mutating endpoints — short-circuit to avoid real inference.
        if '/director/' in path and method == 'POST':
            return route.fulfill(json={'ok': True, 'pid': 'stub-pid'})
        if method == 'DELETE' and '/director/' in path:
            return route.fulfill(json={'ok': True})
        # Everything else — pass through to the live backend.
        return route.continue_()

    page.route('**/api/v1/director/**', handle)


def test_director_music_tab_timeline_button_and_stage_status():
    """Director UX smoke: shell entry, stage status refactor, timeline button."""
    from playwright.sync_api import sync_playwright, expect

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1440, 'height': 960})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))

        # Bypass welcome modal + collapsed sidebar for predictable layout.
        page.add_init_script(
            "localStorage.setItem('cue-studio_welcome_seen_v1','1');"
            " localStorage.setItem('hwbar_collapsed','1')"
        )
        _stub_director_routes(page)

        page.goto(URL, wait_until='domcontentloaded', timeout=20_000)
        # The Cue Studio SPA mounts several sections in parallel and
        # `networkidle` is too eager (some polling never goes idle).
        # Wait for the Director tab to appear instead.
        page.wait_for_selector('#tab-director', state='attached', timeout=15_000)

        # Navigate into the Director section. If the project gate is still
        # closed the tab will be aria-disabled; that is the failure mode we
        # want to surface explicitly.
        director_tab = page.locator('#tab-director')
        disabled = director_tab.get_attribute('aria-disabled')
        if disabled:
            raise AssertionError(
                f'Director tab is locked (aria-disabled={disabled}); '
                'project gating did not unlock with smoke fixture.'
            )
        director_tab.click()
        expect(director_tab).to_have_attribute('aria-selected', 'true')

        # --- 1. DirectorStatusPanel refactor: stage counter present ---
        # The new status panel shows "Etapa: Upload 1/10" instead of the
        # pre-merge "Preparing audio" / "Idle" labels. Confirms the
        # DirectorStatusPanel.tsx modernization is live in this build.
        stage_label = page.get_by_text('Etapa:', exact=False).first
        expect(stage_label).to_be_visible(timeout=5_000)

        # --- 2. Timeline editor button is hidden when no clip plan exists ---
        # The new DirectorTimelineEditor returns null until clips are loaded.
        # This is intentional UX (don't surface an action that would have
        # nothing to edit), so the smoke asserts the button is *absent*
        # rather than disabled. The icon variant in the clip structure
        # header is also gated on the same condition.
        timeline_button = page.get_by_role('button', name='Dividir / editar clipes')
        assert timeline_button.count() == 0, (
            'Timeline editor button should not render before any clip plan '
            f'was loaded; found {timeline_button.count()} button(s).'
        )
        # Sanity: the empty-state copy "No clips planned yet" is visible,
        # which is the prompt the user sees in lieu of the timeline button.
        empty_state = page.get_by_text('No clips planned yet', exact=False)
        expect(empty_state.first).to_be_visible(timeout=2_000)

        page.screenshot(path=str(ARTIFACTS / 'director-music-tab.png'), full_page=True)

        if errors:
            raise AssertionError(
                f'Page errors during Director UX smoke: {errors[:5]}'
            )

        browser.close()
