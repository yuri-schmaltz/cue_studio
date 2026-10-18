# ui/tests

## Vitest — the frontend test entrypoint

`npm run test` (alias: `vitest run`) is the **single** frontend test
entrypoint, per feature A06 (spec
`_reversa_forward/plano-2026-10-04/12-feature-a06-test-isolation.md`).
Configuration lives in `ui/vitest.config.ts`:

- environment: `node` (store/slice tests are pure logic; a DOM test
  can opt in per file with a `// @vitest-environment jsdom` docblock)
- include: `src/**/*.test.{ts,tsx}`, `tests/**/*.test.{ts,tsx}`

Current suites:

- `src/stores/directorQueueSlice.test.ts` — Director Queue slice
- `src/stores/llmSlice.test.ts` — LLM lifecycle slice (ported from
  `tests/manual/test-llm-slice.mjs`)

## tests/manual — standalone legacy harnesses

The scripts in `tests/manual/` are **intentionally standalone** and
are not run by `npm run test` (spec §3.2 allows keeping them with a
justification):

- `test-director-queue-slice.mjs` (+ `test-director-queue-slice-api-shim.mjs`)
  and `test-llm-slice.mjs` predate the Vitest setup: they bundle the
  slices with esbuild and assert their public surface with plain
  `node:assert`, runnable with bare `node <script>` and **no test
  runner, no dev dependencies beyond esbuild**. They double as smoke
  probes for environments where `node_modules` is incomplete (the
  esbuild bundling tolerates a partially-installed tree as long as
  esbuild itself resolves).
- Their coverage is now **fully mirrored under Vitest** in
  `src/stores/directorQueueSlice.test.ts` and
  `src/stores/llmSlice.test.ts`; the `.mjs` files are kept only as
  zero-dependency manual fallbacks. Run them with, e.g.:

  ```sh
  node tests/manual/test-llm-slice.mjs
  ```

- `control-gauntlet.mjs` and `store-gauntlet.mjs` live in `ui/scripts/`
  and remain wired to `npm run test:control` / `npm run test:store`;
  they exercise the browser control harness / full store boot and are
  out of scope for the Vitest unit suite.
