/**
 * Tests for the store ⇄ URL sync hook (feature A09): deep links
 * restore project + section without any generation, filter changes
 * don't pollute the history, and popstate applies the URL.
 */

// @vitest-environment jsdom
import { expect, it, beforeEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

vi.mock('../stores/useStore', async () => {
  const { create } = await vi.importActual<typeof import('zustand')>('zustand')
  const useStore = create(() => ({
    appSection: 'projects' as string,
    activeWorkspace: 'default' as string,
    mediaFilter: 'all' as string,
    workspaces: [] as Array<{ name: string }>,
    setAppSection: (section: string) => { useStore.setState({ appSection: section }) },
    setMediaFilter: (filter: string) => { useStore.setState({ mediaFilter: filter }) },
    // Mirrors the real switchWorkspace contract: resolves, no generation.
    switchWorkspace: async (name: string) => { useStore.setState({ activeWorkspace: name }) },
  }))
  return { useStore }
})

import { useStore } from '../stores/useStore'
import { useUrlNavigation } from './useUrlNavigation'

interface FakeState {
  appSection: string
  activeWorkspace: string
  mediaFilter: string
  workspaces: Array<{ name: string }>
  setAppSection: (section: string) => void
  setMediaFilter: (filter: string) => void
  switchWorkspace: (name: string) => Promise<void>
}

const state = () => useStore.getState() as unknown as FakeState

function setUrl(path: string): void {
  window.history.replaceState(null, '', path)
}

/** Mount the hook and let the mount-time hydration settle. */
async function mount() {
  const view = renderHook(() => useUrlNavigation())
  await act(async () => { await Promise.resolve() })
  return view
}

beforeEach(() => {
  setUrl('/')
  act(() => {
    useStore.setState({
      appSection: 'projects',
      activeWorkspace: 'default',
      mediaFilter: 'all',
      workspaces: [],
    } as never)
  })
})

it('keeps the URL in sync with store navigation (pushState)', async () => {
  await mount()
  act(() => { state().setAppSection('projects') })
  expect(window.location.pathname).toBe('/projects')
  act(() => { state().setAppSection('queue') })
  expect(window.location.pathname).toBe('/queue')
})

it('serializes the project into the URL for project sections', async () => {
  await mount()
  act(() => {
    useStore.setState({ workspaces: [{ name: 'abc' }], activeWorkspace: 'abc' } as never)
    state().setAppSection('studio')
  })
  expect(window.location.pathname).toBe('/projects/abc/studio')
})

it('applies a deep link once the workspace list loads', async () => {
  setUrl('/projects/abc/medias?filter=videos')
  await mount()
  // Workspace list arrives after mount.
  await act(async () => { useStore.setState({ workspaces: [{ name: 'abc' }] } as never) })
  expect(state().activeWorkspace).toBe('abc')
  expect(state().appSection).toBe('medias')
  expect(state().mediaFilter).toBe('videos')
  expect(window.location.pathname + window.location.search).toBe('/projects/abc/medias?filter=videos')
})

it('falls back when the deep link references an unknown project', async () => {
  setUrl('/projects/nope/studio')
  act(() => { useStore.setState({ workspaces: [{ name: 'abc' }] } as never) })
  await mount()
  // The URL is replaced with the current state's route, no crash.
  expect(window.location.pathname).toBe('/projects')
  expect(state().appSection).toBe('projects')
})

it('applies the URL on popstate (browser Back)', async () => {
  await mount()
  act(() => { state().setAppSection('projects') })
  expect(window.location.pathname).toBe('/projects')
  // Simulate Back to the previous URL.
  setUrl('/queue')
  await act(async () => {
    window.dispatchEvent(new PopStateEvent('popstate'))
    await Promise.resolve()
  })
  expect(state().appSection).toBe('queue')
})

it('keeps media filter changes in the query string', async () => {
  await mount()
  act(() => {
    useStore.setState({ workspaces: [{ name: 'abc' }], activeWorkspace: 'abc' } as never)
    state().setAppSection('medias')
  })
  expect(window.location.pathname).toBe('/projects/abc/medias')
  act(() => { state().setMediaFilter('videos') })
  expect(window.location.pathname + window.location.search).toBe('/projects/abc/medias?filter=videos')
})
