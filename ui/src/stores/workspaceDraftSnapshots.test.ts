/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useStore } from './useStore'
import * as api from '../api/client'

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client')
  return {
    ...actual,
    saveDirectorDraft: vi.fn().mockResolvedValue({}),
    deleteDirectorDraft: vi.fn().mockResolvedValue({}),
    fetchDirectorDraft: vi.fn().mockResolvedValue(null),
    reconcileScript: vi.fn().mockResolvedValue({
      total_units: 0,
      timed_units: 0,
      untimed_units: 0,
      coverage_ratio: 0,
      has_timecodes: false,
      warnings: [],
      units: [],
    }),
    uploadImage: vi.fn().mockResolvedValue({
      filename: 'a1b2c3d4.png',
      path: '/app/uploads/a1b2c3d4.png',
      url: '/api/v1/uploads/a1b2c3d4.png',
    }),
  }
})

describe('workspaceSlice - Director draft snapshots', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useStore.setState({
      activeWorkspace: 'proj-1',
      activeWorkspaceSetup: null,
      pipelineId: null,
      pipelineStatus: null,
      directorSkill: 'cinematic',
      directorStep: 'plan',
      directorAudioPath: null,
      directorAudioFile: null,
      directorAnalysis: null,
      directorPlannedClips: [],
      directorClipPlans: [],
      directorSceneDescription: '',
      directorDraftSnapshots: [],
    })
  })

  it('starts with empty snapshots array', () => {
    expect(useStore.getState().directorDraftSnapshots).toEqual([])
  })

  it('keeps project defaults when no saved draft exists', async () => {
    useStore.setState({ activeWorkspaceSetup: { aspect_ratio: '9:16', resolution: '480p', music_source: 'upload' } })
    await useStore.getState().loadDirectorDraft('proj-1')
    expect(useStore.getState().directorAspectRatio).toBe('9:16')
    expect(useStore.getState().directorResolution).toBe('480p')
    expect(useStore.getState().directorMusicSource).toBe('upload')
  })

  it('ignores a draft response from the previous workspace', async () => {
    let resolve!: (draft: api.DirectorDraft | null) => void
    vi.mocked(api.fetchDirectorDraft).mockReturnValueOnce(new Promise(done => { resolve = done }))
    const pending = useStore.getState().loadDirectorDraft('proj-1')
    useStore.setState({ activeWorkspace: 'proj-2', directorSceneDescription: 'New project story' })
    resolve(null)
    await pending
    expect(useStore.getState().directorSceneDescription).toBe('New project story')
  })

  it('does not reset a setup saved while an empty draft was pending', async () => {
    let resolve!: (draft: api.DirectorDraft | null) => void
    vi.mocked(api.fetchDirectorDraft).mockReturnValueOnce(new Promise(done => { resolve = done }))
    const pending = useStore.getState().loadDirectorDraft('proj-1')
    const setup = { aspect_ratio: '1:1', resolution: '480p', music_source: 'upload' } as const
    const save = vi.spyOn(api, 'saveWorkspaceSetup').mockResolvedValueOnce(setup)
    await useStore.getState().saveWorkspaceSetup(setup)
    resolve(null)
    await pending
    expect(useStore.getState().directorAspectRatio).toBe('1:1')
    expect(useStore.getState().directorMusicSource).toBe('upload')
    save.mockRestore()
  })

  it('archives a snapshot when planned clips are added', async () => {
    const clips1 = [
      { start: 0, end: 4, label: 'Scene 1' },
      { start: 4, end: 8, label: 'Scene 2' },
    ] as any

    useStore.setState({
      directorPlannedClips: clips1,
      directorSceneDescription: 'A retro detective story',
    })

    await useStore.getState().saveDirectorDraftNow()

    const snapshots = useStore.getState().directorDraftSnapshots
    expect(snapshots.length).toBe(1)
    expect(snapshots[0].plannedClips).toEqual(clips1)
    expect(snapshots[0].sceneDescription).toBe('A retro detective story')
    expect(api.saveDirectorDraft).toHaveBeenCalledTimes(1)
  })

  it('archives a new snapshot only when planned clips change', async () => {
    const clips1 = [{ start: 0, end: 4 }] as any
    const clips2 = [{ start: 0, end: 4 }, { start: 4, end: 10 }] as any

    useStore.setState({ directorPlannedClips: clips1 })
    await useStore.getState().saveDirectorDraftNow()
    expect(useStore.getState().directorDraftSnapshots.length).toBe(1)

    // Saving again with identical clips should NOT duplicate snapshot
    await useStore.getState().saveDirectorDraftNow()
    expect(useStore.getState().directorDraftSnapshots.length).toBe(1)

    // Changing clips should create a second snapshot
    useStore.setState({ directorPlannedClips: clips2 })
    await useStore.getState().saveDirectorDraftNow()
    expect(useStore.getState().directorDraftSnapshots.length).toBe(2)
  })

  it('restores a previous snapshot correctly', async () => {
    const clips1 = [{ start: 0, end: 5, label: 'Version A' }] as any
    const clips2 = [{ start: 0, end: 8, label: 'Version B' }] as any

    useStore.setState({ directorPlannedClips: clips1, directorSceneDescription: 'Desc A' })
    await useStore.getState().saveDirectorDraftNow()

    useStore.setState({ directorPlannedClips: clips2, directorSceneDescription: 'Desc B' })
    await useStore.getState().saveDirectorDraftNow()

    expect(useStore.getState().directorPlannedClips).toEqual(clips2)

    // Restore version A (index 0)
    await useStore.getState().restoreDraftSnapshot(0)

    expect(useStore.getState().directorPlannedClips).toEqual(clips1)
    expect(useStore.getState().directorSceneDescription).toBe('Desc A')
  })

  it('enforces a maximum of 5 snapshots in FIFO order', async () => {
    for (let i = 1; i <= 8; i++) {
      useStore.setState({
        directorPlannedClips: [{ start: 0, end: i, section_label: `Version ${i}`, beat_count: 4, duration_frames: 48, energy: 0.5, suggested_prompt_hint: '' }],
      })
      await useStore.getState().saveDirectorDraftNow()
    }

    const snapshots = useStore.getState().directorDraftSnapshots
    expect(snapshots.length).toBe(5)
    // Oldest should be Version 4, newest Version 8
    expect(snapshots[0].plannedClips?.[0]?.section_label).toBe('Version 4')
    expect(snapshots[4].plannedClips?.[0]?.section_label).toBe('Version 8')
  })

  it('clears snapshots on clearDirectorDraft', async () => {
    useStore.setState({
      directorPlannedClips: [{ start: 0, end: 3 }] as any,
    })
    await useStore.getState().saveDirectorDraftNow()
    expect(useStore.getState().directorDraftSnapshots.length).toBe(1)

    await useStore.getState().clearDirectorDraft()
    expect(useStore.getState().directorDraftSnapshots).toEqual([])
    expect(api.deleteDirectorDraft).toHaveBeenCalledWith('proj-1')
  })

  it('reconciles the restored script against the restored audio', async () => {
    vi.mocked(api.fetchDirectorDraft).mockResolvedValueOnce({
      directorSceneDescription: '0:00 Abertura\n0:12 Cena dois',
      directorAnalysis: { duration: 30 } as any,
      directorStructureSource: 'script',
      directorScriptGranularity: 'beat',
    } as any)

    await useStore.getState().loadDirectorDraft('proj-1')

    expect(api.reconcileScript).toHaveBeenCalledWith({
      scene_description: '0:00 Abertura\n0:12 Cena dois',
      audio_duration: 30,
    })
    expect(useStore.getState().directorStructureSource).toBe('script')
    expect(useStore.getState().directorScriptGranularity).toBe('beat')
  })

  it('does not reconcile when the restored draft has no script', async () => {
    vi.mocked(api.fetchDirectorDraft).mockResolvedValueOnce({
      directorAnalysis: { duration: 30 } as any,
    } as any)

    await useStore.getState().loadDirectorDraft('proj-1')

    expect(api.reconcileScript).not.toHaveBeenCalled()
  })

  it('keeps a speaker photo alive across a reload', async () => {
    useStore.setState({
      directorSceneDescription: 'Um videoclipe',
      directorSpeakerMappings: [{
        speakerId: 'SPEAKER_00',
        name: 'gary',
        role: 'singing',
        imagePath: '/app/uploads/a1b2c3d4.png',
      }],
    })

    await useStore.getState().saveDirectorDraftNow()

    const saved = vi.mocked(api.saveDirectorDraft).mock.calls[0][1] as any
    expect(saved.directorSpeakerMappings[0].imagePath).toBe('/app/uploads/a1b2c3d4.png')

    // The restored draft comes back with the photo, not a dead blob.
    vi.mocked(api.fetchDirectorDraft).mockResolvedValueOnce(saved)
    useStore.setState({ directorSpeakerMappings: [] })
    await useStore.getState().loadDirectorDraft('proj-1')

    const mapping = useStore.getState().directorSpeakerMappings[0]
    expect(mapping.imagePath).toBe('/app/uploads/a1b2c3d4.png')
    expect(mapping.imagePreview ?? null).toBeNull()
  })

  it('never writes a blob preview or a File into the draft', async () => {
    useStore.setState({
      directorSceneDescription: 'Um videoclipe',
      directorSpeakerMappings: [{
        speakerId: 'SPEAKER_00',
        name: 'gary',
        role: 'singing',
        image: new File(['x'], 'gary.png', { type: 'image/png' }),
        imagePreview: 'blob:http://127.0.0.1:7860/dead',
      }],
    })

    await useStore.getState().saveDirectorDraftNow()

    const saved = vi.mocked(api.saveDirectorDraft).mock.calls[0][1] as any
    const mapping = saved.directorSpeakerMappings[0]
    expect(mapping.image).toBeUndefined()
    expect(mapping.imagePreview).toBeUndefined()
  })

  it('uploads a picked speaker photo and keeps its server path', async () => {
    useStore.setState({
      directorSpeakerMappings: [{ speakerId: 'SPEAKER_00', name: 'gary', role: 'singing' }],
    })

    await useStore.getState().directorSetSpeakerImage('SPEAKER_00', new File(['x'], 'gary.png', { type: 'image/png' }))

    expect(api.uploadImage).toHaveBeenCalledTimes(1)
    const mapping = useStore.getState().directorSpeakerMappings[0]
    expect(mapping.imagePath).toBe('/app/uploads/a1b2c3d4.png')
  })

  it('keeps the photo visible when its upload fails', async () => {
    vi.mocked(api.uploadImage).mockRejectedValueOnce(new Error('offline'))
    useStore.setState({
      directorSpeakerMappings: [{ speakerId: 'SPEAKER_00', name: 'gary', role: 'singing' }],
    })

    await useStore.getState().directorSetSpeakerImage('SPEAKER_00', new File(['x'], 'gary.png', { type: 'image/png' }))

    const mapping = useStore.getState().directorSpeakerMappings[0]
    expect(mapping.imagePreview).toBeTruthy()
    expect(mapping.imagePath ?? null).toBeNull()
  })
})
