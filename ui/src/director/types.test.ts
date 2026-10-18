// Tests for the A12 Director header/tab contract (pure derivations).

import { describe, expect, it } from 'vitest'

import {
  buildDirectorHeaderState,
  deriveDirectorStep,
  DIRECTOR_COLUMN_HREFS,
  DIRECTOR_LABELS,
  DIRECTOR_STEP_ORDER,
  tabForHref,
  tabForStep,
  type PipelineDirectorStep,
} from './types'

const ALL_PIPELINE_STEPS: PipelineDirectorStep[] = [
  'upload',
  'analyze',
  'structure',
  'style',
  'plan',
  'review',
  'generate_images',
  'plan_video',
  'review_video',
]

describe('deriveDirectorStep', () => {
  const expected: Record<PipelineDirectorStep, ReturnType<typeof deriveDirectorStep>> = {
    upload: 'briefing',
    analyze: 'briefing',
    structure: 'scenes',
    style: 'scenes',
    plan: 'scenes',
    generate_images: 'options',
    plan_video: 'options',
    review: 'review',
    review_video: 'review',
  }

  it('maps every pipeline step to its header group', () => {
    for (const step of ALL_PIPELINE_STEPS) {
      expect(deriveDirectorStep(step), `step ${step}`).toBe(expected[step])
    }
  })
})

describe('buildDirectorHeaderState', () => {
  it('starts at briefing: next action only, no back link', () => {
    const state = buildDirectorHeaderState('upload')
    expect(state.step).toBe('briefing')
    expect(state.nextAction).toEqual({ label: 'Continue to scenes', href: '#director-scenes' })
    expect(state.previousAction).toBeUndefined()
  })

  it('keeps briefing as the group while analyzing', () => {
    expect(buildDirectorHeaderState('analyze').step).toBe('briefing')
  })

  it('at scenes: points forward to options and back to briefing', () => {
    const state = buildDirectorHeaderState('plan')
    expect(state.step).toBe('scenes')
    expect(state.nextAction).toEqual({ label: 'Continue to options', href: '#director-options' })
    expect(state.previousAction).toEqual({ label: 'Back to briefing', href: '#director-briefing' })
  })

  it('during generation the group is options and review is next', () => {
    for (const step of ['generate_images', 'plan_video'] as const) {
      const state = buildDirectorHeaderState(step)
      expect(state.step, step).toBe('options')
      expect(state.nextAction, step).toEqual({ label: 'Continue to review', href: '#director-scenes' })
      expect(state.previousAction, step).toEqual({ label: 'Back to briefing', href: '#director-briefing' })
    }
  })

  it('at review: back link only — there is no next action', () => {
    for (const step of ['review', 'review_video'] as const) {
      const state = buildDirectorHeaderState(step)
      expect(state.step, step).toBe('review')
      expect(state.nextAction, step).toBeUndefined()
      expect(state.previousAction, step).toEqual({ label: 'Back to briefing', href: '#director-briefing' })
    }
  })

  it('previousAction is only present once the flow left briefing', () => {
    for (const step of ALL_PIPELINE_STEPS) {
      const state = buildDirectorHeaderState(step)
      if (state.step === 'briefing') expect(state.previousAction, step).toBeUndefined()
      else expect(state.previousAction, step).toBeDefined()
    }
  })
})

describe('tab helpers', () => {
  it('tabForStep maps every group, with review folding into scenes', () => {
    expect(tabForStep('briefing')).toBe('briefing')
    expect(tabForStep('scenes')).toBe('scenes')
    expect(tabForStep('options')).toBe('options')
    expect(tabForStep('review')).toBe('scenes')
  })

  it('tabForHref resolves the stage column anchors', () => {
    expect(tabForHref(DIRECTOR_COLUMN_HREFS.briefing)).toBe('briefing')
    expect(tabForHref(DIRECTOR_COLUMN_HREFS.scenes)).toBe('scenes')
    expect(tabForHref(DIRECTOR_COLUMN_HREFS.options)).toBe('options')
    expect(tabForHref('#director-review')).toBe('scenes')
    expect(tabForHref('#somewhere-else')).toBeNull()
  })
})

describe('DIRECTOR_LABELS', () => {
  it('exposes the four English step labels in order', () => {
    expect(DIRECTOR_STEP_ORDER.map((step) => DIRECTOR_LABELS.steps[step])).toEqual([
      'Briefing',
      'Scenes',
      'Options',
      'Review',
    ])
  })

  it('exposes the three mobile tab labels', () => {
    expect(DIRECTOR_LABELS.tabs).toEqual({ briefing: 'Briefing', scenes: 'Scenes', options: 'Options' })
  })

  it('uses the spec retry CTA for failed scenes', () => {
    // Spec A12 §5: a scene with status `failed` shows "Tentar de novo"
    // — English app wording: "Try again" (matches error-actions).
    expect(DIRECTOR_LABELS.retryScene).toBe('Try again')
  })
})
