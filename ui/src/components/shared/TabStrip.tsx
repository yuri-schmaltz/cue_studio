/**
 * TabStrip — the one tab primitive the whole application uses.
 *
 * Why
 * ---
 * The app grew five different tab implementations that all looked
 * like they belonged to different products: colored pills at the top
 * of the shell, custom pills in the Director's briefing column,
 * bordered buttons in the Director's right column, chips in Medias
 * and a tab bar with a notification dot in Studio. A user who
 * learned "tabs" in one place could not transfer that knowledge to
 * another, and every fix had to be applied five times.
 *
 * Variants
 * --------
 *   section   — the application navigation (solid color per section)
 *   pill      — a sub-navigation strip (Director briefing, Studio)
 *   segmented — a two-way switch inside a panel (Director Music)
 *
 * The variants differ only in skin; the behavior (roving tabindex,
 * arrow/Home/End navigation, disabled state, aria wiring) lives here.
 */

import { useRef } from 'react'
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

export type TabStripItem<T extends string = string> = {
  id: T
  label: string
  /** Short label used on narrow viewports (Medias). */
  shortLabel?: string
  icon?: LucideIcon
  /** Numeric badge (Queue item count). */
  badge?: number | null
  disabled?: boolean
  title?: string
  /** Overrides the accessible name when the visible label is not enough. */
  ariaLabel?: string
}

export type TabStripVariant = 'section' | 'pill' | 'segmented'

export type TabStripProps<T extends string> = {
  items: readonly TabStripItem<T>[]
  value: T
  onChange: (id: T) => void
  variant?: TabStripVariant
  /** Accessible name of the tab list. */
  ariaLabel: string
  /** Prefix for the generated element ids, e.g. "director-tab". */
  idPrefix?: string
  /** Resolves the id of the panel each tab controls. */
  controlsId?: (item: TabStripItem<T>) => string | undefined
  /** Extra classes on the list element. */
  className?: string
  /** Test hook on the list element. */
  testId?: string
  /** Extra classes on each tab, e.g. to tint a section by its accent. */
  itemClassName?: (item: TabStripItem<T>, active: boolean) => string
  /** Emits `data-section` on each tab so CSS can tint it (the
   *  application navigation gives every section its own accent). */
  dataSectionKey?: (item: TabStripItem<T>) => string | undefined
  /** Emits `data-testid` on each tab. */
  itemTestId?: (item: TabStripItem<T>) => string | undefined
  /** Extra content rendered inside the tab, after the label. */
  renderTrailing?: (item: TabStripItem<T>, active: boolean) => ReactNode
}

export function TabStrip<T extends string>({
  items,
  value,
  onChange,
  variant = 'pill',
  ariaLabel,
  idPrefix,
  controlsId,
  className,
  testId,
  itemClassName,
  dataSectionKey,
  itemTestId,
  renderTrailing,
}: TabStripProps<T>) {
  const listRef = useRef<HTMLDivElement>(null)

  /* Keyboard handling lives on the tablist, not on each button: the
   * roving-tabindex pattern expects the list to own Arrow/Home/End,
   * and it keeps the behaviour identical no matter which element
   * inside the strip received the key. */
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const list = listRef.current
    const focusedId = list
      ?.querySelector<HTMLElement>(':focus')
      ?.getAttribute('data-tab-id')
    const index = focusedId
      ? items.findIndex(item => item.id === focusedId)
      : items.findIndex(item => item.id === value)
    if (index < 0) return

    const next = event.key === 'ArrowRight' ? (index + 1) % items.length
      : event.key === 'ArrowLeft' ? (index + items.length - 1) % items.length
        : event.key === 'Home' ? 0
          : event.key === 'End' ? items.length - 1
            : -1
    if (next < 0) return
    const target = items[next]
    if (target.disabled) return
    event.preventDefault()
    onChange(target.id)
    list?.querySelector<HTMLButtonElement>(`[data-tab-id="${target.id}"]`)?.focus()
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      data-variant={variant}
      data-testid={testId}
      onKeyDown={handleKeyDown}
      className={[
        'tab-strip',
        `tab-strip--${variant}`,
        className,
      ].filter(Boolean).join(' ')}
    >
      {items.map((item) => {
        const active = item.id === value
        const Icon = item.icon
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={idPrefix ? `${idPrefix}-${item.id}` : undefined}
            data-tab-id={item.id}
            data-testid={itemTestId?.(item)}
            data-section={dataSectionKey?.(item)}
            aria-selected={active}
            aria-controls={controlsId?.(item)}
            aria-disabled={item.disabled || undefined}
            aria-label={item.ariaLabel}
            title={item.title}
            disabled={item.disabled}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.id)}
            className={[
              'tab-strip__tab',
              `tab-strip__tab--${variant}`,
              active ? 'is-active' : '',
              item.disabled ? 'is-disabled' : '',
              itemClassName ? itemClassName(item, active) : '',
            ].filter(Boolean).join(' ')}
          >
            {Icon && <Icon size={variant === 'section' ? 16 : 13} aria-hidden="true" />}
            <span className="tab-strip__label">{item.label}</span>
            {item.shortLabel && <span className="tab-strip__label-short">{item.shortLabel}</span>}
            {item.badge != null && item.badge > 0 && (
              <span className="tab-strip__badge" aria-hidden="true">
                {item.badge > 99 ? '99+' : item.badge}
              </span>
            )}
            {renderTrailing?.(item, active)}
          </button>
        )
      })}
    </div>
  )
}
