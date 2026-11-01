import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

export interface StudioSelectOption {
  value: string
  label: string
  description?: string
}

interface StudioSelectProps {
  value: string
  options: StudioSelectOption[]
  onChange: (value: string) => void
  ariaLabel: string
  className?: string
}

/**
 * Compact listbox used by the Studio control column.
 *
 * The native `<select>` rendered the OS dropdown chrome (light list on the
 * dark app surface) and forced a fixed 158px minimum width, so long option
 * labels were cut off. This keeps the app's own close semantics (Escape
 * closes, click outside closes) while painting the menu with the app's
 * surfaces.
 *
 * The menu is placed with fixed coordinates instead of `absolute` because
 * the control column lives inside an `overflow-y-auto` scroller, which
 * would clip an absolutely positioned dropdown.
 */
export function StudioSelect({
  value,
  options,
  onChange,
  ariaLabel,
  className = '',
}: StudioSelectProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuStyle, setMenuStyle] = useState<{ top: number; left: number; width: number } | null>(null)
  const active = options.find(option => option.value === value)

  const positionMenu = () => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    setMenuStyle({ top: rect.bottom + 4, left: rect.left, width: rect.width })
  }

  // Keep the menu glued to the trigger while the page scrolls or resizes.
  // The subscription only reads the DOM; the state update happens in the
  // event callback, not in the effect body.
  useEffect(() => {
    if (!open) return
    const reposition = () => positionMenu()
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node
      if (rootRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return (
    <div ref={rootRef} className={`relative min-w-0 ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          positionMenu()
          setOpen(current => !current)
        }}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        title={active?.description || active?.label}
        className={`flex w-full min-w-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-left transition-colors ${
          open
            ? 'border-accent-blue bg-accent-blue/10'
            : 'border-border bg-bg-tertiary hover:border-border-light'
        }`}
      >
        <span className="min-w-0 flex-1 truncate text-xs text-text-primary">
          {active?.label ?? 'Select'}
        </span>
        <ChevronDown
          size={13}
          className={`shrink-0 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && menuStyle && (
        <div
          ref={menuRef}
          role="listbox"
          aria-label={ariaLabel}
          style={{ top: menuStyle.top, left: menuStyle.left, width: menuStyle.width }}
          className="fixed z-[100] overflow-hidden rounded-xl border border-border bg-bg-secondary p-1 shadow-xl"
        >
          {options.map(option => {
            const selected = option.value === value
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                }}
                title={option.description || option.label}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
                  selected
                    ? 'bg-accent-blue/10 text-text-primary'
                    : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs">{option.label}</span>
                  {option.description && (
                    <span className="mt-0.5 block text-2xs leading-snug text-text-muted">
                      {option.description}
                    </span>
                  )}
                </span>
                {selected && <Check size={13} className="shrink-0 text-accent-blue" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
