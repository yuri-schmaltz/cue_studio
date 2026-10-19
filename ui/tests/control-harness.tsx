import { DirectorTimelineEditor } from '../src/components/Sidebar/DirectorTimelineEditor'
// Browser contract harness. Vite's production entry does not include this file.
import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { DirectorReview } from '../src/components/Director/DirectorReview'
import { GenerationReviewPanel } from '../src/components/Sidebar/GenerationReviewPanel'
import { useStore } from '../src/stores/useStore'
import { resolvedGenerationPlan } from '../src/lib/generationPlan'
import '../src/index.css'

const fixture = {
  id: 'browser-project', status: 'paused', phase: 'planning', pause_reason: 'review_prompts', review_digest: 'revision-1',
  progress: { current: 1, total: 3, step: 0, total_steps: 0, message: 'Review' },
  clip_plans: [
    { image_prompt: 'Ana at a station', video_prompt: 'Ana enters the station', window_prompts: [] },
    { image_prompt: 'Ana on the platform', video_prompt: 'Ana waits', window_prompts: [] },
  ],
  clip_images: [], planned_clips: [{ start: 0, end: 5 }, { start: 5, end: 10 }], output_files: [], error: null,
}
const params = { model_type: 'test-model', prompt: 'prepared story', seed: 123, video_length: 240, resolution: '1280x720',
  h3_window_prompts: ['opening window', 'closing window'], num_inference_steps: 8, guidance_scale: 1,
  _review_ui: { generationMode: 'video', durationSeconds: 10, outputCount: 1 },
}
function Harness() {
  const [mode, setMode] = useState('director')
  Object.assign(window, { controlHarness: {
    showDirector: (reason = 'review_prompts') => {
      useStore.setState({ pipelineId: fixture.id, pipelineStatus: { ...fixture, pause_reason: reason, review_digest: reason,
        clip_images: reason === 'review_prompts' ? [] : ['frame.png', 'frame.png'],
        review_render_params: reason === 'review_render' ? params : undefined } as never })
      setMode('director')
    },
    showStudio: () => {
      useStore.setState({ reviewPlan: resolvedGenerationPlan(useStore.getState(), { id: 'a'.repeat(32), prepared: { params } }), reviewAction: 'generate', reviewBusy: false })
      setMode('studio')
    },
    showTiming: () => {
      useStore.setState({ pipelineStatus: null, pipelineId: null, directorLoading: false,
        directorPlannedClips: fixture.planned_clips.map(clip => ({ ...clip, duration_frames: 121, beat_count: 0, section_label: 'verse', energy: 0.5, suggested_prompt_hint: '' })),
        directorClipPlans: fixture.clip_plans,
        directorClipImages: [{ clipIndex: 0, filename: 'first.jpg', prompt: 'first', file: new File(['image'], 'first.jpg') }],
      })
      setMode('timing')
    },
    timingState: () => ({ clips: useStore.getState().directorPlannedClips, images: useStore.getState().directorClipImages.map(i => ({ index: i.clipIndex, name: i.filename })), plans: useStore.getState().directorClipPlans }),
    changeDraft: () => useStore.setState({ params: { ...useStore.getState().params, prompt: 'UNAPPROVED CHANGES' } }),
  } })
  return <main className="p-4 bg-bg-primary text-text-primary min-h-screen">
    {mode === 'timing' && <DirectorTimelineEditor />}
    {mode === 'director' && <DirectorReview />}
    {mode === 'studio' && <GenerationReviewPanel />}
  </main>
}
useStore.setState({ pipelineId: fixture.id, pipelineStatus: fixture as never })
createRoot(document.getElementById('root')!).render(<Harness />)
