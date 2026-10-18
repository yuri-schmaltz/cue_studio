// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

import { ContinuityPanel } from './ContinuityPanel'

describe('ContinuityPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renders severity counts and entries with severity coloring', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        production_id: 'p',
        shot_count: 2,
        inconsistencies: [
          { kind: 'position_collision', severity: 'error', shot_id_a: 's1', shot_id_b: 's1', message: 'colisão' },
          { kind: 'object_hand_jump', severity: 'info', shot_id_a: 's2', shot_id_b: 's3', message: 'troca' },
        ],
        severity_counts: { info: 1, warning: 0, error: 1 },
      }),
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    render(<ContinuityPanel productionId="p" />)
    await waitFor(() => expect(screen.getByText('colisão')).toBeInTheDocument())
    expect(screen.getByText('troca')).toBeInTheDocument()
    // severity color classes applied
    const errorItem = screen.getByText('colisão').closest('li')
    expect(errorItem?.className).toContain('text-red-400')
    const infoItem = screen.getByText('troca').closest('li')
    expect(infoItem?.className).toContain('text-blue-400')
  })

  it('shows empty-shot-ir message when shot_count is 0', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ production_id: 'p', shot_count: 0, inconsistencies: [], severity_counts: { info: 0, warning: 0, error: 0 } }),
    }) as unknown as typeof fetch
    render(<ContinuityPanel productionId="p" />)
    await waitFor(() => expect(screen.getByText(/Shot IR não gerado/)).toBeInTheDocument())
  })

  it('triggers check endpoint on button click', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ production_id: 'p', shot_count: 1, inconsistencies: [], severity_counts: { info: 0, warning: 0, error: 0 } }),
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch
    render(<ContinuityPanel productionId="p" />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const btn = screen.getByRole('button', { name: /Verificar continuidade/i })
    fireEvent.click(btn)
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/check'))).toBe(true))
  })

  it('navigates to shot when provided', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        production_id: 'p',
        shot_count: 1,
        inconsistencies: [{ kind: 'gaze_flip', severity: 'warning', shot_id_a: 'shot-42', shot_id_b: 'shot-43', message: 'gaze' }],
        severity_counts: { info: 0, warning: 1, error: 0 },
      }),
    }) as unknown as typeof fetch
    const onNav = vi.fn()
    render(<ContinuityPanel productionId="p" onNavigateToShot={onNav} />)
    await waitFor(() => expect(screen.getByText('gaze')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Abrir shot shot-42/i }))
    expect(onNav).toHaveBeenCalledWith('shot-42')
  })
})
