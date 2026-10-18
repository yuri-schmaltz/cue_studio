// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest'

import { getStoredDensity, applyDensity, DENSITY_STORAGE_KEY } from './density'

describe('density', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-density')
  })

  it('defaults to comfortable', () => {
    expect(getStoredDensity()).toBe('comfortable')
  })

  it('reads persisted value', () => {
    localStorage.setItem(DENSITY_STORAGE_KEY, 'compact')
    expect(getStoredDensity()).toBe('compact')
  })

  it('applyDensity sets attribute and persists', () => {
    applyDensity('compact')
    expect(document.documentElement.getAttribute('data-density')).toBe('compact')
    expect(localStorage.getItem(DENSITY_STORAGE_KEY)).toBe('compact')
  })
})
