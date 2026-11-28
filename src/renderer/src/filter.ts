import type { StripFilter } from '@shared/ipc'
import type { Photo } from '@shared/photo'

export type { StripFilter }

export function matchesFilter(p: Photo, f: StripFilter): boolean {
  // Tracks are shown whatever the filter (tz.md, п. 3.9.3).
  if (p.track) return true
  if (f === 'coords') return p.coords !== null
  if (f === 'noCoords') return p.coords === null
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
  return f !== 'all' && !photos.some((p) => !p.track && matchesFilter(p, f)) ? 'all' : f
}

const CYCLE: readonly StripFilter[] = ['all', 'coords', 'noCoords', 'modified']

/** F and View → Filter: … (tz.md, п. 4.9): the next filter in turn, skipping the empty ones. */
export function nextFilter(photos: readonly Photo[], current: StripFilter): StripFilter {
  const from = CYCLE.indexOf(current)
  for (let i = 1; i < CYCLE.length; i++) {
    const f = CYCLE[(from + i) % CYCLE.length]!
    if (effectiveFilter(photos, f) === f) return f
  }
  return current
}

/** A click on a filter button: the active filter (other than "all") is switched off by a second click. */
export function toggleFilter(current: StripFilter, clicked: StripFilter): StripFilter {
  return clicked === current ? 'all' : clicked
}
