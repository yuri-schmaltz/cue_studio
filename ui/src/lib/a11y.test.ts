// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { announce } from './a11y'

describe('a11y announce', () => {
  it('writes message to a11y-status node', () => {
    const node = document.createElement('div')
    node.id = 'a11y-status'
    document.body.appendChild(node)
    announce('hello')
    // requestAnimationFrame async
    return new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        expect(node.textContent).toBe('hello')
        resolve()
      })
    })
  })
})
