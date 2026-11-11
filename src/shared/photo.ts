export interface LatLon {
  lat: number
  lon: number
}

/**
 * Place names of a photo, the fields Lightroom shows (tz.md, п. 5.5); a field nobody knows is ''.
 */
export interface Address {
  country: string
  /** ISO 3166 code, upper case ("UA"). */
  countryCode: string
  state: string
  city: string
  /** Street with the house number. */
  location: string
}

export const ADDRESS_FIELDS = ['country', 'countryCode', 'state', 'city', 'location'] as const

export function sameAddress(a: Address | null, b: Address | null): boolean {
  if (!a || !b) return a === b
  return ADDRESS_FIELDS.every((f) => a[f] === b[f])
}

/** "Street 1, City, State, Country": the known parts, from the most exact one. */
export function addressText(a: Address): string {
  return [a.location, a.city, a.state, a.country].filter((s) => s).join(', ')
}

/** What the files of a photo hold: what "modified" is compared with (tz.md, п. 4.3). */
export interface FileMeta {
  coords: LatLon | null
  address: Address | null
}

/** Where the shown coordinates were read from (tz.md, п. 3.7). */
export type CoordSource = 'sidecar' | 'xmp' | 'exif'

export interface Photo {
  /** Index in the folder's photo list; stable while the folder is open. */
  id: number
  name: string
  path: string
  /** Local wall time "YYYY-MM-DD HH:MM:SS"; null if neither shooting nor file date is known. */
  date: string | null
  /** `shot` — date of shooting; `file` — file modification time used instead (п. 4.2). */
  dateSource: 'shot' | 'file'
  coords: LatLon | null
  coordSource: CoordSource | null
  /** Place names (tz.md, п. 5.5); null — none. Removed together with changed coordinates. */
  address: Address | null
  /** Coordinates or address changed in the program and not saved yet (tz.md, п. 4.3). */
  modified: boolean
  /** Read error reported by exiftool (broken file etc.). */
  error?: string
}

export function sameCoords(a: LatLon | null, b: LatLon | null): boolean {
  if (!a || !b) return a === b
  return a.lat === b.lat && a.lon === b.lon
}

export interface FolderData {
  folder: string
  photos: Photo[]
  /** Generation of the opened folder; part of thumbnail URLs so old ones are not reused. */
  generation: number
  /** Photo to select right after opening (the chosen or dropped photo), or null. */
  selected: number | null
  /**
   * Set only when the folder of the last run is opened at start (tz.md, п. 7.1): the strip
   * scroll comes back, and the map stays where it was instead of showing all photos.
   */
  restored?: { scroll: number }
}

export function formatCoords(c: LatLon): string {
  return `${c.lat.toFixed(6)}, ${c.lon.toFixed(6)}`
}
