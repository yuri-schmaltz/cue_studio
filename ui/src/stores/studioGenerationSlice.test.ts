import { afterEach, describe, expect, it, vi } from 'vitest'
import { useStore } from './useStore'
import * as api from '../api/client'
import type { ModelDef } from '../types'

const initial = useStore.getState()
afterEach(() => {
  useStore.setState(initial, true)
  vi.restoreAllMocks()
})

describe('Studio submission through the composed store', () => {
  it('previews specialized settings without submitting a job', async () => {
    const submit = vi.spyOn(api, 'submitGeneration')
    useStore.setState({ generationMode: 'avatar', params: { ...initial.params, model_type: '', prompt: 'A careful repair' } })
    await useStore.getState().startGeneration('now', undefined, true)
    expect(useStore.getState().reviewPlan?.mode).toBe('avatar')
    expect(useStore.getState().reviewPlan?.prompt).toBe('A careful repair')
    expect(submit).not.toHaveBeenCalled()
    expect(useStore.getState().jobs).toEqual(initial.jobs)
  })

  it('uses the reviewed snapshot even when the live controls differ', async () => {
    const snapshot = { ...initial, generationMode: 'avatar' as const,
      params: { ...initial.params, model_type: 'reviewed-edit-model', prompt: 'Reviewed idea' } }
    useStore.setState({ params: { ...initial.params, prompt: 'Later edit' } })
    await useStore.getState().startGeneration('now', snapshot, true)
    expect(useStore.getState().reviewPlan?.prompt).toBe('Reviewed idea')
    expect(useStore.getState().reviewPlan?.modelType).toBe('reviewed-edit-model')
    expect(useStore.getState().params.prompt).toBe('Later edit')
  })

  it('rejects an image-to-video request with no start image before dispatch', async () => {
    const submit = vi.spyOn(api, 'submitGeneration')
    const model: ModelDef = { model_type: 'fixture-i2v', name: 'Fixture', family: 'wan', architecture: 'wan',
      is_i2v: true, is_t2v: false, guidance_max_phases: 1, fps: 24 }
    const snapshot = { ...initial, generationMode: 'video' as const, models: [model],
      params: { ...initial.params, model_type: model.model_type, image_mode: 1, prompt: 'A train' },
      startImage: null, clips: [] }
    await useStore.getState().startGeneration('now', snapshot, true)
    expect(submit).not.toHaveBeenCalled()
    expect(useStore.getState().jobs).toEqual(initial.jobs)
  })
})
