/**
 * Legacy-key migration helper — single chokepoint for replacing
 * `maestro-*` localStorage / IndexedDB keys with `cue-studio-*`.
 *
 * Cue Studio v2.1 renamed the product. Backwards compatibility is
 * preserved by reading from the maestro key on first access and writing
 * to the cue-studio key. Each helper returns the canonical (new) value,
 * which code should store and reuse.
 *
 * Add new keys here — never inline the read/write pairs at call sites.
 * The migration is one-shot: `migrateAll()` runs once per browser
 * (gated by `cue-migrations-v1-done`) and rewrites everything it finds.
 */

const MIGRATION_FLAG = 'cue-studio-migrations-v1-done'

/** Build the canonical key from a legacy `maestro*` name. */
function newKey(legacy: string): string {
  // maestro-thumbnails           → cue-studio-thumbnails
  // maestro-collapsed-...        → cue-studio-collapsed-...
  // maestro_civitai_nsfw         → cue_studio_civitai_nsfw
  // maestro-scene-rejections:... → cue-studio-scene-rejections:...
  return legacy.replace(/^maestro[-_]/, 'cue-studio-').replace(/^maestro-/, 'cue-studio-')
}

/**
 * Read a value via the new key, falling back to the legacy key on first
 * hit. After a successful read the legacy key is removed so we don't keep
 * paying the lookup cost. Returns undefined if neither exists.
 */
export function readWithLegacy<T>(
  storage: Storage,
  newName: string,
  legacyName: string,
  parse: (raw: string) => T,
): T | undefined {
  try {
    const direct = storage.getItem(newName)
    if (direct != null) return parse(direct)
    const old = storage.getItem(legacyName)
    if (old == null) return undefined
    const value = parse(old)
    storage.setItem(newName, old)
    storage.removeItem(legacyName)
    return value
  } catch {
    return undefined
  }
}

/** Write the canonical key. No-op if localStorage is unavailable. */
export function writeKey(storage: Storage, name: string, value: string): void {
  try {
    storage.setItem(name, value)
  } catch {
    /* private mode / quota */
  }
}

/** Remove a key, swallowing storage errors. */
export function removeKey(storage: Storage, name: string): void {
  try {
    storage.removeItem(name)
  } catch {
    /* ignore */
  }
}

/**
 * Build the canonical schema-bump key from a legacy name.
 *
 * Use this for keys whose values embed a version (IndexedDB names,
 * persisted snapshots). The scheme transforms:
 *   maestro-foo           → cue-studio-foo
 *   maestro-thumbnails    → cue-studio-thumbnails
 */
export function migratedKey(legacy: string): string {
  return newKey(legacy)
}

/**
 * Migration table: a function per legacy key that knows how to convert
 * the stored value into the new format. Add an entry whenever you remove
 * a maestro-* key from the codebase.
 *
 * Each migrator is invoked exactly once per browser. Failed migrators
 * are swallowed and logged so a single broken schema can't block the
 * whole upgrade path.
 */
const MIGRATORS: Array<(storage: Storage) => void> = [
  // Theme storage — maestro-theme-mode / maestro-theme-family /
  // maestro-theme-dark / maestro-theme → cue-studio-theme-*.
  // The theme helper already handles fallback reads; here we just
  // promote any still-pending legacy writes into the new layout so we
  // can drop the old keys from the user's storage.
  storage => {
    const legacyPairs: Array<[string, string]> = [
      ['maestro-theme-mode', 'cue-studio-theme-mode'],
      ['maestro-theme-family', 'cue-studio-theme-family'],
      ['maestro-theme-dark', 'cue-studio-theme-dark'],
      ['maestro-theme', 'cue-studio-theme'],
    ]
    for (const [from, to] of legacyPairs) {
      const v = storage.getItem(from)
      if (v != null && storage.getItem(to) == null) storage.setItem(to, v)
      storage.removeItem(from)
    }
  },
  // Notifications history (per-device seen-key buffer).
  storage => {
    const oldPrefs = 'maestro-notification-preferences-v1'
    const newPrefs = 'cue-studio-notification-preferences-v1'
    const oldSeen = 'maestro-notification-seen-v1'
    const newSeen = 'cue-studio-notification-seen-v1'
    const p = storage.getItem(oldPrefs)
    if (p != null && storage.getItem(newPrefs) == null) storage.setItem(newPrefs, p)
    storage.removeItem(oldPrefs)
    const s = storage.getItem(oldSeen)
    if (s != null && storage.getItem(newSeen) == null) storage.setItem(newSeen, s)
    storage.removeItem(oldSeen)
  },
  // Welcome modal one-shot
  storage => {
    const old = 'maestro_welcome_seen_v1'
    const next = 'cue-studio_welcome_seen_v1'
    const v = storage.getItem(old)
    if (v != null && storage.getItem(next) == null) storage.setItem(next, v)
    storage.removeItem(old)
  },
  // System notifications panel: collapsed-model-families
  storage => {
    const old = 'maestro-collapsed-model-families'
    const next = 'cue-studio-collapsed-model-families'
    const v = storage.getItem(old)
    if (v != null && storage.getItem(next) == null) storage.setItem(next, v)
    storage.removeItem(old)
  },
  // Studio mode settings blob
  storage => {
    const old = 'maestro_mode_settings'
    const next = 'cue-studio_mode_settings'
    const v = storage.getItem(old)
    if (v != null && storage.getItem(next) == null) storage.setItem(next, v)
    storage.removeItem(old)
  },
  // CivitAI NSFW toggle (underbar-separated)
  storage => {
    const old = 'maestro_civitai_nsfw'
    const next = 'cue-studio_civitai_nsfw'
    const v = storage.getItem(old)
    if (v != null && storage.getItem(next) == null) storage.setItem(next, v)
    storage.removeItem(old)
  },
  // LoRA NSFW toggle
  storage => {
    const old = 'maestro_loras_show_nsfw'
    const next = 'cue-studio_loras_show_nsfw'
    const v = storage.getItem(old)
    if (v != null && storage.getItem(next) == null) storage.setItem(next, v)
    storage.removeItem(old)
  },
  // Generations review prompt
  storage => {
    const old = 'maestro-pending-generation-review'
    const next = 'cue-studio-pending-generation-review'
    const v = storage.getItem(old)
    if (v != null && storage.getItem(next) == null) storage.setItem(next, v)
    storage.removeItem(old)
  },
  // Director scene-rejection journal uses dynamic keys:
  //   maestro-scene-rejections:<pid>:<reason>:<digest>
  // We rename the prefix only; the colon-separated suffix is opaque to us.
  storage => {
    const oldPrefix = 'maestro-scene-rejections:'
    const newPrefix = 'cue-studio-scene-rejections:'
    const toRename: string[] = []
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i)
      if (k && k.startsWith(oldPrefix)) toRename.push(k)
    }
    for (const k of toRename) {
      const v = storage.getItem(k)
      if (v == null) continue
      const renamed = newPrefix + k.slice(oldPrefix.length)
      if (storage.getItem(renamed) == null) storage.setItem(renamed, v)
      storage.removeItem(k)
    }
  },
  // Sessionstorage-only flag used by the welcome pre-flight banner.
  sessionStorage => {
    const old = 'maestro_preflight_dismissed'
    const next = 'cue-studio_preflight_dismissed'
    const v = sessionStorage.getItem(old)
    if (v != null && sessionStorage.getItem(next) == null) sessionStorage.setItem(next, v)
    sessionStorage.removeItem(old)
  },
]

/**
 * Run all migrators exactly once per browser. Safe to call at every app
 * boot — the migration flag prevents re-running.
 */
export function migrateAll(): void {
  if (typeof localStorage === 'undefined') return
  try {
    if (localStorage.getItem(MIGRATION_FLAG) === 'done') return
    for (const run of MIGRATORS) {
      try {
        run(localStorage)
      } catch (err) {
        console.warn('[cue-studio] migrator failed', err)
      }
    }
    try {
      localStorage.setItem(MIGRATION_FLAG, 'done')
    } catch {
      /* ignore */
    }
  } catch {
    /* no localStorage available */
  }
}

/**
 * IndexedDB name migrator — separate because IDB open() takes a name,
 * not a key. Apply when opening the DB.
 */
export function migratedIdbName(legacy: string): string {
  return newKey(legacy)
}
