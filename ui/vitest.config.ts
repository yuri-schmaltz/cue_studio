import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Store/slice tests are pure logic (no DOM). Component tests that
    // need a DOM can opt in per file with a
    // `// @vitest-environment jsdom` docblock.
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
  },
})
