import type { LatLon } from './photo'

/**
 * Tracks (tz.md, п. 3.9): files of a recorded path. In 0.26.0 they are only shown: never written,
 * they do not change the coordinates of photos.
 */

/** One recorded point. Time in ms since 1970 (UTC); the sensor values only when the file has them. */
export interface TrackPoint {
  lat: number
  lon: number
  /** Instant of the point, ms (UTC); null — the file has no times. */
  t: number | null
  /** Altitude, m. */
  ele: number | null
  /** Heart rate, beats per minute. */
  hr?: number
  /** Speed, m/s. */
  speed?: number
  /** Cadence, rpm (or steps per minute). */
  cad?: number
  /** Temperature, °C. */
  temp?: number
  /** Power, W. */
  power?: number
}

/** A waypoint of the file: a named place (tz.md, п. 3.9.5). */
export interface Waypoint {
  lat: number
  lon: number
  name: string
}

/** What a track file holds: its lines (segments are never joined), waypoints, name and creator. */
export interface TrackData {
  name: string | null
  /** Program or device that wrote the file. */
  creator: string | null
  segments: TrackPoint[][]
  waypoints: Waypoint[]
}

/** What the strip and the status bar know of a track (tz.md, п. 3.9.3). */
export interface TrackInfo {
  points: number
  waypoints: number
  /** Length, m. */
  distance: number
  /** First to last time, s; null — no times. */
  duration: number | null
  /** Index in the track colours of the settings (п. 3.9.5): by the order of tracks in the strip. */
  color: number
}

export const TRACK_EXTENSIONS = ['gpx', 'kml', 'kmz', 'fit', 'tcx', 'geojson'] as const

/** Whether a file is a track by its extension (tz.md, п. 3.9.1). */
export function isTrackFile(fileName: string): boolean {
  const dot = fileName.lastIndexOf('.')
  const ext = dot < 0 ? '' : fileName.slice(dot + 1).toLowerCase()
  return (TRACK_EXTENSIONS as readonly string[]).includes(ext)
}

const R = 6371008.8

/** Distance between two points, m (haversine). */
export function distance(a: LatLon, b: LatLon): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLon = (b.lon - a.lon) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function allPoints(track: TrackData): TrackPoint[] {
  return track.segments.flat()
}

/** Length of the lines, m; the gaps between segments do not count. */
export function trackLength(track: TrackData): number {
  let sum = 0
  for (const seg of track.segments) for (let i = 1; i < seg.length; i++) sum += distance(seg[i - 1]!, seg[i]!)
  return sum
}

/** First and last time of the track, ms; null if it has no times. */
export function timeSpan(track: TrackData): { start: number; end: number } | null {
  let start = Infinity
  let end = -Infinity
  for (const p of allPoints(track)) {
    if (p.t === null) continue
    if (p.t < start) start = p.t
    if (p.t > end) end = p.t
  }
  return start === Infinity ? null : { start, end }
}

export function trackInfo(track: TrackData, color = 0): TrackInfo {
  const span = timeSpan(track)
  return {
    points: allPoints(track).length,
    waypoints: track.waypoints.length,
    distance: trackLength(track),
    duration: span ? (span.end - span.start) / 1000 : null,
    color
  }
}

export function trackBounds(track: TrackData): { south: number; west: number; north: number; east: number } | null {
  const pts: LatLon[] = [...allPoints(track), ...track.waypoints]
  if (!pts.length) return null
  let south = 90
  let north = -90
  let west = 180
  let east = -180
  for (const p of pts) {
    south = Math.min(south, p.lat)
    north = Math.max(north, p.lat)
    west = Math.min(west, p.lon)
    east = Math.max(east, p.lon)
  }
  return { south, west, north, east }
}

/** A stop (tz.md, п. 3.9.6): at least 2 minutes within this many metres of where it began. */
export const STOP_RADIUS = 30
export const STOP_SECONDS = 120
/** Ups and downs smaller than this are GPS noise, not climbing (ascent / descent). */
export const CLIMB_STEP = 5
/** Speed from positions is measured over at least this long, s: shorter steps are mostly noise. */
const SPEED_WINDOW = 10

/** The summary of the track view (tz.md, п. 3.9.6); null — the file has no such data. */
export interface TrackStats {
  start: number | null
  end: number | null
  distance: number
  duration: number | null
  moving: number | null
  stops: { count: number; seconds: number } | null
  /** m/s */
  avgSpeed: number | null
  maxSpeed: number | null
  ascent: number | null
  descent: number | null
  minEle: number | null
  maxEle: number | null
  hrAvg: number | null
  hrMax: number | null
  points: number
  waypoints: number
}

/** Stops of a segment: their number and seconds (points without time are skipped). */
function segmentStops(seg: readonly TrackPoint[]): { count: number; seconds: number } {
  const pts = seg.filter((p) => p.t !== null)
  let count = 0
  let seconds = 0
  let i = 0
  while (i < pts.length) {
    let j = i
    while (j + 1 < pts.length && distance(pts[i]!, pts[j + 1]!) <= STOP_RADIUS) j++
    const dt = (pts[j]!.t! - pts[i]!.t!) / 1000
    if (j > i && dt >= STOP_SECONDS) {
      count++
      seconds += dt
      i = j
    } else i++
  }
  return { count, seconds }
}

/** Highest speed of a segment, m/s: the file's own speeds, else from positions over ≥ 10 s. */
function segmentMaxSpeed(seg: readonly TrackPoint[]): number | null {
  const own = seg.filter((p) => p.speed !== undefined).map((p) => p.speed!)
  if (own.length) return maxOf(own)
  const pts = seg.filter((p) => p.t !== null)
  // Distance along the line from the first point to each one.
  const along = [0]
  for (let i = 1; i < pts.length; i++) along.push(along[i - 1]! + distance(pts[i - 1]!, pts[i]!))
  let max: number | null = null
  let k = 0
  for (let i = 0; i < pts.length; i++) {
    // The first point at least SPEED_WINDOW later.
    if (k < i) k = i
    while (k < pts.length && (pts[k]!.t! - pts[i]!.t!) / 1000 < SPEED_WINDOW) k++
    if (k >= pts.length) break
    const dt = (pts[k]!.t! - pts[i]!.t!) / 1000
    max = Math.max(max ?? 0, (along[k]! - along[i]!) / dt)
  }
  return max
}

/** Climbing with a 5 m step, so the noise of the altitude does not add up (ascent, descent). */
function climb(seg: readonly TrackPoint[]): { up: number; down: number } | null {
  const eles = seg.filter((p) => p.ele !== null).map((p) => p.ele!)
  if (eles.length < 2) return null
  let up = 0
  let down = 0
  let ref = eles[0]!
  for (const e of eles) {
    if (e >= ref + CLIMB_STEP) {
      up += e - ref
      ref = e
    } else if (e <= ref - CLIMB_STEP) {
      down += ref - e
      ref = e
    }
  }
  return { up, down }
}

export function trackStats(track: TrackData): TrackStats {
  const pts = allPoints(track)
  const span = timeSpan(track)
  const dist = trackLength(track)
  // Time is counted within segments: a gap between segments (the recording was paused) is not.
  let duration: number | null = null
  let stopCount = 0
  let stopSeconds = 0
  let maxSpeed: number | null = null
  let ascent: number | null = null
  let descent: number | null = null
  for (const seg of track.segments) {
    const times = seg.filter((p) => p.t !== null).map((p) => p.t!)
    if (times.length >= 2) {
      duration = (duration ?? 0) + (maxOf(times) - minOf(times)) / 1000
      const s = segmentStops(seg)
      stopCount += s.count
      stopSeconds += s.seconds
    }
    const m = segmentMaxSpeed(seg)
    if (m !== null) maxSpeed = Math.max(maxSpeed ?? 0, m)
    const c = climb(seg)
    if (c) {
      ascent = (ascent ?? 0) + c.up
      descent = (descent ?? 0) + c.down
    }
  }
  const stops = duration === null ? null : { count: stopCount, seconds: stopSeconds }
  const moving = duration === null ? null : duration - stopSeconds
  const eles = pts.filter((p) => p.ele !== null).map((p) => p.ele!)
  const hrs = pts.filter((p) => p.hr !== undefined).map((p) => p.hr!)
  return {
    start: span?.start ?? null,
    end: span?.end ?? null,
    distance: dist,
    duration,
    moving,
    stops,
    avgSpeed: moving && moving > 0 ? dist / moving : null,
    maxSpeed,
    ascent,
    descent,
    minEle: eles.length ? minOf(eles) : null,
    maxEle: eles.length ? maxOf(eles) : null,
    hrAvg: hrs.length ? hrs.reduce((a, b) => a + b, 0) / hrs.length : null,
    hrMax: hrs.length ? maxOf(hrs) : null,
    points: pts.length,
    waypoints: track.waypoints.length
  }
}

/** The point of the track nearest to a place (hover on the line, tz.md, п. 3.9.5). */
export function nearestPoint(track: TrackData, at: LatLon): TrackPoint | null {
  const k = Math.cos((at.lat * Math.PI) / 180)
  let best: TrackPoint | null = null
  let bestD = Infinity
  for (const p of allPoints(track)) {
    const dx = (p.lon - at.lon) * k
    const dy = p.lat - at.lat
    const d = dx * dx + dy * dy
    if (d < bestD) {
      bestD = d
      best = p
    }
  }
  return best
}

/** The profile of the track view: distance from the start (m) of every point, segments in order. */
export function profile(track: TrackData): { at: number; p: TrackPoint }[] {
  const out: { at: number; p: TrackPoint }[] = []
  let at = 0
  for (const seg of track.segments) {
    seg.forEach((p, i) => {
      if (i > 0) at += distance(seg[i - 1]!, p)
      out.push({ at, p })
    })
  }
  return out
}

/**
 * The shape of the track as an SVG picture (the strip thumbnail, tz.md, п. 3.9.3): its lines in its
 * colour on a dark background, fitted into the box; at most ~600 points per segment.
 */
export function trackPreviewSvg(track: TrackData, color: string, width = 320, height = 240): string {
  const b = trackBounds(track)
  const bg = `<rect width="${width}" height="${height}" fill="#2a2d33"/>`
  if (!b) return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${bg}</svg>`
  const k = Math.cos((((b.north + b.south) / 2) * Math.PI) / 180)
  const w = Math.max((b.east - b.west) * k, 1e-9)
  const h = Math.max(b.north - b.south, 1e-9)
  const pad = 16
  const scale = Math.min((width - 2 * pad) / w, (height - 2 * pad) / h)
  const ox = (width - w * scale) / 2
  const oy = (height - h * scale) / 2
  const xy = (p: LatLon): string => `${(ox + (p.lon - b.west) * k * scale).toFixed(1)},${(oy + (b.north - p.lat) * scale).toFixed(1)}`
  const lines = track.segments
    .filter((s) => s.length > 1)
    .map((s) => {
      const step = Math.max(1, Math.ceil(s.length / 600))
      const pts = s.filter((_, i) => i % step === 0 || i === s.length - 1)
      return `<polyline points="${pts.map(xy).join(' ')}" fill="none" stroke="${color}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>`
    })
  const dots = track.waypoints.map((p) => {
    const [x, y] = xy(p).split(',')
    return `<circle cx="${x}" cy="${y}" r="4" fill="${color}" stroke="#fff" stroke-width="1.5"/>`
  })
  // A track of one point (or only waypoints): a dot.
  const single = track.segments.filter((s) => s.length === 1).map((s) => {
    const [x, y] = xy(s[0]!).split(',')
    return `<circle cx="${x}" cy="${y}" r="5" fill="${color}"/>`
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${bg}${lines.join('')}${single.join('')}${dots.join('')}</svg>`
}

/** Max and min of long lists (spreading 100 000 numbers into Math.max overflows the stack). */
function maxOf(xs: readonly number[]): number {
  let m = -Infinity
  for (const x of xs) if (x > m) m = x
  return m
}

function minOf(xs: readonly number[]): number {
  let m = Infinity
  for (const x of xs) if (x < m) m = x
  return m
}

/**
 * Colours of tracks (tz.md, п. 3.9.5): by their order in the strip, round again when there are
 * more tracks than colours. Returns the items with the colour index set (others unchanged).
 */
export function withTrackColors<T extends { track?: TrackInfo }>(items: readonly T[], colors: number): T[] {
  let k = 0
  return items.map((it) => (it.track ? { ...it, track: { ...it.track, color: k++ % Math.max(1, colors) } } : it))
}
