import type { StripFilter } from './ipc'

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
  altitude: number | null
}

/** Altitudes are the same to a centimetre: more is noise of the number format. */
export function sameAltitude(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b
  return Math.abs(a - b) < 0.005
}

/** "290 m" (whole metres: the elevation data are about that exact, tz.md, п. 5.6). */
export function altitudeText(a: number): string {
  return `${Math.round(a)} m`
}

/** Where the shown coordinates were read from (tz.md, п. 3.7). */
export type CoordSource = 'sidecar' | 'xmp' | 'quicktime' | 'exif' | 'track'

export interface Photo {
  /** Index in the folder's photo list; stable while the folder is open. */
  id: number
  name: string
  path: string
  /** Local wall time "YYYY-MM-DD HH:MM:SS"; null if neither shooting nor file date is known. */
  date: string | null
  /**
   * `shot` — date of shooting; `name` — taken from the file name; `file` — file modification time
   * used instead (п. 4.2).
   */
  dateSource: DateSource
  coords: LatLon | null
  coordSource: CoordSource | null
  /** Place names (tz.md, п. 5.5); null — none. Removed together with changed coordinates. */
  address: Address | null
  /** Altitude above sea level, metres (tz.md, п. 5.6); null — none. Removed with changed coordinates. */
  altitude: number | null
  /** Coordinates or address changed in the program and not saved yet (tz.md, п. 4.3). */
  modified: boolean
  /** Read error reported by exiftool (broken file etc.). */
  error?: string
  /** Size of the file, bytes (status bar, tz.md, п. 4.13); absent if unknown. */
  size?: number
  /** A video (tz.md, п. 3.3.6): its length in seconds, null if unknown. Absent for photos. */
  video?: { duration: number | null }
}

export type DateSource = 'shot' | 'name' | 'file'

/**
 * Size of a file for the status bar (tz.md, п. 4.13): one decimal under 10 units ("6.4", "86",
 * "1.2"), with the unit key of the locale files. Bytes are 1024-based, as Explorer shows them.
 */
export function fileSizeParts(bytes: number): { value: number; digits: number; unit: 'size.b' | 'size.kb' | 'size.mb' | 'size.gb' } {
  const units = ['size.b', 'size.kb', 'size.mb', 'size.gb'] as const
  let v = Math.max(0, bytes)
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  const digits = i > 0 && v < 10 ? 1 : 0
  return { value: Number(v.toFixed(digits)), digits, unit: units[i]! }
}

/** "0:47", "1:02:03": length of a video (tz.md, п. 4.13). */
export function durationText(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
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
  /**
   * File → Refresh (tz.md, п. 3.8): the selected photos (`selected` is the current one) and the
   * strip filter stay as they were.
   */
  keep?: { ids: number[]; filter: StripFilter }
}

export function formatCoords(c: LatLon): string {
  return `${c.lat.toFixed(6)}, ${c.lon.toFixed(6)}`
}
