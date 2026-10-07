// E2E para A03 — teclado e foco.
// Rodar com: npx playwright test _reversa_forward/plano-2026-10-04/e2e/keyboard.spec.ts
// Pressupõe que o app esteja rodando em http://localhost:5173.

import { test, expect } from '@playwright/test';

test.describe('A03 — keyboard & focus', () => {
  test('Tab moves focus through sidebar', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-testid="new-project"]').focus();
    await page.keyboard.press('Tab');
    const focused = page.locator(':focus');
    await expect(focused).not.toHaveAttribute('data-testid', 'new-project');
  });

  test('Escape closes dialog and returns focus', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-testid="new-project"]').click();
    const name = page.locator('[data-testid="new-project-name"]');
    await name.focus();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="new-project"]')).toBeFocused();
  });

  test('Shift+Tab reverses focus order', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-testid="new-project"]').focus();
    await page.keyboard.press('Tab'); // próximo
    await page.keyboard.press('Shift+Tab'); // volta
    await expect(page.locator('[data-testid="new-project"]')).toBeFocused();
  });

  test('Ctrl+] indents in textarea, Tab still navigates', async ({ page }) => {
    await page.goto('/director');
    const prompt = page.locator('[data-allow-indent="true"]').first();
    await prompt.focus();
    await prompt.fill('linha 1');
    await page.keyboard.press('Control+]');
    await expect(prompt).toHaveValue('  linha 1');
  });
});