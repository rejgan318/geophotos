import { oneLine, type Address, type LatLon, type Photo } from './photo'

/**
 * Reverse geocoding through Nominatim (tz.md, п. 5.5): the address of a point, the names in the
 * interface language first, then in English.
 */
export function reverseUrl(base: string, c: LatLon, language: string): string {
  const root = base.replace(/\/+$/, '')
  const params = new URLSearchParams({
    lat: String(c.lat),
    lon: String(c.lon),
    format: 'jsonv2',
    zoom: '18',
    addressdetails: '1',
    'accept-language': language === 'en' ? 'en' : `${language},en`
  })
  return `${root}/reverse?${params.toString()}`
}

/** A field of the answer on one line: a line break in it must never reach exiftool (`oneLine`). */
const str = (v: unknown): string => (typeof v === 'string' ? oneLine(v) : '')
const first = (a: Record<string, unknown>, keys: string[]): string => {
  for (const k of keys) if (str(a[k])) return str(a[k])
  return ''
}

/**
 * The address from a Nominatim answer, in the fields Lightroom shows (п. 5.5): city is the city,
 * town or village; the place is the street with the house number. Null when the point has no
 * address (the sea) or the answer is an error.
 */
export function parseAddress(json: unknown): Address | null {
  if (!json || typeof json !== 'object') return null
  const a = (json as Record<string, unknown>)['address']
  if (!a || typeof a !== 'object') return null
  const r = a as Record<string, unknown>
  const road = first(r, ['road', 'pedestrian', 'footway', 'path', 'square', 'place'])
  const house = str(r['house_number'])
  const address: Address = {
    country: str(r['country']),
    countryCode: str(r['country_code']).toUpperCase(),
    state: first(r, ['state', 'region', 'province']),
    city: first(r, ['city', 'town', 'village', 'hamlet', 'municipality']),
    location: road && house ? `${road}, ${house}` : road
  }
  return Object.values(address).some((v) => v) ? address : null
}

/** One request per point: photos at exactly one point share it. */
export function pointKey(c: LatLon): string {
  return `${c.lat.toFixed(7)},${c.lon.toFixed(7)}`
}

/**
 * Points still to ask the address for (п. 5.5): photos with coordinates and no address, except
 * points that already got no answer in this folder. In strip order.
 */
export function pointsWithoutAddress(photos: readonly Photo[], failed: ReadonlySet<string>): Map<string, LatLon> {
  const points = new Map<string, LatLon>()
  for (const p of photos) {
    if (!p.coords || p.address) continue
    const key = pointKey(p.coords)
    if (!failed.has(key) && !points.has(key)) points.set(key, p.coords)
  }
  return points
}
