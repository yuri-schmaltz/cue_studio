// @vitest-environment jsdom
/**
 * Unit tests for <StudioTabs> (feature A13 §5: toggling
 * `Controls ↔ Results` by keyboard at ≤767px).
 */

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { StudioTabs } from './StudioTabs'

describe('StudioTabs', () => {
  it('renders both tabs with the selected one marked', () => {
    render(<StudioTabs activeTab="controls" onTabChange={() => {}} />)
    const controls = screen.getByRole('tab', { name: 'Controls' })
    const results = screen.getByRole('tab', { name: 'Results' })
    expect(controls).toHaveAttribute('aria-selected', 'true')
    expect(results).toHaveAttribute('aria-selected', 'false')
    // Roving tabindex: only the active tab is in the tab order.
    expect(controls).toHaveAttribute('tabindex', '0')
    expect(results).toHaveAttribute('tabindex', '-1')
    expect(screen.getByTestId('studio-tabs')).toHaveAttribute('role', 'tablist')
  })

  it('reports clicks through onTabChange', () => {
    const onTabChange = vi.fn()
    render(<StudioTabs activeTab="controls" onTabChange={onTabChange} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Results' }))
    expect(onTabChange).toHaveBeenCalledWith('results')
  })

  it('moves to the next tab with ArrowRight and focuses it', () => {
    const onTabChange = vi.fn()
    render(<StudioTabs activeTab="controls" onTabChange={onTabChange} />)
    fireEvent.keyDown(screen.getByTestId('studio-tabs'), { key: 'ArrowRight' })
    expect(onTabChange).toHaveBeenCalledWith('results')
    // jsdom applies focus synchronously after our direct .focus() call.
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Results' }))
  })

  it('wraps from Results back to Controls with ArrowLeft', () => {
    const onTabChange = vi.fn()
    render(<StudioTabs activeTab="results" onTabChange={onTabChange} />)
    fireEvent.keyDown(screen.getByTestId('studio-tabs'), { key: 'ArrowLeft' })
    expect(onTabChange).toHaveBeenCalledWith('controls')
  })

  it('jumps to the ends with Home/End', () => {
    const onTabChange = vi.fn()
    render(<StudioTabs activeTab="controls" onTabChange={onTabChange} />)
    fireEvent.keyDown(screen.getByTestId('studio-tabs'), { key: 'End' })
    expect(onTabChange).toHaveBeenCalledWith('results')
    onTabChange.mockClear()
    fireEvent.keyDown(screen.getByTestId('studio-tabs'), { key: 'Home' })
    expect(onTabChange).toHaveBeenCalledWith('controls')
  })

  it('shows the new-result dot on Results only while flagged', () => {
    const { rerender } = render(
      <StudioTabs activeTab="controls" onTabChange={() => {}} hasPendingResult />,
    )
    expect(screen.getByTestId('studio-tabs-pending')).toBeInTheDocument()
    rerender(<StudioTabs activeTab="controls" onTabChange={() => {}} />)
    expect(screen.queryByTestId('studio-tabs-pending')).toBeNull()
  })

  it('hides below md so the desktop split keeps its own chrome', () => {
    render(<StudioTabs activeTab="controls" onTabChange={() => {}} />)
    expect(screen.getByTestId('studio-tabs').className).toContain('md:hidden')
  })
})
