// Maps API error `code`s to a human-readable message and the action
// a user should take (feature A15): cancel the operation, retry it,
// or open support. Codes follow `<domain>.<operation>.<detail>` on
// the backend; matching is suffix/prefix-based so new domains fall
// through to sensible defaults.

import type { ApiError } from './errors'

export type ErrorActionKind = 'cancel' | 'retry' | 'support'

export interface ErrorAction {
  kind: ErrorActionKind
  /** Button label for the suggested action. */
  label: string
  /** One-line explanation shown next to the error. */
  hint: string
}

const CANCEL: ErrorAction = {
  kind: 'cancel',
  label: 'Cancel',
  hint: 'This operation can’t complete as requested. Cancel it and try a different approach.',
}

const RETRY: ErrorAction = {
  kind: 'retry',
  label: 'Try again',
  hint: 'This looks transient — retrying usually works.',
}

const SUPPORT: ErrorAction = {
  kind: 'support',
  label: 'Open support',
  hint: 'This needs a closer look. Open support and quote the operation id shown below.',
}

const RULES: Array<{ test: (code: string) => boolean; action: ErrorAction }> = [
  // Conflicts / preconditions the user must resolve by changing the
  // request: queue.cancel.not_allowed, project.exists, …
  {
    test: (code) => code.endsWith('.not_allowed') || code.includes('.conflict') || code.includes('.exists'),
    action: CANCEL,
  },
  // Auth / permission problems: no amount of retrying helps.
  {
    test: (code) => code.includes('auth') || code.includes('permission') || code.includes('forbidden') || code.includes('unauthorized'),
    action: SUPPORT,
  },
  // Backend busy / transient capacity issues.
  {
    test: (code) => code.includes('busy') || code.includes('timeout') || code.includes('unavailable') || code.includes('overloaded'),
    action: RETRY,
  },
]

export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false
  const msg = error instanceof Error ? error.message : String(error)
  return (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Importing a module script failed') ||
    msg.includes('Loading chunk') ||
    msg.includes('error loading dynamically imported module')
  )
}

/** Suggested action for any error; ApiError codes win, everything else
 *  defaults to a retry. */
export function errorActionFor(error: unknown): ErrorAction {
  if (isChunkLoadError(error)) {
    return {
      kind: 'retry',
      label: 'Reload app',
      hint: 'A new version of the app was deployed. Reloading will fetch the latest assets.',
    }
  }
  if (error instanceof Error && 'code' in error && typeof (error as ApiError).code === 'string') {
    const code = (error as ApiError).code
    const match = RULES.find((rule) => rule.test(code))
    if (match) return match.action
  }
  return RETRY
}
