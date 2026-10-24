import { useEffect } from 'react'
import { useStore } from '../stores/useStore'
import { useEditorStore } from '../editor/useEditorStore'

/**
 * Checks whether Cue Studio has active work that would be destroyed
 * by an accidental page reload, tab closure, or browser restart.
 */
export function hasActiveUnsavedWork(): boolean {
  try {
    const store = useStore.getState()
    const hasRunningJobs = (store.jobs || []).some(
      job => job.status === 'running' || job.status === 'queued'
    )
    if (store.isGenerating || hasRunningJobs) return true

    // Check Editor timeline unsaved modifications
    const editor = useEditorStore.getState()
    if (editor.dirty) return true
  } catch {
    // If stores fail to read, do not block unload
  }
  return false
}

/**
 * Global beforeunload protection hook. Mounted once at App root.
 */
export function useUnloadProtection(): void {
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (hasActiveUnsavedWork()) {
        event.preventDefault()
        // Setting returnValue triggers the browser's native confirmation dialog
        event.returnValue = ''
        return ''
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [])
}
