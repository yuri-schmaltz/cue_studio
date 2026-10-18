// Vitest setup: jest-dom matchers (toHaveAttribute, toHaveAccessibleName,
// …) for the shared component tests. Registered for every suite via
// `setupFiles` in vitest.config.ts.
import '@testing-library/jest-dom/vitest'

// jsdom implements the <dialog> element (open reflection, cancel/close
// events) but not the modal behaviour. Minimal polyfill so AppDialog's
// focus and dismissal wiring can be exercised (feature A08).
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    if (!this.open) return
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
}
