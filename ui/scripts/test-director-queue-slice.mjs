// Standalone shape test for the Director Queue slice.

import assert from 'node:assert/strict'
import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const uiRoot = path.resolve(__dirname, '..')

const result = await build({
  stdin: {
    contents: `export { createDirectorQueueSlice } from './src/stores/directorQueueSlice';`,
    resolveDir: uiRoot,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  define: { 'import.meta.hot': 'undefined' },
})

const sliceUrl = `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`
const sliceExports = await import(sliceUrl)

function makeStore() {
  let state = {}
  const set = (patch) => { state = { ...state, ...patch } }
  const get = () => state
  const slice = sliceExports.createDirectorQueueSlice(set, get, () => state)
  state = { ...state, ...slice }
  return { getState: () => state }
}

function main() {
  const store = makeStore()
  const s = store.getState()

  // Initial state
  assert.equal(s.directorQueue, null)
  assert.equal(s.directorQueueLoading, false)
  assert.equal(s.directorQueueEditingEntryId, null)

  // Action presence
  for (const name of [
    'loadDirectorQueue',
    'addDirectorQueueEntry',
    'updateDirectorQueueEntry',
    'deleteDirectorQueueEntry',
    'startDirectorQueue',
    'pauseDirectorQueue',
    'reorderDirectorQueue',
    'setDirectorQueueEditingEntryId',
  ]) {
    assert.equal(typeof s[name], 'function', `${name} must be a function`)
  }

  // Synchronous setter
  s.setDirectorQueueEditingEntryId('e42')
  assert.equal(store.getState().directorQueueEditingEntryId, 'e42')
  s.setDirectorQueueEditingEntryId(null)
  assert.equal(store.getState().directorQueueEditingEntryId, null)

  console.log('test-director-queue-slice: 12 assertions passed')
}

try {
  main()
} catch (err) {
  console.error('test-director-queue-slice FAILED:', err)
  process.exit(1)
}
