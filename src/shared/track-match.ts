import type { LatLon, Photo } from './photo'
import type { TrackData, TrackPoint } from './track'

/**
 * The place of a photo on a track (tz.md, п. 3.9.7): where the track was at the moment the photo
 * was taken. No automatic placing: the program shows it, the user places the photo.
 */

/** Neighbouring points further apart than this (s) are a pause of the recording: no place there. */
export const MAX_GAP_SECONDS = 300

/**
 * A wall time "YYYY-MM-DD HH:MM:SS" → instant, ms: by its own offset ("+03:00") if it has one,
 * else as local time of a time zone (IANA). Null when neither is known or the zone is unknown.
 */
export function wallToInstant(wall: string, offset: string | null | undefined, zone: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)$/.exec(wall)
  if (!m) return null
  const asUtc = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!)
  const off = offset ? /^([+-])(\d\d):(\d\d)$/.exec(offset) : null
  if (off) return asUtc - (off[1] === '-' ? -1 : 1) * (+off[2]! * 60 + +off[3]!) * 60000
  if (!zone) return null
  // The offset of the zone at that moment: shown local time minus UTC. Twice, near a change of
  // summer time the first guess may be on the other side of it.
  const offsetAt = (t: number): number | null => {
    try {
      const f = new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })
      const p = Object.fromEntries(f.formatToParts(new Date(t)).map((x) => [x.type, x.value]))
      return Date.UTC(+p['year']!, +p['month']! - 1, +p['day']!, +p['hour']!, +p['minute']!, +p['second']!) - t
    } catch {
      return null
    }
  }
  const first = offsetAt(asUtc)
  if (first === null) return null
  const second = offsetAt(asUtc - first)
  return asUtc - (second ?? first)
}

/** The instant a photo was taken, for a track of this time zone; null — not known well enough. */
export function photoInstant(p: Pick<Photo, 'date' | 'dateSource' | 'offset'>, zone: string | null): number | null {
  // A date of the file (its modification time) says nothing of the shooting.
  if (!p.date || p.dateSource === 'file') return null
  return wallToInstant(p.date, p.offset ?? null, zone)
}

/**
 * Where the track was at an instant: between two points, in proportion to time. Null outside the
 * track's time, between its segments or in a pause of the recording (`MAX_GAP_SECONDS`).
 */
export function placeAt(track: TrackData, t: number, maxGap = MAX_GAP_SECONDS): LatLon | null {
  for (const seg of track.segments) {
    const pts = seg.filter((p): p is TrackPoint & { t: number } => p.t !== null)
    if (!pts.length || t < pts[0]!.t || t > pts.at(-1)!.t) continue
    // The first point at or after t (times only grow).
    let lo = 0
    let hi = pts.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (pts[mid]!.t < t) lo = mid + 1
      else hi = mid
    }
    const b = pts[lo]!
    if (b.t === t) return { lat: b.lat, lon: b.lon }
    const a = pts[lo - 1]!
    if ((b.t - a.t) / 1000 > maxGap) return null
    const k = (t - a.t) / (b.t - a.t)
    return { lat: a.lat + (b.lat - a.lat) * k, lon: a.lon + (b.lon - a.lon) * k }
  }
  return null
}

/** A track with its time zone, as the window has it. */
export interface ZonedTrack {
  id: number
  data: TrackData
  zone: string | null
}

/** The place of a photo on the first of the tracks (in strip order) that has one (п. 3.9.7). */
export function placeOnTracks(p: Pick<Photo, 'date' | 'dateSource' | 'offset'>, tracks: readonly ZonedTrack[]): { track: number; at: LatLon } | null {
  for (const tr of tracks) {
    const t = photoInstant(p, tr.zone)
    if (t === null) continue
    const at = placeAt(tr.data, t)
    if (at) return { track: tr.id, at }
  }
  return null
}
