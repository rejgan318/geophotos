import type { WriteMode } from './formats'
import { ADDRESS_TAGS } from './metadata'
import { ADDRESS_FIELDS, type Address, type LatLon } from './photo'

/** What is known about a photo's files when its coordinates are written. */
export interface WriteInfo {
  path: string
  write: WriteMode
  /** The embedded XMP of the file has coordinates. */
  xmpCoords: boolean
  /** The XMP sidecar the photo owns (tz.md, п. 3.7); null if it owns none (JPEG of a RAW+JPEG pair). */
  sidecar: { path: string; exists: boolean; coords: boolean } | null
  /**
   * The sidecar of the whole file name, "IMG_0001.JPG.xmp" (tz.md, пп. 3.7, 6.4): only this file's,
   * read first. Absent — not known to exist (its path is the file's path + ".xmp").
   */
  fullSidecar?: { path: string; exists: boolean; coords: boolean }
  /** The file itself has coordinates (EXIF, its XMP, QuickTime): `save.xmpOnly` cannot remove them. */
  innerCoords?: boolean
  /** A video (tz.md, п. 3.3.6): written into QuickTime, not EXIF. */
  video?: boolean
}

/**
 * What else goes into a write: the direction (tz.md, п. 4.21; undefined — left as it is, null —
 * removed) and `save.xmpOnly` (п. 6.4: no file is changed, only XMP sidecars).
 */
export interface WriteOptions {
  direction?: number | null
  xmpOnly?: boolean
}

/** One exiftool write: the file and the tag arguments. */
export interface WriteStep {
  path: string
  kind: 'file' | 'sidecar'
  /** The sidecar does not exist yet: exiftool creates it. */
  create: boolean
  args: string[]
}

/** Decimal degrees as written: 7 decimals, without exponent notation. */
function deg(v: number): string {
  const s = v.toFixed(7).replace(/\.?0+$/, '')
  return s === '-0' ? '0' : s
}

/** EXIF GPS: unsigned values, the direction in the Ref tags. */
export function exifArgs(c: LatLon): string[] {
  return [
    `-EXIF:GPSLatitude=${deg(Math.abs(c.lat))}`,
    `-EXIF:GPSLatitudeRef=${c.lat < 0 ? 'S' : 'N'}`,
    `-EXIF:GPSLongitude=${deg(Math.abs(c.lon))}`,
    `-EXIF:GPSLongitudeRef=${c.lon < 0 ? 'W' : 'E'}`
  ]
}

/** XMP GPS (embedded or sidecar): signed decimal degrees (with -n). */
export function xmpArgs(c: LatLon): string[] {
  return [`-XMP-exif:GPSLatitude=${deg(c.lat)}`, `-XMP-exif:GPSLongitude=${deg(c.lon)}`]
}

/** Altitude in metres: unsigned value, Ref 1 below sea level (tz.md, п. 5.6); null removes it. */
function altitudeArgs(group: 'EXIF' | 'XMP-exif', a: number | null): string[] {
  if (a === null) return [`-${group}:GPSAltitude=`, `-${group}:GPSAltitudeRef=`]
  const v = Math.round(Math.abs(a) * 100) / 100
  return [`-${group}:GPSAltitude=${v}`, `-${group}:GPSAltitudeRef=${a < 0 ? 1 : 0}`]
}

/**
 * Where the camera looked (tz.md, п. 4.21): degrees from true north; null removes it, undefined
 * leaves it alone.
 */
function directionArgs(group: 'EXIF' | 'XMP-exif', d: number | null | undefined): string[] {
  if (d === undefined) return []
  if (d === null) return [`-${group}:GPSImgDirection=`, `-${group}:GPSImgDirectionRef=`]
  return [`-${group}:GPSImgDirection=${Math.round(d * 100) / 100}`, `-${group}:GPSImgDirectionRef=T`]
}

/** The sidecar of the whole file name (п. 6.4), as known or as it would be. */
function fullSidecarOf(info: WriteInfo): { path: string; exists: boolean; coords: boolean } {
  return info.fullSidecar ?? { path: `${info.path}.xmp`, exists: false, coords: false }
}

/**
 * Removing the coordinates (Del, tz.md, п. 6.6) removes with them the altitude and the address,
 * which would be wrong without them: the whole GPS block of EXIF, the GPS fields of XMP, and the
 * place names that Lightroom shows (XMP and IPTC).
 */
const XMP_DELETE = ['-XMP-exif:GPS*=', ...xmpAddressArgs(null)]
const FILE_DELETE = ['-GPS:all=', ...iptcAddressDelete(), ...XMP_DELETE]

/**
 * The address in XMP, as Lightroom keeps it (tz.md, п. 5.5); an empty field (or no address)
 * removes the tag.
 */
export function xmpAddressArgs(a: Address | null): string[] {
  return ADDRESS_FIELDS.map((f) => `-${ADDRESS_TAGS.xmp[f]}=${a ? a[f] : ''}`)
}

/** The older IPTC place names go: the address lives in XMP, and the two must not differ. */
function iptcAddressDelete(): string[] {
  return ADDRESS_FIELDS.map((f) => `-${ADDRESS_TAGS.iptc[f]}=`)
}

/** No `*_original` copies (tz.md, п. 6.3); -n: numbers as they are. */
const COMMON = ['-overwrite_original', '-n']

/**
 * A video file keeps its modification time (-P): for some videos it is the only date there is
 * (tz.md, пп. 4.2, 6.3).
 */
const VIDEO_COMMON = [...COMMON, '-P']

/**
 * GPS of a video in its QuickTime metadata (tz.md, пп. 3.3.6, 6.3), where phones keep it: Keys
 * (iPhone) and UserData (Android); ISO 6709 with the altitude. The old value is removed from every
 * QuickTime group first, so no other one is left behind.
 */
export function quickTimeGpsArgs(c: LatLon | null, altitude: number | null = null): string[] {
  if (!c) return ['-QuickTime:GPSCoordinates=']
  const v = `${deg(c.lat)} ${deg(c.lon)}${altitude === null ? '' : ` ${Math.round(altitude * 100) / 100}`}`
  return ['-QuickTime:GPSCoordinates=', `-Keys:GPSCoordinates=${v}`, `-UserData:GPSCoordinates=${v}`]
}

/**
 * Where and how the coordinates and the address are written (tz.md, пп. 6.2–6.4, 5.5).
 * - Ordinary formats and DNG: coordinates in EXIF of the file; the embedded XMP and the sidecars
 *   get the same values if they already have coordinates, so that reading by п. 3.7 gives the new
 *   ones. The address goes to the XMP of the file and of existing sidecars (read first, п. 3.7).
 * - Other RAW: only the sidecar; an existing one is updated, a missing one is created.
 * - `xmpOnly` (п. 6.4): no file is changed; what would go into it goes to the sidecar of the whole
 *   file name ("IMG_0001.JPG.xmp"), created if missing. RAW as above.
 * The altitude and the direction go wherever the coordinates go (пп. 5.6, 4.21); none removes an old
 * one. No coordinates: everything is removed (Del, п. 6.6).
 */
export function writePlan(
  info: WriteInfo,
  c: LatLon | null,
  address: Address | null = null,
  altitude: number | null = null,
  opts: WriteOptions = {}
): WriteStep[] {
  if (!c) return deletePlan(info, opts)
  const addr = xmpAddressArgs(address)
  const xmpGps = [...xmpArgs(c), ...altitudeArgs('XMP-exif', altitude), ...directionArgs('XMP-exif', opts.direction)]
  if (info.write === 'xmp') {
    if (!info.sidecar) throw new Error(`No sidecar for ${info.path}`)
    return [{ path: info.sidecar.path, kind: 'sidecar', create: !info.sidecar.exists, args: [...COMMON, ...xmpGps, ...addr] }]
  }
  const full = fullSidecarOf(info)
  // Existing sidecars keep the same values (п. 6.3): coordinates where they already are, the address always.
  const sync = (s: { path: string; exists: boolean; coords: boolean } | null | undefined): WriteStep[] =>
    s?.exists ? [{ path: s.path, kind: 'sidecar', create: false, args: [...COMMON, ...(s.coords ? xmpGps : []), ...addr] }] : []
  if (opts.xmpOnly) {
    return [
      { path: full.path, kind: 'sidecar', create: !full.exists, args: [...COMMON, ...xmpGps, ...addr] },
      ...sync(info.sidecar)
    ]
  }
  if (info.video) return [...videoFileStep(info, c, address, altitude, opts.direction), ...sync(full), ...sync(info.sidecar)]
  return [
    {
      path: info.path,
      kind: 'file',
      create: false,
      args: [
        ...COMMON,
        ...exifArgs(c),
        ...altitudeArgs('EXIF', altitude),
        ...directionArgs('EXIF', opts.direction),
        ...(info.xmpCoords ? xmpGps : []),
        ...addr,
        ...iptcAddressDelete()
      ]
    },
    ...sync(full),
    ...sync(info.sidecar)
  ]
}

/**
 * Removing the coordinates (п. 6.6): from the file itself (ordinary formats and DNG) and from the
 * sidecars there are. A RAW file is never changed: only its sidecar; nor, with `xmpOnly`, any file.
 */
function deletePlan(info: WriteInfo, opts: WriteOptions): WriteStep[] {
  const sidecars = [fullSidecarOf(info), info.sidecar]
    .filter((s): s is { path: string; exists: boolean; coords: boolean } => !!s?.exists)
    .map((s): WriteStep => ({ path: s.path, kind: 'sidecar', create: false, args: [...COMMON, ...XMP_DELETE] }))
  if (info.write === 'xmp' || opts.xmpOnly) return sidecars
  const file: WriteStep = info.video
    ? { path: info.path, kind: 'file', create: false, args: [...VIDEO_COMMON, ...quickTimeGpsArgs(null), ...XMP_DELETE] }
    : { path: info.path, kind: 'file', create: false, args: [...COMMON, ...FILE_DELETE] }
  return [file, ...sidecars]
}

/**
 * A video exiftool writes (the QuickTime family, п. 3.3.6): its QuickTime GPS, and XMP — the GPS
 * if it is already there, the address, and the direction (QuickTime has no place for it, п. 4.21).
 */
function videoFileStep(info: WriteInfo, c: LatLon, address: Address | null, altitude: number | null, direction: number | null | undefined): WriteStep[] {
  const xmpGps = [...xmpArgs(c), ...altitudeArgs('XMP-exif', altitude)]
  return [
    {
      path: info.path,
      kind: 'file',
      create: false,
      args: [
        ...VIDEO_COMMON,
        ...quickTimeGpsArgs(c, altitude),
        ...(info.xmpCoords ? xmpGps : []),
        ...directionArgs('XMP-exif', direction),
        ...xmpAddressArgs(address)
      ]
    }
  ]
}

/** exiftool's summary of a write: success, or the reason from its messages. */
export function writeResult(stdout: string, stderr: string): { ok: true } | { ok: false; error: string } {
  if (/\b1 image files? (updated|created|unchanged)\b/.test(stdout)) return { ok: true }
  const lines = `${stderr}\n${stdout}`
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const errors = lines.filter((l) => /^Error\b/i.test(l))
  const reason = (errors.length ? errors : lines.filter((l) => !/files? (weren't|were not) updated/.test(l)))
    .map((l) => l.replace(/^Error:\s*/i, ''))
    .join('; ')
  return { ok: false, error: reason || 'exiftool did not write the file' }
}
