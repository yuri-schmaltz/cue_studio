// @vitest-environment jsdom
/**
 * Unit tests for <DirectorHeader> (feature A12 §5: the header shows
 * the current step and the next action; the "Back to briefing" link
 * only appears once the flow left the briefing group).
 */

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { DirectorHeader } from './DirectorHeader'

describe('DirectorHeader', () => {
  it('renders the full stepper with the current group marked', () => {
    render(<DirectorHeader pipelineStep="plan" />)
    for (const label of ['Briefing', 'Scenes', 'Options', 'Review']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(screen.getByTestId('director-header')).toHaveAttribute('data-step', 'scenes')
    // aria-current="step" pins the current stepper item.
    const current = screen.getByText('Scenes').closest('[aria-current]')
    expect(current).toHaveAttribute('aria-current', 'step')
  })

  it('shows the next action at briefing but no back link', () => {
    render(<DirectorHeader pipelineStep="upload" />)
    const next = screen.getByRole('link', { name: /Continue to scenes/ })
    expect(next).toHaveAttribute('href', '#director-scenes')
    expect(screen.queryByRole('link', { name: /Back to briefing/ })).toBeNull()
  })

  it('shows both actions mid-flow and forwards clicks to onNavigate', () => {
    const onNavigate = vi.fn()
    render(<DirectorHeader pipelineStep="generate_images" onNavigate={onNavigate} />)

    fireEvent.click(screen.getByRole('link', { name: /Continue to review/ }))
    expect(onNavigate).toHaveBeenCalledWith('#director-scenes')

    fireEvent.click(screen.getByRole('link', { name: /Back to briefing/ }))
    expect(onNavigate).toHaveBeenCalledWith('#director-briefing')
  })

  it('drops the next action at the review step', () => {
    render(<DirectorHeader pipelineStep="review_video" />)
    expect(screen.getByRole('link', { name: /Back to briefing/ })).toHaveAttribute(
      'href',
      '#director-briefing',
    )
    expect(screen.queryByRole('link', { name: /Continue/ })).toBeNull()
  })

  it('keeps anchor hrefs so it still works without an onNavigate handler', () => {
    render(<DirectorHeader pipelineStep="style" />)
    expect(screen.getByRole('link', { name: /Continue to options/ })).toHaveAttribute(
      'href',
      '#director-options',
    )
  })
})
