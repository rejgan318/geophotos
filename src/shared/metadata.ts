import { dateFromName, videoDate } from './dates'
import { ADDRESS_FIELDS, type Address, type CoordSource, type DateSource, type LatLon, type Photo } from './photo'

/** One file's record from `exiftool -j -n -G0`: keys like "EXIF:GPSLatitude". */
export type ExifRecord = Record<string, unknown>

/** Value of a tag regardless of group: tag("GPSLatitude") matches "EXIF:GPSLatitude". */
export function tagValue(rec: ExifRecord, tag: string, group?: string): unknown {
  if (group) return rec[`${group}:${tag}`]
  if (tag in rec) return rec[tag]
  const suffix = `:${tag}`
  for (const [k, v] of Object.entries(rec)) if (k.endsWith(suffix)) return v
  return undefined
}

/** "2025:06:09 20:40:06[.123][+03:00]" → "2025-06-09 20:40:06" (local wall time as written). */
export function parseExifDate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const m = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(value.trim())
  if (!m) return null
  const [, y, mo, d, h, mi, s = '00'] = m
  if (y === '0000' || mo === '00' || d === '00') return null
  return `${y}-${mo}-${d} ${h}:${mi}:${s}`
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return null
}

function valid(lat: number | null, lon: number | null): LatLon | null {
  if (lat === null || lon === null) return null
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  return { lat, lon }
}

/** EXIF GPS: with -n the values are unsigned and the sign is in the Ref tags. */
export function exifCoords(rec: ExifRecord): LatLon | null {
  const lat = num(tagValue(rec, 'GPSLatitude', 'EXIF'))
  const lon = num(tagValue(rec, 'GPSLongitude', 'EXIF'))
  if (lat === null || lon === null) return null
  const latRef = String(tagValue(rec, 'GPSLatitudeRef', 'EXIF') ?? 'N').toUpperCase()
  const lonRef = String(tagValue(rec, 'GPSLongitudeRef', 'EXIF') ?? 'E').toUpperCase()
  return valid(
    latRef.startsWith('S') ? -Math.abs(lat) : lat,
    lonRef.startsWith('W') ? -Math.abs(lon) : lon
  )
}

/** XMP GPS (embedded or sidecar): with -n the values are signed decimal degrees. */
export function xmpCoords(rec: ExifRecord): LatLon | null {
  return valid(num(tagValue(rec, 'GPSLatitude', 'XMP')), num(tagValue(rec, 'GPSLongitude', 'XMP')))
}

/**
 * QuickTime GPSCoordinates of a video (tz.md, п. 3.3.6), as phones write them: with -n
 * "40.6252 -73.2877" or "40.6252 -73.2877 12.3" (signed degrees, altitude in metres).
 */
function quickTimeGps(rec: ExifRecord): { coords: LatLon; altitude: number | null } | null {
  const v = tagValue(rec, 'GPSCoordinates', 'QuickTime')
  if (typeof v !== 'string') return null
  const parts = v.trim().split(/[\s,]+/).map(Number)
  if (parts.length < 2 || parts.some((n) => !Number.isFinite(n))) return null
  const coords = valid(parts[0]!, parts[1]!)
  if (!coords || (coords.lat === 0 && coords.lon === 0)) return null
  return { coords, altitude: parts.length > 2 ? parts[2]! : null }
}

export function quickTimeCoords(rec: ExifRecord): LatLon | null {
  return quickTimeGps(rec)?.coords ?? null
}

/** The first point of a GPS track found by reading a video deeper (п. 3.3.6). */
export interface TrackPoint {
  coords: LatLon
  altitude: number | null
}

/**
 * The first point of a track from `exiftool -ee -n -G3` (embedded documents "Doc1", "Doc2"…,
 * signed degrees); null if there is none.
 */
export function firstTrackPoint(rec: ExifRecord): TrackPoint | null {
  const docs = new Set<number>()
  for (const k of Object.keys(rec)) {
    const m = /^Doc(\d+)(?:-\d+)?:GPSLatitude$/.exec(k)
    if (m) docs.add(Number(m[1]))
  }
  for (const n of [...docs].sort((a, b) => a - b)) {
    const lat = num(rec[`Doc${n}:GPSLatitude`])
    const lon = num(rec[`Doc${n}:GPSLongitude`])
    const latRef = String(rec[`Doc${n}:GPSLatitudeRef`] ?? 'N').toUpperCase()
    const lonRef = String(rec[`Doc${n}:GPSLongitudeRef`] ?? 'E').toUpperCase()
    if (lat === null || lon === null) continue
    const coords = valid(latRef.startsWith('S') ? -Math.abs(lat) : lat, lonRef.startsWith('W') ? -Math.abs(lon) : lon)
    if (!coords || (coords.lat === 0 && coords.lon === 0)) continue
    return { coords, altitude: num(rec[`Doc${n}:GPSAltitude`]) }
  }
  return null
}

/** Altitude in one group: with -n the value is unsigned, Ref 1 means below sea level. */
function altitudeIn(rec: ExifRecord, group: 'EXIF' | 'XMP'): number | null {
  const v = num(tagValue(rec, 'GPSAltitude', group))
  if (v === null) return null
  return Number(tagValue(rec, 'GPSAltitudeRef', group)) === 1 ? -Math.abs(v) : v
}

/**
 * Altitude by the same priority as the coordinates (tz.md, пп. 3.7, 5.6): sidecar, XMP,
 * QuickTime (videos), EXIF, then the first point of a track.
 */
export function pickAltitude(rec: ExifRecord, sidecar: ExifRecord | undefined, track?: TrackPoint | null): number | null {
  return (
    (sidecar ? altitudeIn(sidecar, 'XMP') : null) ??
    altitudeIn(rec, 'XMP') ??
    quickTimeGps(rec)?.altitude ??
    altitudeIn(rec, 'EXIF') ??
    track?.altitude ??
    null
  )
}

/**
 * Coordinates by priority: sidecar XMP, then embedded XMP, then the QuickTime metadata of a video,
 * then EXIF (tz.md, пп. 3.7, 3.3.6); a video's track only when there is nothing else.
 */
export function pickCoords(
  rec: ExifRecord,
  sidecar: ExifRecord | undefined,
  track?: TrackPoint | null
): { coords: LatLon | null; source: CoordSource | null } {
  const candidates: [CoordSource, LatLon | null][] = [
    ['sidecar', sidecar ? xmpCoords(sidecar) : null],
    ['xmp', xmpCoords(rec)],
    ['quicktime', quickTimeCoords(rec)],
    ['exif', exifCoords(rec)],
    ['track', track?.coords ?? null]
  ]
  for (const [source, coords] of candidates) if (coords) return { coords, source }
  return { coords: null, source: null }
}

/**
 * Tags of the place names (tz.md, п. 5.5): XMP as Lightroom writes it, and the older IPTC.
 * With -G0 they come back as "XMP:City", "IPTC:City"…
 */
export const ADDRESS_TAGS = {
  xmp: {
    country: 'XMP-photoshop:Country',
    countryCode: 'XMP-iptcCore:CountryCode',
    state: 'XMP-photoshop:State',
    city: 'XMP-photoshop:City',
    location: 'XMP-iptcCore:Location'
  },
  iptc: {
    country: 'IPTC:Country-PrimaryLocationName',
    countryCode: 'IPTC:Country-PrimaryLocationCode',
    state: 'IPTC:Province-State',
    city: 'IPTC:City',
    location: 'IPTC:Sub-location'
  }
} as const satisfies Record<string, Record<keyof Address, string>>

/** Tag arguments for reading the address. */
export const ADDRESS_READ_ARGS = [...Object.values(ADDRESS_TAGS.xmp), ...Object.values(ADDRESS_TAGS.iptc)].map((t) => `-${t}`)

/** The address in one group of a record; null if none of its fields is there. */
function addressIn(rec: ExifRecord, kind: 'xmp' | 'iptc'): Address | null {
  const group = kind === 'xmp' ? 'XMP' : 'IPTC'
  const a = {} as Address
  let any = false
  for (const f of ADDRESS_FIELDS) {
    const tag = ADDRESS_TAGS[kind][f].split(':')[1]!
    const v = tagValue(rec, tag, group)
    a[f] = v === undefined || v === null ? '' : String(v).trim()
    if (a[f]) any = true
  }
  if (a.countryCode) a.countryCode = a.countryCode.toUpperCase()
  return any ? a : null
}

/** The address by the same priority as the coordinates (п. 3.7): sidecar, embedded XMP, IPTC. */
export function pickAddress(rec: ExifRecord, sidecar: ExifRecord | undefined): Address | null {
  return (sidecar ? addressIn(sidecar, 'xmp') : null) ?? addressIn(rec, 'xmp') ?? addressIn(rec, 'iptc')
}

/**
 * Shooting time (tz.md, п. 4.2): a photo's EXIF time, a video's time by the rules of
 * `videoDate`; then a date in the file name; then the file modification time.
 */
export function pickDate(
  rec: ExifRecord,
  name = '',
  video?: { coords: LatLon | null }
): { date: string | null; source: DateSource } {
  const shot = video
    ? videoDate(rec, video.coords)
    : parseExifDate(tagValue(rec, 'DateTimeOriginal', 'EXIF')) ?? parseExifDate(tagValue(rec, 'DateTimeOriginal', 'XMP'))
  if (shot) return { date: shot, source: 'shot' }
  const named = dateFromName(name)
  if (named) return { date: named, source: 'name' }
  return { date: parseExifDate(tagValue(rec, 'FileModifyDate', 'File')), source: 'file' }
}

/** Read error: reported by exiftool, or the file is not what its name says (e.g. text with .jpg). */
export function readError(rec: ExifRecord, video = false): string | undefined {
  const e = tagValue(rec, 'Error', 'ExifTool') ?? rec['Error']
  if (typeof e === 'string' && e) return e
  const mime = tagValue(rec, 'MIMEType', 'File')
  const kind = video ? 'video/' : 'image/'
  if (typeof mime === 'string' && !mime.startsWith(kind)) {
    return `Not ${video ? 'a video' : 'an image'} (file type: ${String(tagValue(rec, 'FileType', 'File') ?? mime)})`
  }
  return undefined
}

/** Length of a video, seconds (QuickTime, or exiftool's estimate for AVI and MPEG). */
export function videoDuration(rec: ExifRecord): number | null {
  const d = num(tagValue(rec, 'Duration', 'QuickTime')) ?? num(tagValue(rec, 'Duration'))
  return d !== null && d >= 0 ? d : null
}

/** Builds a photo from its exiftool record (`id` is assigned after sorting). */
export function toPhoto(
  name: string,
  path: string,
  rec: ExifRecord | undefined,
  sidecar: ExifRecord | undefined,
  opts: { video?: boolean; track?: TrackPoint | null } = {}
): Omit<Photo, 'id'> {
  const video = opts.video ? { video: { duration: rec ? videoDuration(rec) : null } } : {}
  if (!rec) {
    const named = dateFromName(name)
    return {
      name, path, date: named, dateSource: named ? 'name' : 'file', coords: null, coordSource: null, address: null, altitude: null,
      modified: false,
      error: 'no metadata',
      ...video
    }
  }
  const { coords, source: coordSource } = pickCoords(rec, sidecar, opts.track)
  const { date, source: dateSource } = pickDate(rec, name, opts.video ? { coords } : undefined)
  const error = readError(rec, opts.video)
  const address = pickAddress(rec, sidecar)
  const altitude = pickAltitude(rec, sidecar, opts.track)
  return { name, path, date, dateSource, coords, coordSource, address, altitude, modified: false, ...(error ? { error } : {}), ...video }
}

/** Order of the strip: by date (shooting or file), then by name; photos without date go last. */
export function comparePhotos(a: Omit<Photo, 'id'>, b: Omit<Photo, 'id'>): number {
  if (a.date !== b.date) {
    if (a.date === null) return 1
    if (b.date === null) return -1
    return a.date < b.date ? -1 : 1
  }
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
}

/** Which embedded preview to extract: the first one present (biggest first for RAW). */
export function embeddedPreviewTag(rec: ExifRecord | undefined): string | null {
  if (!rec) return null
  for (const tag of ['PreviewImage', 'JpgFromRaw', 'OtherImage', 'ThumbnailImage']) {
    if (tagValue(rec, tag) !== undefined) return tag
  }
  return null
}
