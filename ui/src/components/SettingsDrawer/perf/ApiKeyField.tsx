/* eslint-disable react-refresh/only-export-components -- standalone field,
 * no co-located helpers. Lives in /perf so the Performance panel and any
 * future embedder can render the same masked-key + Set/Change affordance
 * without depending on the Integrations panel internals. */
import { useState } from 'react'

/** Masked API-key input. Renders a single row showing the masked
 *  value (e.g. ``sk-••••••••abc``) plus a Set / Change button.
 *  Clicking the button swaps in a password input + Save / Cancel
 *  pair so the user can paste a new key. The maskedValue is owned
 *  by the parent (returned by the backend), so this component is a
 *  pure controlled field. */
export function ApiKeyField({
  label,
  maskedValue,
  isSet,
  onSave,
}: {
  label: string
  maskedValue: string
  isSet: boolean
  onSave: (value: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')

  return (
    <div>
      <label className="text-xs text-text-muted uppercase tracking-wider mb-1.5 block">
        {label}
      </label>
      {editing ? (
        <div className="flex gap-2">
          <input
            type="password"
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder="Paste API key..."
            className="flex-1 bg-bg-tertiary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-blue"
            autoFocus
          />
          <button
            onClick={() => { onSave(value); setEditing(false); setValue('') }}
            className="px-3 py-2 bg-accent-blue text-white text-xs rounded-lg hover:bg-accent-blue-hover"
          >
            Save
          </button>
          <button
            onClick={() => { setEditing(false); setValue('') }}
            className="px-3 py-2 border border-border text-xs rounded-lg text-text-secondary hover:text-text-primary"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex gap-2 items-center">
          <div className="flex-1 bg-bg-tertiary border border-border rounded-lg px-3 py-2 text-sm text-text-muted font-mono">
            {isSet ? maskedValue : 'Not set'}
          </div>
          <button
            onClick={() => setEditing(true)}
            className="px-3 py-2 border border-border text-xs rounded-lg text-text-secondary hover:text-text-primary hover:border-border-light transition-colors"
          >
            {isSet ? 'Change' : 'Set'}
          </button>
        </div>
      )}
    </div>
  )
}
