import { describedBy } from './types'
import type { BaseFieldProps } from './types'

/**
 * Shared select (feature A08). Built on the native `<select>`
 * combobox so keyboard navigation (arrow keys, Home/End, type-ahead)
 * comes for free and matches platform expectations; label, hint and
 * error wiring follows the same `aria-describedby` contract as
 * `TextField`.
 */

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectProps extends BaseFieldProps {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  success?: string
}

export function Select({
  id,
  label,
  hint,
  error,
  required,
  disabled,
  value,
  onChange,
  options,
  success,
}: SelectProps) {
  const baseClasses = 'mt-2 w-full rounded-lg border bg-bg-primary px-3 py-2.5 text-sm text-text-primary disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-blue'
  const borderClasses = error
    ? 'border-red-500/60'
    : success
      ? 'border-emerald-500/60'
      : 'border-border'
  return (
    <div className="block min-w-0 text-xs text-text-secondary">
      <label htmlFor={id} className="block">
        {label}
        {required && <span aria-hidden="true" className="ml-0.5 text-red-400">*</span>}
      </label>
      <select
        id={id}
        name={id}
        value={value}
        required={required}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error, success)}
        onChange={(e) => onChange(e.target.value)}
        className={`${baseClasses} ${borderClasses}`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      {hint && <p id={`${id}-hint`} className="mt-1.5 text-xs text-text-muted">{hint}</p>}
      {error && <p id={`${id}-error`} role="alert" className="mt-1.5 text-xs text-red-400">{error}</p>}
      {!error && success && <p id={`${id}-success`} role="status" className="mt-1.5 text-xs text-emerald-400">{success}</p>}
    </div>
  )
}
