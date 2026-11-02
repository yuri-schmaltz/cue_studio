/**
 * Regression tests for the Director draft autosave.
 *
 * The autosave effect is the only thing that persists the briefing to
 * `director_draft.json`. It used to watch the audio, the analysis, the
 * planned clips and the scene description — but NOT the speaker
 * mappings. Editing a character's name, role or photo therefore
 * changed the UI and then vanished on reload: the draft on disk kept
 * the previous mapping, complete with the `blob:` preview of a photo
 * that no longer existed, and the Director rendered a broken image.
 */

// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { render, act } from '@testing-library/react'

vi.mock('../Director/DirectorReview', () => ({ DirectorReview: () => null }))
vi.mock('../Sidebar/DirectorBriefingColumn', () => ({ DirectorBriefingColumn: () => null }))
vi.mock('../Sidebar/DirectorPlanColumn', () => ({ DirectorPlanColumn: () => null }))
vi.mock('../Director/DirectorRightColumn', () => ({ DirectorRightColumn: () => null }))
vi.mock('./DirectorTourOverlay', () => ({ DirectorTourOverlay: () => null }))
vi.mock('../../lib/useIsMobile', () => ({ useIsMobile: () => false }))

import { DirectorStage } from './DirectorStage'
import { useStore } from '../../stores/useStore'

const FLUSH_AUTOSAVE_MS = 1100

describe('DirectorStage draft autosave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useStore.setState({
      activeWorkspace: 'default',
      directorAudioPath: '/tmp/audio.wav',
      directorAnalysis: null,
      directorPlannedClips: [],
      directorClipPlans: [],
      directorSceneDescription: '',
      directorSongDescription: '',
      directorTechnicalPrompt: '',
      directorSpeakerMappings: [],
      saveDirectorDraftNow: vi.fn().mockResolvedValue(undefined),
    } as never)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('saves the draft when the speaker mappings change', () => {
    const { saveDirectorDraftNow } = useStore.getState()
    render(<DirectorStage />)

    act(() => {
      vi.advanceTimersByTime(FLUSH_AUTOSAVE_MS)
    })
    ;(saveDirectorDraftNow as ReturnType<typeof vi.fn>).mockClear()

    // A photo is picked for a speaker: the mapping gains an imagePath
    // and the autosave must carry it to disk.
    act(() => {
      useStore.setState({
        directorSpeakerMappings: [
          { speakerId: 'SPEAKER_00', name: 'gary', role: 'singing', imagePath: '/uploads/a.jpeg' },
        ],
      } as never)
    })
    act(() => {
      vi.advanceTimersByTime(FLUSH_AUTOSAVE_MS)
    })

    expect(saveDirectorDraftNow).toHaveBeenCalled()
  })

  it('saves the draft when a speaker is renamed', () => {
    const { saveDirectorDraftNow } = useStore.getState()
    useStore.setState({
      directorSpeakerMappings: [
        { speakerId: 'SPEAKER_00', name: 'gary', role: 'singing' },
      ],
    } as never)
    render(<DirectorStage />)

    act(() => {
      vi.advanceTimersByTime(FLUSH_AUTOSAVE_MS)
    })
    ;(saveDirectorDraftNow as ReturnType<typeof vi.fn>).mockClear()

    act(() => {
      useStore.setState({
        directorSpeakerMappings: [
          { speakerId: 'SPEAKER_00', name: 'Gary', role: 'singing' },
        ],
      } as never)
    })
    act(() => {
      vi.advanceTimersByTime(FLUSH_AUTOSAVE_MS)
    })

    expect(saveDirectorDraftNow).toHaveBeenCalled()
  })

  it('does not save an empty briefing', () => {
    useStore.setState({
      directorAudioPath: '',
      directorAnalysis: null,
      directorPlannedClips: [],
      directorClipPlans: [],
      directorSceneDescription: '',
      directorSongDescription: '',
      directorTechnicalPrompt: '',
      directorSpeakerMappings: [],
    } as never)
    const { saveDirectorDraftNow } = useStore.getState()
    render(<DirectorStage />)

    act(() => {
      vi.advanceTimersByTime(FLUSH_AUTOSAVE_MS * 2)
    })

    expect(saveDirectorDraftNow).not.toHaveBeenCalled()
  })
})