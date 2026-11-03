import { describe, it, expect } from 'vitest'
import {
  clipCountLabel,
  clipNoun,
  clipPositionCompact,
  clipPositionLabel,
  clipUnit,
} from './clipNoun'

describe('clipNoun', () => {
  it('uses "clip" for music video and "scene" for short film', () => {
    expect(clipUnit(false)).toBe('clip')
    expect(clipUnit(true)).toBe('scene')
  })

  it('pluralizes only when the count is not one', () => {
    expect(clipNoun(1, false)).toBe('clip')
    expect(clipNoun(0, false)).toBe('clips')
    expect(clipNoun(25, false)).toBe('clips')
    expect(clipNoun(1, true)).toBe('scene')
    expect(clipNoun(12, true)).toBe('scenes')
  })

  it('formats the total counter', () => {
    expect(clipCountLabel(25, false)).toBe('25 clips')
    expect(clipCountLabel(1, false)).toBe('1 clip')
    expect(clipCountLabel(12, true)).toBe('12 scenes')
  })

  it('formats the positional counter', () => {
    expect(clipPositionLabel(0, 25, false)).toBe('Clip 1 of 25')
    expect(clipPositionLabel(11, 12, true)).toBe('Scene 12 of 12')
  })

  it('formats the compact positional counter', () => {
    expect(clipPositionCompact(2, 25)).toBe('3/25')
  })
})
