import type { BaseFieldProps } from './types'
import { describedBy } from './types'

/**
 * Shared text input with label, hint and error wiring (feature A08).
 *
 * `aria-describedby` always connects the hint and the error message
 * to the input, so assistive tech announces contextual help and
 * validation failures without the caller repeating the id plumbing.
 * A `success` flag renders positive feedback in the same slot as the
 * error (only one of the two is shown; error wins).
 */

export interface TextFieldProps extends BaseFieldProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
  autoFocus?: boolean
  success?: string
}

export function TextField({
  id,
  label,
  hint,
  error,
  required,
  disabled,
  value,
  onChange,
  placeholder,
  type = 'text',
  autoFocus,
  success,
}: TextFieldProps) {
  const baseClasses = 'mt-2 w-full rounded-lg border bg-bg-primary px-3 py-2.5 text-sm text-text-primary disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-blue'
  const borderClasses = error
    ? 'border-red-500/60'
    : success
      ? 'border-emerald-500/60'
      : 'border-border'
  return (
    <div className="block min-w-0 flex-1 text-xs text-text-secondary">
      <label htmlFor={id} className="block">
        {label}
        {required && <span aria-hidden="true" className="ml-0.5 text-red-400">*</span>}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        required={required}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error, success)}
        onChange={(e) => onChange(e.target.value)}
        className={`${baseClasses} ${borderClasses}`}
      />
      {hint && <p id={`${id}-hint`} className="mt-1.5 text-xs text-text-muted">{hint}</p>}
      {error && <p id={`${id}-error`} role="alert" className="mt-1.5 text-xs text-red-400">{error}</p>}
      {!error && success && <p id={`${id}-success`} role="status" className="mt-1.5 text-xs text-emerald-400">{success}</p>}
    </div>
  )
}
