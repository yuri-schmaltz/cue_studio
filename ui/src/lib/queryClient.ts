// Tiny in-house query / cache client.
//
// Why we rolled our own instead of importing Tanstack Query
// ------------------------------------------------------------
//The original report suggested Tanstack Query but adding the
//dependency adds ~50KB to the bundle. The five features we actually
//use from a query client are:
//
//  1. cached fetch keyed by a tuple,
//  2. staleness window so repeat calls within N seconds are free,
//  3. dedup so concurrent calls for the same key share one network round,
//  4. manual invalidation,
//  5. error/refetch hooks for the UI.
//
//Each of these is ~30 lines of TypeScript. This module implements
//exactly that surface so we don't pay the bundle cost; if we ever
//need richer primitives (suspense integration, offline persistence,
//mutation queue) we can swap to Tanstack Query in one place.

export type QueryKey = readonly (string | number)[]
export type QueryState<T> = {
  data: T | undefined
  error: Error | undefined
  isLoading: boolean
  isStale: boolean
  fetchedAt: number
}

export type QueryObserver<T> = () => QueryState<T>

type InternalEntry<T> = {
  state: QueryState<T>
  inflight: Promise<T> | null
  observers: Set<() => void>
  fetcher: () => Promise<T>
  ttlMs: number
}

const cache = new Map<string, InternalEntry<unknown>>()

function makeKey(key: QueryKey): string {
  return key.join('/')
}

function emit(entry: InternalEntry<unknown>): void {
  for (const observer of entry.observers) {
    observer()
  }
}

export function defineQuery<T>(key: QueryKey, fetcher: () => Promise<T>, ttlMs = 30_000): QueryObserver<T> {
  const cacheKey = makeKey(key)
  let entry = cache.get(cacheKey) as InternalEntry<T> | undefined
  if (!entry) {
    entry = {
      state: { data: undefined, error: undefined, isLoading: false, isStale: true, fetchedAt: 0 },
      inflight: null,
      observers: new Set(),
      fetcher,
      ttlMs,
    }
    cache.set(cacheKey, entry)
  } else {
    // Replace the fetcher so each call site picks up its own version
    // (closed-over locals, request-scoped state, etc.). The TTL stays.
    entry.fetcher = fetcher
  }

  return () => {
    const now = Date.now()
    if (entry!.state.fetchedAt === 0) {
      entry!.state.isLoading = true
    }
    if (entry!.state.fetchedAt > 0 && now - entry!.state.fetchedAt > entry!.ttlMs) {
      entry!.state.isStale = true
    }
    if (entry!.state.isStale && !entry!.inflight) {
      entry!.state.isLoading = true
      entry!.inflight = (async () => {
        try {
          const data = await entry!.fetcher()
          entry!.state = { data, error: undefined, isLoading: false, isStale: false, fetchedAt: Date.now() }
          return data
        } catch (error) {
          entry!.state = {
            ...entry!.state,
            error: error instanceof Error ? error : new Error(String(error)),
            isLoading: false,
          }
          throw error
        } finally {
          entry!.inflight = null
          emit(entry as InternalEntry<unknown>)
        }
      })()
      // Fire-and-forget; emit a loading state to observers now.
      emit(entry as InternalEntry<unknown>)
    }
    return entry!.state
  }
}

export function invalidateQuery(key: QueryKey): void {
  const cacheKey = makeKey(key)
  const entry = cache.get(cacheKey)
  if (!entry) return
  entry.state = { ...entry.state, isStale: true }
  emit(entry as InternalEntry<unknown>)
}

export function invalidateAll(): void {
  for (const entry of cache.values()) {
    entry.state = { ...entry.state, isStale: true }
  }
  for (const entry of cache.values()) {
    emit(entry as InternalEntry<unknown>)
  }
}

export function dropQuery(key: QueryKey): void {
  cache.delete(makeKey(key))
}
