import { readFile } from 'node:fs/promises'
import { inflateRawSync } from 'node:zlib'
import { XMLParser } from 'fast-xml-parser'
import FitParser from 'fit-file-parser'
import type { TrackData, TrackPoint, Waypoint } from '@shared/track'

/**
 * Reading track files (tz.md, п. 3.9.1): GPX, KML, KMZ, TCX, GeoJSON and FIT — by the program
 * itself, no outside converter. Throws when the file cannot be read or has no point at all.
 */
export async function readTrack(path: string): Promise<TrackData> {
  return parseTrack(path, await readFile(path))
}

export async function parseTrack(fileName: string, data: Buffer): Promise<TrackData> {
  const ext = fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase()
  const track =
    ext === 'gpx'
      ? parseGpx(data.toString('utf8'))
      : ext === 'kml'
        ? parseKml(data.toString('utf8'))
        : ext === 'kmz'
          ? parseKml(kmlOfKmz(data))
          : ext === 'tcx'
            ? parseTcx(data.toString('utf8'))
            : ext === 'geojson'
              ? parseGeoJson(data.toString('utf8'))
              : ext === 'fit'
                ? await parseFit(data)
                : null
  if (!track) throw new Error(`not a track file: ${fileName}`)
  const segments = track.segments.filter((s) => s.length > 0)
  if (!segments.length && !track.waypoints.length) throw new Error('no points with coordinates')
  return { ...track, segments }
}

type Node = Record<string, unknown>

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // gpxtpx:hr → hr, gx:Track → Track: the prefixes differ between writers.
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true
})

const list = (v: unknown): Node[] => (v === undefined || v === null ? [] : Array.isArray(v) ? (v as Node[]) : [v as Node])
const text = (v: unknown): string | null => {
  if (v === undefined || v === null) return null
  if (typeof v === 'object') return text((v as Node)['#text'])
  const s = String(v).trim()
  return s === '' ? null : s
}
const num = (v: unknown): number | null => {
  const s = text(v)
  if (s === null) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
const time = (v: unknown): number | null => {
  const s = text(v)
  if (s === null) return null
  const t = Date.parse(s)
  return Number.isFinite(t) ? t : null
}
const validLatLon = (lat: number | null, lon: number | null): boolean =>
  lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0)

/** Sensor values from anywhere under a node (GPX extensions differ between writers). */
function sensors(ext: unknown, into: TrackPoint): void {
  const walk = (v: unknown): void => {
    if (!v || typeof v !== 'object') return
    for (const [k, val] of Object.entries(v as Node)) {
      const key = k.toLowerCase()
      if (val && typeof val === 'object' && !('#text' in (val as Node))) {
        walk(val)
        continue
      }
      const n = num(val)
      if (n === null) continue
      if (key === 'hr' || key === 'heartrate' || key === 'heartratebpm') into.hr = n
      else if (key === 'cad' || key === 'cadence' || key === 'runcadence') into.cad = n
      else if (key === 'atemp' || key === 'temp' || key === 'temperature' || key === 'wtemp') into.temp = n
      else if (key === 'power' || key === 'watts' || key === 'powerinwatts') into.power = n
      else if (key === 'speed') into.speed = n
    }
  }
  walk(ext)
}

export function parseGpx(source: string): TrackData {
  const gpx = (xml.parse(source) as Node)['gpx'] as Node | undefined
  if (!gpx) throw new Error('not a GPX file')
  const point = (n: Node): TrackPoint | null => {
    const lat = num(n['@_lat'])
    const lon = num(n['@_lon'])
    if (!validLatLon(lat, lon)) return null
    const p: TrackPoint = { lat: lat!, lon: lon!, t: time(n['time']), ele: num(n['ele']) }
    sensors(n['extensions'], p)
    return p
  }
  const segments: TrackPoint[][] = []
  for (const trk of list(gpx['trk'])) {
    for (const seg of list(trk['trkseg'])) segments.push(list(seg['trkpt']).map(point).filter((p): p is TrackPoint => !!p))
  }
  // Routes (planned, usually without times) are lines too.
  for (const rte of list(gpx['rte'])) segments.push(list(rte['rtept']).map(point).filter((p): p is TrackPoint => !!p))
  const waypoints: Waypoint[] = list(gpx['wpt']).flatMap((w) => {
    const p = point(w)
    return p ? [{ lat: p.lat, lon: p.lon, name: text(w['name']) ?? text(w['desc']) ?? '' }] : []
  })
  const meta = gpx['metadata'] as Node | undefined
  const firstTrk = list(gpx['trk'])[0] ?? list(gpx['rte'])[0]
  return {
    name: text(meta?.['name']) ?? text(firstTrk?.['name']),
    creator: text(gpx['@_creator']),
    segments,
    waypoints
  }
}

/** "lon,lat[,alt] lon,lat[,alt] …" of KML. */
function kmlCoords(s: string | null): TrackPoint[] {
  if (!s) return []
  return s
    .split(/\s+/)
    .filter((c) => c)
    .flatMap((c) => {
      const [lon, lat, alt] = c.split(',').map(Number)
      return validLatLon(lat ?? null, lon ?? null) ? [{ lat: lat!, lon: lon!, t: null, ele: alt !== undefined && Number.isFinite(alt) ? alt : null }] : []
    })
}

export function parseKml(source: string): TrackData {
  const root = (xml.parse(source) as Node)['kml'] as Node | undefined
  if (!root) throw new Error('not a KML file')
  const segments: TrackPoint[][] = []
  const waypoints: Waypoint[] = []
  let name: string | null = null

  const geometry = (g: Node, placeName: string): void => {
    for (const ls of list(g['LineString'])) segments.push(kmlCoords(text(ls['coordinates'])))
    for (const ring of list(g['LinearRing'])) segments.push(kmlCoords(text(ring['coordinates'])))
    // gx:Track: <when> and <gx:coord> ("lon lat alt") in pairs.
    for (const tr of [...list(g['Track']), ...list(g['MultiTrack']).flatMap((m) => list(m['Track']))]) {
      const whens = list(tr['when']).map(time)
      const coords = list(tr['coord']).map((c) => (text(c) ?? '').split(/\s+/).map(Number))
      segments.push(
        coords.flatMap(([lon, lat, alt], i) =>
          validLatLon(lat ?? null, lon ?? null)
            ? [{ lat: lat!, lon: lon!, t: whens[i] ?? null, ele: alt !== undefined && Number.isFinite(alt) ? alt : null }]
            : []
        )
      )
    }
    for (const pt of list(g['Point'])) {
      const [p] = kmlCoords(text(pt['coordinates']))
      if (p) waypoints.push({ lat: p.lat, lon: p.lon, name: placeName })
    }
    for (const mg of list(g['MultiGeometry'])) geometry(mg, placeName)
  }

  const walk = (n: Node): void => {
    for (const pm of list(n['Placemark'])) geometry(pm, text(pm['name']) ?? '')
    for (const key of ['Document', 'Folder']) {
      for (const child of list(n[key])) {
        name ??= text(child['name'])
        walk(child)
      }
    }
  }
  walk(root)
  return { name, creator: null, segments, waypoints }
}

export function parseTcx(source: string): TrackData {
  const db = (xml.parse(source) as Node)['TrainingCenterDatabase'] as Node | undefined
  if (!db) throw new Error('not a TCX file')
  const segments: TrackPoint[][] = []
  const waypoints: Waypoint[] = []
  const point = (tp: Node): TrackPoint | null => {
    const pos = tp['Position'] as Node | undefined
    const lat = num(pos?.['LatitudeDegrees'])
    const lon = num(pos?.['LongitudeDegrees'])
    if (!validLatLon(lat, lon)) return null
    const p: TrackPoint = { lat: lat!, lon: lon!, t: time(tp['Time']), ele: num(tp['AltitudeMeters']) }
    const hr = num((tp['HeartRateBpm'] as Node | undefined)?.['Value'])
    if (hr !== null) p.hr = hr
    const cad = num(tp['Cadence'])
    if (cad !== null) p.cad = cad
    sensors(tp['Extensions'], p)
    return p
  }
  const tracks = (holder: Node): void => {
    for (const tr of list(holder['Track'])) segments.push(list(tr['Trackpoint']).map(point).filter((p): p is TrackPoint => !!p))
  }
  let name: string | null = null
  let creator: string | null = null
  for (const act of list((db['Activities'] as Node | undefined)?.['Activity'])) {
    for (const lap of list(act['Lap'])) tracks(lap)
    creator ??= text((act['Creator'] as Node | undefined)?.['Name'])
    name ??= text(act['Notes'])
  }
  for (const course of list((db['Courses'] as Node | undefined)?.['Course'])) {
    tracks(course)
    name ??= text(course['Name'])
    for (const cp of list(course['CoursePoint'])) {
      const pos = cp['Position'] as Node | undefined
      const lat = num(pos?.['LatitudeDegrees'])
      const lon = num(pos?.['LongitudeDegrees'])
      if (validLatLon(lat, lon)) waypoints.push({ lat: lat!, lon: lon!, name: text(cp['Name']) ?? '' })
    }
  }
  return { name, creator, segments, waypoints }
}

export function parseGeoJson(source: string): TrackData {
  const root = JSON.parse(source) as Node
  const segments: TrackPoint[][] = []
  const waypoints: Waypoint[] = []
  let name: string | null = typeof root['name'] === 'string' ? root['name'] : null
  const pt = (c: unknown, t: unknown = null): TrackPoint | null => {
    if (!Array.isArray(c)) return null
    const [lon, lat, ele] = c as number[]
    if (typeof lat !== 'number' || typeof lon !== 'number' || !validLatLon(lat, lon)) return null
    return { lat, lon, t: time(t), ele: typeof ele === 'number' ? ele : null }
  }
  const line = (coords: unknown, times: unknown): TrackPoint[] => {
    const ts = Array.isArray(times) ? times : []
    return (Array.isArray(coords) ? coords : []).map((c, i) => pt(c, ts[i])).filter((p): p is TrackPoint => !!p)
  }
  const feature = (f: Node): void => {
    const props = (f['properties'] as Node | null) ?? {}
    const g = f['geometry'] as Node | null
    if (!g) return
    // Times as written by togeojson and others: properties.coordTimes / coordinateProperties.times.
    const times = props['coordTimes'] ?? (props['coordinateProperties'] as Node | undefined)?.['times']
    const fname = typeof props['name'] === 'string' ? props['name'] : null
    if (g['type'] === 'LineString') {
      segments.push(line(g['coordinates'], times))
      name ??= fname
    } else if (g['type'] === 'MultiLineString') {
      ;(g['coordinates'] as unknown[]).forEach((c, i) => segments.push(line(c, Array.isArray(times) ? times[i] : null)))
      name ??= fname
    } else if (g['type'] === 'Point') {
      const p = pt(g['coordinates'])
      if (p) waypoints.push({ lat: p.lat, lon: p.lon, name: fname ?? '' })
    } else if (g['type'] === 'GeometryCollection') {
      for (const sub of list(g['geometries'])) feature({ properties: props, geometry: sub })
    }
  }
  if (root['type'] === 'FeatureCollection') for (const f of list(root['features'])) feature(f)
  else if (root['type'] === 'Feature') feature(root)
  else feature({ properties: {}, geometry: root })
  return { name, creator: null, segments, waypoints }
}

export async function parseFit(data: Buffer): Promise<TrackData> {
  const fit = (await new FitParser({ force: true, mode: 'list', speedUnit: 'm/s', lengthUnit: 'm', temperatureUnit: 'celsius' }).parseAsync(
    data as Buffer<ArrayBuffer>
  )) as unknown as Node
  const records = list(fit['records'])
  const val = (r: Node, ...keys: string[]): number | null => {
    for (const k of keys) {
      const v = r[k]
      if (typeof v === 'number' && Number.isFinite(v)) return v
    }
    return null
  }
  const points: TrackPoint[] = []
  for (const r of records) {
    const lat = val(r, 'position_lat')
    const lon = val(r, 'position_long')
    if (!validLatLon(lat, lon)) continue
    const ts = r['timestamp']
    const p: TrackPoint = {
      lat: lat!,
      lon: lon!,
      t: ts instanceof Date ? ts.getTime() : typeof ts === 'number' ? ts : time(ts),
      ele: val(r, 'enhanced_altitude', 'altitude')
    }
    const hr = val(r, 'heart_rate')
    if (hr !== null) p.hr = hr
    const speed = val(r, 'enhanced_speed', 'speed')
    if (speed !== null) p.speed = speed
    const cad = val(r, 'cadence')
    if (cad !== null) p.cad = cad
    const temp = val(r, 'temperature')
    if (temp !== null) p.temp = temp
    const power = val(r, 'power')
    if (power !== null) p.power = power
    points.push(p)
  }
  const waypoints: Waypoint[] = list(fit['course_points']).flatMap((cp) => {
    const lat = val(cp, 'position_lat')
    const lon = val(cp, 'position_long')
    return validLatLon(lat, lon) ? [{ lat: lat!, lon: lon!, name: typeof cp['name'] === 'string' ? cp['name'] : '' }] : []
  })
  const fileId = list(fit['file_ids'])[0] ?? list(fit['file_id'])[0]
  const maker = fileId ? [fileId['manufacturer'], fileId['product_name'] ?? fileId['garmin_product'] ?? fileId['product']].filter((s) => typeof s === 'string' && s).join(' ') : ''
  const course = list(fit['courses'])[0]
  return {
    name: course && typeof course['name'] === 'string' ? course['name'] : null,
    creator: maker || null,
    segments: [points],
    waypoints
  }
}

/** The KML inside a KMZ (a zip): `doc.kml`, else the first .kml file. */
export function kmlOfKmz(zip: Buffer): string {
  const entries = zipEntries(zip)
  const kml = entries.find((e) => e.name.toLowerCase() === 'doc.kml') ?? entries.find((e) => e.name.toLowerCase().endsWith('.kml'))
  if (!kml) throw new Error('no KML inside the KMZ')
  return kml.read().toString('utf8')
}

/** Entries of a zip file, read from its central directory (stored and deflated entries). */
function zipEntries(zip: Buffer): { name: string; read: () => Buffer }[] {
  // End of central directory: signature 0x06054b50, within the last 64 KB + 22 bytes.
  let eocd = -1
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('not a zip file')
  const count = zip.readUInt16LE(eocd + 10)
  let at = zip.readUInt32LE(eocd + 16)
  const out: { name: string; read: () => Buffer }[] = []
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error('broken zip directory')
    const method = zip.readUInt16LE(at + 10)
    const size = zip.readUInt32LE(at + 20)
    const nameLen = zip.readUInt16LE(at + 28)
    const extraLen = zip.readUInt16LE(at + 30)
    const commentLen = zip.readUInt16LE(at + 32)
    const local = zip.readUInt32LE(at + 42)
    const name = zip.subarray(at + 46, at + 46 + nameLen).toString('utf8')
    out.push({
      name,
      read: () => {
        const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
        const body = zip.subarray(start, start + size)
        if (method === 0) return Buffer.from(body)
        if (method === 8) return inflateRawSync(body)
        throw new Error(`zip method ${method} is not supported`)
      }
    })
    at += 46 + nameLen + extraLen + commentLen
  }
  return out
}
