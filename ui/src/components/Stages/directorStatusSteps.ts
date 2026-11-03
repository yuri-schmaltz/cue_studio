/**
 * The ten Director pipeline steps, in execution order.
 *
 * Kept in its own module so `DirectorStatusBar.tsx` exports nothing but
 * the component itself (react-refresh friendly).
 */

export type StepMeta = {
  id: string
  label: string
  description: (clipCount: number) => string
}

export const STATUS_STEPS: StepMeta[] = [
  { id: 'upload', label: 'Upload', description: () => 'Receiving audio and references' },
  { id: 'analyze', label: 'Analyze', description: () => 'Transcribing audio, detecting voices and sections' },
  { id: 'structure', label: 'Plan structure', description: (n) => n > 0 ? `Segmenting music into ${n} clips and beats` : 'Segmenting music into clips and beats' },
  { id: 'style', label: 'Scene description', description: () => 'Defining scene description, characters and style' },
  { id: 'plan', label: 'Image prompts', description: (n) => n > 0 ? `LLM writing image prompts for ${n} clips` : 'LLM writing image prompts' },
  { id: 'review', label: 'Review image prompts', description: (n) => n > 0 ? `Reviewing image prompts of ${n} clips` : 'Reviewing image prompts' },
  { id: 'generate_images', label: 'Generate images', description: (n) => n > 0 ? `Rendering ${n} initial images` : 'Rendering initial images' },
  { id: 'plan_video', label: 'Video prompts', description: (n) => n > 0 ? `LLM writing video prompts for ${n} clips` : 'LLM writing video prompts' },
  { id: 'review_video', label: 'Review video prompts', description: (n) => n > 0 ? `Reviewing video prompts of ${n} clips` : 'Reviewing video prompts' },
  { id: 'generate_videos', label: 'Generate videos', description: (n) => n > 0 ? `Rendering ${n} final videos` : 'Rendering final videos' },
]
