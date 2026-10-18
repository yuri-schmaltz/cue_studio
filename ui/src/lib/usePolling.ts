// Owned polling (feature A17).
//
// A poll belongs to the component that starts it: the interval is
// cleared on unmount and while the document is hidden
// (`document.visibilityState`), so background tabs stop hammering the
// backend and no timer outlives its owner.

import { useEffect, useRef } from 'react'

export interface PollingOptions {
  /** Set to false to pause the poll without unmounting (e.g. section
   *  not active). Defaults to true. */
  enabled?: boolean
}

export function usePolling(callback: () => void, intervalMs: number, options?: PollingOptions): void {
  const enabled = options?.enabled ?? true
  const callbackRef = useRef(callback)
  useEffect(() => {
    callbackRef.current = callback
  })

  useEffect(() => {
    if (!enabled || intervalMs <= 0) return
    let timer: number | null = null
    const tick = () => {
      if (document.visibilityState === 'visible') callbackRef.current()
    }
    const start = () => {
      if (timer === null) timer = window.setInterval(tick, intervalMs)
    }
    const stop = () => {
      if (timer !== null) {
        window.clearInterval(timer)
        timer = null
      }
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') start()
      else stop()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    if (document.visibilityState !== 'hidden') start()
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [enabled, intervalMs])
}
