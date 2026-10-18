import { useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'

import { Button } from './Button'
import type { DialogProps } from './types'

/**
 * Shared modal dialog built on the native `<dialog>` element
 * (feature A08).
 *
 * - `role="dialog"` (implicit on `<dialog>`) + explicit `aria-modal`
 *   and `aria-labelledby` / `aria-describedby`.
 * - Initial focus: the dialog container receives focus on open so
 *   screen readers announce the title.
 * - `Escape` fires the native `cancel` event and is routed to
 *   `onClose` (prevented by default so the component stays
 *   controlled). With `confirmOnClose` the Escape / backdrop
 *   dismissal is blocked — closing becomes an explicit action.
 * - Focus is restored to the element that was focused before the
 *   dialog opened.
 */
export function AppDialog({
  open,
  onClose,
  title,
  description,
  children,
  primaryAction,
  secondaryAction,
  confirmOnClose,
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open) {
      previouslyFocused.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null
      if (!dialog.open) dialog.showModal()
      // Initial focus goes to the field flagged `autofocus` (matching
      // the pre-migration behaviour); otherwise the dialog container
      // itself so the title is announced.
      const initialFocus = dialog.querySelector<HTMLElement>('[autofocus]')
      ;(initialFocus ?? dialog).focus()
    } else if (dialog.open) {
      dialog.close()
    }
  }, [open])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const handleCancel = (event: Event) => {
      // Keep the component controlled: intercept the native Escape
      // and let the owner decide what "close" means.
      event.preventDefault()
      if (!confirmOnClose) onClose()
    }
    const handleClose = () => {
      previouslyFocused.current?.focus?.()
    }
    dialog.addEventListener('cancel', handleCancel)
    dialog.addEventListener('close', handleClose)
    return () => {
      dialog.removeEventListener('cancel', handleCancel)
      dialog.removeEventListener('close', handleClose)
    }
  }, [onClose, confirmOnClose])

  return (
    <dialog
      ref={dialogRef}
      tabIndex={-1}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      className="shared-app-dialog"
      onClick={(event) => {
        // Clicks on the backdrop land on the <dialog> element itself.
        if (event.target === event.currentTarget && !confirmOnClose) onClose()
      }}
    >
      <div className="shared-app-dialog-panel">
        <div className="mb-2 flex items-center gap-2">
          <h2 id={titleId} className="text-lg font-semibold text-text-primary">
            {title}
          </h2>
          <button
            type="button"
            aria-label="Close dialog"
            onClick={() => { if (!confirmOnClose) onClose() }}
            className="ml-auto rounded-lg p-1.5 text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-blue"
          >
            <X size={16} />
          </button>
        </div>
        {description && (
          <p id={descriptionId} className="mb-3 text-sm text-text-secondary">
            {description}
          </p>
        )}
        {children}
        {(primaryAction || secondaryAction) && (
          <div className="mt-4 flex justify-end gap-2">
            {secondaryAction && (
              <Button variant="secondary" onClick={secondaryAction.onClick}>
                {secondaryAction.label}
              </Button>
            )}
            {primaryAction && (
              <Button variant="primary" loading={primaryAction.loading} onClick={primaryAction.onClick}>
                {primaryAction.label}
              </Button>
            )}
          </div>
        )}
      </div>
    </dialog>
  )
}
