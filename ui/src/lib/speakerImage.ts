import { getUploadUrl } from '../api/client'
import type { SpeakerMapping } from '../types'

/**
 * A speaker's reference photo, in a form that outlives the page.
 *
 * The photo used to live only as a `blob:` object URL created from the
 * picked `File`. That URL is scoped to the document that created it,
 * but the mapping was written to the workspace draft verbatim — so the
 * next reload restored a URL whose blob no longer existed and the UI
 * showed a broken image in three places (the Music tab avatar, the
 * References > Characters card and the Director panel).
 *
 * The photo is therefore uploaded as soon as it is picked and the
 * server path travels with the mapping. A blob URL is now only a
 * transient preview while that upload is in flight; the persisted
 * mapping keeps the path, which the server can serve forever.
 */

/** The server path of a mapping's reference photo, if it has one. */
export function speakerImagePath(mapping: Pick<SpeakerMapping, 'imagePath'>): string | null {
  const path = mapping.imagePath
  return typeof path === 'string' && path.trim() ? path.trim() : null
}

/**
 * The URL to display a mapping's reference photo from.
 *
 * Prefers the uploaded server path so the picture survives a reload.
 * Falls back to an in-memory preview for the brief window between
 * picking a file and its upload finishing.
 */
export function speakerImageSrc(
  mapping: Pick<SpeakerMapping, 'imagePath' | 'imagePreview'>,
): string | null {
  const path = speakerImagePath(mapping)
  if (path) {
    const filename = path.replace(/\\/g, '/').split('/').filter(Boolean).pop()
    return filename ? getUploadUrl(filename) : null
  }
  const preview = mapping.imagePreview
  if (typeof preview === 'string' && preview.trim()) return preview
  return null
}

/**
 * Normalize a mapping that came back from the server.
 *
 * The stored `image` is a `File`, which JSON turns into `{}` — an
 * object that is not a File and cannot be re-uploaded. The stored
 * `imagePreview` is a `blob:` URL from a document that no longer
 * exists. Both are dropped so nothing renders a broken image or
 * silently ships an empty reference to the pipeline. The server path
 * is kept: it is the only part that still points at a real photo.
 */
export function sanitizeSpeakerMapping(raw: unknown): SpeakerMapping {
  const value = (raw ?? {}) as Partial<SpeakerMapping>
  const speakerId = typeof value.speakerId === 'string' ? value.speakerId : ''
  const name = typeof value.name === 'string' ? value.name : ''
  const role = (['rapping', 'singing', 'speaking', ''] as const).includes(value.role as never)
    ? value.role!
    : ''
  const imagePath = speakerImagePath(value as SpeakerMapping)
  const preview = typeof value.imagePreview === 'string' ? value.imagePreview.trim() : ''
  // A `blob:` preview only works inside the document that created it.
  // A draft loaded from disk belongs to a document that is gone.
  const imagePreview = preview && !preview.startsWith('blob:') ? preview : null
  const mapping: SpeakerMapping = { speakerId, name, role, imagePreview }
  if (imagePath) mapping.imagePath = imagePath
  return mapping
}

/**
 * The mapping as it should be written to the draft.
 *
 * The `File` and the transient blob preview are dropped on purpose:
 * neither survives JSON, and carrying a dead blob URL is exactly what
 * made the restored project show broken images.
 */
export function serializeSpeakerMapping(mapping: SpeakerMapping): Record<string, unknown> {
  const out: Record<string, unknown> = {
    speakerId: mapping.speakerId,
    name: mapping.name,
    role: mapping.role,
  }
  const path = speakerImagePath(mapping)
  if (path) out.imagePath = path
  const preview = typeof mapping.imagePreview === 'string' ? mapping.imagePreview.trim() : ''
  if (preview && !preview.startsWith('blob:')) out.imagePreview = preview
  return out
}
