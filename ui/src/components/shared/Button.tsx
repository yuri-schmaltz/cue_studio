import { forwardRef, useState } from 'react'
import type { ButtonHTMLAttributes } from 'react'
import { Loader2 } from 'lucide-react'

/**
 * Shared button with semantic variants and promise-aware busy state.
 *
 * `variant` maps to the three visual weights used across the app:
 * primary (accent fill), secondary (bordered) and ghost (bare).
 * `loading` — or an `onClick` returning a pending promise — flips
 * `aria-busy` and disables the button, so callers get consistent
 * in-flight feedback without repeating spinner markup.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost'

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  variant?: ButtonVariant
  loading?: boolean
  onClick?: () => void | Promise<unknown>
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-accent-blue text-white hover:brightness-110',
  secondary: 'border border-border text-text-secondary hover:border-border-light hover:text-text-primary',
  ghost: 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button({ variant = 'primary', loading, onClick, className = '', children, disabled, type, ...rest }, ref) {
    const [pending, setPending] = useState(false)
    const busy = Boolean(loading) || pending
    const classes = [
      'inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium',
      'transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-blue',
      'disabled:cursor-not-allowed disabled:opacity-50',
      VARIANT_CLASSES[variant],
      className,
    ].join(' ')
    const handleClick = () => {
      if (!onClick) return
      const result = onClick() as unknown
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        setPending(true)
        ;(result as Promise<unknown>)
          .catch(() => undefined)
          .finally(() => setPending(false))
      }
    }
    return (
      <button
        ref={ref}
        type={type ?? 'button'}
        className={classes}
        aria-busy={busy || undefined}
        disabled={disabled || busy}
        onClick={onClick ? handleClick : undefined}
        {...rest}
      >
        {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
        {children}
      </button>
    )
  },
)
