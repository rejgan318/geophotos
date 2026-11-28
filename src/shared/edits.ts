import { sameAddress, sameAltitude, sameCoords, sameDirection, type Address, type FileMeta, type LatLon, type Photo } from './photo'
import { distance } from './track'

/** Coordinates are kept to 7 decimals (about 1 cm): more is noise from the mouse position. */
export function roundCoords(c: LatLon): LatLon {
  const r = (v: number): number => Math.round(v * 1e7) / 1e7
  return { lat: r(c.lat), lon: r(c.lon) }
}

/** Longitude brought into −180…180 (the map can be scrolled around the world). */
export function normalizeCoords(c: LatLon): LatLon {
  let lon = ((((c.lon + 180) % 360) + 360) % 360) - 180
  if (lon === -180 && c.lon > 0) lon = 180
  return roundCoords({ lat: Math.max(-90, Math.min(90, c.lat)), lon })
}

/** A photo is modified while its coordinates, address, altitude or direction differ from its files (п. 4.3). */
export function isModified(p: FileMeta, file: FileMeta | undefined): boolean {
  return (
    !sameCoords(p.coords, file?.coords ?? null) ||
    !sameAddress(p.address, file?.address ?? null) ||
    !sameAltitude(p.altitude, file?.altitude ?? null) ||
    !sameDirection(p.direction, file?.direction)
  )
}

/**
 * A move this short only corrects the place (tz.md, п. 4.21): the direction set at the old point
 * still points at what was shot. Farther, it is removed.
 */
export const DIRECTION_KEEP_METERS = 30

/**
 * Gives the photos new coordinates (tz.md, пп. 4.5, 4.7), or removes them with `null` (Del,
 * п. 6.6). The address and altitude go with the old coordinates: they would be wrong at the new
 * point (п. 6.2).
 * Returns only the photos that changed, as new objects. A photo counts as modified while it
 * differs from its files (`file`), so moving it back to where it was removes the mark (unless
 * its address from the file is gone).
 */
export function assignCoords(
  photos: readonly Photo[],
  file: readonly FileMeta[],
  ids: readonly number[],
  coords: LatLon | null
): Photo[] {
  const c = coords ? normalizeCoords(coords) : null
  const changed: Photo[] = []
  for (const id of new Set(ids)) {
    const p = photos[id]
    // A track has no coordinates of its own and is never edited (tz.md, п. 3.9).
    if (!p || p.track || sameCoords(p.coords, c)) continue
    // The direction stays when the place is only corrected (п. 4.21).
    const keep = p.direction !== undefined && p.coords && c && distance(p.coords, c) <= DIRECTION_KEEP_METERS
    const next: FileMeta = { coords: c, address: null, altitude: null, ...(keep ? { direction: p.direction } : {}) }
    const { direction: _old, ...base } = p
    changed.push({ ...base, ...next, modified: isModified(next, file[id]) })
  }
  return changed
}

/**
 * Gives the photos with coordinates a direction (Alt+drag, tz.md, п. 4.21), whole degrees from
 * true north; those without coordinates, tracks and those that already have it are left out.
 */
export function assignDirection(
  photos: readonly Photo[],
  file: readonly FileMeta[],
  ids: readonly number[],
  direction: number
): Photo[] {
  const d = ((Math.round(direction) % 360) + 360) % 360
  const changed: Photo[] = []
  for (const id of new Set(ids)) {
    const p = photos[id]
    if (!p || p.track || !p.coords || sameDirection(p.direction, d)) continue
    const q = { ...p, direction: d }
    changed.push({ ...q, modified: isModified(q, file[id]) })
  }
  return changed
}

/** Gives the photos a found address (п. 5.5); those that already have it are left out. */
export function assignAddress(
  photos: readonly Photo[],
  file: readonly FileMeta[],
  ids: readonly number[],
  address: Address
): Photo[] {
  const changed: Photo[] = []
  for (const id of new Set(ids)) {
    const p = photos[id]
    if (!p || sameAddress(p.address, address)) continue
    const next = { ...p, address }
    changed.push({ ...next, modified: isModified(next, file[id]) })
  }
  return changed
}

/** Gives the photos a found altitude (п. 5.6); those that already have it are left out. */
export function assignAltitude(
  photos: readonly Photo[],
  file: readonly FileMeta[],
  ids: readonly number[],
  altitude: number
): Photo[] {
  const changed: Photo[] = []
  for (const id of new Set(ids)) {
    const p = photos[id]
    if (!p || sameAltitude(p.altitude, altitude)) continue
    const next = { ...p, altitude }
    changed.push({ ...next, modified: isModified(next, file[id]) })
  }
  return changed
}

/**
 * Dropping photos dragged in the strip onto another photo (tz.md, п. 4.5), both ways:
 * - onto a photo with coordinates — the dragged photos get them;
 * - onto a photo without coordinates — it gets the coordinates of the dragged photos, if they
 *   all have the same ones.
 * Null when the drop means nothing (onto itself, or the dragged photos have no common point).
 */
export function dropOnPhoto(
  photos: readonly Photo[],
  dragged: readonly number[],
  target: number
): { ids: number[]; coords: LatLon } | null {
  const t = photos[target]
  // Dropping onto a track comes with 0.27.0 (tz.md, п. 9.3); tracks are never dragged.
  if (!t || t.track || dragged.some((id) => photos[id]?.track) || !dragged.length || (dragged.length === 1 && dragged[0] === target)) return null
  if (t.coords) return { ids: [...dragged], coords: t.coords }
  const first = photos[dragged[0]!]?.coords
  if (!first || !dragged.every((id) => sameCoords(photos[id]?.coords ?? null, first))) return null
  return { ids: [target], coords: first }
}

/**
 * Ctrl+V of what Ctrl+C took from a photo (tz.md, п. 4.10): its coordinates, and with them its
 * address and altitude (none stays none: a mode on gets them later). Returns the changed photos.
 */
export function pastePhotoData(
  photos: readonly Photo[],
  file: readonly FileMeta[],
  ids: readonly number[],
  coords: LatLon,
  address: Address | null,
  altitude: number | null
): Photo[] {
  const next = [...photos]
  const touched = new Set<number>()
  const apply = (changed: Photo[]): void => {
    for (const p of changed) {
      next[p.id] = p
      touched.add(p.id)
    }
  }
  apply(assignCoords(next, file, ids, coords))
  // The pasted point is the copied one: the old address and altitude of a photo that was already
  // there are replaced as well.
  const at = normalizeCoords(coords)
  const there = ids.filter((id) => next[id] && sameCoords(next[id]!.coords, at))
  if (address) apply(assignAddress(next, file, there, address))
  else apply(clearField(next, file, there, 'address'))
  if (altitude !== null) apply(assignAltitude(next, file, there, altitude))
  else apply(clearField(next, file, there, 'altitude'))
  return [...touched].sort((a, b) => a - b).map((id) => next[id]!)
}

function clearField(photos: readonly Photo[], file: readonly FileMeta[], ids: readonly number[], field: 'address' | 'altitude'): Photo[] {
  const changed: Photo[] = []
  for (const id of ids) {
    const p = photos[id]
    if (!p || p[field] === null) continue
    const q = { ...p, [field]: null }
    changed.push({ ...q, modified: isModified(q, file[id]) })
  }
  return changed
}

/** Photos standing at exactly this point: they move together with their marker (п. 4.7). */
export function photosAt(photos: readonly Photo[], coords: LatLon): number[] {
  return photos.filter((p) => sameCoords(p.coords, coords)).map((p) => p.id)
}

/**
 * Modified photos to write: all of them ("Save") or only the given ones ("Save Selected"); a
 * photo without coordinates has them removed from its files (п. 6.6).
 */
export function photosToSave(photos: readonly Photo[], only?: ReadonlySet<number>): Photo[] {
  return photos.filter((p) => p.modified && (!only || only.has(p.id)))
}

/** Counter of the status bar (п. 4.13). */
export function photoCounts(photos: readonly Photo[]): {
  total: number
  withCoords: number
  withoutCoords: number
  modified: number
} {
  // Tracks are not counted (tz.md, п. 3.9.3).
  const only = photos.filter((p) => !p.track)
  const withCoords = only.filter((p) => p.coords).length
  return {
    total: only.length,
    withCoords,
    withoutCoords: only.length - withCoords,
    modified: only.filter((p) => p.modified).length
  }
}
