/**
 * Unit tests for the shared <Button> (feature A08).
 */

// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createRef } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { Button } from './Button'

describe('Button', () => {
  it('defaults to type="button" so it never submits forms accidentally', () => {
    render(<Button>Go</Button>)
    expect(screen.getByRole('button', { name: 'Go' })).toHaveAttribute('type', 'button')
  })

  it('honours an explicit type', () => {
    render(<Button type="submit">Go</Button>)
    expect(screen.getByRole('button', { name: 'Go' })).toHaveAttribute('type', 'submit')
  })

  it('forwards refs', () => {
    const ref = createRef<HTMLButtonElement>()
    render(<Button ref={ref}>Go</Button>)
    expect(ref.current).toBe(screen.getByRole('button', { name: 'Go' }))
  })

  it('is aria-busy and disabled while loading', () => {
    render(<Button loading>Save</Button>)
    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toBeDisabled()
  })

  it('is busy while an onClick promise is pending, then recovers', async () => {
    let resolve: (() => void) | undefined
    const pending = new Promise<void>((r) => { resolve = r })
    render(<Button onClick={() => pending}>Run</Button>)
    const button = screen.getByRole('button', { name: 'Run' })
    fireEvent.click(button)
    // The button flips to aria-busy (and disabled) for the duration of
    // the promise and recovers once it settles.
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toBeDisabled()
    resolve!()
    await waitFor(() => expect(button).not.toHaveAttribute('aria-busy'))
  })

  it('invokes onClick on click', () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Go</Button>)
    fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
