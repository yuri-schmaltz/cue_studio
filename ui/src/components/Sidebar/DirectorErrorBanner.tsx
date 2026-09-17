// filepath: ui/src/components/Sidebar/DirectorErrorBanner.tsx
//
// DirectorErrorBanner — rich failure surface for the Director pipeline.
//
// Replaces the previous static "fetch() error" banner that only had a
// dismiss button. The new component:
//
//   • picks an icon + colour based on the classified error kind
//     (OOM, VRAM, network, model, etc.)
//   • shows the failure phase as a small badge
//     ("image generation", "planning", etc.) so the user knows
//     which stage died
//   • renders a short list of pre-baked remediation steps
//     ("Free 2 GB of VRAM", "Remove LoRAs and retry", …)
//   • exposes the raw backend string in a collapsible "Technical
//     details" panel so support staff can grep the exact message
//   • offers a copy-to-clipboard button so the user can paste the
//     raw message into Discord / GitHub / a bug report
//   • exposes a "↻ Regenerate" action when the error is per-clip
//     (clipIndex set + recoverable = true)
//   • keeps a tiny × dismiss button in the corner for the existing
//     "make this go away" flow
//
// Error prop accepts both the legacy string and the new typed
// DirectorError so callers can transition gradually.

import { useState, useMemo } from 'react'
import { AlertTriangle, Cpu, HardDrive, Wifi, FileX, Box, Layers, XCircle, ClipboardCopy, Eye, EyeOff, X, RotateCcw } from 'lucide-react'
import {
  classifyDirectorError,
  normalizeDirectorError,
  type DirectorError,
  type DirectorErrorKind,
} from '../../stores/directorError'
import { useStore } from '../../stores/useStore'

interface DirectorErrorBannerProps {
  /** Either a typed DirectorError or a legacy raw string. Both work. */
  error: DirectorError | string | null
  /** Optional: forward the current pipeline status so the classifier
   *  can show the failing phase even when no specific phase is in
   *  the error string itself. */
  pipelineStatus?: import('../../api/client').PipelineStatus | null
  /** Optional: pin the error to a specific clip when surfaces show
   *  per-clip errors (e.g. inside ImageGenView). */
  clipIndex?: number | null
  /** When provided, render this instead of using the global dismiss
   *  action. Useful for clip-level errors that should clear when
   *  the user retries that clip. */
  onDismiss?: () => void
  /** When provided, render a "↻ Regenerate this clip" button that
   *  calls this with the clipIndex from props. */
  onRegenerateClip?: (clipIndex: number) => void
  className?: string
}

const KIND_META: Record<DirectorErrorKind, { colour: string; label: string }> = {
  oom:        { colour: 'text-red-300',   label: 'CUDA OOM'        },
  vram:       { colour: 'text-red-300',   label: 'VRAM'            },
  disk:       { colour: 'text-orange-300', label: 'Disk full'      },
  model:      { colour: 'text-amber-300', label: 'Model missing'  },
  lora:       { colour: 'text-amber-300', label: 'LoRA mismatch'  },
  planner:    { colour: 'text-purple-300', label: 'LLM planner'    },
  llm:        { colour: 'text-purple-300', label: 'LLM provider'   },
  media:      { colour: 'text-orange-300', label: 'Audio/video'    },
  network:    { colour: 'text-blue-300',  label: 'Network'        },
  cancelled:  { colour: 'text-gray-400',  label: 'Cancelled'      },
  validation: { colour: 'text-yellow-300', label: 'Missing input'  },
  pipeline:   { colour: 'text-red-300',   label: 'Pipeline'       },
  unknown:    { colour: 'text-red-300',   label: 'Error'          },
}

const PHASE_LABEL: Record<DirectorError['phase'], string> = {
  planning: 'planning',
  plan_prompts: 'image-prompt planning',
  plan_video: 'video-prompt planning',
  image_gen: 'image generation',
  video_gen: 'video generation',
  post_processing: 'post-processing',
  unknown: 'unknown phase',
}

function KindIcon({ kind }: { kind: DirectorErrorKind }) {
  const props = { size: 14, className: 'shrink-0 mt-0.5' }
  switch (kind) {
    case 'oom':
    case 'vram':
      return <Cpu {...props} />
    case 'disk':
      return <HardDrive {...props} />
    case 'network':
      return <Wifi {...props} />
    case 'model':
    case 'lora':
      return <Box {...props} />
    case 'media':
      return <FileX {...props} />
    case 'planner':
    case 'llm':
      return <Layers {...props} />
    case 'cancelled':
      return <XCircle {...props} />
    case 'validation':
    case 'pipeline':
    case 'unknown':
    default:
      return <AlertTriangle {...props} />
  }
}

/**
 * Compact rich-error banner. Drop-in replacement for the legacy
 *   <div role="alert">{error}</div>
 * pattern in DirectorPanel/DirectorChat/ImageGenView.
 *
 * Reads the dismiss action from the store by default so legacy
 * call sites don't need to be touched; pass `onDismiss` to override.
 */
export function DirectorErrorBanner({
  error,
  pipelineStatus,
  clipIndex,
  onDismiss,
  onRegenerateClip,
  className = '',
}: DirectorErrorBannerProps) {
  const clearDirectorError = useStore(s => s.clearDirectorError)
  const dismiss = onDismiss || clearDirectorError
  const typed: DirectorError | null = useMemo(() => {
    if (!error) return null
    const normalized = normalizeDirectorError(error, {
      pipelineStatus: pipelineStatus ?? null,
      clipIndex: clipIndex ?? null,
    })
    if (normalized) return normalized
    return classifyDirectorError(typeof error === 'string' ? error : error.message)
  }, [error, pipelineStatus, clipIndex])
  const [showTechnical, setShowTechnical] = useState(false)
  const [copied, setCopied] = useState(false)
  if (!typed || !typed.message) return null

  const meta = KIND_META[typed.kind]
  const canCopy = !!typed.technical

  return (
    <div
      role="alert"
      className={`rounded-lg border bg-red-500/5 border-red-500/20 p-3 space-y-2 ${className}`}
    >
      <div className="flex items-start gap-2">
        <span className={meta.colour} title={meta.label}>
          <KindIcon kind={typed.kind} />
        </span>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className={`text-xs font-semibold uppercase tracking-wider ${meta.colour}`}>
              {meta.label}
            </span>
            {typed.phase !== 'unknown' && (
              <span className="text-2xs px-1.5 py-0.5 rounded bg-bg-tertiary text-text-muted font-mono">
                {PHASE_LABEL[typed.phase]}
              </span>
            )}
            {typeof typed.clipIndex === 'number' && (
              <span className="text-2xs px-1.5 py-0.5 rounded bg-bg-tertiary text-text-muted font-mono">
                Clip {typed.clipIndex + 1}
              </span>
            )}
          </div>
          <p className="text-xs text-text-primary leading-snug">{typed.message}</p>
          {typed.actions.length > 0 && (
            <ul className="text-2xs text-text-muted leading-relaxed space-y-0.5 list-disc pl-4 mt-1">
              {typed.actions.map((action, i) => (
                <li key={i}>{action}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0 -mr-1 -mt-1">
          {typeof typed.clipIndex === 'number' && onRegenerateClip && (
            <button
              type="button"
              onClick={() => onRegenerateClip(typed.clipIndex!)}
              className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
              title={`Re-run only Clip ${typed.clipIndex + 1}`}
              aria-label={`Regenerate Clip ${typed.clipIndex + 1}`}
            >
              <RotateCcw size={12} />
            </button>
          )}
          {canCopy && (
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(typed.technical!)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                } catch {
                  /* clipboard may be blocked — silently no-op */
                }
              }}
              className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
              title="Copy the raw backend message"
              aria-label="Copy error message"
            >
              <ClipboardCopy size={12} />
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowTechnical(v => !v)}
            className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
            title={showTechnical ? 'Hide technical details' : 'Show technical details'}
            aria-label={showTechnical ? 'Hide technical details' : 'Show technical details'}
          >
            {showTechnical ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
            title="Dismiss"
            aria-label="Dismiss error"
          >
            <X size={12} />
          </button>
        </div>
      </div>
      {showTechnical && typed.technical && (
        <details open className="text-2xs">
          <summary className="cursor-pointer text-text-muted hover:text-text-primary flex items-center gap-1 select-none">
            <span className="font-mono">Backend message</span>
          </summary>
          <pre className="mt-1 p-2 rounded bg-bg-primary/60 border border-border/40 text-text-muted whitespace-pre-wrap break-words font-mono leading-relaxed">
            {copied && (
              <span className="text-emerald-300 block mb-1">[copied to clipboard]</span>
            )}
            {typed.technical}
          </pre>
        </details>
      )}
    </div>
  )
}
