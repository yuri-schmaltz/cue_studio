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

  it('is collapsed by default', () => {
    render(<DirectorTechnicalPromptField />)
    expect(screen.queryByTestId('director-technical-prompt-input')).toBeNull()
    expect(screen.getByTestId('director-technical-prompt-toggle')).toHaveAttribute('aria-expanded', 'false')
  })

  it('explains what the field is for while collapsed', () => {
    render(<DirectorTechnicalPromptField />)
    expect(screen.getByTestId('director-technical-prompt')).toHaveTextContent('Prompt técnico')
    expect(screen.getByTestId('director-technical-prompt')).toHaveTextContent(
      'fps, material, iluminação',
    )
  })

  it('opens on click and exposes a textarea', async () => {
    render(<DirectorTechnicalPromptField />)
    await userEvent.click(screen.getByTestId('director-technical-prompt-toggle'))
    expect(screen.getByTestId('director-technical-prompt-input')).toBeInTheDocument()
    expect(screen.getByTestId('director-technical-prompt-toggle')).toHaveAttribute('aria-expanded', 'true')
  })

  it('writes to the store as the user types', async () => {
    render(<DirectorTechnicalPromptField />)
    await userEvent.click(screen.getByTestId('director-technical-prompt-toggle'))
    await userEvent.type(screen.getByTestId('director-technical-prompt-input'), '12-15 fps')
    expect(useStore.getState().directorTechnicalPrompt).toBe('12-15 fps')
  })

  it('summarises existing content in the collapsed header', () => {
    useStore.setState({ directorTechnicalPrompt: '12-15 fps stop-motion claymation' } as never)
    render(<DirectorTechnicalPromptField />)
    expect(screen.getByTestId('director-technical-prompt')).toHaveTextContent(
      '12-15 fps stop-motion claymation',
    )
  })
})
