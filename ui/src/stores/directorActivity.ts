// Pure presentation rules for durable Director pipeline states.
// This module has no store, transport or browser dependencies.
import type { PipelineStatus } from '../api/client'

export type DirectorStep = 'upload' | 'analyze' | 'structure' | 'style' | 'plan' | 'review' | 'generate_images' | 'plan_video' | 'review_video'

export function directorStepForPipelineStatus(
  status: PipelineStatus,
  fallback: DirectorStep,
): DirectorStep {
  if (status.status === 'paused') {
    if (status.pause_reason === 'review_prompts') return 'review'
    if ((status.pause_reason === 'review_images' || status.pause_reason === 'review_render')) return 'review_video'
  }
  if (status.status === 'completed') return 'review_video'
  if (status.phase === 'planning' || status.phase === 'resuming' || status.phase === 'polishing_prompts') {
    return 'plan'
  }
  if (status.phase === 'generating_images') return 'generate_images'
  if (
    status.phase === 'preparing_video'
    || status.phase === 'generating_video'
    || status.phase === 'post_processing'
  ) return 'review_video'
  return fallback
}

/**
 * Translate a live PipelineStatus into a single human-readable activity
 * label + a 0..1 progress fraction. Both are surfaced to the user in
 * three places that used to show the hard-coded "Recalculating..." /
 * "Analyzing audio..." / nothing-at-all:
 *
 *   • CLIP STRUCTURE card (left chat column)   — small inline label
 *   • Director Activity card (middle column)   — large live status
 *   • Per-clip review cards' disabled affordance
 *
 * The label is derived from `status.phase` first, then falls back to the
 * backend's `progress.message`, then to a generic "Working…". The
 * fraction is `current/total` when both are > 0 (LLM streaming reports
 * step/total_steps, image/video gen reports current_clip/total_clips).
 *
 * Returns NaN for the fraction when the backend hasn't reported any
 * progress yet — the UI uses NaN to switch from a determinate bar to an
 * indeterminate animated stripe so the user always sees motion.
 */
export function computeDirectorActivity(
  status: PipelineStatus | null,
  fallbackLabel: string | null,
): { label: string; fraction: number; step?: number; total?: number } {
  if (!status) {
    return { label: fallbackLabel || 'Working…', fraction: NaN }
  }
  // Terminal states: no work in flight.
  if (status.status === 'completed') {
    return { label: 'Director run completed', fraction: 1 }
  }
  if (status.status === 'failed') {
    return { label: 'Director run failed', fraction: NaN }
  }
  if (status.status === 'cancelled') {
    return { label: 'Director run cancelled', fraction: NaN }
  }
  if (status.status === 'paused') {
    return { label: 'Awaiting your review', fraction: NaN }
  }
  // In-flight phases.
  const progress = status.progress
  const current = progress?.current ?? 0
  const total = progress?.total ?? 0
  const step = progress?.step ?? 0
  const totalSteps = progress?.total_steps ?? 0
  const currentClip = progress?.current_clip
  const totalClips = progress?.total_clips
  const fraction = total > 0
    ? Math.min(1, Math.max(0, current / total))
    : (totalSteps > 0 ? Math.min(1, Math.max(0, step / totalSteps)) : NaN)
  switch (status.phase) {
    case 'resuming':
      return {
        label: 'Resuming previous run…',
        fraction,
        ...(totalSteps > 0 ? { step, total: totalSteps } : {}),
      }
    case 'planning': {
      // Pass number is encoded in the message ("Polishing prompts (3rd
      // pass)…" — see backend) so we just surface the message when
      // present; otherwise default to the friendlier "Planning with LLM…".
      const msg = progress?.message
      if (msg && /polish/i.test(msg)) {
        return { label: 'Polishing prompts…', fraction, ...(totalSteps > 0 ? { step, total: totalSteps } : {}) }
      }
      return {
        label: 'Planning with LLM…',
        fraction,
        ...(totalSteps > 0 ? { step, total: totalSteps } : {}),
      }
    }
    case 'polishing_prompts':
      return {
        label: 'Polishing prompts…',
        fraction,
        ...(totalSteps > 0 ? { step, total: totalSteps } : {}),
      }
    case 'generating_images': {
      const m = currentClip && totalClips
        ? `Generating start image ${currentClip}/${totalClips}…`
        : 'Generating start images…'
      return {
        label: m,
        fraction,
        ...(currentClip && totalClips ? { step: currentClip, total: totalClips } : {}),
      }
    }
    case 'preparing_video':
      return { label: 'Writing video prompts…', fraction }
    case 'generating_video': {
      const m = currentClip && totalClips
        ? `Generating video clip ${currentClip}/${totalClips}…`
        : 'Generating videos…'
      return {
        label: m,
        fraction,
        ...(currentClip && totalClips ? { step: currentClip, total: totalClips } : {}),
      }
    }
    case 'post_processing':
      return { label: 'Joining final video…', fraction }
    default: {
      const msg = progress?.message?.trim()
      return {
        label: msg || fallbackLabel || 'Working…',
        fraction,
      }
    }
  }
}

