/**
 * Unit tests for the feedback primitives (feature A08):
 * StatusBadge, ErrorState and EmptyState.
 */

// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { StatusBadge } from './StatusBadge'
import { ErrorState } from './ErrorState'
import { EmptyState } from './EmptyState'

describe('StatusBadge', () => {
  it('uses a polite status role for non-critical levels', () => {
    render(<StatusBadge level="ok" label="Ready" />)
    expect(screen.getByRole('status')).toHaveTextContent('Ready')
  })

  it('uses an assertive alert role for error and warning levels', () => {
    const { rerender } = render(<StatusBadge level="error" label="Failed" />)
    expect(screen.getByRole('alert')).toHaveTextContent('Failed')
    rerender(<StatusBadge level="warning" label="Degraded" />)
    expect(screen.getByRole('alert')).toHaveTextContent('Degraded')
  })
})

describe('ErrorState', () => {
  it('announces the message via role=alert', () => {
    render(<ErrorState error={new Error('network down')} />)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('network down')
  })

  it('shows an explicit retry affordance only when provided', () => {
    const { rerender } = render(<ErrorState error="boom" />)
    expect(screen.queryByRole('button')).toBeNull()
    const onRetry = vi.fn()
    rerender(<ErrorState error="boom" onRetry={onRetry} />)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})

describe('EmptyState', () => {
  it('renders the headline and the CTA', () => {
    const action = vi.fn()
    render(
      <EmptyState
        title="No projects yet"
        description="Create one to get started"
        action={{ label: 'New project', onClick: action }}
      />,
    )
    expect(screen.getByRole('heading', { name: 'No projects yet' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'New project' }))
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('renders without an action', () => {
    render(<EmptyState title="Nothing here" />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
