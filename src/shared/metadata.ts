import type { CoordSource, LatLon, Photo } from './photo'

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

/** Coordinates by priority: sidecar XMP, then embedded XMP, then EXIF (tz.md, п. 3.7). */
export function pickCoords(
  rec: ExifRecord,
  sidecar: ExifRecord | undefined
): { coords: LatLon | null; source: CoordSource | null } {
  const candidates: [CoordSource, LatLon | null][] = [
    ['sidecar', sidecar ? xmpCoords(sidecar) : null],
    ['xmp', xmpCoords(rec)],
    ['exif', exifCoords(rec)]
  ]
  for (const [source, coords] of candidates) if (coords) return { coords, source }
  return { coords: null, source: null }
}

/** Shooting date, or file modification time when there is none (tz.md, п. 4.2). */
export function pickDate(rec: ExifRecord): { date: string | null; source: 'shot' | 'file' } {
  const shot =
    parseExifDate(tagValue(rec, 'DateTimeOriginal', 'EXIF')) ??
    parseExifDate(tagValue(rec, 'DateTimeOriginal', 'XMP'))
  if (shot) return { date: shot, source: 'shot' }
  return { date: parseExifDate(tagValue(rec, 'FileModifyDate', 'File')), source: 'file' }
}

/** Read error: reported by exiftool, or the file is not an image at all (e.g. text with .jpg). */
export function readError(rec: ExifRecord): string | undefined {
  const e = tagValue(rec, 'Error', 'ExifTool') ?? rec['Error']
  if (typeof e === 'string' && e) return e
  const mime = tagValue(rec, 'MIMEType', 'File')
  if (typeof mime === 'string' && !mime.startsWith('image/')) {
    return `Not an image (file type: ${String(tagValue(rec, 'FileType', 'File') ?? mime)})`
  }
  return undefined
}

/** Builds a photo from its exiftool record (`id` is assigned after sorting). */
export function toPhoto(
  name: string,
  path: string,
  rec: ExifRecord | undefined,
  sidecar: ExifRecord | undefined
): Omit<Photo, 'id'> {
  if (!rec) {
    return {
      name, path, date: null, dateSource: 'file', coords: null, coordSource: null, modified: false,
      error: 'no metadata'
    }
  }
  const { date, source: dateSource } = pickDate(rec)
  const { coords, source: coordSource } = pickCoords(rec, sidecar)
  const error = readError(rec)
  return { name, path, date, dateSource, coords, coordSource, modified: false, ...(error ? { error } : {}) }
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
