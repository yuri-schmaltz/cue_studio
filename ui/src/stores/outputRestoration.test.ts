import { afterEach, describe, expect, it, vi } from 'vitest'
import { useStore } from './useStore'

const initial = useStore.getState()

afterEach(() => {
  useStore.setState(initial, true)
  vi.restoreAllMocks()
})

describe('on-demand output restoration through the public store', () => {
  it('restores mixer tracks without selecting a generation model', async () => {
    const tracks = [{ path: 'voice.wav', volume: 0.8 }]
    const selectModel = vi.fn()
    useStore.setState({
      selectModel,
      selectedOutputMeta: { source: 'sidecar', params: {
        model_type: 'audio_mixer', audio_mixer_tracks: tracks,
      } },
    })
    await useStore.getState().loadSettingsFromOutput()
    expect(useStore.getState().audioSubMode).toBe('mixer')
    expect(useStore.getState().params.audio_mixer_tracks).toEqual(tracks)
    expect(useStore.getState().params.audio_mixer_tracks).not.toBe(tracks)
    expect(selectModel).not.toHaveBeenCalled()
  })

  it('reopens a Director production instead of restoring only its clip', async () => {
    const loadDirectorFromPipeline = vi.fn().mockResolvedValue(undefined)
    useStore.setState({
      loadDirectorFromPipeline,
      selectedOutputMeta: { source: 'sidecar', params: {}, director_pipeline_id: 'production-1' },
    })
    await useStore.getState().loadSettingsFromOutput()
    expect(loadDirectorFromPipeline).toHaveBeenCalledWith('production-1')
  })

  it('recovers metadata that had not arrived when the user clicked', async () => {
    const loadOutputMetadata = vi.fn(async () => {
      useStore.setState({ selectedOutputMeta: { source: 'sidecar', tool: 'film_grain', params: {
        model_type: 'post_processing', intensity: 0.25, saturation: 0.7,
      } } })
    })
    useStore.setState({ selectedOutputMeta: null, loadOutputMetadata,
      filteredOutputs: () => [{ name: 'take.mp4' }] as ReturnType<typeof initial.filteredOutputs>,
      selectedOutput: 0,
    })
    await useStore.getState().loadSettingsFromOutput()
    expect(loadOutputMetadata).toHaveBeenCalledWith('take.mp4')
    expect(useStore.getState().toolsTool).toBe('film_grain')
    expect(useStore.getState().filmGrainIntensity).toBe(0.25)
    expect(useStore.getState().filmGrainSaturation).toBe(0.7)
  })
})
