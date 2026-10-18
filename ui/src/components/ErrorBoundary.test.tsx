/**
 * Tests for the per-section <ErrorBoundary> (feature A15): a render
 * crash inside one section must not take down the surrounding
 * (navigation) shell, and the fallback suggests an action.
 */

// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'

import { ErrorBoundary } from './ErrorBoundary'
import { ApiError } from '../api/errors'

// React logs caught errors (and the component stack) to console.error.
vi.spyOn(console, 'error').mockImplementation(() => undefined)

function Boom({ error }: { error: unknown }): never {
  throw error instanceof Error ? error : new Error(String(error))
}

describe('ErrorBoundary', () => {
  it('renders children while no error occurs', () => {
    render(
      <ErrorBoundary section="Studio">
        <p>studio content</p>
      </ErrorBoundary>,
    )
    expect(screen.getByText('studio content')).toBeTruthy()
  })

  it('catches a render error and keeps the surrounding shell alive', () => {
    render(
      <>
        <nav>navigation</nav>
        <ErrorBoundary section="Studio">
          <Boom error="render exploded" />
        </ErrorBoundary>
      </>,
    )
    // The failing section is contained…
    const fallback = screen.getByRole('alert')
    expect(fallback).toHaveTextContent('Studio hit an error')
    expect(fallback).toHaveTextContent('render exploded')
    // …while the rest of the page still renders.
    expect(screen.getByText('navigation')).toBeTruthy()
  })

  it('shows the action suggested for an ApiError', () => {
    render(
      <ErrorBoundary section="Queue">
        <Boom error={new ApiError({ code: 'auth.token.expired', message: 'Token expired' }, 401)} />
      </ErrorBoundary>,
    )
    const fallback = screen.getByRole('alert')
    expect(fallback).toHaveTextContent('Token expired')
    // auth.* → support hint
    expect(fallback).toHaveTextContent('Open support and quote the operation id')
  })

  it('recovers the section when Try again is pressed', () => {
    function Harness() {
      const [explode, setExplode] = useState(true)
      return (
        <>
          <button type="button" onClick={() => setExplode(false)}>fix</button>
          <ErrorBoundary section="Director">
            {explode ? <Boom error="temporary" /> : <p>director content</p>}
          </ErrorBoundary>
        </>
      )
    }
    render(<Harness />)
    expect(screen.getByRole('alert')).toHaveTextContent('Director hit an error')
    // The erroring child is gone; press retry on the fallback.
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    // Boundary resets but the child still throws (state unchanged) —
    // flipping the child state first makes the reset meaningful.
    fireEvent.click(screen.getByRole('button', { name: 'fix' }))
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('director content')).toBeTruthy()
  })
})
