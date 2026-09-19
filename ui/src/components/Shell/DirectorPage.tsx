import { DirectorStage } from '../Stages/DirectorStage'

/**
 * Director page — single screen, full-height layout, planning only.
 *
 * The Director Stage renders three equal columns (chat / plan /
 * setup) so the user sees the creative conversation, the per-shot
 * artifacts, and the generation options without scrollbars stacking
 * vertically. The Manual Studio workflow (single-clip manual
 * generation, image/video editing) lives on its own shell tab
 * (StudioPage) so the Director workflow stays focused on AI-driven
 * end-to-end runs and manual tools are one click away without losing
 * the planning context.
 *
 *   ┌─────────────────────────────────────────────────────────┐
 *   │  DirectorStage: chat | plan | setup (1fr 1fr 1fr)        │
 *   └─────────────────────────────────────────────────────────┘
 *
 * The Style Bibles shortcut was moved into the Generation Options
 * column header (DirectorGenerationOptions) so the Director sub-
 * header doesn't compete with the planning surface. The modal
 * itself is owned locally by that component.
 */
export function DirectorPage() {
  return (
    <div className="director-layout h-full">
      <div className="director-stage-pane h-full">
        <DirectorStage />
      </div>
    </div>
  )
}
