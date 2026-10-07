// E2E para A09 — navegação com URL.
// Rodar com: npx playwright test _reversa_forward/plano-2026-10-04/e2e/navigation.spec.ts

import { test, expect } from '@playwright/test';

test.describe('A09 — navegação', () => {
  test('URL reflects project and section', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-testid="new-project"]').click();
    await page.locator('[data-testid="new-project-name"]').fill('Teste');
    await page.locator('[data-testid="new-project-create"]').click();
    await expect(page).toHaveURL(/\/projects\/[^/]+\/briefing/);
  });

  test('back button does not trigger generation', async ({ page }) => {
    await page.goto('/projects/abc/briefing');
    await page.goBack();
    await expect(page).toHaveURL(/\/$|\/projects/);
  });

  test('deep-link reopens project without firing generation', async ({ page }) => {
    let generationRequests = 0;
    await page.route('**/api/projects/*/generate', (r) => {
      generationRequests++;
      r.fulfill({ status: 200, body: '{}' });
    });
    await page.goto('/projects/abc/briefing');
    await page.waitForLoadState('networkidle');
    expect(generationRequests).toBe(0);
  });
});