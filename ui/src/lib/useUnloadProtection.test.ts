/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useUnloadProtection, hasActiveUnsavedWork } from './useUnloadProtection'
import { useStore } from '../stores/useStore'
import { useEditorStore } from '../editor/useEditorStore'

describe('useUnloadProtection', () => {
  beforeEach(() => {
    useStore.setState({ isGenerating: false, jobs: [] })
    useEditorStore.setState({ dirty: false })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reports false when there is no running generation and editor is not dirty', () => {
    expect(hasActiveUnsavedWork()).toBe(false)
  })

  it('reports true when isGenerating is true', () => {
    useStore.setState({ isGenerating: true })
    expect(hasActiveUnsavedWork()).toBe(true)
  })

  it('reports true when a job is running or queued', () => {
    useStore.setState({
      jobs: [{ id: 'job-1', status: 'running' } as any],
    })
    expect(hasActiveUnsavedWork()).toBe(true)
  })

  it('reports true when editor has unsaved changes', () => {
    useEditorStore.setState({ dirty: true })
    expect(hasActiveUnsavedWork()).toBe(true)
  })

  it('intercepts beforeunload event when work is active', () => {
    useStore.setState({ isGenerating: true })
    renderHook(() => useUnloadProtection())

    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault')
    window.dispatchEvent(event)

    expect(preventDefaultSpy).toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)
  })

  it('does not intercept beforeunload when no work is active', () => {
    renderHook(() => useUnloadProtection())

    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault')
    window.dispatchEvent(event)

    expect(preventDefaultSpy).not.toHaveBeenCalled()
  })

  it('removes event listener cleanly on unmount', () => {
    useStore.setState({ isGenerating: true })
    const { unmount } = renderHook(() => useUnloadProtection())

    unmount()

    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault')
    window.dispatchEvent(event)

    expect(preventDefaultSpy).not.toHaveBeenCalled()
  })

  it('handles null or malformed jobs array without throwing', () => {
    useStore.setState({ isGenerating: false, jobs: null as any })
    expect(hasActiveUnsavedWork()).toBe(false)
  })
})

