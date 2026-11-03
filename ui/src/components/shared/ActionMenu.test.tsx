// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ActionMenu } from './ActionMenu'

describe('ActionMenu', () => {
  it('keeps the menu closed until the trigger is pressed', () => {
    render(
      <ActionMenu
        ariaLabel="More actions for Project"
        items={[{ id: 'a', label: 'Duplicate setup', onSelect: vi.fn() }]}
      />,
    )
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(screen.getByLabelText('More actions for Project'))
    expect(screen.getByRole('menu')).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Duplicate setup' })).toBeTruthy()
  })

  it('runs the item action and closes the menu', () => {
    const onSelect = vi.fn()
    render(
      <ActionMenu
        ariaLabel="More actions for Project"
        items={[{ id: 'a', label: 'Duplicate setup', onSelect }]}
      />,
    )
    fireEvent.click(screen.getByLabelText('More actions for Project'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate setup' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('marks destructive items so they can be styled apart', () => {
    render(
      <ActionMenu
        ariaLabel="More actions for Project"
        items={[
          { id: 'a', label: 'Pin project', onSelect: vi.fn() },
          { id: 'b', label: 'Delete project', danger: true, onSelect: vi.fn() },
        ]}
      />,
    )
    fireEvent.click(screen.getByLabelText('More actions for Project'))
    expect(screen.getByRole('menuitem', { name: 'Delete project' }).className).toContain('action-menu__item--danger')
    expect(screen.getByRole('menuitem', { name: 'Pin project' }).className).not.toContain('action-menu__item--danger')
  })

  it('closes on Escape', () => {
    render(
      <ActionMenu
        ariaLabel="More actions for Project"
        items={[{ id: 'a', label: 'Duplicate setup', onSelect: vi.fn() }]}
      />,
    )
    fireEvent.click(screen.getByLabelText('More actions for Project'))
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
