// filepath: ui/src/stores/directorError.ts
//
// directorError — typed shape + classifier for Director failures.
//
// The previous state was `directorError: string | null` and the only
// action the user could take on it was `× dismiss`. That was fine when
// the backend wrote "No image prompt for this clip" or similar short
// strings, but the actual surface the user ends up reading is much
// richer:
//
//   • mesh / ffmpeg failure ("moov atom not found")
//   • CUDA OOM ("CUDA out of memory. Tried to allocate 1.50 GiB")
//   • incompatible LoRA architecture ("LoRA X has hidden_dim=1536 but
//     Klein 9B expects 2560")
//   • network / backend down ("Failed to fetch")
//   • model not loaded ("Flux 2 Dev checkpoint not found at …")
//   • LLM planner returned invalid JSON
//   • pipeline cancelled mid-flight ("Cancelled by user")
//
// Each of those has a *different* remediation: bump VRAM budget,
// remove the LoRA, switch LLM, retry the network, free disk, etc.
// Without classifier + actions the user is left guessing.
//
// The shape:
//   message     — primary text, surfaced in the banner header.
//   kind        — short tag, used for icon + colour.
//   technical   — raw backend string (full traceback for logs /
//                  copy-to-clipboard). Keep server messages verbatim
//                  so support can grep them.
//   phase       — at which pipeline phase the error was raised
//                  (planning / image_gen / video_gen / plan_prompts /
//                  unknown). Rendered as a small badge so the user
//                  knows *which* surface failed.
//   clipIndex   — when the failure is per-clip, the offending clip,
//                  otherwise null. Lets us offer "↻ Regenerate this
//                  clip" as a contextual recovery action.
//   recoverable — whether the same input could succeed on retry
//                  without parameter changes (transient VRAM blip,
//                  network blip) vs needing user input first
//                  (LoRA mismatch, no scene description, etc).
//   actions     — pre-baked hint list ("free 2 GB of VRAM", "remove
//                  LoRAs and retry", "switch to CPU offload").
//   timestamp   — when the error arrived; used so the banner can say
//                  "2 minutes ago" and the auto-dismiss can age out.
//
// Backwards compatibility: legacy call sites that set
// `directorError: 'some string'` continue to work because
// `classifyDirectorError()` accepts strings and converts them to
// the typed shape with `kind: 'unknown'`.

import type { PipelineStatus } from '../api/client'

export type DirectorErrorKind =
  | 'oom'         // CUDA out of memory
  | 'vram'        // VRAM threshold exceeded (non-OOM, refused by planner)
  | 'disk'        // not enough disk space
  | 'model'       // checkpoint missing or wrong architecture
  | 'lora'        // LoRA not compatible with selected model
  | 'planner'     // LLM returned invalid JSON / grammar failed
  | 'llm'         // LLM connection / remote provider error
  | 'media'       // ffmpeg / moov atom / decode error
  | 'network'     // fetch() never reached backend
  | 'cancelled'   // user pressed stop or the queue was cleared
  | 'validation'  // missing required input (no scene description, etc)
  | 'pipeline'    // generic backend pipeline failure
  | 'unknown'

export type DirectorErrorPhase =
  | 'planning' | 'plan_prompts' | 'plan_video'
  | 'image_gen' | 'video_gen' | 'post_processing' | 'unknown'

export interface DirectorError {
  message: string
  kind: DirectorErrorKind
  technical: string | null
  phase: DirectorErrorPhase
  clipIndex: number | null
  recoverable: boolean
  actions: string[]
  timestamp: number
}

/** Heuristic classifier. Pure function — no side effects, deterministic
 *  output for the same input. Used both in the store (to populate the
 *  typed state) and in the banner (to pick an icon + colour). */
export function classifyDirectorError(
  raw: string | null | undefined,
  options?: { pipelineStatus?: PipelineStatus | null; clipIndex?: number | null },
): DirectorError {
  const text = (raw || '').trim()
  const lower = text.toLowerCase()
  const technical = text || null
  const phase: DirectorErrorPhase = options?.pipelineStatus?.phase === 'generating_images'
    ? 'image_gen'
    : options?.pipelineStatus?.phase === 'generating_video'
      ? 'video_gen'
      : options?.pipelineStatus?.phase === 'planning'
        ? 'planning'
        : options?.pipelineStatus?.phase === 'polishing_prompts'
          ? 'plan_prompts'
          : options?.pipelineStatus?.phase === 'preparing_video'
            ? 'plan_video'
            : options?.pipelineStatus?.phase === 'post_processing'
              ? 'post_processing'
              : 'unknown'
  const ts = Date.now()

  // Empty raw → unknown generic, used by callers that want to reset.
  if (!text) {
    return {
      message: '', kind: 'unknown', technical: null,
      phase, clipIndex: null, recoverable: false,
      actions: [], timestamp: ts,
    }
  }

  // 1) Network → fetch() never reached backend
  if (lower === 'failed to fetch' || lower.includes('failed to fetch')) {
    return {
      message: 'Could not reach the Maestro backend.',
      kind: 'network',
      technical,
      phase,
      clipIndex: options?.clipIndex ?? null,
      recoverable: true,
      actions: [
        'Confirm start.sh is still running in a terminal',
        'Check http://127.0.0.1:7860/api/v1/health in your browser',
        'If the URL changed (port collision), restart with ./start.sh',
      ],
      timestamp: ts,
    }
  }

  // 2) Cancelled — explicit user action
  if (
    lower.includes('cancelled by user')
    || lower.includes('cancel director')
    || options?.pipelineStatus?.status === 'cancelled'
  ) {
    return {
      message: 'Director run was cancelled.',
      kind: 'cancelled',
      technical,
      phase,
      clipIndex: options?.clipIndex ?? null,
      recoverable: true,
      actions: [
        'Click "Review image prompts" in the footer to re-plan from the last saved step',
        'Or restart from the upload step (the Director tab → ↺ Reset)',
      ],
      timestamp: ts,
    }
  }

  // 3) CUDA / VRAM OOM
  if (
    /cuda out of memory|cuda oom|outofmemoryerror|allocation on device/.test(lower)
    || lower.includes('torch.cuda')
  ) {
    return {
      message: 'The image/video model ran out of GPU memory (CUDA OOM).',
      kind: 'oom',
      technical,
      phase,
      clipIndex: options?.clipIndex ?? null,
      recoverable: true,
      actions: [
        'Lower the resolution or shot duration in "Generation Options" (right column)',
        'Disable any image LoRAs you don\'t actually need',
        'Wait for any other active generation to finish, then retry',
        'If it keeps happening, switch the engine to "CPU offload" in Configurations',
      ],
      timestamp: ts,
    }
  }

  // 4) VRAM threshold refused by planner (different from runtime OOM)
  if (
    /only [\d.]+ ?gb free .* required|free gpu .* required|requires [\d.]+ ?gb/i.test(lower)
    || (options?.pipelineStatus?.status === 'failed' && /vram/i.test(lower))
  ) {
    return {
      message: 'The Director refused to start: not enough free VRAM.',
      kind: 'vram',
      technical,
      phase,
      clipIndex: null,
      recoverable: true,
      actions: [
        'Close other GPU-heavy apps (browser tabs, Blender, etc.)',
        'Reduce image/video resolution in "Generation Options"',
        'Switch the engine to "CPU offload" in Configurations',
        'Wait for an in-flight generation to finish (queue drains first)',
      ],
      timestamp: ts,
    }
  }

  // 5) Disk
  if (
    /only [\d.]+ ?gb free on the output drive|not enough disk|disk_usage error|enoent .* output/.test(lower)
  ) {
    return {
      message: 'Not enough free disk space on the output drive.',
      kind: 'disk',
      technical,
      phase,
      clipIndex: null,
      recoverable: true,
      actions: [
        'Free at least 20 GB on the drive that holds the outputs/ folder',
        'Move old finished projects to an external drive',
        'Or change the project path in Configurations → Storage',
      ],
      timestamp: ts,
    }
  }

  // 6) LoRA mismatch
  if (
    /lora .* (incompatible|does not match|hidden_dim|architecture)/.test(lower)
    || /trained for .* but selected model/.test(lower)
  ) {
    return {
      message: 'One or more LoRAs are incompatible with the selected model.',
      kind: 'lora',
      technical,
      phase,
      clipIndex: null,
      recoverable: true,
      actions: [
        'Open "Generation Options → Image LoRAs" and remove the flagged ones',
        'Try a different model (e.g. Flux 2 Dev LoRAs won\'t load on Klein 9B)',
        'See the amber advisory banners above for the exact names',
      ],
      timestamp: ts,
    }
  }

  // 7) Model / checkpoint missing
  if (
    /checkpoint .* not found|model .* not found|safetensors? .* (missing|not found)|no checkpoint for/.test(lower)
  ) {
    return {
      message: 'The selected model checkpoint is missing on disk.',
      kind: 'model',
      technical,
      phase,
      clipIndex: null,
      recoverable: true,
      actions: [
        'Open Configurations → Models and re-download the missing checkpoint',
        'Check that ckpts/ and models/ exist and are writable',
        'Switch to a different model in the right column dropdown',
      ],
      timestamp: ts,
    }
  }

  // 8) Media decode / ffmpeg / moov atom
  if (
    /moov atom not found|invalid data found|ffmpeg error|format .* not detected|decoder .* not found/.test(lower)
  ) {
    return {
      message: 'Maestro could not decode the audio or video.',
      kind: 'media',
      technical,
      phase,
      clipIndex: null,
      recoverable: true,
      actions: [
        'Re-export the audio/video as a standard format (WAV / MP4)',
        'If the file came from a screen-recording app, try a different one',
        'Remove corrupted uploads from the file picker and try again',
      ],
      timestamp: ts,
    }
  }

  // 9) LLM planner / grammar failure
  if (
    /json (grammar|schema) (failed|rejected)|invalid json|jsondecodeerror|grammar timeout|grammar failed/.test(lower)
    || /json schema validation failed/.test(lower)
  ) {
    return {
      message: 'The LLM returned a malformed response.',
      kind: 'planner',
      technical,
      phase,
      clipIndex: null,
      recoverable: true,
      actions: [
        'Click "↻ Regenerate" in the Image Prompts section to retry',
        'If it keeps failing, try a different LLM in Configurations',
        'Reduce the scene description length (under 1500 chars)',
      ],
      timestamp: ts,
    }
  }

  // 10) LLM connection / provider error
  if (
    /llama-?\s*server|ollama|openai|anthropic|gemini/.test(lower)
    && /connection|timeout|refused|api key|unauthorized|429|quota/i.test(lower)
  ) {
    return {
      message: 'The LLM provider returned an error.',
      kind: 'llm',
      technical,
      phase,
      clipIndex: null,
      recoverable: true,
      actions: [
        'Check your internet connection (remote providers)',
        'For local llama-server: confirm it\'s still running on the configured port',
        'For Ollama: verify the model is pulled (ollama list)',
        'Check that the API key in Configurations → Services is still valid',
      ],
      timestamp: ts,
    }
  }

  // 11) Validation
  if (
    /scene description|no image prompt|no video prompt|write a scene description first|invalid fps|missing .* reference/.test(lower)
  ) {
    return {
      message: text,
      kind: 'validation',
      technical,
      phase,
      clipIndex: null,
      recoverable: true,
      actions: [
        'Fill in the missing input and retry',
        'Click "↻ Regenerate" once the form is complete',
      ],
      timestamp: ts,
    }
  }

  // 12) Generic pipeline failure
  return {
    message: text,
    kind: 'pipeline',
    technical,
    phase,
    clipIndex: options?.clipIndex ?? null,
    recoverable: false,
    actions: [
      'See "Show technical details" below for the raw backend message',
      'If the message is cryptic, copy it and send via the Help menu',
      'You can also try "↻ Regenerate" to re-run with the same inputs',
    ],
    timestamp: ts,
  }
}

/** Convert anything (legacy string | DirectorError | null) into the
 *  canonical typed DirectorError. Centralises the migration logic
 *  so legacy `directorError: 'msg'` assignments still produce a
 *  helpful banner while the codebase transitions. */
export function normalizeDirectorError(
  raw: DirectorError | string | null | undefined,
  options?: { pipelineStatus?: PipelineStatus | null; clipIndex?: number | null },
): DirectorError | null {
  if (raw == null) return null
  if (typeof raw === 'string') {
    if (!raw.trim()) return null
    return classifyDirectorError(raw, options)
  }
  return raw
}
