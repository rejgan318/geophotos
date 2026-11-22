import tzLookup from '@photostructure/tz-lookup'
import type { LatLon } from './photo'

/**
 * Shooting time (tz.md, п. 4.2): only for the order of the strip and to be shown, never written.
 * All times are local wall times "YYYY-MM-DD HH:MM:SS".
 */

/** Value of a tag regardless of group: tag("Make") matches "QuickTime:Make" and "MakerNotes:Make". */
type Rec = Record<string, unknown>

function anyGroup(rec: Rec, tag: string): unknown {
  if (tag in rec) return rec[tag]
  const suffix = `:${tag}`
  for (const [k, v] of Object.entries(rec)) if (k.endsWith(suffix)) return v
  return undefined
}

const DATE_RE = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?/i

interface Parsed {
  wall: string
  /** "Z", "+03:00"… as written; null when the date carries no zone. */
  zone: string | null
}

function parse(value: unknown): Parsed | null {
  if (typeof value !== 'string') return null
  const m = DATE_RE.exec(value.trim())
  if (!m) return null
  const [, y, mo, d, h, mi, s = '00', zone] = m
  if (!plausible(Number(y), Number(mo), Number(d), Number(h), Number(mi), Number(s))) return null
  return { wall: `${y}-${mo}-${d} ${h}:${mi}:${s}`, zone: zone ? zone.toUpperCase() : null }
}

/** A real calendar date between 1980 and next year (cameras write zeros or 1904 when unset). */
function plausible(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): boolean {
  if (y < 1980 || y > new Date().getFullYear() + 1) return false
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return false
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate()
}

/** The wall time of an instant in a time zone (IANA name), or in the computer's zone. */
export function wallTime(instant: Date, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(instant)
  const p = (type: string): string => parts.find((x) => x.type === type)?.value ?? '00'
  return `${p('year')}-${p('month')}-${p('day')} ${p('hour')}:${p('minute')}:${p('second')}`
}

/** IANA time zone at a point, or undefined if it cannot be found. */
export function zoneAt(c: LatLon): string | undefined {
  try {
    return tzLookup(c.lat, c.lon)
  } catch {
    return undefined
  }
}

/**
 * Makers of cameras: their videos hold the local time in the QuickTime dates, although the
 * standard says UTC (checked on Canon EOS 5D Mark II, Canon CanonAVC0001, Olympus C5060WZ).
 * Phones (Samsung, Android, iPhone) write UTC.
 */
const CAMERA_MAKERS = [
  'canon', 'nikon', 'sony', 'panasonic', 'olympus', 'om digital', 'fujifilm', 'pentax', 'ricoh',
  'casio', 'kodak', 'leica', 'sigma', 'jvc', 'minolta', 'konica', 'hasselblad', 'gopro'
]

/** Whether the video comes from a camera (п. 4.2): by its maker or model, Canon also by `CompressorVersion`. */
export function isCameraVideo(rec: Rec): boolean {
  const text = ['Make', 'Model'].map((t) => String(anyGroup(rec, t) ?? '').toLowerCase()).join(' ')
  if (CAMERA_MAKERS.some((m) => text.includes(m))) return true
  return /^canon/i.test(String(anyGroup(rec, 'CompressorVersion') ?? ''))
}

/**
 * Shooting time of a video (п. 4.2), or null when the file has none:
 * - a date with its own zone (QuickTime CreationDate of an iPhone, an XMP date with "+03:00") —
 *   its wall time; "Z" in XMP does not count (programs add it to the camera's local time);
 * - a camera — the QuickTime date as it is;
 * - otherwise (phones) — the QuickTime date is UTC: the wall time at the place of shooting, by
 *   the coordinates of the file, or in the computer's zone without them;
 * - a RIFF date (AVI) — as it is.
 */
export function videoDate(rec: Rec, coords: LatLon | null): string | null {
  for (const tag of ['QuickTime:CreationDate', 'XMP:DateTimeOriginal', 'XMP:CreateDate']) {
    const d = parse(rec[tag])
    if (d && d.zone && d.zone !== 'Z') return d.wall
  }
  const qt = parse(rec['QuickTime:CreateDate']) ?? parse(rec['QuickTime:MediaCreateDate'])
  if (qt) {
    if (isCameraVideo(rec)) return qt.wall
    const instant = new Date(`${qt.wall.replace(' ', 'T')}Z`)
    return wallTime(instant, coords ? zoneAt(coords) : undefined)
  }
  for (const tag of ['RIFF:DateTimeOriginal', 'XMP:DateTimeOriginal', 'XMP:CreateDate']) {
    const d = parse(rec[tag])
    if (d) return d.wall
  }
  return null
}

/**
 * Date, and time if there is one, from a file name (п. 4.2): "20190816_192927.mp4",
 * "VID_20250426_101211.mp4", "1998 03 19 Юля.avi", "1998-03-19", "1998_03_19". Null if none.
 */
export function dateFromName(fileName: string): string | null {
  const name = fileName.split(/[\\/]/).at(-1) ?? fileName
  const withTime = /(?<!\d)((?:19|20)\d{2})[ ._-]?(\d{2})[ ._-]?(\d{2})[ _T.-]?(\d{2})[.:-]?(\d{2})[.:-]?(\d{2})(?!\d)/.exec(name)
  if (withTime) {
    const [, y, mo, d, h, mi, s] = withTime
    if (plausible(+y!, +mo!, +d!, +h!, +mi!, +s!)) return `${y}-${mo}-${d} ${h}:${mi}:${s}`
  }
  const re = /(?<!\d)((?:19|20)\d{2})([ ._-]?)(\d{2})\2(\d{2})(?!\d)/g
  for (const m of name.matchAll(re)) {
    const [, y, , mo, d] = m
    if (plausible(+y!, +mo!, +d!)) return `${y}-${mo}-${d} 00:00:00`
  }
  return null
}
