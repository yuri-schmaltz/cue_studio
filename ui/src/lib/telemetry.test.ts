// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest'

import { sanitizeTelemetryFields, isTelemetryEnabled, setTelemetryEnabled, TELEMETRY_OPT_IN_KEY } from './telemetry'

describe('telemetry', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('opt-in defaults false', () => {
    expect(isTelemetryEnabled()).toBe(false)
  })

  it('setTelemetryEnabled persists', () => {
    setTelemetryEnabled(true)
    expect(localStorage.getItem(TELEMETRY_OPT_IN_KEY)).toBe('1')
    expect(isTelemetryEnabled()).toBe(true)
    setTelemetryEnabled(false)
    expect(isTelemetryEnabled()).toBe(false)
  })

  it('sanitizes PII keys and paths', () => {
    const out = sanitizeTelemetryFields({
      projectId: 'abc',
      durationMs: 123,
      prompt: 'secret prompt',
      filePath: '/tmp/x.png',
      nested: { token: 'tok', count: 5 },
      arr: ['a', 2],
    })
    expect(out.projectId).toBe('abc')
    expect(out.durationMs).toBe(123)
    expect(out.prompt).toBeUndefined()
    expect(out.filePath).toBeUndefined()
    expect((out.nested as Record<string, unknown>).token).toBeUndefined()
    expect((out.nested as Record<string, unknown>).count).toBe(5)
  })
})
