/**
 * Unit tests for the shared <AppDialog> (feature A08).
 *
 * jsdom implements the native `<dialog>` element (showModal/close/
 * cancel), so the tests exercise the real focus + dismissal wiring
 * instead of a re-implementation.
 */

// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'

import { AppDialog } from './AppDialog'

describe('AppDialog', () => {
  it('renders title and description with dialog semantics', () => {
    render(
      <AppDialog open onClose={() => {}} title="New project" description="Pick a name">
        <p>body</p>
      </AppDialog>,
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleName('New project')
    expect(screen.getByText('Pick a name')).toBeTruthy()
    expect(screen.getByText('body')).toBeTruthy()
  })

  it('moves focus into the dialog on open and restores it on close', () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>open</button>
          <AppDialog open={open} onClose={() => setOpen(false)} title="Test dialog">
            <input aria-label="field" />
          </AppDialog>
        </>
      )
    }
    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'open' })
    opener.focus()
    fireEvent.click(opener)
    const dialog = screen.getByRole('dialog')
    // Initial focus lands on the dialog container itself (no
    // data-autofocus element inside) so the title is announced.
    expect(document.activeElement).toBe(dialog)
    // Close and confirm focus goes back to the opener.
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }))
    expect(document.activeElement).toBe(opener)
  })

  it('focuses the element flagged for initial focus (data-autofocus)', () => {
    // React's `autoFocus` prop doesn't render an attribute and would
    // run while the dialog is still closed, so the shared convention
    // is `data-autofocus` (TextField mirrors its `autoFocus` prop).
    render(
      <AppDialog open onClose={() => {}} title="With autofocus">
        <input aria-label="first field" data-autofocus />
      </AppDialog>,
    )
    expect(document.activeElement).toBe(screen.getByLabelText('first field'))
  })

  it('routes the native Escape (cancel) event to onClose', () => {
    const onClose = vi.fn()
    render(
      <AppDialog open onClose={onClose} title="Escapable">
        <p>body</p>
      </AppDialog>,
    )
    // jsdom does not synthesize Escape → cancel, so dispatch the
    // native cancel event a browser would fire.
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('blocks Escape and backdrop dismissal when confirmOnClose is set', () => {
    const onClose = vi.fn()
    const { container } = render(
      <AppDialog open onClose={onClose} title="Guarded" confirmOnClose>
        <p>body</p>
      </AppDialog>,
    )
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
    // Backdrop clicks land on the <dialog> element itself.
    fireEvent.click(container.querySelector('dialog')!)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('calls onClose on backdrop click', () => {
    const onClose = vi.fn()
    const { container } = render(
      <AppDialog open onClose={onClose} title="Backdrop">
        <p>body</p>
      </AppDialog>,
    )
    fireEvent.click(container.querySelector('dialog')!)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders provided footer actions', () => {
    const primary = vi.fn()
    const secondary = vi.fn()
    render(
      <AppDialog
        open
        onClose={() => {}}
        title="Actions"
        primaryAction={{ label: 'Create project', onClick: primary }}
        secondaryAction={{ label: 'Cancel', onClick: secondary }}
      >
        <p>body</p>
      </AppDialog>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(primary).toHaveBeenCalledTimes(1)
    expect(secondary).toHaveBeenCalledTimes(1)
  })
})
