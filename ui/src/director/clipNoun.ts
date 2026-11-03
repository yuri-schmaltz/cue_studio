/**
 * Clip/scene vocabulary shared by every Director surface.
 *
 * The Director calls the same unit "clip" (music video) or "scene"
 * (short film), and the counter used to be rendered in four different
 * formats across the app ("25 clips", "1 / 25", "Clip #1", "3/25
 * approved"). These helpers keep the *unit* consistent while letting
 * each surface keep the format that fits its context.
 */

export type ClipUnit = 'clip' | 'scene'

/** The unit word for a project type. */
export function clipUnit(isShortFilm: boolean): ClipUnit {
  return isShortFilm ? 'scene' : 'clip'
}

/** Pluralized unit: "1 clip" / "25 clips". */
export function clipNoun(count: number, isShortFilm: boolean): string {
  const unit = clipUnit(isShortFilm)
  return count === 1 ? unit : `${unit}s`
}

/**
 * The canonical counter badge: "25 clips" / "1 scene".
 * Used wherever a *total* is shown without a position.
 */
export function clipCountLabel(count: number, isShortFilm: boolean): string {
  return `${count} ${clipNoun(count, isShortFilm)}`
}

/**
 * A positional counter: "Clip 3 of 25" / "Scene 3 of 25".
 * Used wherever the surface also identifies *which* unit is selected.
 */
export function clipPositionLabel(
  index: number,
  total: number,
  isShortFilm: boolean,
): string {
  const unit = clipUnit(isShortFilm)
  const label = unit.charAt(0).toUpperCase() + unit.slice(1)
  return `${label} ${index + 1} of ${total}`
}

/**
 * A compact positional counter for dense rows: "3/25".
 * Only used where the surrounding row already names the unit.
 */
export function clipPositionCompact(index: number, total: number): string {
  return `${index + 1}/${total}`
}
