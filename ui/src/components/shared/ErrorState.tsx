import { AlertTriangle } from 'lucide-react'

import { Button } from './Button'

/**
 * Shared error block (feature A08).
 *
 * Announced via `role="alert"`. When the failed action is
 * repeatable, pass `onRetry` — an explicit retry affordance is
 * rendered instead of forcing users to reload the whole screen.
 * `error` may be an `ApiError` (from `api/errors.ts`); its message
 * is surfaced as-is.
 */

export interface ErrorStateProps {
  title?: string
  error?: unknown
  onRetry?: () => void
  retryLabel?: string
  className?: string
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Something went wrong.'
}

export function ErrorState({
  title = 'Something went wrong',
  error,
  onRetry,
  retryLabel = 'Try again',
  className = '',
}: ErrorStateProps) {
  return (
    <div role="alert" className={`flex flex-col items-center justify-center gap-3 rounded-xl border border-red-500/30 bg-red-500/5 p-8 text-center ${className}`}>
      <AlertTriangle size={28} className="text-red-400" aria-hidden="true" />
      <div>
        <p className="text-sm font-semibold text-text-primary">{title}</p>
        {error !== undefined && (
          <p className="mt-1 text-xs text-text-secondary">{messageOf(error)}</p>
        )}
      </div>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  )
}
