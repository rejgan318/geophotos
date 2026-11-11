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
 * Points still to ask the altitude for (п. 5.6): photos with coordinates and no altitude, except
 * points that already got no answer in this folder. In strip order.
 */
export function pointsWithoutAltitude(photos: readonly Photo[], failed: ReadonlySet<string>): Map<string, LatLon> {
  const points = new Map<string, LatLon>()
  for (const p of photos) {
    if (!p.coords || p.altitude !== null) continue
    const key = pointKey(p.coords)
    if (!failed.has(key) && !points.has(key)) points.set(key, p.coords)
  }
  return points
}
