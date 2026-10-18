// Density preference (A21): comfortable (default) vs compact.
//
// Persisted to localStorage under `cue-density` and applied to the
// <html> element as `data-density="..."` so the CSS tokens in
// index.css cascade into every component that opts into them.

export type Density = 'comfortable' | 'compact'

export const DENSITY_STORAGE_KEY = 'cue-density'

export function getStoredDensity(): Density {
  try {
    const raw = localStorage.getItem(DENSITY_STORAGE_KEY)
    if (raw === 'compact' || raw === 'comfortable') return raw
  } catch {
    /* localStorage blocked — fall back to default */
  }
  return 'comfortable'
}

export function applyDensity(density: Density): void {
  try {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-density', density)
    }
    localStorage.setItem(DENSITY_STORAGE_KEY, density)
  } catch {
    /* ignore storage failures */
  }
}

// Apply the persisted preference as early as possible so the first
// paint already uses the right tokens.
if (typeof document !== 'undefined') {
  applyDensity(getStoredDensity())
}
