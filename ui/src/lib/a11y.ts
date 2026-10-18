// Accessibility helpers (A23).

export function announce(message: string): void {
  try {
    const node = document.getElementById('a11y-status')
    if (node) {
      node.textContent = ''
      // Force a re-announcement even for repeated messages.
      window.requestAnimationFrame(() => {
        node.textContent = message
      })
    }
  } catch {
    /* ignore */
  }
}
