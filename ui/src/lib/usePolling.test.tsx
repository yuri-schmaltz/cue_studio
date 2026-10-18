/**
 * Tests for the owned polling hook (feature A17): the interval stops
 * while the document is hidden and is always cleared on unmount.
 */

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

import { usePolling } from './usePolling'

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  vi.useFakeTimers()
  setVisibility('visible')
})

afterEach(() => {
  setVisibility('visible')
  vi.useRealTimers()
})

describe('usePolling', () => {
  it('ticks on the interval while visible', () => {
    const callback = vi.fn()
    renderHook(() => usePolling(callback, 1000))
    vi.advanceTimersByTime(3000)
    expect(callback).toHaveBeenCalledTimes(3)
  })

  it('stops while the document is hidden and resumes when visible', () => {
    const callback = vi.fn()
    renderHook(() => usePolling(callback, 1000))
    setVisibility('hidden')
    vi.advanceTimersByTime(5000)
    expect(callback).not.toHaveBeenCalled()
    setVisibility('visible')
    vi.advanceTimersByTime(2000)
    expect(callback).toHaveBeenCalledTimes(2)
  })

  it('clears the interval on unmount', () => {
    const callback = vi.fn()
    const { unmount } = renderHook(() => usePolling(callback, 1000))
    unmount()
    vi.advanceTimersByTime(5000)
    expect(callback).not.toHaveBeenCalled()
  })

  it('does not poll while disabled', () => {
    const callback = vi.fn()
    renderHook(() => usePolling(callback, 1000, { enabled: false }))
    vi.advanceTimersByTime(5000)
    expect(callback).not.toHaveBeenCalled()
  })
})
