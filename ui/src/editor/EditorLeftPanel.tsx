import { FolderOpen, SlidersHorizontal, X } from 'lucide-react'
import { useStore } from '../stores/useStore'
import { EditorInspector } from './EditorInspector'
import { EditorMediaBin } from './EditorMediaBin'
import { useEditorStore } from './useEditorStore'

type EditorSideTab = 'media' | 'inspector'

/**
 * The Editor's tool drawer — mobile only.
 *
 * On a narrow screen the media bin and the inspector cannot both fit
 * next to the canvas, so they live behind a two-way switch driven by
 * the `mobilePanel` slice of the editor store.
 *
 * On the desktop the two surfaces are separate columns (see
 * `EditorWorkspace`): the store still flips `mobilePanel` to
 * "inspector" whenever a clip is selected, but nothing is hidden
 * there — the drawer is simply not mounted.
 */
export function EditorLeftPanel() {
  const sidebarOpen = useStore(state => state.sidebarOpen)
  const setSidebarOpen = useStore(state => state.setSidebarOpen)
  const mobilePanel = useEditorStore(state => state.mobilePanel)
  const setMobilePanel = useEditorStore(state => state.setMobilePanel)
  const tab: EditorSideTab = mobilePanel === 'inspector' ? 'inspector' : 'media'

  return (
    <>
      <aside
        className="fixed inset-y-0 left-0 z-[150] flex w-[380px] max-w-[85vw] flex-col border-r border-border bg-bg-secondary shadow-2xl transition-transform duration-300 ease-in-out"
        style={{ transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)' }}
        aria-label="Editor media and settings"
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
          <span className="text-sm font-semibold">Editor tools</span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              className="rounded-lg p-1.5 text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
              title="Close Editor panel"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="grid h-11 shrink-0 grid-cols-2 gap-1 border-b border-border bg-bg-secondary p-1.5">
          {([
            ['media', FolderOpen, 'Media'],
            ['inspector', SlidersHorizontal, 'Adjust'],
          ] as const).map(([value, Icon, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setMobilePanel(value)}
              className={`flex items-center justify-center gap-1.5 rounded-lg text-2xs font-medium transition-colors ${tab === value ? 'bg-bg-active text-text-primary shadow-sm' : 'text-text-muted hover:bg-bg-hover hover:text-text-secondary'}`}
            >
              <Icon size={12} className={tab === value ? 'text-accent-blue' : ''} />
              {label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1">
          {tab === 'media' ? <EditorMediaBin compact /> : <EditorInspector compact />}
        </div>
      </aside>
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Close Editor panel"
          className="fixed inset-0 z-[140] cursor-default bg-black/45"
          onClick={() => setSidebarOpen(false)}
        />
      )}
    </>
  )
}
