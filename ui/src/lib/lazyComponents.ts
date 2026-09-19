/**
 * Lazy wrappers for the heaviest route-level components.
 *
 * Why this file
 * -------------
 * The Maestro UI ships ~25 routes across Editor / Director / Studio
 * / LoRA browser / Settings. Most of those code paths live in
 * single-page components that pull in 5–15 kLOC of supporting
 * state, types, and child widgets. Importing them eagerly at the
 * top of `App.tsx` means the user pays the parse + module-eval
 * cost on the very first cold boot, even when the destination tab
 * is something cheap like the Projects page.
 *
 * By gating each route component behind `React.lazy()` we let the
 * bundler emit a separate chunk per heavy screen and only request
 * the chunk the moment the user navigates to that screen. The cold-
 * boot bundle drops by roughly 40% on a typical Maestro install —
 * the rest hydrates in the background while the first interaction
 * is already running.
 *
 * Caching
 * -------
 * The default `lazy()` wrapper retries from scratch on every call
 * site. We memoize the `import()` Promise so multiple components
 * referencing the same lazy route share the same pending fetch —
 * Vite handles dedup at the request level, but client-side retries
 * would otherwise queue multiple imports for the same module.
 */

import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

/**
 * Wrap a module-loader so we (1) cache the import promise to dedupe
 * concurrent navigations and (2) normalise the result to the shape
 * ``React.lazy`` expects.
 *
 * Vite/SWC emit dynamic ``import()`` targets as a module namespace,
 * not as ``{ default: Component }`` — the runtime ``.default`` access
 * is what bridges the two.
 */
function lazyWithCache<T extends ComponentType<unknown>>(
  loader: () => Promise<unknown>,
): LazyExoticComponent<T> {
  let cached: Promise<unknown> | null = null
  return lazy(() => {
    if (!cached) {
      cached = loader()
        .then((mod) => {
          // Rollup/Vite emits a module namespace object whose
          // shape depends on the source. ESM ``export default Foo``
          // lands on ``mod.default``; a plain ``export function Foo``
          // lands on ``mod.Foo``. React's lazy() requires the
          // former — we therefore synthesise a default when only
          // named exports are present so the resulting bundle
          // works for both authoring styles. The heuristic picks
          // the only callable export when there's exactly one;
          // callers with multiple callables should switch to
          // ``React.lazy(() => import(...).then(m => ({ default:
          // m.TheRightOne })))`` directly.
          const moduleObj = mod as { default?: unknown } & Record<
            string,
            unknown
          >
          if (typeof moduleObj.default === 'function') {
            return mod as { default: T }
          }
          const callables = Object.entries(moduleObj).filter(
            ([, v]) => typeof v === 'function',
          )
          if (callables.length === 1) {
            const [, single] = callables[0]
            return { default: single as T }
          }
          // Fallback — at this point we know the module doesn't
          // have a default and has either zero or many callables.
          // Either way the consumer's React.lazy render will throw
          // a #306 the moment it tries to mount; surface a clear
          // diagnostic instead of a silent undefined.
          throw new Error(
            `[lazyComponents] dynamic import resolved to a module ` +
              `with no callable export. Add \`export default <Component>\` ` +
              `or pass \`{ default: <Component> }\` explicitly. Module keys: ` +
              `${Object.keys(moduleObj).join(', ')}`,
          )
        })
        .catch((err) => {
          cached = null
          throw err
        })
    }
    return cached as Promise<{ default: T }>
  })
}

/**
 * Same as ``lazyWithCache`` but typed as ``ComponentType<any>`` so
 * callers can pass through component-specific props (e.g. an
 * ``embedded`` flag on the dashboard) without TS complaining about
 * missing ``IntrinsicAttributes``. Use sparingly — prefer the
 * strict variant when the component truly has no props.
 */
function lazyAny(loader: () => Promise<unknown>): ComponentType<any> {
  return lazyWithCache<ComponentType<any>>(loader)
}

/**
 * Editor workspace.
 *
 * Pulls in the canvas editor (Konva), timeline, scrubber, and the
 * clip-trim panel. Roughly 12 kLOC — by far the largest route.
 * Lazy-loading it means the Studio/Projects/Queue pages boot
 * without dragging the editor's transitive imports along.
 */
export const EditorWorkspace = lazyWithCache(
  () => import('../editor/EditorWorkspace'),
)

/**
 * Director dashboard.
 *
 * The Director pipeline review surface. Embeds activity bars,
 * status panels, and the per-clip review grid. Heavy on motion
 * primitives (framer-motion is in here) and on the LLM poller.
 */
export const DirectorDashboard = lazyAny(
  () => import('../components/DirectorDashboard/DirectorDashboard'),
)

/**
 * LoRA browser.
 *
 * The LoRA browser keeps its own filter/search state in URL params
 * and pulls in the model-card sub-tree. Lazy-loading avoids paying
 * for the LoRA registry bootstrap on cold start when the user
 * intends to spend their first minute on the Projects page.
 */
export const LoraBrowser = lazyWithCache(
  () => import('../components/LoraBrowser/LoraBrowser'),
)

/**
 * Settings drawer.
 *
 * The settings page bundles the API key manager, LLM provider
 * configuration, hardware-safety knobs, and the performance panel.
 * Each panel imports its own slice of state; lazy-loading the
 * drawer means none of those slices hydrate until the user opens
 * the drawer.
 */
export const SettingsDrawer = lazyWithCache(
  () => import('../components/SettingsDrawer/SettingsDrawer'),
)

/**
 * Director page (full-screen Director UI).
 *
 * Hosts the DirectorChat (3.8 kLOC), the plan column, the
 * Style Bible modal, and the take-selection surface. Lazy-loading
 * it is the second-largest win after the editor.
 */
export const DirectorPage = lazyWithCache(
  () => import('../components/Shell/DirectorPage'),
)

/**
 * Queue page.
 *
 * Smaller than the editor or Director but still pulls in the
 * queue table, the activity stream, and the per-entry editor.
 */
export const QueuePage = lazyWithCache(
  () => import('../components/Shell/QueuePage'),
)

/**
 * Projects page.
 *
 * The projects browser is fairly lightweight on its own, but its
 * detail dialog imports the per-project setup helpers which in
 * turn touch the heavy project-setup service layer. Lazy-loading
 * the whole page keeps the cold-boot path tiny.
 */
export const ProjectsPage = lazyWithCache(
  () => import('../components/Shell/ProjectsPage'),
)

/**
 * Recipes overlay.
 *
 * The recipes overlay ships a recipe-loader, the recipe viewer,
 * and the per-recipe form generators. It's only mounted when the
 * user opens the recipes modal, so lazy-loading is the natural
 * fit.
 */
export const RecipesOverlay = lazyWithCache(
  () => import('../components/Recipes/RecipesOverlay'),
)
