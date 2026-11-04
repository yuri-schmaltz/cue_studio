/**
 * The pre-flight card is the last thing a Director user reads before
 * committing GPU time, so it has to say three things plainly: how many
 * shots the plan became, how long the render will take, and whether the
 * longest shot fits in this machine's VRAM.
 */

// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

import { DirectorPreflightCard } from './DirectorPreflightCard'
import { useStore } from '../../stores/useStore'
import type { DirectorPreflightReport } from '../../types'

function report(overrides: Partial<DirectorPreflightReport> = {}): DirectorPreflightReport {
  return {
    schema: 1,
    video_model: 'ltx2_22B_distilled_1_1',
    resolution: '1280x720',
    fps: 25,
    num_inference_steps: 8,
    video_strategy: 'rolling_window',
    window_frames: 506,
    clip_count: 13,
    total_duration_seconds: 255,
    total_frames: 6373,
    max_clip_frames: 497,
    per_clip: [],
    estimated_seconds: 11520,
    estimated_clip_seconds: 886,
    eta_confidence: 'low',
    eta_match: 'model',
    eta_samples: 12,
    setup_seconds: 45,
    join_seconds: 63,
    gpu_vram_gb: 12,
    vram_required_gb: 16,
    max_frames_at_detected_vram: 243,
    effective_max_frames: null,
    peak_frames: 506,
    observed_window_frames: 137,
    oom_risk: 'high',
    oom_reason: 'One pass of this render needs 506 frames, above the 137-frame limit.',
    fallback_resolution: '720p or lower',
    warnings: [
      {
        code: 'oom_risk',
        severity: 'error',
        message: 'One pass of this render needs 506 frames, above the 137-frame limit.',
      },
    ],
    ...overrides,
  }
}

describe('DirectorPreflightCard', () => {
  beforeEach(() => {
    localStorage.clear()
    useStore.setState({
      directorPreflight: null,
      directorPreflightLoading: false,
      directorPreflightError: null,
    } as never)
  })

  it('renders nothing without a plan', () => {
    render(<DirectorPreflightCard />)
    expect(screen.queryByTestId('director-preflight-card')).toBeNull()
  })

  it('shows the shot count, the footage and the render estimate', () => {
    useStore.setState({ directorPreflight: report() } as never)
    render(<DirectorPreflightCard />)
    expect(screen.getByText('13')).toBeInTheDocument()
    expect(screen.getByText('4:15')).toBeInTheDocument()
    expect(screen.getByText('3h 12m')).toBeInTheDocument()
  })

  it('marks a render that will not fit as an error', () => {
    useStore.setState({ directorPreflight: report() } as never)
    render(<DirectorPreflightCard />)
    expect(screen.getByText(/Won’t fit/)).toBeInTheDocument()
    expect(
      screen.getByText(/needs 506 frames, above the 137-frame limit/),
    ).toBeInTheDocument()
  })

  it('says so when the machine has no timing history', () => {
    useStore.setState({
      directorPreflight: report({
        estimated_seconds: null,
        eta_confidence: 'calibrating',
        warnings: [],
      }),
    } as never)
    render(<DirectorPreflightCard />)
    expect(screen.getByText('Not available yet')).toBeInTheDocument()
  })

  it('surfaces a failed estimate instead of staying blank', () => {
    useStore.setState({ directorPreflightError: 'boom' } as never)
    render(<DirectorPreflightCard />)
    expect(screen.getByText('boom')).toBeInTheDocument()
  })
})
