// E2E para A14 — fila.
// Rodar com: npx playwright test _reversa_forward/plano-2026-10-04/e2e/queue.spec.ts

import { test, expect } from '@playwright/test';

test.describe('A14 — fila', () => {
  test('each state renders correct actions', async ({ page }) => {
    await page.goto('/queue');
    const states: Array<{ state: string; actions: string[] }> = [
      { state: 'queued', actions: ['cancel'] },
      { state: 'running', actions: ['cancel'] },
      { state: 'awaiting_review', actions: ['review'] },
      { state: 'done', actions: ['review', 'download'] },
      { state: 'failed', actions: ['reopen'] },
    ];
    for (const { state, actions } of states) {
      const card = page.locator(`[data-queue-state="${state}"]`).first();
      const buttons = await card.locator('[data-queue-action]').all();
      const labels = await Promise.all(buttons.map((b) => b.getAttribute('data-queue-action')));
      expect(labels.sort()).toEqual(actions.sort());
    }
  });

  test('cancel during running opens confirmation', async ({ page }) => {
    await page.goto('/queue');
    const card = page.locator('[data-queue-state="running"]').first();
    await card.locator('[data-queue-action="cancel"]').click();
    await expect(page.locator('[data-testid="cancel-confirm"]')).toBeVisible();
  });
});