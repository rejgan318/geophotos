/** A place found by name (tz.md, п. 5.3). */
export interface Place {
  name: string
  lat: number
  lon: number
  /** South, west, north, east; absent when the service gives none. */
  bounds?: [number, number, number, number]
}

export type SearchResult = { ok: true; places: Place[] } | { ok: false; error: string }

export const SEARCH_LIMIT = 10

/** Nominatim search request: free-form query, JSON answer. */
export function searchUrl(base: string, query: string, limit = SEARCH_LIMIT): string {
  const root = base.replace(/\/+$/, '')
  const params = new URLSearchParams({ q: query, format: 'jsonv2', limit: String(limit) })
  return `${root}/search?${params.toString()}`
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

/** Places from a Nominatim answer; entries without valid coordinates are skipped. */
export function parsePlaces(json: unknown): Place[] {
  if (!Array.isArray(json)) return []
  const places: Place[] = []
  for (const item of json as Record<string, unknown>[]) {
    const lat = num(item?.['lat'])
    const lon = num(item?.['lon'])
    if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue
    const name = typeof item['display_name'] === 'string' ? item['display_name'] : `${lat}, ${lon}`
    const place: Place = { name, lat, lon }
    // Nominatim: [south, north, west, east] as strings.
    const bb = Array.isArray(item['boundingbox']) ? (item['boundingbox'] as unknown[]).map(num) : []
    if (bb.length === 4 && bb.every((v) => v !== null)) {
      const [s, n, w, e] = bb as number[]
      place.bounds = [s!, w!, n!, e!]
    }
    places.push(place)
  }
  return places
}

/**
 * At most one request per interval (Nominatim usage policy: one per second).
 * Returns how long to wait before the next request may go.
 */
export function waitBeforeRequest(lastStart: number | null, now: number, intervalMs = 1000): number {
  if (lastStart === null) return 0
  return Math.max(0, lastStart + intervalMs - now)
}
