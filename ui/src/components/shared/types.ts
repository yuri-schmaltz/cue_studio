/**
 * Shared contracts for the reusable UI primitives (feature A08).
 *
 * These types are the public surface of `components/shared/`; every
 * component in the folder consumes them so call sites get a uniform
 * prop vocabulary (label / hint / error / disabled) without each
 * component re-declaring the same fields.
 */

import type { ReactNode } from 'react'

/** Common props for every form field primitive. */
export interface BaseFieldProps {
  id: string
  label?: string
  hint?: string
  error?: string
  required?: boolean
  disabled?: boolean
  hideLabel?: boolean
}

export interface DialogProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  primaryAction?: { label: string; onClick: () => void; loading?: boolean }
  secondaryAction?: { label: string; onClick: () => void }
  /** Bloqueia fechamento se houver mudanças. */
  confirmOnClose?: boolean
}

/**
 * Constrói o valor do atributo `aria-describedby` a partir do id e dos
 * textos opcionais de hint, erro e sucesso. Usado pelos primitives de
 * formulário para conectar ajuda contextual e validação à tecnologia
 * assistiva sem que o chamador repita o encadeamento de ids.
 */
export function describedBy(
  id: string,
  hint?: string,
  error?: string,
  success?: string,
): string | undefined {
  const ids = [
    hint ? `${id}-hint` : null,
    error ? `${id}-error` : null,
    !error && success ? `${id}-success` : null,
  ].filter(Boolean)
  return ids.length > 0 ? ids.join(' ') : undefined
}
