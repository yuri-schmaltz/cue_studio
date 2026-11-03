/**
 * Regression test: the scene review must be scrollable.
 *
 * The stage column has `overflow:hidden`, and the review card used to
 * be rendered without a scroll container of its own. With a 25-scene
 * plan the card grew past the column and got clipped — scene 20 was
 * unreachable and there was no scrollbar to reach it. The card is now
 * the scroll area, and the approval actions stay pinned below it.
 */

// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

import { DirectorReview } from './DirectorReview'
import { useStore } from '../../stores/useStore'
import type { PipelineStatus } from '../../api/client'

const SCENES = 25

function pausedStatus(): PipelineStatus {
  return {
    id: 'pipe-1',
    status: 'paused',
    phase: 'planning',
    auto_mode: false,
    progress: { current: 0, total: SCENES, message: 'Awaiting review', step: 6, total_steps: 10 },
    clip_plans: Array.from({ length: SCENES }, (_, i) => ({
      image_prompt: `image prompt ${i + 1}`,
      video_prompt: `video prompt ${i + 1}`,
    })),
    clip_images: [],
    output_files: [],
    error: null,
    pause_reason: 'review_plan',
    llm_streaming: false,
  }
}

describe('DirectorReview scrolling', () => {
  beforeEach(() => {
    localStorage.clear()
    useStore.setState({ pipelineId: 'pipe-1', pipelineStatus: pausedStatus() } as never)
  })

  it('renders one card per scene', () => {
    render(<DirectorReview />)
    expect(screen.getByText('Scene 1')).toBeInTheDocument()
    expect(screen.getByText(`Scene ${SCENES}`)).toBeInTheDocument()
  })

  it('puts the scene cards inside a scrollable container', () => {
    const { container } = render(<DirectorReview />)
    const scroller = container.querySelector('.overflow-y-auto')
    expect(scroller).not.toBeNull()
    // The last scene must be reachable by scrolling, not clipped.
    expect(scroller!.contains(screen.getByText(`Scene ${SCENES}`))).toBe(true)
  })

  it('keeps the approval actions outside the scroll area', () => {
    const { container } = render(<DirectorReview />)
    const scroller = container.querySelector('.overflow-y-auto')
    const approveAll = screen.getByRole('button', { name: /Approve all scenes/i })
    expect(scroller!.contains(approveAll)).toBe(false)
    expect(approveAll.closest('[data-testid="director-review"]')).not.toBeNull()
  })

  it('keeps the counter visible while the scenes scroll', () => {
    render(<DirectorReview />)
    expect(screen.getByText(`0/${SCENES} scenes approved`)).toBeInTheDocument()
  })
})
