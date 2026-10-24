/**
 * Prompt history management per generation mode (image, video, audio).
 * Persisted in localStorage so past prompts can be inspected and restored.
 */

const STORAGE_KEY = 'cue-studio-prompt-history'
const DEFAULT_LIMIT = 30

type HistoryMap = Record<string, string[]>

function loadAllHistory(): HistoryMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

function saveAllHistory(history: HistoryMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history))
  } catch {
    // LocalStorage full or unavailable
  }
}

export function getPromptHistory(mode: string): string[] {
  const all = loadAllHistory()
  const list = all[mode]
  return Array.isArray(list) ? list : []
}

export function addPromptToHistory(mode: string, prompt: string, limit = DEFAULT_LIMIT): string[] {
  const clean = prompt.trim()
  if (!clean) return getPromptHistory(mode)

  const all = loadAllHistory()
  const current = Array.isArray(all[mode]) ? all[mode] : []

  // Remove duplicate if it already exists, then push to front
  const filtered = current.filter(item => item.trim() !== clean)
  const updated = [clean, ...filtered].slice(0, limit)

  all[mode] = updated
  saveAllHistory(all)
  return updated
}

export function removePromptFromHistory(mode: string, index: number): string[] {
  const all = loadAllHistory()
  const current = Array.isArray(all[mode]) ? all[mode] : []
  if (index < 0 || index >= current.length) return current

  const updated = [...current.slice(0, index), ...current.slice(index + 1)]
  all[mode] = updated
  saveAllHistory(all)
  return updated
}

export function clearPromptHistory(mode?: string): void {
  if (mode) {
    const all = loadAllHistory()
    delete all[mode]
    saveAllHistory(all)
  } else {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // LocalStorage unavailable
    }
  }
}
