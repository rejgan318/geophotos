import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { FitBaseType, FitEncoder } from 'fit-file-parser'
import { kmlOfKmz, parseFit, parseGeoJson, parseGpx, parseKml, parseTcx, parseTrack } from '../../src/main/tracks'
import { isTrackFile, nearestPoint, trackInfo, trackPreviewSvg, trackStats, type TrackData, type TrackPoint } from '@shared/track'

const GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Amazfit Zepp" xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
  <metadata><name>Morning walk</name></metadata>
  <wpt lat="49.8400" lon="24.0300"><name>Café</name></wpt>
  <trk><name>Track</name>
    <trkseg>
      <trkpt lat="49.8400" lon="24.0300"><ele>290</ele><time>2024-05-01T07:00:00Z</time>
        <extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>120</gpxtpx:hr><gpxtpx:cad>80</gpxtpx:cad><gpxtpx:atemp>14</gpxtpx:atemp></gpxtpx:TrackPointExtension></extensions></trkpt>
      <trkpt lat="49.8410" lon="24.0300"><ele>300</ele><time>2024-05-01T07:01:00Z</time></trkpt>
    </trkseg>
    <trkseg>
      <trkpt lat="49.8500" lon="24.0400"><time>2024-05-01T08:00:00Z</time></trkpt>
    </trkseg>
  </trk>
</gpx>`

describe('tracks: formats (tz.md, п. 3.9.1)', () => {
  it('track files by extension', () => {
    for (const n of ['a.gpx', 'B.KML', 'c.kmz', 'd.fit', 'e.tcx', 'f.geojson']) expect(isTrackFile(n), n).toBe(true)
    for (const n of ['a.jpg', 'a.json', 'a.nmea', 'gpx']) expect(isTrackFile(n), n).toBe(false)
  })

  it('GPX: segments kept apart, times, altitude, sensors from extensions, waypoints, name, creator', () => {
    const t = parseGpx(GPX)
    expect(t.name).toBe('Morning walk')
    expect(t.creator).toBe('Amazfit Zepp')
    expect(t.segments.map((s) => s.length)).toEqual([2, 1])
    expect(t.segments[0]![0]).toEqual({ lat: 49.84, lon: 24.03, t: Date.parse('2024-05-01T07:00:00Z'), ele: 290, hr: 120, cad: 80, temp: 14 })
    expect(t.segments[1]![0]!.ele).toBeNull()
    expect(t.waypoints).toEqual([{ lat: 49.84, lon: 24.03, name: 'Café' }])
  })

  it('KML: LineString, gx:Track with times, Placemark points in folders', () => {
    const t = parseKml(`<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2"><Document><name>Trip</name>
      <Folder><Placemark><name>Line</name><LineString><coordinates>24.03,49.84,290 24.04,49.85,300</coordinates></LineString></Placemark>
      <Placemark><name>Peak</name><Point><coordinates>24.05,49.86,0</coordinates></Point></Placemark></Folder>
      <Placemark><gx:Track><when>2024-05-01T07:00:00Z</when><when>2024-05-01T07:01:00Z</when>
        <gx:coord>24.03 49.84 290</gx:coord><gx:coord>24.031 49.841 291</gx:coord></gx:Track></Placemark>
    </Document></kml>`)
    expect(t.name).toBe('Trip')
    expect(t.segments.map((s) => s.length)).toEqual([2, 2])
    const line = t.segments.find((s) => s[0]!.t === null)!
    const timed = t.segments.find((s) => s[0]!.t !== null)!
    expect(line[1]).toEqual({ lat: 49.85, lon: 24.04, t: null, ele: 300 })
    expect(timed[1]!.t).toBe(Date.parse('2024-05-01T07:01:00Z'))
    expect(t.waypoints).toEqual([{ lat: 49.86, lon: 24.05, name: 'Peak' }])
  })

  it('KMZ: the KML inside the zip (deflated)', async () => {
    const kml = Buffer.from('<kml><Document><Placemark><LineString><coordinates>24.03,49.84 24.04,49.85</coordinates></LineString></Placemark></Document></kml>')
    const zip = makeZip([{ name: 'files/icon.png', data: Buffer.from('png') }, { name: 'doc.kml', data: kml }])
    expect(kmlOfKmz(zip)).toBe(kml.toString())
    const t = await parseTrack('a.kmz', zip)
    expect(t.segments[0]).toHaveLength(2)
  })

  it('TCX: activity laps, heart rate, cadence, speed and watts from extensions, creator', () => {
    const t = parseTcx(`<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
      <Activities><Activity Sport="Biking"><Id>2024-05-01T07:00:00Z</Id>
        <Lap><Track><Trackpoint><Time>2024-05-01T07:00:00Z</Time><Position><LatitudeDegrees>49.84</LatitudeDegrees><LongitudeDegrees>24.03</LongitudeDegrees></Position>
          <AltitudeMeters>290.5</AltitudeMeters><HeartRateBpm><Value>130</Value></HeartRateBpm><Cadence>85</Cadence>
          <Extensions><ns3:TPX><ns3:Speed>5.5</ns3:Speed><ns3:Watts>210</ns3:Watts></ns3:TPX></Extensions></Trackpoint>
          <Trackpoint><Time>2024-05-01T07:00:05Z</Time></Trackpoint></Track></Lap>
        <Creator><Name>Edge 530</Name></Creator></Activity></Activities></TrainingCenterDatabase>`)
    expect(t.creator).toBe('Edge 530')
    expect(t.segments).toEqual([[{ lat: 49.84, lon: 24.03, t: Date.parse('2024-05-01T07:00:00Z'), ele: 290.5, hr: 130, cad: 85, speed: 5.5, power: 210 }]])
  })

  it('GeoJSON: lines with coordTimes, points as waypoints', () => {
    const t = parseGeoJson(JSON.stringify({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { name: 'Run', coordTimes: ['2024-05-01T07:00:00Z', '2024-05-01T07:00:10Z'] }, geometry: { type: 'LineString', coordinates: [[24.03, 49.84, 290], [24.031, 49.84]] } },
        { type: 'Feature', properties: { name: 'Start' }, geometry: { type: 'Point', coordinates: [24.03, 49.84] } }
      ]
    }))
    expect(t.name).toBe('Run')
    expect(t.segments[0]).toEqual([
      { lat: 49.84, lon: 24.03, t: Date.parse('2024-05-01T07:00:00Z'), ele: 290 },
      { lat: 49.84, lon: 24.031, t: Date.parse('2024-05-01T07:00:10Z'), ele: null }
    ])
    expect(t.waypoints).toEqual([{ lat: 49.84, lon: 24.03, name: 'Start' }])
  })

  it('FIT: records with position, time, altitude, heart rate, speed, cadence, power, temperature', async () => {
    const t = await parseFit(Buffer.from(makeFit()))
    expect(t.segments[0]).toHaveLength(2)
    const p = t.segments[0]![0]!
    expect(p.lat).toBeCloseTo(49.84, 5)
    expect(p.lon).toBeCloseTo(24.03, 5)
    expect(p.t).toBe(Date.parse('2024-05-01T07:00:00Z'))
    expect(p.ele).toBeCloseTo(290, 1)
    expect(p).toMatchObject({ hr: 140, cad: 90, power: 200, temp: 15 })
    expect(p.speed).toBeCloseTo(3.5, 3)
  })

  it('a file without points is an error', async () => {
    await expect(parseTrack('a.gpx', Buffer.from('<gpx><trk><trkseg/></trk></gpx>'))).rejects.toThrow()
    await expect(parseTrack('a.gpx', Buffer.from('not xml at all'))).rejects.toThrow()
  })
})

const at = (sec: number, lat: number, lon: number, extra: Partial<TrackPoint> = {}): TrackPoint => ({
  lat,
  lon,
  t: Date.parse('2024-05-01T07:00:00Z') + sec * 1000,
  ele: null,
  ...extra
})

describe('tracks: summary (tz.md, п. 3.9.6)', () => {
  // About 111 m per 0.001° of latitude.
  const walk: TrackData = {
    name: null,
    creator: null,
    waypoints: [],
    segments: [
      [
        at(0, 49.84, 24.03, { ele: 100, hr: 100 }),
        at(60, 49.8405, 24.03, { ele: 110, hr: 120 }),
        // A 5-minute stop near the same place.
        at(120, 49.8411, 24.03, { ele: 112 }),
        at(420, 49.8411, 24.03, { ele: 108 }),
        at(480, 49.842, 24.03, { ele: 102 })
      ]
    ]
  }

  it('distance, time, stops, moving time, speeds, climbing, heart rate', () => {
    const s = trackStats(walk)
    expect(s.distance).toBeCloseTo(222.4, 0)
    expect(s.duration).toBe(480)
    expect(s.stops).toEqual({ count: 1, seconds: 300 })
    expect(s.moving).toBe(180)
    expect(s.avgSpeed).toBeCloseTo(222.4 / 180, 2)
    expect(s.maxSpeed).toBeGreaterThan(1.5)
    // With the 5 m step: 100 → 110 up, 112 is noise, then down to 102.
    expect(s.ascent).toBe(10)
    expect(s.descent).toBe(8)
    expect([s.minEle, s.maxEle]).toEqual([100, 112])
    expect([s.hrAvg, s.hrMax]).toEqual([110, 120])
    expect(s.points).toBe(5)
  })

  it('a gap between segments is not time of the track', () => {
    const s = trackStats({ ...walk, segments: [walk.segments[0]!.slice(0, 2), [at(3600, 49.85, 24.03), at(3660, 49.851, 24.03)]] })
    expect(s.duration).toBe(120)
  })

  it('no times: no durations or speeds', () => {
    const s = trackStats({ ...walk, segments: [walk.segments[0]!.map((p) => ({ ...p, t: null }))] })
    expect([s.duration, s.moving, s.stops, s.avgSpeed, s.start]).toEqual([null, null, null, null, null])
    expect(trackInfo({ ...walk, segments: [walk.segments[0]!.map((p) => ({ ...p, t: null }))] }).duration).toBeNull()
  })

  it('the nearest point to a place', () => {
    expect(nearestPoint(walk, { lat: 49.8419, lon: 24.0301 })).toBe(walk.segments[0]![4])
  })

  it('the preview is an SVG with the line in the track colour', () => {
    const svg = trackPreviewSvg(walk, '#ff8800')
    expect(svg).toMatch(/^<svg /)
    expect(svg).toContain('stroke="#ff8800"')
    expect(svg).toContain('<polyline')
  })
})

/** A small zip (central directory and all) of deflated entries. */
function makeZip(files: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = []
  const dirs: Buffer[] = []
  let offset = 0
  for (const f of files) {
    const body = deflateRawSync(f.data)
    const name = Buffer.from(f.name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(f.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(0x02014b50, 0)
    dir.writeUInt16LE(8, 10)
    dir.writeUInt32LE(body.length, 20)
    dir.writeUInt32LE(f.data.length, 24)
    dir.writeUInt16LE(name.length, 28)
    dir.writeUInt32LE(offset, 42)
    locals.push(local, name, body)
    dirs.push(dir, name)
    offset += 30 + name.length + body.length
  }
  const dirBuf = Buffer.concat(dirs)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(dirBuf.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, dirBuf, end])
}

/** A FIT activity of two records (raw, already scaled values of the FIT profile). */
function makeFit(): Uint8Array {
  const semi = (deg: number): number => Math.round((deg * 2 ** 31) / 180)
  const enc = new FitEncoder()
  const start = new Date('2024-05-01T07:00:00Z')
  enc.writeMessage(0, [
    { number: 0, size: 1, baseType: FitBaseType.Enum, value: 4 },
    { number: 1, size: 2, baseType: FitBaseType.Uint16, value: 1 },
    { number: 4, size: 4, baseType: FitBaseType.Uint32, value: FitEncoder.toFitTimestamp(start) }
  ])
  for (const [i, lat] of [49.84, 49.841].entries()) {
    enc.writeMessage(20, [
      { number: 253, size: 4, baseType: FitBaseType.Uint32, value: FitEncoder.toFitTimestamp(new Date(start.getTime() + i * 10000)) },
      { number: 0, size: 4, baseType: FitBaseType.Sint32, value: semi(lat) },
      { number: 1, size: 4, baseType: FitBaseType.Sint32, value: semi(24.03) },
      { number: 2, size: 2, baseType: FitBaseType.Uint16, value: (290 + 500) * 5 },
      { number: 3, size: 1, baseType: FitBaseType.Uint8, value: 140 },
      { number: 4, size: 1, baseType: FitBaseType.Uint8, value: 90 },
      { number: 6, size: 2, baseType: FitBaseType.Uint16, value: 3500 },
      { number: 7, size: 2, baseType: FitBaseType.Uint16, value: 200 },
      { number: 13, size: 1, baseType: FitBaseType.Sint8, value: 15 }
    ], 1)
  }
  return enc.close()
}
