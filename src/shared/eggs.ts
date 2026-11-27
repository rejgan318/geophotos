/**
 * Easter eggs "ATB bag" (tz.md, п. 9.3): photos hidden on the map, found by looking at their
 * place closely enough. Pure logic, shared by main, the window, the preparing script and tests.
 */

/** The zoom from which an egg can be found and found eggs are shown. */
export const EGG_ZOOM = 16

/** How long the egg must stay in view to count as found, ms (not just flown over). */
export const EGG_DWELL_MS = 1000

/** Part of the view at each edge that does not count: the egg must be well inside. */
export const EGG_INSET = 0.05

/**
 * The map of a "typical screen" (tz.md, п. 9.3: a window of 1366×768 with the strip at the
 * bottom): the place of shooting is the egg's point only if it is seen there with the sight in
 * the middle.
 */
export const TYPICAL_MAP = { width: 1366, height: 500 }

/**
 * The light coding of the files of the eggs: every byte XOR the key, repeated. It is not a secret
 * (README tells how to undo it) — it only keeps the photos from opening while browsing GitHub.
 */
export const EGG_KEY = 'ATB-GeoPhotos'

export function eggCode(data: Uint8Array): Uint8Array {
  const key = new TextEncoder().encode(EGG_KEY)
  const out = new Uint8Array(data.length)
  for (let i = 0; i < data.length; i++) out[i] = data[i]! ^ key[i % key.length]!
  return out
}

export type EggTitle = Record<string, string>

/** An egg in `eggs/eggs.bin`. */
export interface Egg {
  id: number
  lat: number
  lon: number
  /** Name of the place, by language code; `en` is always there. */
  title: EggTitle
  /** File of the photo next to `eggs.bin`. */
  file: string
}

/** Checks the decoded list of eggs; the broken entries are left out. */
export function validEggs(v: unknown): Egg[] {
  if (!Array.isArray(v)) return []
  const ids = new Set<number>()
  const out: Egg[] = []
  for (const e of v) {
    if (!e || typeof e !== 'object') continue
    const r = e as Record<string, unknown>
    const { id, lat, lon, title, file } = r
    if (!Number.isInteger(id) || ids.has(id as number)) continue
    if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90) continue
    if (typeof file !== 'string' || !/^[\w-]+\.bin$/.test(file)) continue
    if (!title || typeof title !== 'object' || typeof (title as EggTitle)['en'] !== 'string') continue
    ids.add(id as number)
    out.push({ id: id as number, lat, lon, title: title as EggTitle, file })
  }
  return out
}

/** A found egg in the state (tz-config: state): which one and when (ISO date and time). */
export interface FoundEgg {
  id: number
  date: string
}

/** Checks the found eggs of the state file: known ids once each, in the order found. */
export function validFoundEggs(v: unknown): FoundEgg[] {
  if (!Array.isArray(v)) return []
  const seen = new Set<number>()
  const out: FoundEgg[] = []
  for (const e of v) {
    if (!e || typeof e !== 'object') continue
    const { id, date } = e as Record<string, unknown>
    if (!Number.isInteger(id) || seen.has(id as number) || typeof date !== 'string' || Number.isNaN(Date.parse(date))) continue
    seen.add(id as number)
    out.push({ id: id as number, date })
  }
  return out
}

/** An egg for the window: its point, its name in the language of the program, its photo. */
export interface EggForMap {
  id: number
  lat: number
  lon: number
  title: string
  url: string
}

export interface Bounds {
  south: number
  west: number
  north: number
  east: number
}

/**
 * The eggs not found yet that are well inside the view (EGG_INSET) at a zoom of at least
 * EGG_ZOOM. The view is not wider than the world here (at EGG_ZOOM it never is).
 */
export function eggsInView<T extends { id: number; lat: number; lon: number }>(eggs: readonly T[], view: Bounds, zoom: number, found: ReadonlySet<number>): T[] {
  if (zoom < EGG_ZOOM) return []
  const dLat = (view.north - view.south) * EGG_INSET
  const dLon = (view.east - view.west) * EGG_INSET
  const south = view.south + dLat
  const north = view.north - dLat
  const west = view.west + dLon
  const east = view.east - dLon
  return eggs.filter((e) => {
    if (found.has(e.id) || e.lat < south || e.lat > north) return false
    // The longitude of the egg brought to the copy of the world the view is on.
    const lon = e.lon + 360 * Math.round((west + east) / 2 / 360 - e.lon / 360)
    return lon >= west && lon <= east
  })
}

/** Point of the Web Mercator world at the zoom, px. */
export function worldPx(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const size = 256 * 2 ** zoom
  const s = Math.sin((lat * Math.PI) / 180)
  return { x: ((lon + 180) / 360) * size, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * size }
}

/**
 * Whether the place of shooting is well inside a map of the given size (TYPICAL_MAP) at EGG_ZOOM
 * with the sight in the middle: then it is the egg's point; otherwise the sight is (tz.md, п. 9.3).
 */
export function shotFits(sight: { lat: number; lon: number }, shot: { lat: number; lon: number }, map = TYPICAL_MAP, zoom = EGG_ZOOM): boolean {
  const a = worldPx(sight.lat, sight.lon, zoom)
  const b = worldPx(shot.lat, shot.lon, zoom)
  const halfW = (map.width / 2) * (1 - 2 * EGG_INSET)
  const halfH = (map.height / 2) * (1 - 2 * EGG_INSET)
  return Math.abs(a.x - b.x) <= halfW && Math.abs(a.y - b.y) <= halfH
}

/** The name of the egg in the language, English if there is none. */
export function eggTitle(title: EggTitle, language: string): string {
  return title[language] || title['en'] || ''
}
