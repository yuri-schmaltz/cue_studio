/**
 * Unit tests for the shared field primitives (feature A08):
 * TextField, NumberField and Select share the label/hint/error
 * `aria-describedby` contract.
 */

// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { TextField } from './TextField'
import { NumberField } from './NumberField'
import { Select } from './Select'

describe('TextField', () => {
  it('associates the label with the input and reports changes', () => {
    const onChange = vi.fn()
    render(
      <TextField id="name" label="Project name" value="abc" onChange={onChange} />,
    )
    const input = screen.getByLabelText('Project name')
    expect(input).toHaveValue('abc')
    fireEvent.change(input, { target: { value: 'xyz' } })
    expect(onChange).toHaveBeenCalledWith('xyz')
  })

  it('links hint and error through aria-describedby and marks aria-invalid', () => {
    render(
      <TextField
        id="name"
        label="Project name"
        value=""
        onChange={() => {}}
        hint="lowercase, no spaces"
        error="Name is required"
      />,
    )
    const input = screen.getByLabelText('Project name')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('lowercase, no spaces Name is required')
    expect(screen.getByRole('alert')).toHaveTextContent('Name is required')
  })

  it('links the success message when there is no error', () => {
    render(
      <TextField id="name" label="Project name" value="ok" onChange={() => {}} success="Saved" />,
    )
    expect(screen.getByLabelText('Project name')).toHaveAccessibleDescription('Saved')
  })

  it('mirrors autoFocus into data-autofocus for AppDialog initial focus', () => {
    render(
      <TextField id="name" label="Project name" value="" onChange={() => {}} autoFocus />,
    )
    expect(screen.getByLabelText('Project name')).toHaveAttribute('data-autofocus')
  })
})

describe('NumberField', () => {
  it('uses a numeric input mode and reports numbers', () => {
    const onChange = vi.fn()
    render(
      <NumberField id="count" label="Clips" value={3} onChange={onChange} />,
    )
    const input = screen.getByLabelText('Clips')
    expect(input).toHaveAttribute('inputmode', 'numeric')
    fireEvent.change(input, { target: { value: '7' } })
    expect(onChange).toHaveBeenCalledWith(7)
  })

  it('reports an empty string for unparseable values and wires errors', () => {
    const onChange = vi.fn()
    render(
      <NumberField id="count" label="Clips" value={5} onChange={onChange} error="Must be a number" />,
    )
    const input = screen.getByLabelText('Clips')
    fireEvent.change(input, { target: { value: '' } })
    expect(onChange).toHaveBeenCalledWith('')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('Must be a number')
  })
})

describe('Select', () => {
  it('renders options and reports the chosen value', () => {
    const onChange = vi.fn()
    render(
      <Select
        id="skill"
        label="Skill"
        value="a"
        onChange={onChange}
        options={[{ value: 'a', label: 'Music video' }, { value: 'b', label: 'Short film' }]}
      />,
    )
    const select = screen.getByLabelText('Skill')
    expect(select).toHaveValue('a')
    fireEvent.change(select, { target: { value: 'b' } })
    expect(onChange).toHaveBeenCalledWith('b')
  })

  it('wires hint and error like the other fields', () => {
    render(
      <Select
        id="skill"
        label="Skill"
        value="a"
        onChange={() => {}}
        options={[{ value: 'a', label: 'Music video' }]}
        hint="Pick one"
        error="Required"
      />,
    )
    const select = screen.getByLabelText('Skill')
    expect(select).toHaveAttribute('aria-invalid', 'true')
    expect(select).toHaveAccessibleDescription('Pick one Required')
  })
})
