import { sameCoords, type LatLon, type Photo } from './photo'

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

/**
 * Gives the photos new coordinates (tz.md, пп. 4.5, 4.7). Returns only the photos that changed,
 * as new objects. A photo counts as modified while its coordinates differ from those in its file
 * (`fileCoords`), so moving it back to where it was removes the mark.
 */
export function assignCoords(
  photos: readonly Photo[],
  fileCoords: readonly (LatLon | null)[],
  ids: readonly number[],
  coords: LatLon
): Photo[] {
  const c = normalizeCoords(coords)
  const changed: Photo[] = []
  for (const id of new Set(ids)) {
    const p = photos[id]
    if (!p || sameCoords(p.coords, c)) continue
    changed.push({ ...p, coords: c, modified: !sameCoords(c, fileCoords[id] ?? null) })
  }
  return changed
}

/** Photos standing at exactly this point: they move together with their marker (п. 4.7). */
export function photosAt(photos: readonly Photo[], coords: LatLon): number[] {
  return photos.filter((p) => sameCoords(p.coords, coords)).map((p) => p.id)
}

/** Modified photos to write: all of them ("Save") or only the given ones ("Save Selected"). */
export function photosToSave(photos: readonly Photo[], only?: ReadonlySet<number>): Photo[] {
  return photos.filter((p) => p.modified && p.coords && (!only || only.has(p.id)))
}

/** Counter of the status bar (п. 4.13). */
export function photoCounts(photos: readonly Photo[]): { total: number; withCoords: number; modified: number } {
  return {
    total: photos.length,
    withCoords: photos.filter((p) => p.coords).length,
    modified: photos.filter((p) => p.modified).length
  }
}
