/**
 * ActionMenu — the "more" menu used wherever a card offers more
 * actions than it should show.
 *
 * Why
 * ---
 * The project card had seven icon-only buttons in a row, each
 * discoverable only on hover, with the destructive one sitting in the
 * same row as the harmless ones. The affordances were uniform, so
 * nothing said which action was the common one and which was rare or
 * irreversible.
 *
 * The menu keeps the two or three frequent actions on the card and
 * moves the rest behind a single trigger, where each entry carries
 * its own label.
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'

export type ActionMenuItem = {
  id: string
  label: string
  icon?: ReactNode
  onSelect: () => void
  danger?: boolean
  disabled?: boolean
}

export function ActionMenu({
  items,
  ariaLabel,
  disabled,
}: {
  items: ActionMenuItem[]
  ariaLabel: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <span className="relative" ref={rootRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(current => !current)}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        className="shell-icon-button"
      >
        <MoreHorizontal size={15} />
      </button>
      {open && (
        <span role="menu" className="action-menu" aria-label={ariaLabel}>
          {items.map(item => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => { setOpen(false); item.onSelect() }}
              className={`action-menu__item ${item.danger ? 'action-menu__item--danger' : ''}`}
            >
              {item.icon && <span className="action-menu__icon">{item.icon}</span>}
              <span>{item.label}</span>
            </button>
          ))}
        </span>
      )}
    </span>
  )
}
