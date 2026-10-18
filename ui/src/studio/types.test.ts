// Tests for the A13 Studio layout contract (pure decision helpers).

import { describe, expect, it } from 'vitest'

import type { OutputFile } from '../types'
import {
  findNewOutput,
  generationConcluded,
  INTERACTION_GUARD_MS,
  isTextEntryTarget,
  shouldAutoSwitchToResults,
  STUDIO_LABELS,
  type AutoSwitchContext,
} from './types'

const output = (name: string, created_at: number): OutputFile => ({
  name,
  url: `outputs/${name}`,
  type: 'video',
  mode: null,
  favorite: false,
  size: 1,
  created_at,
})

describe('generationConcluded', () => {
  it('fires only on the true → false transition', () => {
    expect(generationConcluded(true, false)).toBe(true)
    expect(generationConcluded(false, false)).toBe(false)
    expect(generationConcluded(true, true)).toBe(false)
    expect(generationConcluded(false, true)).toBe(false)
  })
})

describe('findNewOutput', () => {
  it('returns the newest output that was not in the previous snapshot', () => {
    const result = findNewOutput([], [output('old.mp4', 100), output('new.mp4', 300), output('mid.mp4', 200)])
    expect(result).toEqual({ id: 'new.mp4', createdAt: '300' })
  })

  it('ignores outputs already seen', () => {
    expect(findNewOutput(['new.mp4'], [output('new.mp4', 300)])).toBeNull()
  })

  it('returns null when nothing appeared', () => {
    expect(findNewOutput([], [])).toBeNull()
  })

  it('does not depend on array order', () => {
    const result = findNewOutput([], [output('b.mp4', 5), output('a.mp4', 9)])
    expect(result?.id).toBe('a.mp4')
  })
})

describe('isTextEntryTarget', () => {
  const fake = (props: object) => props as unknown as Element

  it('detects form inputs and contenteditable regions', () => {
    expect(isTextEntryTarget(fake({ tagName: 'INPUT' }))).toBe(true)
    expect(isTextEntryTarget(fake({ tagName: 'TEXTAREA' }))).toBe(true)
    expect(isTextEntryTarget(fake({ tagName: 'SELECT' }))).toBe(true)
    expect(isTextEntryTarget(fake({ tagName: 'DIV', isContentEditable: true }))).toBe(true)
    expect(isTextEntryTarget(fake({ tagName: 'DIV', isContentEditable: false }))).toBe(false)
    expect(isTextEntryTarget(null)).toBe(false)
  })
})

describe('shouldAutoSwitchToResults', () => {
  const base: AutoSwitchContext = {
    concluded: true,
    compact: true,
    activeTab: 'controls',
    activeElement: { tagName: 'BODY' } as unknown as Element,
    lastInteractionAt: 0,
    now: 10_000,
  }

  it('switches when the run concluded on the mobile layout and the user is idle', () => {
    expect(shouldAutoSwitchToResults(base)).toBe(true)
  })

  it('never switches without a conclusion', () => {
    expect(shouldAutoSwitchToResults({ ...base, concluded: false })).toBe(false)
  })

  it('never switches on the desktop split layout', () => {
    expect(shouldAutoSwitchToResults({ ...base, compact: false })).toBe(false)
  })

  it('does nothing when the user is already on Results', () => {
    expect(shouldAutoSwitchToResults({ ...base, activeTab: 'results' })).toBe(false)
  })

  it('does not steal focus from a text input', () => {
    expect(
      shouldAutoSwitchToResults({ ...base, activeElement: { tagName: 'TEXTAREA' } as unknown as Element }),
    ).toBe(false)
  })

  it('respects the 4s interaction guard (spec A13 §7)', () => {
    const recent = { ...base, lastInteractionAt: 10_000 - (INTERACTION_GUARD_MS - 1) }
    expect(shouldAutoSwitchToResults(recent)).toBe(false)
    const exactlyAtGuard = { ...base, lastInteractionAt: 10_000 - INTERACTION_GUARD_MS }
    expect(shouldAutoSwitchToResults(exactlyAtGuard)).toBe(true)
  })
})

describe('STUDIO_LABELS', () => {
  it('uses the English tab labels from the spec', () => {
    expect(STUDIO_LABELS.tabs).toEqual({ controls: 'Controls', results: 'Results' })
  })
})
