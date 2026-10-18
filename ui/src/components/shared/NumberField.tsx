import { describedBy } from './types'
import type { BaseFieldProps } from './types'

/**
 * Shared numeric input (feature A08). Mirrors `TextField` but
 * constrains the keyboard on mobile (`inputMode="numeric"`) and
 * reports values as numbers so callers skip the parsing boilerplate.
 * An unparseable (empty) value reports `''`.
 */

export interface NumberFieldProps extends BaseFieldProps {
  value: number | ''
  onChange: (value: number | '') => void
  min?: number
  max?: number
  step?: number
  placeholder?: string
  success?: string
}

export function NumberField({
  id,
  label,
  hint,
  error,
  required,
  disabled,
  value,
  onChange,
  min,
  max,
  step,
  placeholder,
  success,
}: NumberFieldProps) {
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
      <input
        id={id}
        name={id}
        type="number"
        inputMode="numeric"
        value={value}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error, success)}
        onChange={(e) => {
          const parsed = e.target.valueAsNumber
          onChange(Number.isNaN(parsed) ? '' : parsed)
        }}
        className={`${baseClasses} ${borderClasses}`}
      />
      {hint && <p id={`${id}-hint`} className="mt-1.5 text-xs text-text-muted">{hint}</p>}
      {error && <p id={`${id}-error`} role="alert" className="mt-1.5 text-xs text-red-400">{error}</p>}
      {!error && success && <p id={`${id}-success`} role="status" className="mt-1.5 text-xs text-emerald-400">{success}</p>}
    </div>
  )
}
