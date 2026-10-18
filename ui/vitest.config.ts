import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Store/slice tests are pure logic (no DOM). Component tests that
    // need a DOM can opt in per file with a
    // `// @vitest-environment jsdom` docblock.
    environment: 'node',
    // `globals: true` lets @testing-library/react register its
    // auto-cleanup afterEach hook; test files still import
    // describe/it/expect explicitly.
    globals: true,
    // jest-dom matchers for the component tests.
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
  },
})
