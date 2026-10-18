/**
 * Shared status pill (feature A08).
 *
 * Criticality drives the accessibility semantics: informational and
 * positive states render `role="status"` (polite announcement),
 * warnings and errors render `role="alert"` (assertive), matching
 * the WCAG guidance for live regions.
 */

export type StatusLevel = 'info' | 'ok' | 'busy' | 'warning' | 'error'

const LEVEL_CLASSES: Record<StatusLevel, string> = {
  info: 'bg-accent-blue/10 text-accent-blue border-accent-blue/30',
  ok: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  busy: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  warning: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  error: 'bg-red-500/10 text-red-400 border-red-500/30',
}

export interface StatusBadgeProps {
  level: StatusLevel
  label: string
  className?: string
}

export function StatusBadge({ level, label, className = '' }: StatusBadgeProps) {
  const critical = level === 'error' || level === 'warning'
  return (
    <span
      role={critical ? 'alert' : 'status'}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-2xs font-medium ${LEVEL_CLASSES[level]} ${className}`}
    >
      {label}
    </span>
  )
}
