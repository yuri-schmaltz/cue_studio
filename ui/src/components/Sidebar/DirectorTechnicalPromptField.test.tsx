/**
 * Unit tests for the separate technical-prompt field.
 *
 * The technical prompt is global direction (fps, material, lighting), so
 * it must never be mixed into the scene script and must travel with
 * every clip.
 */

// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { DirectorTechnicalPromptField } from './DirectorTechnicalPromptField'
import { useStore } from '../../stores/useStore'

describe('DirectorTechnicalPromptField', () => {
  beforeEach(() => {
    useStore.setState({
      directorTechnicalPrompt: '',
      directorSetTechnicalPrompt: (v: string) => useStore.setState({ directorTechnicalPrompt: v }),
    } as never)
  })

  it('is always visible — there is nothing to expand', () => {
    render(<DirectorTechnicalPromptField />)
    expect(screen.getByTestId('director-technical-prompt-input')).toBeInTheDocument()
    expect(screen.queryByTestId('director-technical-prompt-toggle')).toBeNull()
  })

  it('explains what the field is for', () => {
    render(<DirectorTechnicalPromptField />)
    expect(screen.getByTestId('director-technical-prompt')).toHaveTextContent('Prompt técnico')
    expect(screen.getByTestId('director-technical-prompt')).toHaveTextContent(
      'fps, material, iluminação',
    )
  })

  it('writes to the store as the user types', async () => {
    render(<DirectorTechnicalPromptField />)
    await userEvent.type(screen.getByTestId('director-technical-prompt-input'), '12-15 fps')
    expect(useStore.getState().directorTechnicalPrompt).toBe('12-15 fps')
  })

  it('shows the existing content in the textarea', () => {
    useStore.setState({ directorTechnicalPrompt: '12-15 fps stop-motion claymation' } as never)
    render(<DirectorTechnicalPromptField />)
    expect(screen.getByTestId('director-technical-prompt-input')).toHaveValue(
      '12-15 fps stop-motion claymation',
    )
  })

  it('keeps a fixed height so the scene script does not move as the user types', () => {
    render(<DirectorTechnicalPromptField />)
    const input = screen.getByTestId('director-technical-prompt-input')
    // A fixed pixel height (rather than an auto-growing box) is what
    // keeps the block visually stable.
    expect(input.className).toContain('h-[120px]')
    expect(input.className).toContain('shrink-0')
  })
})
