import { pointKey } from './geocode'
import type { LatLon, Photo } from './photo'

/** Open-Meteo answers up to 100 points in one request (tz.md, п. 5.6). */
export const ELEVATION_BATCH = 100

/** Request for the altitudes of some points: latitudes and longitudes as two lists. */
export function elevationUrl(base: string, points: readonly LatLon[]): string {
  const list = (f: (c: LatLon) => number): string => points.map((c) => f(c).toFixed(6)).join(',')
  return `${base.replace(/\/+$/, '')}?latitude=${list((c) => c.lat)}&longitude=${list((c) => c.lon)}`
}

/** Altitudes from the answer, one per point in order; null where there is none. Null if broken. */
export function parseElevations(json: unknown, count: number): (number | null)[] | null {
  if (!json || typeof json !== 'object') return null
  const list = (json as Record<string, unknown>)['elevation']
  if (!Array.isArray(list) || list.length !== count) return null
  return list.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : null))
}

/**
 * An altitude of exactly 0 is often written by a device that did not know it (tz.md, п. 5.6): it
 * is checked against the terrain and replaced when the terrain is at least this far from the sea
 * level, metres. Near the sea 0 may be right and stays.
 */
export const ZERO_ALTITUDE_CHECK_M = 10

/** Whether the altitude of a photo is to be asked: none, or a 0 to check (п. 5.6). */
export function needsAltitude(altitude: number | null): boolean {
  return altitude === null || altitude === 0
}

/**
 * The altitude a photo gets from the terrain `found` at its point (п. 5.6): a missing one is
 * taken as is; a 0 is replaced only if the terrain shows it is wrong. Null — keep what it has.
 */
export function checkedAltitude(current: number | null, found: number): number | null {
  if (current === null) return found
  if (current === 0) return Math.abs(found) >= ZERO_ALTITUDE_CHECK_M ? found : null
  return null
}

/**
 * Points still to ask the altitude for (п. 5.6): photos with coordinates and no altitude, or an
 * altitude of 0 to check, except points that already got no answer (or were checked) in this
 * folder. In strip order.
 */
export function pointsWithoutAltitude(photos: readonly Photo[], failed: ReadonlySet<string>): Map<string, LatLon> {
  const points = new Map<string, LatLon>()
  for (const p of photos) {
    if (!p.coords || !needsAltitude(p.altitude)) continue
    const key = pointKey(p.coords)
    if (!failed.has(key) && !points.has(key)) points.set(key, p.coords)
  }
  return points
}
