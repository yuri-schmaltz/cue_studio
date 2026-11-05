// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { StudioPage } from './StudioPage'

const runtime = vi.hoisted(() => ({ compact: false }))
vi.mock('../../lib/useIsMobile', () => ({ useIsMobile: () => runtime.compact }))
vi.mock('../../stores/useStore', () => ({ useStore: { subscribe: vi.fn(() => vi.fn()) } }))
vi.mock('../Sidebar/Sidebar', () => ({ Sidebar: () => <div>Generation controls</div> }))
vi.mock('../MainContent/MainContent', () => ({ MainContent: () => <div>Generated media</div> }))
vi.mock('../StyleBibles/StyleBiblesModal', () => ({ StyleBiblesModal: () => null }))

afterEach(cleanup)
describe('Studio page', () => {
  it('renders both desktop panels without depending on a mobile tab variable', () => {
    runtime.compact = false
    render(<StudioPage />)
    expect(screen.getByText('Generation controls')).toBeInTheDocument()
    expect(screen.getByText('Generated media')).toBeInTheDocument()
    expect(document.querySelector('#studio-controls-panel')).not.toHaveClass('hidden')
    expect(document.querySelector('#studio-results-panel')).not.toHaveClass('hidden')
  })
  it('switches between controls and results in the compact layout', () => {
    runtime.compact = true
    render(<StudioPage />)
    expect(document.querySelector('#studio-results-panel')).toHaveClass('hidden')
    fireEvent.click(screen.getByTestId('studio-tab-results'))
    expect(document.querySelector('#studio-controls-panel')).toHaveClass('hidden')
    expect(document.querySelector('#studio-results-panel')).not.toHaveClass('hidden')
  })
})
