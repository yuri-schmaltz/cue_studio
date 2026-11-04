// @vitest-environment jsdom
/**
 * Regression test: the Director → Editor handoff.
 *
 * The Editor could import a Director run, but only from the Media Bin's
 * "Director" filter — the Director itself offered no way in, so the
 * natural flow (plan → render → refine on a timeline) dead-ended at an
 * exported MP4. `openDirectorRunInEditor` is the entry point that closes
 * that gap: it makes sure an Editor project exists for the workspace and
 * then imports the run's shots into it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../api/client', () => ({
  fetchEditorProject: vi.fn(),
  createEditorProject: vi.fn(),
  fetchPipelineList: vi.fn(async () => ({ pipelines: [] })),
  fetchOutputs: vi.fn(async () => ({ outputs: [], total: 0 })),
  fetchSavedPipeline: vi.fn(),
  probeEditorMedia: vi.fn(),
  listEditorProjects: vi.fn(async () => ({ projects: [] })),
}))

import { useEditorStore } from './useEditorStore'
import * as api from '../api/client'

describe('openDirectorRunInEditor', () => {
  beforeEach(() => {
    useEditorStore.setState({
      project: null,
      projects: [],
      workspace: 'default',
      error: null,
      directorImportingId: null,
    } as never)
  })

  it('creates an Editor project when the workspace has none', async () => {
    const created = { id: 'proj-1', name: 'Director edit', workspace: 'default', tracks: [], assets: {} }
    ;(api.createEditorProject as ReturnType<typeof vi.fn>).mockResolvedValue(created)
    ;(api.fetchSavedPipeline as ReturnType<typeof vi.fn>).mockResolvedValue({
      pipeline_id: 'pipe-1',
      workspace: 'default',
      pipeline_type: 'music_video',
      clips: [],
      output_files: [],
    })

    await useEditorStore.getState().openDirectorRunInEditor('pipe-1', 'My edit')

    expect(api.createEditorProject).toHaveBeenCalled()
    const call = (api.createEditorProject as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.name).toBe('My edit')
    expect(call.workspace).toBe('default')
  })

  it('reuses the open project when it already belongs to the workspace', async () => {
    const existing = {
      id: 'proj-existing',
      name: 'Existing',
      workspace: 'default',
      tracks: [],
      assets: {},
    }
    useEditorStore.setState({ project: existing } as never)
    ;(api.createEditorProject as ReturnType<typeof vi.fn>).mockClear()
    ;(api.fetchSavedPipeline as ReturnType<typeof vi.fn>).mockResolvedValue({
      pipeline_id: 'pipe-2',
      workspace: 'default',
      pipeline_type: 'music_video',
      clips: [],
      output_files: [],
    })

    await useEditorStore.getState().openDirectorRunInEditor('pipe-2')

    expect(api.createEditorProject).not.toHaveBeenCalled()
    expect(api.fetchSavedPipeline).toHaveBeenCalledWith('pipe-2')
  })

  it('reports the error instead of failing silently', async () => {
    ;(api.createEditorProject as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('disk full'))
    ;(api.listEditorProjects as ReturnType<typeof vi.fn>).mockResolvedValue({ projects: [] })

    const ok = await useEditorStore.getState().openDirectorRunInEditor('pipe-3')

    expect(ok).toBe(false)
    expect(useEditorStore.getState().error).toContain('disk full')
  })
})
