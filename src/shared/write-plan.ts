import type { WriteMode } from './formats'
import type { LatLon } from './photo'

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

/**
 * Removing the coordinates (Del, tz.md, п. 6.6) removes with them the altitude and the address,
 * which would be wrong without them: the whole GPS block of EXIF, the GPS fields of XMP, and the
 * place names that Lightroom shows (XMP and IPTC).
 */
const ADDRESS_DELETE = [
  '-XMP-photoshop:Country=',
  '-XMP-photoshop:State=',
  '-XMP-photoshop:City=',
  '-XMP-iptcCore:Location=',
  '-XMP-iptcCore:CountryCode='
]
const XMP_DELETE = ['-XMP-exif:GPS*=', ...ADDRESS_DELETE]
const FILE_DELETE = [
  '-GPS:all=',
  '-IPTC:Country-PrimaryLocationName=',
  '-IPTC:Country-PrimaryLocationCode=',
  '-IPTC:Province-State=',
  '-IPTC:City=',
  '-IPTC:Sub-location=',
  ...XMP_DELETE
]

/** No `*_original` copies (tz.md, п. 6.3); -n: numbers as they are. */
const COMMON = ['-overwrite_original', '-n']

/**
 * Where and how the coordinates are written (tz.md, пп. 6.2–6.4): only latitude and longitude.
 * - Ordinary formats and DNG: EXIF of the file; the embedded XMP and the sidecar are updated with
 *   the same values if they already have coordinates, so that reading by п. 3.7 gives the new ones.
 * - Other RAW: only the sidecar; an existing one is updated, a missing one is created.
 */
export function writePlan(info: WriteInfo, c: LatLon | null): WriteStep[] {
  if (!c) return deletePlan(info)
  if (info.write === 'xmp') {
    if (!info.sidecar) throw new Error(`No sidecar for ${info.path}`)
    return [{ path: info.sidecar.path, kind: 'sidecar', create: !info.sidecar.exists, args: [...COMMON, ...xmpArgs(c)] }]
  }
  const steps: WriteStep[] = [
    {
      path: info.path,
      kind: 'file',
      create: false,
      args: [...COMMON, ...exifArgs(c), ...(info.xmpCoords ? xmpArgs(c) : [])]
    }
  ]
  if (info.sidecar?.exists && info.sidecar.coords) {
    steps.push({ path: info.sidecar.path, kind: 'sidecar', create: false, args: [...COMMON, ...xmpArgs(c)] })
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
