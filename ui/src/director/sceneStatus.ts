// filepath: ui/src/director/sceneStatus.ts
//
// Pure per-scene status derivations (feature A12).
//
// `DirectorChat` renders two near-identical card lists — one during
// image generation (driven by `directorImageGenProgress`) and one
// during video generation (driven by the pipeline status). Both used
// to inline the same nested ternary to pick the ShotStatus badge;
// these helpers extract that logic verbatim so it can be unit-tested
// (spec A12 §2.1 "cada cena mostra … status" / §5 failed-scene CTA).

import type { DirectorImageGenProgress } from '../types'
import type { SceneCardStatus } from './types'

export interface ImageSceneStatusInput {
  /** 0-based clip index this card renders. */
  index: number
  /** True once a start image exists for this clip. */
  hasImage: boolean
  /** True while a per-clip regenerate spinner overrides the global state. */
  regenerating: boolean
  /** Image-generation progress from the store, if a run is in flight. */
  progress: DirectorImageGenProgress | null
}

/** Badge status for an image-generation scene card.
 *
 *  Order matters and mirrors the historical inline expression:
 *  per-clip spinner → produced image → per-clip/global error →
 *  currently generating → pending. */
export function deriveImageSceneStatus({
  index,
  hasImage,
  regenerating,
  progress,
}: ImageSceneStatusInput): SceneCardStatus {
  if (regenerating) return 'generating'
  if (hasImage) return 'ready'
  // Per-clip error captured by the store's failed_clip_index; falls
  // back to `current === index` when only one clip failed and the
  // loop didn't stamp the index.
  if (
    progress?.status === 'error' &&
    (progress.failed_clip_index === index || progress.current === index)
  ) {
    return 'failed'
  }
  if (progress && progress.current === index && progress.status !== 'done') {
    return 'generating'
  }
  return 'pending'
}

export interface VideoSceneStatusInput {
  /** 0-based clip index this card renders. */
  index: number
  /** True once a start image exists for this clip. */
  hasStartImage: boolean
  /** True while a per-clip re-roll spinner overrides the global state. */
  regenerating: boolean
  /** `pipelineStatus.status === 'failed'`. */
  pipelineFailed: boolean
  /** `pipelineStatus.status === 'running'`. */
  pipelineRunning: boolean
  /** `pipelineStatus.progress.current_clip` (1-based), null if unknown. */
  currentClip: number | null
  /** 0-based index of the failed clip while the pipeline failed, else null. */
  failedClipIndex: number | null
}

/** Badge status for a video-generation scene card. Same precedence as
 *  the historical inline expression: per-clip spinner → failed clip →
 *  produced start image → currently rendering → pending. */
export function deriveVideoSceneStatus({
  index,
  hasStartImage,
  regenerating,
  pipelineFailed,
  pipelineRunning,
  currentClip,
  failedClipIndex,
}: VideoSceneStatusInput): SceneCardStatus {
  if (regenerating) return 'generating'
  if (pipelineFailed && (failedClipIndex === index || currentClip === index + 1)) {
    return 'failed'
  }
  if (hasStartImage) return 'ready'
  if (pipelineRunning && currentClip === index + 1) return 'generating'
  return 'pending'
}
