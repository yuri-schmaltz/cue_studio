/**
 * Unit tests for the clip-structure source toggle.
 *
 * The Director used to derive every cut from the audio alone, so a
 * time-anchored briefing could only decorate the plan. These tests
 * cover the control that lets the briefing place the cuts, and the
 * granularity that decides whether a shot is a scene or a sub-segment.
 */

// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { DirectorStructureSourceToggle } from './DirectorStructureSourceToggle'
import { useStore } from '../../stores/useStore'

const anchoredReport = {
  status: 'full_track' as const,
  scene_count: 12,
  anchored_scene_count: 12,
  audio_duration: 255,
  covered_start: 0,
  covered_end: 255,
  covered_seconds: 255,
  coverage_ratio: 1,
  uncovered_seconds: 0,
  gaps: [],
}

function setScript(anchored: boolean) {
  useStore.setState({
    directorSceneDescription: 'CENA 1: Abertura (0:00 - 0:11)',
    directorScriptReconciliation: {
      script: { scenes: [], global_style: '', global_technical: '', span: null, anchored },
      report: {
        ...anchoredReport,
        anchored_scene_count: anchored ? 12 : 0,
        scene_count: anchored ? 12 : 1,
      },
    },
    directorStructureSource: 'audio',
    directorScriptGranularity: 'beat',
    directorLoading: false,
  } as never)
}

describe('DirectorStructureSourceToggle', () => {
  const setStructureSource = vi.fn()
  const setScriptGranularity = vi.fn()

  beforeEach(() => {
    setStructureSource.mockClear()
    setScriptGranularity.mockClear()
    useStore.setState({
      directorSetStructureSource: setStructureSource,
      directorSetScriptGranularity: setScriptGranularity,
    } as never)
    setScript(true)
  })

  it('offers both sources when the briefing carries timecodes', () => {
    render(<DirectorStructureSourceToggle />)
    expect(screen.getByTestId('director-structure-source-audio')).toBeInTheDocument()
    expect(screen.getByTestId('director-structure-source-script')).toBeInTheDocument()
  })

  it('explains how to enable script-driven cuts when there are no timecodes', () => {
    setScript(false)
    render(<DirectorStructureSourceToggle />)
    expect(screen.getByTestId('director-structure-source-unavailable')).toBeInTheDocument()
    expect(screen.queryByTestId('director-structure-source-script')).toBeNull()
  })

  it('hides the granularity until the script drives the structure', () => {
    render(<DirectorStructureSourceToggle />)
    expect(screen.queryByTestId('director-script-granularity-beat')).toBeNull()
  })

  it('offers scene and beat granularity for a script-driven plan', () => {
    useStore.setState({ directorStructureSource: 'script' } as never)
    render(<DirectorStructureSourceToggle />)
    expect(screen.getByTestId('director-script-granularity-scene')).toBeInTheDocument()
    expect(screen.getByTestId('director-script-granularity-beat')).toBeInTheDocument()
  })

  it('switches the source', async () => {
    render(<DirectorStructureSourceToggle />)
    await userEvent.click(screen.getByTestId('director-structure-source-script'))
    expect(setStructureSource).toHaveBeenCalledWith('script')
  })

  it('switches the granularity', async () => {
    useStore.setState({ directorStructureSource: 'script' } as never)
    render(<DirectorStructureSourceToggle />)
    await userEvent.click(screen.getByTestId('director-script-granularity-scene'))
    expect(setScriptGranularity).toHaveBeenCalledWith('scene')
  })

  it('reports how many scenes carry timecodes', () => {
    render(<DirectorStructureSourceToggle />)
    expect(screen.getByTestId('director-structure-source')).toHaveTextContent('12 cenas')
  })
})
