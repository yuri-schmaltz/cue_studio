// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  getPromptHistory,
  addPromptToHistory,
  removePromptFromHistory,
  clearPromptHistory,
} from './promptHistory'

describe('promptHistory', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns empty array when no history exists', () => {
    expect(getPromptHistory('image')).toEqual([])
  })

  it('adds prompts to history and respects mode isolation', () => {
    addPromptToHistory('image', 'a futuristic city at dusk')
    addPromptToHistory('video', 'cinematic drone flythrough')

    expect(getPromptHistory('image')).toEqual(['a futuristic city at dusk'])
    expect(getPromptHistory('video')).toEqual(['cinematic drone flythrough'])
    expect(getPromptHistory('audio')).toEqual([])
  })

  it('deduplicates and moves most recent prompt to the front', () => {
    addPromptToHistory('image', 'prompt 1')
    addPromptToHistory('image', 'prompt 2')
    addPromptToHistory('image', 'prompt 1')

    expect(getPromptHistory('image')).toEqual(['prompt 1', 'prompt 2'])
  })

  it('ignores empty or whitespace-only prompts', () => {
    addPromptToHistory('image', '   ')
    expect(getPromptHistory('image')).toEqual([])
  })

  it('respects the history limit', () => {
    for (let i = 1; i <= 35; i++) {
      addPromptToHistory('image', `prompt ${i}`, 10)
    }
    const history = getPromptHistory('image')
    expect(history.length).toBe(10)
    expect(history[0]).toBe('prompt 35')
  })

  it('removes prompt by index', () => {
    addPromptToHistory('image', 'p1')
    addPromptToHistory('image', 'p2')
    addPromptToHistory('image', 'p3')

    const updated = removePromptFromHistory('image', 1)
    expect(updated).toEqual(['p3', 'p1'])
    expect(getPromptHistory('image')).toEqual(['p3', 'p1'])
  })

  it('clears history for a specific mode or entirely', () => {
    addPromptToHistory('image', 'img prompt')
    addPromptToHistory('video', 'vid prompt')

    clearPromptHistory('image')
    expect(getPromptHistory('image')).toEqual([])
    expect(getPromptHistory('video')).toEqual(['vid prompt'])

    clearPromptHistory()
    expect(getPromptHistory('video')).toEqual([])
  })

  it('handles corrupt localStorage safely without throwing', () => {
    localStorage.setItem('cue-studio-prompt-history', '{invalid json}')
    expect(getPromptHistory('image')).toEqual([])

    // Should overwrite corrupt state cleanly
    addPromptToHistory('image', 'recovering from corrupt state')
    expect(getPromptHistory('image')).toEqual(['recovering from corrupt state'])
  })

  it('handles out of bounds index removal gracefully', () => {
    addPromptToHistory('image', 'only prompt')
    expect(removePromptFromHistory('image', -1)).toEqual(['only prompt'])
    expect(removePromptFromHistory('image', 99)).toEqual(['only prompt'])
    expect(getPromptHistory('image')).toEqual(['only prompt'])
  })

  it('preserves multiline prompts, emojis, and unicode symbols', () => {
    const richPrompt = "Line 1: 🌟 Night sky\nLine 2: Cyberpunk street 🚗💨\nLine 3: 漢字 & accents: àéîôù"
    addPromptToHistory('video', richPrompt)
    expect(getPromptHistory('video')).toEqual([richPrompt])
  })
})

