import type { StripFilter } from '@shared/ipc'
import type { Photo } from '@shared/photo'

export type { StripFilter }

export function matchesFilter(p: Photo, f: StripFilter): boolean {
  if (f === 'coords') return p.coords !== null
  if (f === 'modified') return p.modified
  return true
}

/** Ids of the photos shown in the strip, in strip order. */
export function visibleIds(photos: readonly Photo[], f: StripFilter): number[] {
  return photos.filter((p) => matchesFilter(p, f)).map((p) => p.id)
}

/**
 * The filter in force: a filter no photo passes is not available (its button is disabled),
 * so an active filter that became empty (e.g. "modified" after saving) falls back to "all".
 */
export function effectiveFilter(photos: readonly Photo[], f: StripFilter): StripFilter {
  return f !== 'all' && !photos.some((p) => matchesFilter(p, f)) ? 'all' : f
}

/** A click on a filter button: the active filter (other than "all") is switched off by a second click. */
export function toggleFilter(current: StripFilter, clicked: StripFilter): StripFilter {
  return clicked === current ? 'all' : clicked
}
