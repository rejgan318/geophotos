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

/**
 * How many found places the search remembers (tz.md, п. 5.3): one more than it shows — the current
 * place (with the mark on it) is not shown, it is the present, not the history.
 */
export const RECENT_PLACES = 6

/** How many places of the history the list shows. */
export const RECENT_SHOWN = 5

/** Favourite places with keys Ctrl+1…9 (п. 5.3). */
export const FAVORITE_KEYS = 9

const samePlace = (a: Place, b: Place): boolean =>
  a.name === b.name && Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lon - b.lon) < 1e-6

/** A place gone to goes on top; the same place again moves up, not twice; at most RECENT_PLACES. */
export function addRecentPlace(list: readonly Place[], p: Place): Place[] {
  return [p, ...list.filter((x) => !samePlace(x, p))].slice(0, RECENT_PLACES)
}

export function removeRecentPlace(list: readonly Place[], p: Place): Place[] {
  return list.filter((x) => !samePlace(x, p))
}

/** A place from the state file or the window; null if it is not one. */
export function validPlace(v: unknown): Place | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  const { name, lat, lon, bounds } = r
  const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
  if (typeof name !== 'string' || !name || !num(lat) || !num(lon) || Math.abs(lat) > 90) return null
  const b = Array.isArray(bounds) && bounds.length === 4 && bounds.every(num) ? (bounds as [number, number, number, number]) : undefined
  return { name: name.slice(0, 500), lat, lon, ...(b ? { bounds: b } : {}) }
}

/** Most favourite places kept (tz.md, п. 5.3: no limit for a person; a guard for a broken file). */
export const MAX_FAVORITES = 1000

/**
 * A place becomes a favourite (п. 5.3): at the end — the favourites keep the order they were added
 * in, so their numbers (Ctrl+1…9) do not move; one already there stays where it is.
 */
export function addFavorite(favorites: readonly Place[], p: Place): Place[] {
  return favorites.some((x) => samePlace(x, p)) ? [...favorites] : [...favorites, p]
}

export function removeFavorite(favorites: readonly Place[], p: Place): Place[] {
  return favorites.filter((x) => !samePlace(x, p))
}

/** The favourite `old` moved or renamed to `now`; it keeps its place in the list. */
export function replaceFavorite(favorites: readonly Place[], old: Place, now: Place): Place[] {
  return favorites.map((x) => (samePlace(x, old) ? now : x))
}

export { samePlace }

/** Favourite places from the state file or the window: valid ones, in their order, without repeats. */
export function validFavorites(v: unknown): Place[] {
  const list = (Array.isArray(v) ? v : []).map(validPlace).filter((p): p is Place => !!p)
  const out: Place[] = []
  for (const p of list) if (!out.some((x) => samePlace(x, p))) out.push(p)
  return out.slice(0, MAX_FAVORITES)
}

/**
 * The name of a point from its address (п. 5.3, a favourite made from a mark): the street with the
 * house and the city; without them the state and the country; null — no address.
 */
export function addressName(a: { country: string; state: string; city: string; location: string } | null): string | null {
  if (!a) return null
  const near = [a.location, a.city].filter(Boolean)
  const far = [a.state, a.country].filter(Boolean)
  const parts = near.length ? near : far
  return parts.length ? parts.join(', ') : null
}
