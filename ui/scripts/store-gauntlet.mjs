import assert from 'node:assert/strict'
import { build } from 'esbuild'

// Bundle the actual store so these contracts exercise its composition too.
const result = await build({
  stdin: {
    contents: `export { useStore } from './src/stores/useStore';
      export { trackAnalysisProgress } from './src/stores/analysisProgress';
      export { toggleLoraState, updateLoraWeight } from './src/stores/loraState';
      export { canonicalDirectorSkill } from './src/types';
      export { saveModeSettings, loadModeSettings, persistStickyStudioPreferences, modeBlobToLoraIdKeyed, modeBlobToFilenameKeyed, stripEphemeralParams } from './src/stores/studioPersistence';`,
    resolveDir: process.cwd(), loader: 'ts',
  },
  bundle: true, write: false, format: 'esm', platform: 'node',
  define: { 'import.meta.hot': 'undefined' },
})
const { useStore, trackAnalysisProgress, toggleLoraState, updateLoraWeight, canonicalDirectorSkill, saveModeSettings, loadModeSettings, persistStickyStudioPreferences, modeBlobToLoraIdKeyed, modeBlobToFilenameKeyed, stripEphemeralParams } =
  await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
const original = useStore.getState()
const pending = []
globalThis.fetch = (url, options) => new Promise(resolve => pending.push({ url, options, resolve }))
const respond = (request, data) => request.resolve(new Response(JSON.stringify({ setup: data })))

useStore.setState({ activeWorkspace: 'alpha' })
const alpha = useStore.getState().loadWorkspaceSetup('alpha')
useStore.setState({ activeWorkspace: 'beta' })
const beta = useStore.getState().loadWorkspaceSetup('beta')
respond(pending[1], { aspect_ratio: '9:16', music_source: 'generate', music_model: 'beta-music' })
await beta
respond(pending[0], { aspect_ratio: '4:3', music_source: 'upload', music_model: 'alpha-music' })
await alpha
assert.equal(useStore.getState().directorAspectRatio, '9:16')
assert.equal(useStore.getState().directorMusicModel, 'beta-music')
assert.equal(useStore.getState().activeWorkspaceSetupLoading, false)

const save = useStore.getState().saveWorkspaceSetup({ aspect_ratio: '1:1' })
useStore.setState({ activeWorkspace: 'gamma' })
respond(pending[2], { aspect_ratio: '1:1' })
await save
assert.equal(useStore.getState().directorAspectRatio, '9:16', 'late save must not change another project')

let resolveStatus
const events = []
let current = true
const progress = trackAnalysisProgress(
  () => new Promise(resolve => { resolveStatus = resolve }),
  value => events.push(value), () => current,
)
const tick = progress.refresh()
resolveStatus({ step: 'transcribing', detail: 'Transcribing', current: 2, total: 6 })
await tick
assert.equal(events.at(-1).current, 2)
const lateTick = progress.refresh()
progress.finish('done')
resolveStatus({ step: 'late', detail: 'Old response', current: 3, total: 6 })
await lateTick
assert.equal(events.at(-1).status, 'done')
assert.equal(events.at(-1).current, 6)
const resetProgress = trackAnalysisProgress(async () => ({ step: 'old', detail: '', current: 1, total: 2 }),
  value => events.push(value), () => current)
const beforeReset = events.length
current = false
await resetProgress.refresh()
resetProgress.finish('error')
assert.equal(events.length, beforeReset, 'reset invalidates old progress')
const errors = []
const failed = trackAnalysisProgress(async () => { throw new Error('offline') }, value => errors.push(value), () => true)
await failed.refresh()
failed.finish('error')
assert.equal(errors.at(-1).status, 'error')

const toggled = toggleLoraState([], {}, 'actor.safetensors', 3)
assert.equal(toggled.multipliers, '1.00;1.00;1.00')
const weighted = updateLoraWeight(toggled.activatedLoras, toggled.weights, 'actor.safetensors', 1, 0.7, 3)
assert.equal(weighted.multipliers, '1.00;0.70;1.00')
assert.deepEqual(toggled.weights['actor.safetensors'], [1, 1, 1], 'weights are immutable')
assert.equal(canonicalDirectorSkill('demo_local_skill'), 'demo_local_skill')

useStore.setState(original, true)
let submitted
// Exercise actual request construction while stopping before any generation.
globalThis.fetch = async (url, options) => {
  if (options?.method === 'POST') {
    submitted = JSON.parse(options.body)
    return new Response(JSON.stringify({ detail: 'Fixture: generation deliberately stopped' }), { status: 400 })
  }
  return new Response(JSON.stringify({}))
}
useStore.setState({ activeWorkspace: 'fixture', directorSceneDescription: 'A quiet station', directorSkill: 'demo_local_skill' })
useStore.getState().applyWorkspaceSetup({
  video_model: 'fixture-video', image_model: 'fixture-image',
  music_source: 'generate', music_model: 'fixture-music',
  advanced: { video_film_grain_intensity: 0.2, video_num_inference_steps: 12, video_self_refiner: 2,
    image_spatial_upsampling: 'lanczos2', untrusted_extra: 'must not leak' },
  default_video_loras: { activated_loras: ['actor.safetensors'], loras_multipliers: '0.70',
    loraWeights: { 'actor.safetensors': [0.7] } },
})
await useStore.getState().startDirectorPipeline()
assert.equal(submitted.skill_type, 'demo_local_skill')
assert.equal(submitted.video_film_grain_intensity, 0.2)
assert.equal(submitted.video_params.num_inference_steps, 12)
assert.equal(submitted.video_self_refiner, 2)
assert.equal(submitted.image_spatial_upsampling, 'lanczos2')
assert.deepEqual(submitted.video_loras.activated_loras, ['actor.safetensors'])
assert.equal(submitted.untrusted_extra, undefined)
useStore.getState().setDirectorVideoFilmGrainIntensity(0.4)
await useStore.getState().startDirectorPipeline()
assert.equal(submitted.video_film_grain_intensity, 0.4, 'per-take edit wins over project defaults')
useStore.getState().applyWorkspaceSetup({ advanced: {}, music_model: '' })
assert.equal(useStore.getState().directorVideoFilmGrainIntensity, 0)
assert.equal(useStore.getState().directorVideoInferenceStepsByModel['fixture-video'], undefined)
assert.equal(useStore.getState().directorMusicModel, original.directorMusicModel)
useStore.setState(original, true)
// Round-trip the real mode-switch action without model/network initialization.
globalThis.fetch = async () => new Response('{}')
globalThis.localStorage = { getItem: () => null, setItem: () => {} }
useStore.setState({ params: { ...original.params, model_type: '', prompt: 'Video prompt', seed: 101 },
  models: [], families: [], enabledModels: new Set() })
useStore.getState().setGenerationMode('image')
useStore.getState().setParam('prompt', 'Image prompt')
useStore.getState().setParam('seed', 202)
useStore.getState().setGenerationMode('video')
assert.equal(useStore.getState().params.prompt, 'Video prompt')
assert.equal(useStore.getState().params.seed, 101)
useStore.getState().setGenerationMode('image')
assert.equal(useStore.getState().params.prompt, 'Image prompt')
assert.equal(useStore.getState().params.seed, 202)
useStore.getState().setStudioImageWorkflow('outpaint')
assert.equal(useStore.getState().params.image_mode, 2)
useStore.getState().setStudioImageWorkflow('upscale')
assert.equal(useStore.getState().generationMode, 'tools')
assert.equal(useStore.getState().toolsUpscaleMedia, 'image')
useStore.getState().setGenerationMode('image')
assert.equal(useStore.getState().params.seed, 202)
useStore.setState(original, true)

// --- Cancel contracts (Director analyze / track / image-gen + unified cancelPlan) ---
// No-op call must return false and not throw. This guards the "user clicked
// cancel while nothing was running" path used by the unified cancel button.
assert.equal(useStore.getState().cancelDirectorAnalyze(), false, 'analyze cancel is a no-op when idle')
assert.equal(useStore.getState().cancelDirectorTrackGen(), false, 'track-gen cancel is a no-op when idle')
assert.equal(useStore.getState().cancelDirectorImageGen(), false, 'image-gen cancel is a no-op when idle')

// cancelPlan returns the full structured result with all six fields, even
// when no phase is active. Type contract that the UI / tests rely on.
const empty = await useStore.getState().cancelPlan()
assert.deepEqual(Object.keys(empty).sort(), [
  'cancelledAnalyze', 'cancelledImageGen', 'cancelledJobs',
  'cancelledPipeline', 'cancelledTrackGen', 'cancelledV2Plan',
], 'cancelPlan returns the documented shape')
assert.equal(empty.cancelledAnalyze, false)
assert.equal(empty.cancelledTrackGen, false)
assert.equal(empty.cancelledImageGen, false)
assert.equal(empty.cancelledV2Plan, false)
assert.equal(empty.cancelledPipeline, false)
assert.equal(empty.cancelledJobs, 0)

// Drive an analyze flow against a fetch that never resolves, then cancel.
// The handler must flip directorStep back to 'upload' and clear loading.
let analyzeFetchStarted = false
globalThis.fetch = async (url, options) => {
  const path = String(url).split('?')[0]
  if (path === '/api/v1/audio/analyze/status') {
    return new Response(JSON.stringify({ step: 'transcribing', detail: '', current: 1, total: 6, status: 'running' }))
  }
  if (path === '/api/v1/audio/analyze') {
    analyzeFetchStarted = true
    // Honor the abort signal so the cancel actually settles the pending promise.
    return new Promise((resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })
  }
  if (path === '/api/v1/upload-audio') {
    return new Response(JSON.stringify({ filename: 'song.mp3', path: '/uploads/song.mp3', url: '/uploads/song.mp3' }))
  }
  return new Response('{}')
}
const pendingAnalyze = useStore.getState().directorAnalyzeAndPlan('/uploads/song.mp3', { transcribe: true })
// Give the analyze handler a tick to start its fetch.
await new Promise(resolve => setTimeout(resolve, 0))
await new Promise(resolve => setTimeout(resolve, 50))
assert.equal(analyzeFetchStarted, true, 'analyze request is in flight')
assert.equal(useStore.getState().cancelDirectorAnalyze(), true, 'analyze cancel flips active phase')
const cancelledState = useStore.getState()
assert.equal(cancelledState.directorStep, 'upload', 'analyze cancel returns to upload step')
assert.equal(cancelledState.directorLoading, false)
assert.equal(cancelledState.directorLoadingMessage, null)
// Allow the pendingAnalyze promise to settle; the catch is silent because
// the controller aborted it.
await pendingAnalyze.catch(() => undefined)
// After cancel the action must be a no-op (no double-cancel side effects).
assert.equal(useStore.getState().cancelDirectorAnalyze(), false, 'analyze cancel is idempotent')

// Track-gen cancel: stub generateMusic to never resolve.
let trackFetchStarted = false
globalThis.fetch = async (url, options) => {
  const path = String(url).split('?')[0]
  if (path === '/api/v1/director/generate-music') {
    trackFetchStarted = true
    return new Promise((resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })
  }
  if (path.startsWith('/api/v1/status/')) {
    return new Response(JSON.stringify({ status: 'running', phase: 'sampling', step: 5, total_steps: 50, progress: 10 }))
  }
  if (path === '/api/v1/upload-image') {
    return new Response(JSON.stringify({ filename: 'ref.png', path: '/uploads/ref.png', url: '/uploads/ref.png' }))
  }
  return new Response('{}')
}
useStore.setState({
  directorSongDescription: 'a calm piano ballad',
  directorSongStyle: '',
  directorSongLyrics: '',
  directorSongInstrumental: false,
  directorSongDuration: 60,
  directorReferenceImage: null,
  directorReferenceImagePath: '/uploads/ref.png',
})
const pendingTrack = useStore.getState().directorGenerateTrack()
await new Promise(resolve => setTimeout(resolve, 0))
await new Promise(resolve => setTimeout(resolve, 50))
assert.equal(trackFetchStarted, true, 'track-gen request is in flight')
assert.equal(useStore.getState().directorTrackGenerating, true)
assert.equal(useStore.getState().cancelDirectorTrackGen(), true, 'track-gen cancel flips active phase')
const cancelledTrack = useStore.getState()
assert.equal(cancelledTrack.directorTrackGenerating, false)
assert.equal(cancelledTrack.directorLoading, false)
assert.equal(cancelledTrack.directorStep, 'upload')
await pendingTrack.catch(() => undefined)
assert.equal(useStore.getState().cancelDirectorTrackGen(), false, 'track-gen cancel is idempotent')

// Image-gen cancel: stub submitGeneration to return a job id, then have
// status never resolve until cancelJob is called. The cancel must call
// api.cancelJob AND unblock the status promise.
let cancelCalled = null
let pendingStatus = []
globalThis.fetch = async (url, options) => {
  const path = String(url).split('?')[0]
  if (path === '/api/v1/generate') {
    return new Response(JSON.stringify({ job_id: 'fake-job-1', status: 'queued' }))
  }
  if (path.startsWith('/api/v1/status/fake-job-1')) {
    return new Promise(resolve => {
      pendingStatus.push(resolve)
    })
  }
  if (path === '/api/v1/cancel/fake-job-1') {
    cancelCalled = true
    // Resolve any pending status poll with a 'cancelled' so the while loop
    // returns through its normal completion path.
    for (const resolve of pendingStatus.splice(0)) {
      resolve(new Response(JSON.stringify({ status: 'cancelled', output_files: [] })))
    }
    return new Response('{}')
  }
  if (path === '/api/v1/llm/status') return new Response(JSON.stringify({ loaded: false }))
  if (path === '/api/v1/llm/unload') return new Response(JSON.stringify({ ok: true }))
  if (path.startsWith('/api/v1/upload-image')) return new Response(JSON.stringify({ filename: 'ref.png', path: '/uploads/ref.png', url: '/uploads/ref.png' }))
  if (path === '/api/v1/director/refs/upload') return new Response(JSON.stringify({ ref_image_path: '/uploads/ref.png', char_paths: [], loc_paths: [] }))
  return new Response('{}')
}
useStore.setState({
  directorClipPlans: [
    { image_prompt: 'a calm forest', video_prompt: 'calm forest pan' },
  ],
  directorPlannedClips: [
    { id: 'c1', section_label: 'verse', duration_frames: 48, start_time: 0, energy: 0.3 },
  ],
  directorReferenceImage: null,
  directorReferenceImagePath: '/uploads/ref.png',
  directorImageGenProgress: null,
})
// Fire the image-gen flow but don't await it — the inner genImage poll
// loop awaits a stub fetchJobStatus that never resolves by itself. The
// contract under test is the cancel action's state mutation, server-side
// cancel call, and idempotence, all observable without waiting for the
// function to settle. The pendingImageGen handle stays around so the
// unhandled-rejection doesn't crash the suite.
const pendingImageGen = useStore.getState().directorGenerateStartImages().catch(() => undefined)
await new Promise(resolve => setTimeout(resolve, 50))
assert.equal(useStore.getState().directorStep, 'generate_images', 'image-gen enters its phase')
assert.equal(useStore.getState().cancelDirectorImageGen(), true, 'image-gen cancel flips active phase')
assert.equal(cancelCalled, true, 'image-gen cancel routes through api.cancelJob')
const cancelledImage = useStore.getState()
assert.equal(cancelledImage.directorStep, 'review', 'image-gen cancel drops to prompt review')
assert.equal(cancelledImage.directorLoading, false)
assert.equal(useStore.getState().cancelDirectorImageGen(), false, 'image-gen cancel is idempotent')
// Detach the pending promise so Node's top-level await doesn't see it as
// unsettled after the rest of the gauntlet finishes.
pendingImageGen.catch(() => undefined)

useStore.setState(original, true)
globalThis.fetch = (url, options) => new Promise(resolve => pending.push({ url, options, resolve }))

// --- Storage contracts (projectsRoot, workspaceSlice) ---
// The hydration action and setter route through the api client. Stub
// fetch with a deterministic projectsRoot shape so we can assert the
// round-trip without touching the real backend.
let projectsRootCallCount = 0
let lastSetPayload = null
globalThis.fetch = async (url, options) => {
  projectsRootCallCount += 1
  const method = options?.method || 'GET'
  if (String(url).endsWith('/api/v1/settings/projects-root') && method === 'GET') {
    return new Response(JSON.stringify({
      configured_path: '',
      default_path: 'outputs',
      effective_path: '/home/user/Videos',
      exists: true,
      writable: true,
    }))
  }
  if (String(url).endsWith('/api/v1/settings/projects-root') && method === 'PUT') {
    lastSetPayload = JSON.parse(options.body)
    // Empty path → backend returns the default effective_path.
    const effective = lastSetPayload.path || '/home/user/Videos'
    return new Response(JSON.stringify({
      configured_path: lastSetPayload.path,
      default_path: 'outputs',
      effective_path: effective,
      exists: true,
      writable: true,
    }))
  }
  // Stub loadWorkspaces triggered by setProjectsRoot on success.
  if (String(url).endsWith('/api/v1/workspaces') && method === 'GET') {
    return new Response(JSON.stringify({ workspaces: [{ name: 'default', path: '/home/user/Videos', file_count: 0, modified: 0, setup: {} }], active: 'default' }))
  }
  return new Response('{}')
}
useStore.setState({ projectsRoot: null })
await useStore.getState().loadProjectsRoot()
let stp = useStore.getState()
assert.ok(stp.projectsRoot, 'loadProjectsRoot hydrates the store')
assert.equal(stp.projectsRoot.effective_path, '/home/user/Videos')
assert.equal(stp.projectsRoot.configured_path, '')
assert.equal(stp.projectsRoot.writable, true)
assert.equal(projectsRootCallCount, 1, 'loadProjectsRoot issues exactly one GET')
// Setter: empty path reverts to default; the backend then returns the
// effective path under the OS-default folder.
lastSetPayload = null
const reverted = await useStore.getState().setProjectsRoot('')
assert.equal(lastSetPayload.path, '', 'empty path is sent as-is')
assert.equal(reverted.configured_path, '')
assert.equal(reverted.effective_path, '/home/user/Videos')
stp = useStore.getState()
assert.equal(stp.projectsRoot.configured_path, '')
// Setter: custom path is persisted.
lastSetPayload = null
const customInfo = await useStore.getState().setProjectsRoot('/mnt/media/Maestro')
assert.equal(lastSetPayload.path, '/mnt/media/Maestro')
assert.equal(customInfo.configured_path, '/mnt/media/Maestro')
assert.equal(customInfo.effective_path, '/mnt/media/Maestro')
stp = useStore.getState()
assert.equal(stp.projectsRoot.configured_path, '/mnt/media/Maestro')
// Setter refreshes the workspace list so the gallery picks up the new
// layout. The PUT triggers one GET for loadWorkspaces.
assert.ok(projectsRootCallCount >= 3, 'setProjectsRoot refreshes loadWorkspaces')
useStore.setState(original, true)

console.log('Cancel contracts passed: analyze / track-gen / image-gen idempotent cancels, abort signals, server-side job cancellation and unified cancelPlan shape.')
console.log('Storage contracts passed: loadProjectsRoot hydration, setProjectsRoot empty revert and custom path persistence, workspace refresh on save.')
console.log('Store contracts passed: workspace races, late saves, progress lifecycle, LoRA phases, plugin identity, mode snapshots and workflow routing.')

// --- Persistence contracts (studioPersistence, no store instance) ---
let memory = new Map()
globalThis.localStorage = {
  getItem: key => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: key => memory.delete(key),
  clear: () => memory.clear(),
}
assert.equal(loadModeSettings(), null, 'empty storage loads null')
saveModeSettings({
  generationMode: 'video',
  selectedModelPerMode: { video: 'ltx-2' },
  savedParamsPerMode: {
    video: { prompt: 'kept', video_source: '/app/uploads/ghost.mp4', video_prompt_type: 'OBN' },
  },
  savedLoraPerMode: {},
})
let loaded = loadModeSettings()
assert.equal(loaded.generationMode, 'video')
assert.equal(loaded.savedParamsPerMode.video.prompt, 'kept')
assert.equal(loaded.savedParamsPerMode.video.video_source, undefined, 'ephemeral media must not round-trip')
assert.equal(loaded.savedParamsPerMode.video.video_prompt_type, 'OBN', 'non-T flag preserved')
memory.clear()
saveModeSettings({
  generationMode: 'video',
  selectedModelPerMode: { video: 'wan' },
  savedParamsPerMode: {
    video: { video_prompt_type: 'TVG', video_source: '/x.mp4' },
  },
  savedLoraPerMode: {},
})
loaded = loadModeSettings()
assert.equal(loaded.savedParamsPerMode.video.video_prompt_type, 'TVG', 'internal T control letter preserved')
assert.equal(loaded.savedParamsPerMode.video.video_source, undefined)
memory.clear()
saveModeSettings({
  generationMode: 'video',
  selectedModelPerMode: { video: 'wan' },
  savedParamsPerMode: {
    video: { video_prompt_type: 'WAN2_T' },
  },
  savedLoraPerMode: {},
})
loaded = loadModeSettings()
assert.equal(loaded.savedParamsPerMode.video.video_prompt_type, 'WAN2_', 'trailing lone T flag stripped')
// Legacy save (no lora map) writes filename-keyed storage; load returns raw shape.
assert.equal(stripEphemeralParams({ video: { seed: 1, video_mask: '/m.png' } }).video.seed, 1)
assert.equal(stripEphemeralParams({ video: { video_mask: '/m.png' } }).video.video_mask, undefined)
// LoRA lora_id round-trip with a shared civitai id across two file versions.
memory.clear()
saveModeSettings({
  generationMode: 'video',
  selectedModelPerMode: { video: 'h3' },
  savedParamsPerMode: {},
  savedLoraPerMode: {
    video: {
      activated_loras: ['actor_v1.safetensors'],
      loras_multipliers: '0.70',
      loraWeights: { 'actor_v1.safetensors': [0.7], 'actor_v2.safetensors': [1.0] },
      availableLoras: ['actor_v1.safetensors', 'actor_v2.safetensors'],
    },
  },
}, { 'actor_v1.safetensors': 'civitai:555', 'actor_v2.safetensors': 'civitai:555' })
loaded = loadModeSettings()
assert.deepEqual(loaded.savedLoraPerMode.video.activated_loras, ['actor_v1.safetensors'])
assert.deepEqual([...loaded.savedLoraPerMode.video.availableLoras].sort(), ['actor_v1.safetensors', 'actor_v2.safetensors'])
assert.deepEqual(loaded.savedLoraPerMode.video.loraWeights['actor_v2.safetensors'], [1.0], 'multi-version A/B weights survive the round trip')
assert.equal(loaded.savedLoraPerMode.video.loras_multipliers, '0.70')
assert.equal(
  modeBlobToLoraIdKeyed({ activated_loras: ['x.safetensors'], loras_multipliers: '1', loraWeights: {}, availableLoras: [] }, { 'x.safetensors': 'civitai:1' }).activated_loras[0],
  'civitai:1')
// Sticky UI fields survive a later partial (LoRA-only) save.
memory.clear()
saveModeSettings({
  generationMode: 'image', selectedModelPerMode: {}, savedParamsPerMode: {}, savedLoraPerMode: {},
  savedPromptPerMode: { image: 'p' },
  studioVideoWorkflow: 'create', studioImageWorkflow: 'generate', audioSubMode: 'speech',
  selectedModelPerAudioSubMode: { speech: 'kugel' },
  h3OptimizationPreferences: { override_attention: 'sla' },
}, {})
saveModeSettings({ generationMode: 'image', selectedModelPerMode: {}, savedParamsPerMode: {}, savedLoraPerMode: {} }, {})
loaded = loadModeSettings()
assert.equal(loaded.studioVideoWorkflow, 'create')
assert.equal(loaded.audioSubMode, 'speech')
assert.equal(loaded.h3OptimizationPreferences.override_attention, 'sla')
// Sticky preferences: durable tools→image generation mode, server payload, failed-save resilience.
const persisted = []
const updates = []
persistStickyStudioPreferences(
  {
    generationMode: 'tools', toolsUpscaleMedia: 'image',
    selectedModelPerMode: {}, audioSubMode: 'speech',
    selectedModelPerAudioSubMode: {}, h3OptimizationPreferences: {},
    studioVideoWorkflow: 'create', studioImageWorkflow: 'generate',
    savedParamsPerMode: {}, savedLoraPerMode: {}, loraIdByFilename: {},
  },
  settings => persisted.push(settings.generationMode),
  async update => { updates.push(update); throw new Error('offline') },
)
persistStickyStudioPreferences(
  {
    generationMode: 'video', toolsUpscaleMedia: 'video',
    selectedModelPerMode: { video: 'h3' }, audioSubMode: 'music',
    selectedModelPerAudioSubMode: { music: 'ace_step_v1_5_xl_sft_lm_4b' }, h3OptimizationPreferences: {},
    studioVideoWorkflow: 'create', studioImageWorkflow: 'generate',
    savedParamsPerMode: {}, savedLoraPerMode: {}, loraIdByFilename: { 'a.safetensors': 'civitai:1' },
  },
  settings => persisted.push(settings.generationMode),
  async update => { updates.push(update) },
)
await new Promise(resolve => setTimeout(resolve, 0))
await new Promise(resolve => setTimeout(resolve, 0))
assert.deepEqual(persisted, ['image', 'video'], 'tools mode persists as its durable image workflow')
assert.equal(updates[0].generation_mode, 'image')
assert.equal(updates[1].generation_mode, 'video')
assert.equal(updates[1].selected_model_per_mode.video, 'h3')
assert.equal(updates[1].audio_sub_mode, 'music')
assert.equal(updates[1].selected_model_per_audio_sub_mode.music, 'ace_step_v1_5_xl_sft_lm_4b')
assert.equal(updates.length, 2, 'a failed preference save must not poison the queue')
console.log('Persistence contracts passed: ephemeral strip, legacy/lora_id shapes, sticky preservation and queued preference mirror.')

// --- Slice contracts: studioModelSlice + studioModeSlice (composed store) ---
// Deterministic catalog. The ids deliberately overlap DEFAULTS_ADDED_IN so
// the curated-defaults upgrade path is exercised (storedVer 1 -> v11).
const SLICE_CATALOG = [
  { model_type: 'ltx2_22B_distilled_1_1', name: 'LTX', family: 'ltx2', architecture: 'ltx2_22B', is_i2v: true, is_t2v: true, guidance_max_phases: 1, fps: 24 },
  { model_type: 'minimax_h3', name: 'H3', family: 'minimax_h3', architecture: 'minimax_h3', is_i2v: true, is_t2v: true, guidance_max_phases: 1, fps: 16 },
  { model_type: 'minimax_h3_ref2va', name: 'H3 Omni', family: 'minimax_h3', architecture: 'minimax_h3_ref2va', is_i2v: true, is_t2v: true, guidance_max_phases: 1, fps: 16, omni_reference: true },
  { model_type: 'scail2_14B', name: 'SCAIL', family: 'scail2', architecture: 'scail2_14B', is_i2v: true, is_t2v: true, guidance_max_phases: 1, fps: 16 },
  { model_type: 'scail2_14B_fast', name: 'SCAIL Fast', family: 'scail2', architecture: 'scail2_14B', is_i2v: true, is_t2v: true, guidance_max_phases: 1, fps: 16 },
  { model_type: 'scail2_14B_recast_fast', name: 'SCAIL Recast', family: 'scail2', architecture: 'scail2_14B', is_i2v: true, is_t2v: true, guidance_max_phases: 1, fps: 16 },
  { model_type: 'ltx2_25', name: 'LTX25', family: 'ltx25', architecture: 'ltx2_25', is_i2v: true, is_t2v: true, guidance_max_phases: 1, fps: 24 },
  { model_type: 'krea2_raw', name: 'Krea', family: 'krea2', architecture: 'krea2', is_i2v: false, is_t2v: false, guidance_max_phases: 1, fps: 0 },
  { model_type: 'minimax_music3', name: 'Music3', family: 'tts', architecture: 'minimax_music3', is_i2v: false, is_t2v: false, guidance_max_phases: 1, fps: 0 },
]
const SLICE_MODEL_OPTIONS = {
  name: 'fixture', fps: 16, guidance_max_phases: 1,
  resolution_preset_order: [], supports_auto_aspect: true,
  default_num_inference_steps: 20, default_guidance_scale: 5,
}
let visibilityFixture = {
  configured: true, enabled_models: ['ltx2_22B_distilled_1_1', 'minimax_h3'],
  initialized_mature_models: [], defaults_version: 1,
}
const defaultEnabled = new Set(original.enabledModels)
globalThis.localStorage = {
  getItem: key => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: key => memory.delete(key),
  clear: () => memory.clear(),
}
memory.clear()
globalThis.fetch = async (url, options) => {
  const path = String(url).split('?')[0]
  const method = options?.method || 'GET'
  let body = {}
  if (path === '/api/v1/models') body = { families: [], models: SLICE_CATALOG }
  else if (path === '/api/v1/model-visibility') body = visibilityFixture
  else if (path === '/api/v1/h3-window-overrides') body = { overrides: {} }
  else if (path === '/api/v1/studio-preferences') body = method === 'GET' ? { configured: false } : {}
  else if (path.endsWith('/loras/installed')) body = { loras: [] }
  else if (path.endsWith('/loras/check-updates')) body = {}
  else if (path.startsWith('/api/v1/loras/')) body = { loras: ['style.safetensors'], guidance_max_phases: 1 }
  else if (path.startsWith('/api/v1/model-options/')) body = SLICE_MODEL_OPTIONS
  else if (path.startsWith('/api/v1/defaults/')) body = {}
  return new Response(JSON.stringify(body), { status: 200 })
}
useStore.setState(original, true)
await useStore.getState().loadModels()
let st = useStore.getState()
assert.equal(st.modelsLoaded, true, 'models load marks loaded')
assert.equal(st.params.model_type, 'ltx2_22B_distilled_1_1', 'boot defaults to the curated video model')
assert.equal(st.selectedModelPerMode.video, 'ltx2_22B_distilled_1_1')
assert.equal(memory.get('cue-studio_defaults_version'), '11', 'curated defaults upgrade stamps the version')
for (const id of ['scail2_14B_recast_fast', 'minimax_h3_ref2va', 'ltx2_25', 'minimax_music3']) {
  assert.equal(st.enabledModels.has(id), true, `${id} enabled by the curated defaults upgrade`)
}
// Server visibility hydrates exactly once: a later different server
// visibility must not re-apply over the (migrated) local explicit set.
visibilityFixture = {
  configured: true, enabled_models: ['minimax_music3'],
  initialized_mature_models: [], defaults_version: 11,
}
await useStore.getState().loadModels()
st = useStore.getState()
assert.equal(st.enabledModels.size, SLICE_CATALOG.length, 'visibility hydrates once across reloads')
assert.equal(st.enabledModels.has('krea2_raw'), true, 'migrated member survives a stale second load')
// Enabled-model actions write through to the backend mirror + localStorage.
useStore.getState().toggleModelEnabled('krea2_raw')
st = useStore.getState()
assert.equal(st.enabledModels.has('krea2_raw'), false, 'toggle disables the curated member')
assert.equal(JSON.parse(memory.get('cue-studio_enabled_models')).includes('krea2_raw'), false, 'disable persists to localStorage')
useStore.getState().setAllModelsEnabled(true)
st = useStore.getState()
assert.equal(st.enabledModels.has('mmaudio_nsfw'), true, 'virtual SFX joins the all-enabled set')
useStore.getState().setModelsEnabled(['minimax_music3'], false)
st = useStore.getState()
assert.equal(st.enabledModels.has('minimax_music3'), false)
assert.equal(JSON.parse(memory.get('cue-studio_enabled_models')).includes('minimax_music3'), false, 'bulk disable persists')
useStore.getState().resetEnabledModels()
st = useStore.getState()
assert.deepEqual(new Set(st.enabledModels), defaultEnabled, 'reset restores the curated default whitelist')
assert.deepEqual(JSON.parse(memory.get('cue-studio_enabled_models')), [...defaultEnabled], 'reset persists the curated whitelist')
useStore.setState({ settingsOpen: false })
useStore.getState().openModelVisibility('video')
st = useStore.getState()
assert.equal(st.settingsOpen, true)
assert.equal(st.settingsTab, 'performance')
assert.equal(st.modelVisibilityFocus, 'video')
useStore.getState().clearModelVisibilityFocus()
assert.equal(useStore.getState().modelVisibilityFocus, null)
// selectModel reseeds the per-mode map and resets the LoRA runtime.
useStore.getState().setGenerationMode('video')
useStore.getState().selectModel('minimax_h3')
st = useStore.getState()
assert.equal(st.params.model_type, 'minimax_h3')
assert.equal(st.selectedModelPerMode.video, 'minimax_h3')
assert.deepEqual(st.params.activated_loras, [])
assert.equal(st.params.loras_multipliers, '')
assert.deepEqual(st.loraWeights, {})
assert.deepEqual(st.availableLoras, [])
await new Promise(resolve => setTimeout(resolve, 0))
st = useStore.getState()
assert.equal(st.lorasLoading, false)
assert.deepEqual(st.availableLoras, ['style.safetensors'], 'LoRAs hydrate for the chosen model')
// LoRA toggle/weight round-trips per-mode persistence through the store.
useStore.getState().toggleLora('style.safetensors')
st = useStore.getState()
assert.deepEqual(st.params.activated_loras, ['style.safetensors'])
assert.equal(st.params.loras_multipliers, '1.00')
assert.deepEqual(st.savedLoraPerMode.video.activated_loras, ['style.safetensors'])
assert.deepEqual(JSON.parse(memory.get('cue-studio_mode_settings')).savedLoraPerMode.video.activated_loras, ['style.safetensors'], 'LoRA toggle persists per mode')
useStore.getState().setLoraWeight('style.safetensors', 0, 0.75)
st = useStore.getState()
assert.equal(st.params.loras_multipliers, '0.75')
assert.deepEqual(st.loraWeights['style.safetensors'], [0.75])
assert.equal(JSON.parse(memory.get('cue-studio_mode_settings')).savedLoraPerMode.video.loras_multipliers, '0.75', 'LoRA weight persists per mode')
// Avatar edit recipes swap SCAIL-2 models and restore the prior avatar model.
useStore.setState({
  generationMode: 'avatar',
  editSubMode: 'retake',
  params: { ...useStore.getState().params, model_type: 'ltx2_22B_distilled_1_1', activated_loras: [], loras_multipliers: '' },
})
useStore.getState().setEditSubMode('recast')
st = useStore.getState()
assert.equal(st.params.model_type, 'scail2_14B_recast_fast', 'recast swaps to its curated model')
assert.equal(st.selectedModelPerMode.avatar, 'scail2_14B_recast_fast')
useStore.getState().setEditSubMode('restyle')
assert.equal(useStore.getState().params.model_type, 'scail2_14B_fast', 'restyle swaps to the Restyle recipe')
useStore.getState().setEditSubMode('retake')
assert.equal(useStore.getState().params.model_type, 'ltx2_22B_distilled_1_1', 'leaving SCAIL edit restores the prior avatar model')
// Edit input mappings: repaint clamps to 5 slots, recast derives + clamps.
const nineMaps = Array.from({ length: 9 }, (_, i) => ({
  id: `m${i}`, target: i === 0 ? 'figure' : 'person',
  refFile: null, refPath: '', refUrl: '', referenceAlignedToSource: false,
}))
useStore.getState().setEditRepaintMappings(nineMaps)
assert.equal(useStore.getState().editRepaintMappings.length, 5, 'repaint mappings clamp to five slots')
const sevenMaps = Array.from({ length: 7 }, (_, i) => ({
  ...nineMaps[i], id: `r${i}`, target: i === 0 ? 'prop' : 'person',
}))
useStore.getState().setEditRecastMappings(sevenMaps)
st = useStore.getState()
assert.equal(st.editRecastMappings.length, 7)
assert.equal(st.editRecastTarget, 'prop', 'recast target follows the first mapping')
assert.equal(st.editRecastPersonCount, 5, 'recast person count clamps to five')
// Create-route routing: media roles own the route, not a pinned control.
useStore.setState({
  generationMode: 'video',
  studioVideoWorkflow: 'frames',
  studioVideoCreateRoute: 'auto',
  startImage: null, endImage: null, imageRefs: [],
  params: {
    ...useStore.getState().params,
    model_type: 'ltx2_22B_distilled_1_1',
    image_mode: 0,
    image_start: '', image_end: '',
    image_refs: undefined, frames_positions: undefined,
    minimax_h3_references: [], audio_guide: '',
  },
})
useStore.getState().setStudioVideoCreateRoute()
st = useStore.getState()
assert.equal(st.studioVideoEffectiveCreateRoute, 'generate', 'empty frames input routes to generate')
assert.equal(st.studioVideoModelPerCreateRoute.generate, 'ltx2_22B_distilled_1_1')
assert.equal(st.params.model_type, 'ltx2_22B_distilled_1_1', 'generate intent keeps the T2V model')
useStore.setState({ params: { ...st.params, image_start: '/uploads/first.png' } })
useStore.getState().reconcileStudioVideoCreateRoute('Frame added')
st = useStore.getState()
assert.equal(st.studioVideoEffectiveCreateRoute, 'guided', 'a first frame pulls the route to guided')
assert.equal(st.studioVideoModelPerCreateRoute.generate, 'ltx2_22B_distilled_1_1', 'past route model is remembered')
assert.equal(st.params.model_type, 'ltx2_22B_distilled_1_1', 'guided intent keeps the frame-capable model')
useStore.getState().selectStudioVideoModel('minimax_h3')
st = useStore.getState()
assert.equal(st.studioVideoEffectiveCreateRoute, 'guided')
assert.equal(st.studioVideoModelPerCreateRoute.guided, 'minimax_h3', 'compatible model remembered per route')
assert.equal(st.params.model_type, 'minimax_h3')
useStore.getState().selectStudioVideoModel('minimax_h3_ref2va')
st = useStore.getState()
assert.equal(st.params.model_type, 'minimax_h3', 'an omni-only model is rejected for a frames/guided intent')
assert.equal(st.studioVideoEffectiveCreateRoute, 'guided')

// --- Finishing contracts (directorFinishingSlice) ---
// 16 fields: 8 state + 8 setters, all exposed on the root facade.
const finishingShape = [
  'directorImageSpatialUpsampling', 'setDirectorImageSpatialUpsampling',
  'directorImageFilmGrainIntensity', 'setDirectorImageFilmGrainIntensity',
  'directorImageFilmGrainSaturation', 'setDirectorImageFilmGrainSaturation',
  'directorVideoSpatialUpsampling', 'setDirectorVideoSpatialUpsampling',
  'directorVideoFilmGrainIntensity', 'setDirectorVideoFilmGrainIntensity',
  'directorVideoFilmGrainSaturation', 'setDirectorVideoFilmGrainSaturation',
  'directorVideoSelfRefiner', 'setDirectorVideoSelfRefiner',
  'directorAudioScale', 'setDirectorAudioScale',
]
for (const name of finishingShape) {
  assert.equal(name in st, true, `finishing slice exposes ${name}`)
}
assert.equal(st.directorImageSpatialUpsampling, '')
assert.equal(st.directorImageFilmGrainIntensity, 0)
assert.equal(st.directorImageFilmGrainSaturation, 0.5)
assert.equal(st.directorVideoSpatialUpsampling, '')
assert.equal(st.directorVideoFilmGrainIntensity, 0)
assert.equal(st.directorVideoFilmGrainSaturation, 0.5)
assert.equal(st.directorVideoSelfRefiner, 0)
assert.equal(st.directorAudioScale, 1.0)
// Setters route through the composed slice and update only their own field.
useStore.getState().setDirectorImageSpatialUpsampling('lanczos2')
useStore.getState().setDirectorImageFilmGrainIntensity(0.4)
useStore.getState().setDirectorImageFilmGrainSaturation(0.7)
useStore.getState().setDirectorVideoSpatialUpsampling('lanczos1.5')
useStore.getState().setDirectorVideoFilmGrainIntensity(0.6)
useStore.getState().setDirectorVideoFilmGrainSaturation(0.3)
useStore.getState().setDirectorVideoSelfRefiner(2)
useStore.getState().setDirectorAudioScale(1.5)
st = useStore.getState()
assert.equal(st.directorImageSpatialUpsampling, 'lanczos2')
assert.equal(st.directorImageFilmGrainIntensity, 0.4)
assert.equal(st.directorImageFilmGrainSaturation, 0.7)
assert.equal(st.directorVideoSpatialUpsampling, 'lanczos1.5')
assert.equal(st.directorVideoFilmGrainIntensity, 0.6)
assert.equal(st.directorVideoFilmGrainSaturation, 0.3)
assert.equal(st.directorVideoSelfRefiner, 2)
assert.equal(st.directorAudioScale, 1.5)
// Each setter is independent: only its own field changes, leaving the
// other seven untouched. Catches cross-coupling regressions in the slice.
useStore.getState().setDirectorImageSpatialUpsampling('')
assert.equal(useStore.getState().directorImageFilmGrainIntensity, 0.4, 'sibling fields untouched')
useStore.setState(original, true)
st = useStore.getState()
assert.equal(st.directorImageFilmGrainIntensity, 0, 'reset via original restores defaults')
assert.equal(st.directorAudioScale, 1.0)

console.log('Slice contracts passed: model visibility hydration, defaults upgrade, enabled-model write-through, LoRA lifecycle, edit recipes, mappings, create-route routing and director finishing surface.')
