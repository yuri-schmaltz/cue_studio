/**
 * Unit tests for the briefing↔audio reconciliation banner.
 *
 * The banner is the visible half of the time-anchored script feature: it
 * tells the user how much of the analysed track their script actually
 * covers before any GPU time is spent on shots they never wrote.
 */

// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

import { DirectorScriptReconciliationBanner } from './DirectorScriptReconciliationBanner'
import { useStore } from '../../stores/useStore'

const EXCERPT_REPORT = {
  status: 'excerpt' as const,
  scene_count: 3,
  anchored_scene_count: 3,
  audio_duration: 255,
  covered_start: 0,
  covered_end: 45,
  covered_seconds: 45,
  coverage_ratio: 0.1765,
  uncovered_seconds: 210,
  gaps: [],
}

describe('DirectorScriptReconciliationBanner', () => {
  beforeEach(() => {
    useStore.setState({
      directorScriptReconciliation: null,
      directorScriptWindow: null,
      directorAnalysis: null,
      directorLoading: false,
    } as never)
  })

  it('renders nothing when there is no reconciliation report', () => {
    const { container } = render(<DirectorScriptReconciliationBanner />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when the briefing carries no timecodes', () => {
    useStore.setState({
      directorScriptReconciliation: {
        script: { scenes: [], global_style: '', span: null, anchored: false },
        report: {
          ...EXCERPT_REPORT,
          status: 'no_timecodes',
          covered_start: null,
          covered_end: null,
          covered_seconds: null,
          coverage_ratio: null,
          uncovered_seconds: null,
        },
      },
    } as never)
    const { container } = render(<DirectorScriptReconciliationBanner />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when the script already covers the whole track', () => {
    useStore.setState({
      directorScriptReconciliation: {
        script: { scenes: [], global_style: '', span: [0, 255], anchored: true },
        report: { ...EXCERPT_REPORT, status: 'full_track', covered_end: 255 },
      },
    } as never)
    const { container } = render(<DirectorScriptReconciliationBanner />)
    expect(container.firstChild).toBeNull()
  })

  it('states the covered window and the uncovered remainder', () => {
    useStore.setState({
      directorScriptReconciliation: {
        script: { scenes: [], global_style: '', span: [0, 45], anchored: true },
        report: EXCERPT_REPORT,
      },
    } as never)
    render(<DirectorScriptReconciliationBanner />)

    expect(screen.getByTestId('director-script-reconciliation')).toHaveTextContent(
      'Your script covers 0:00–0:45',
    )
    expect(screen.getByTestId('director-script-reconciliation')).toHaveTextContent(
      'of a 4:15 track',
    )
    expect(screen.getByTestId('director-script-reconciliation')).toHaveTextContent(
      '3 scenes',
    )
    expect(screen.getByTestId('director-script-reconciliation')).toHaveTextContent(
      '3:30 of the audio were not scripted',
    )
  })

  it('offers both scopes for an excerpt', () => {
    useStore.setState({
      directorScriptReconciliation: {
        script: { scenes: [], global_style: '', span: [0, 45], anchored: true },
        report: EXCERPT_REPORT,
      },
    } as never)
    render(<DirectorScriptReconciliationBanner />)

    expect(screen.getByTestId('director-script-window-only')).toHaveTextContent(
      'Only the scripted part',
    )
    expect(screen.getByTestId('director-script-window-full')).toHaveTextContent(
      'Faixa inteira',
    )
  })

  it('marks the excerpt scope as already applied', () => {
    useStore.setState({
      directorScriptReconciliation: {
        script: { scenes: [], global_style: '', span: [0, 45], anchored: true },
        report: EXCERPT_REPORT,
      },
      directorScriptWindow: { start: 0, end: 45 },
    } as never)
    render(<DirectorScriptReconciliationBanner />)

    expect(screen.getByTestId('director-script-window-only')).toBeDisabled()
    expect(screen.getByTestId('director-script-window-full')).not.toBeDisabled()
    expect(screen.getByTestId('director-script-reconciliation')).toHaveTextContent(
      'O plano foi recalculado para 0:00–0:45',
    )
  })

  it('reports scenes without a timecode as an extra count', () => {
    useStore.setState({
      directorScriptReconciliation: {
        script: { scenes: [], global_style: '', span: [0, 45], anchored: true },
        report: { ...EXCERPT_REPORT, scene_count: 4, anchored_scene_count: 3 },
      },
    } as never)
    render(<DirectorScriptReconciliationBanner />)

    expect(screen.getByTestId('director-script-reconciliation')).toHaveTextContent(
      '4 in total, 1 without a timecode',
    )
  })

  it('calls the store with the covered window when the excerpt is chosen', () => {
    const setWindow = vi.fn()
    useStore.setState({
      directorScriptReconciliation: {
        script: { scenes: [], global_style: '', span: [0, 45], anchored: true },
        report: EXCERPT_REPORT,
      },
      directorSetScriptWindow: setWindow,
    } as never)
    render(<DirectorScriptReconciliationBanner />)

    screen.getByTestId('director-script-window-only').click()
    expect(setWindow).toHaveBeenCalledWith({ start: 0, end: 45 })
  })
})
