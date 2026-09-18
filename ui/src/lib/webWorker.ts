// Lightweight Web Worker bridge for offloading heavy layout / search
// computations from the main thread.
//
// Why this exists
// ---------------
// `MediaFeedItem.tsx` runs an `align()` routine every time the gallery
// resizes; that routine walks every visible item to compute the
// thumbnail grid's centre coordinates. On a 100-clip gallery this
// synchronously blocks the main thread for ~5-15ms, which is enough
// to drop a frame when the user scrolls quickly. The same pattern
// will recur in any future feature that needs to align large virtual
// lists.
//
// Rather than pull in a heavyweight worker library, we hand the
// function a tiny protocol: messages with an `op` discriminator, a
// matching `id` to correlate request/response, and structured-clone
// payloads. Every operation returns a Promise that resolves with the
// worker result or rejects with a structured error.
//
// Worker file lives at `ui/src/workers/layout.worker.ts` and is built
// with Vite's `?worker` import suffix.

export type WorkerRequest<TPayload> = {
  id: number
  op: string
  payload: TPayload
}

export type WorkerResponse<TResult> = {
  id: number
  ok: boolean
  result?: TResult
  error?: string
}

type PendingResolver = {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
}

let nextId = 1
let workerInstance: Worker | null = null
const pending = new Map<number, PendingResolver>()

function ensureWorker(): Worker | null {
  if (workerInstance) return workerInstance
  if (typeof Worker === 'undefined') return null
  try {
    // Vite resolves this import at build time and emits a separate
    // chunk for the worker bundle. Fall back to inline mode when the
    // environment cannot host a worker (SSR tests, jsdom).
    workerInstance = new Worker(
      new URL('../workers/layout.worker.ts', import.meta.url),
      { type: 'module' },
    )
    workerInstance.onmessage = (event: MessageEvent<WorkerResponse<unknown>>) => {
      const response = event.data
      const resolver = pending.get(response.id)
      if (!resolver) return
      pending.delete(response.id)
      if (response.ok) {
        resolver.resolve(response.result)
      } else {
        resolver.reject(new Error(response.error ?? 'worker error'))
      }
    }
    workerInstance.onerror = (event: ErrorEvent) => {
      // Worker crashed; reject all in-flight requests and tear the
      // instance down so the next call falls back to the main thread.
      for (const [, resolver] of pending) {
        resolver.reject(new Error(event.message || 'worker error'))
      }
      pending.clear()
      workerInstance?.terminate()
      workerInstance = null
    }
  } catch (error) {
    workerInstance = null
  }
  return workerInstance
}

export async function runOnWorker<TResult = unknown, TPayload = unknown>(
  op: string,
  payload: TPayload,
  fallback: () => TResult | Promise<TResult>,
): Promise<TResult> {
  const worker = ensureWorker()
  if (!worker) {
    return fallback()
  }
  return new Promise<TResult>((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
    try {
      worker.postMessage({ id, op, payload } as WorkerRequest<TPayload>)
    } catch (error) {
      pending.delete(id)
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  }).catch(async (error) => {
    // Worker failure is non-fatal: fall back to running the work on
    // the main thread so the caller always gets a result.
    if (typeof console !== 'undefined') {
      console.warn(`[web-worker] '${op}' failed; falling back to main thread`, error)
    }
    return fallback()
  })
}

export function terminateWebWorker(): void {
  if (workerInstance) {
    workerInstance.terminate()
    workerInstance = null
  }
  for (const [, resolver] of pending) {
    resolver.reject(new Error('worker terminated'))
  }
  pending.clear()
}
