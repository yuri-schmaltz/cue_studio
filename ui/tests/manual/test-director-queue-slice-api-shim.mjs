// API shim for the Director Queue slice harness.
//
// The slice imports `../api/client` lazily inside each action. We
// replace it with a small dispatcher that returns canned responses
// and records every call so the assertions can introspect them.

const mocks = {
  fetchDirectorQueue: async () => ({ version: 1, paused: false, running: false, entries: [] }),
  enqueueDirectorPipeline: async () => ({}),
  updateDirectorQueueEntry: async () => ({}),
  deleteDirectorQueueEntry: async () => undefined,
  startDirectorQueue: async () => ({ version: 1, paused: false, running: false, entries: [] }),
  pauseDirectorQueue: async () => ({ version: 1, paused: true, running: false, entries: [] }),
  reorderDirectorQueue: async () => undefined,
}

export const calls = {
  fetchDirectorQueue: [],
  enqueueDirectorPipeline: [],
  updateDirectorQueueEntry: [],
  deleteDirectorQueueEntry: [],
  startDirectorQueue: [],
  pauseDirectorQueue: [],
  reorderDirectorQueue: [],
}

export function __setMocks(next) {
  Object.assign(mocks, next)
  for (const key of Object.keys(calls)) calls[key] = []
}

function record(name, args) {
  calls[name].push(args)
}

export async function fetchDirectorQueue(...args) {
  record('fetchDirectorQueue', args)
  return mocks.fetchDirectorQueue(...args)
}
export async function enqueueDirectorPipeline(...args) {
  record('enqueueDirectorPipeline', args)
  return mocks.enqueueDirectorPipeline(...args)
}
export async function updateDirectorQueueEntry(...args) {
  record('updateDirectorQueueEntry', args)
  return mocks.updateDirectorQueueEntry(...args)
}
export async function deleteDirectorQueueEntry(...args) {
  record('deleteDirectorQueueEntry', args)
  return mocks.deleteDirectorQueueEntry(...args)
}
export async function startDirectorQueue(...args) {
  record('startDirectorQueue', args)
  return mocks.startDirectorQueue(...args)
}
export async function pauseDirectorQueue(...args) {
  record('pauseDirectorQueue', args)
  return mocks.pauseDirectorQueue(...args)
}
export async function reorderDirectorQueue(...args) {
  record('reorderDirectorQueue', args)
  return mocks.reorderDirectorQueue(...args)
}
