import type { ReactNode } from 'react'

import { Button } from './Button'

/**
 * Shared empty-list block (feature A08).
 *
 * Gives every empty view the same shape: icon, headline, optional
 * supporting copy, and a single clear call-to-action so "nothing
 * here yet" always comes with a next step.
 */

export interface EmptyStateProps {
  title: string
  description?: string
  icon?: ReactNode
  action?: { label: string; onClick: () => void }
  className?: string
}

export function EmptyState({ title, description, icon, action, className = '' }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 p-12 text-center ${className}`}>
      {icon && <div className="text-text-muted" aria-hidden="true">{icon}</div>}
      <h2 className="text-lg font-semibold text-text-secondary">{title}</h2>
      {description && <p className="max-w-sm text-sm text-text-muted">{description}</p>}
      {action && (
        <Button variant="primary" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  )
}
