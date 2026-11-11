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
 * Where and how the coordinates and the address are written (tz.md, пп. 6.2–6.4, 5.5).
 * - Ordinary formats and DNG: coordinates in EXIF of the file; the embedded XMP and the sidecar
 *   get the same values if they already have coordinates, so that reading by п. 3.7 gives the new
 *   ones. The address goes to the XMP of the file and of an existing sidecar (read first, п. 3.7).
 * - Other RAW: only the sidecar; an existing one is updated, a missing one is created.
 * The altitude goes wherever the coordinates go (п. 5.6); none removes an old one.
 * No coordinates: everything is removed (Del, п. 6.6).
 */
export function writePlan(
  info: WriteInfo,
  c: LatLon | null,
  address: Address | null = null,
  altitude: number | null = null
): WriteStep[] {
  if (!c) return deletePlan(info)
  const addr = xmpAddressArgs(address)
  const xmpGps = [...xmpArgs(c), ...altitudeArgs('XMP-exif', altitude)]
  if (info.write === 'xmp') {
    if (!info.sidecar) throw new Error(`No sidecar for ${info.path}`)
    return [{ path: info.sidecar.path, kind: 'sidecar', create: !info.sidecar.exists, args: [...COMMON, ...xmpGps, ...addr] }]
  }
  const steps: WriteStep[] = [
    {
      path: info.path,
      kind: 'file',
      create: false,
      args: [
        ...COMMON,
        ...exifArgs(c),
        ...altitudeArgs('EXIF', altitude),
        ...(info.xmpCoords ? xmpGps : []),
        ...addr,
        ...iptcAddressDelete()
      ]
    }
  ]
  if (info.sidecar?.exists) {
    steps.push({
      path: info.sidecar.path,
      kind: 'sidecar',
      create: false,
      args: [...COMMON, ...(info.sidecar.coords ? xmpGps : []), ...addr]
    })
  }
  return steps
}

/**
 * Removing the coordinates (п. 6.6): from the file itself (ordinary formats and DNG) and from the
 * sidecar if there is one. A RAW file is never changed: only its sidecar.
 */
function deletePlan(info: WriteInfo): WriteStep[] {
  const steps: WriteStep[] = []
  if (info.write !== 'xmp') steps.push({ path: info.path, kind: 'file', create: false, args: [...COMMON, ...FILE_DELETE] })
  if (info.sidecar?.exists) {
    steps.push({ path: info.sidecar.path, kind: 'sidecar', create: false, args: [...COMMON, ...XMP_DELETE] })
  }
  return steps
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
