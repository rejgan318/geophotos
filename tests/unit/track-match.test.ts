import { describe, expect, it } from 'vitest'
import { MAX_GAP_SECONDS, photoInstant, placeAt, placeOnTracks, wallToInstant } from '@shared/track-match'
import type { TrackData, TrackPoint } from '@shared/track'

const T0 = Date.parse('2024-08-12T06:00:00Z')
const pt = (sec: number, lat: number, lon: number): TrackPoint => ({ lat, lon, t: T0 + sec * 1000, ele: null })
const track: TrackData = {
  name: null,
  creator: null,
  waypoints: [],
  // A pause of 10 minutes between 120 s and 720 s; a second segment an hour later.
  segments: [[pt(0, 50, 20), pt(60, 50.001, 20), pt(120, 50.002, 20), pt(720, 50.01, 20)], [pt(3600, 51, 21), pt(3660, 51.001, 21)]]
}

describe('time of a photo as an instant (tz.md, п. 3.9.7)', () => {
  it('by the offset written in the photo', () => {
    expect(wallToInstant('2024-08-12 09:00:30', '+03:00', null)).toBe(T0 + 30000)
    expect(wallToInstant('2024-08-12 01:00:30', '-05:00', 'Europe/Riga')).toBe(T0 + 30000)
  })

  it('without one: as local time of the track zone, summer time included', () => {
    // Riga is UTC+3 in August, UTC+2 in January.
    expect(wallToInstant('2024-08-12 09:00:30', null, 'Europe/Riga')).toBe(T0 + 30000)
    expect(wallToInstant('2024-01-12 08:00:00', null, 'Europe/Riga')).toBe(Date.parse('2024-01-12T06:00:00Z'))
    expect(wallToInstant('2024-08-12 09:00:30', null, null)).toBeNull()
    expect(wallToInstant('2024-08-12 09:00:30', null, 'No/Such_Zone')).toBeNull()
  })

  it('a date of the file is not a time of shooting', () => {
    expect(photoInstant({ date: '2024-08-12 09:00:30', dateSource: 'file' }, 'Europe/Riga')).toBeNull()
    expect(photoInstant({ date: '2024-08-12 09:00:30', dateSource: 'name' }, 'Europe/Riga')).toBe(T0 + 30000)
    expect(photoInstant({ date: null, dateSource: 'shot' }, 'Europe/Riga')).toBeNull()
  })
})

describe('the place on a track at an instant', () => {
  it('a point, or between two in proportion to time', () => {
    expect(placeAt(track, T0 + 60000)).toEqual({ lat: 50.001, lon: 20 })
    const mid = placeAt(track, T0 + 90000)!
    expect(mid.lat).toBeCloseTo(50.0015, 9)
  })

  it('none in a pause of the recording, between segments or outside the track', () => {
    expect(MAX_GAP_SECONDS).toBe(300)
    expect(placeAt(track, T0 + 400000)).toBeNull()
    expect(placeAt(track, T0 + 2000000)).toBeNull()
    expect(placeAt(track, T0 - 1000)).toBeNull()
    expect(placeAt(track, T0 + 3630000)!.lon).toBe(21)
  })

  it('the first track in the strip that has the moment', () => {
    const other: TrackData = { ...track, segments: [[pt(0, 10, 10), pt(100, 10.1, 10)]] }
    const photo = { date: '2024-08-12 09:00:30', dateSource: 'shot' as const, offset: '+03:00' }
    expect(placeOnTracks(photo, [{ id: 7, data: other, zone: null }, { id: 3, data: track, zone: null }])).toEqual({ track: 7, at: { lat: 10.03, lon: 10 } })
    expect(placeOnTracks({ ...photo, offset: undefined }, [{ id: 3, data: track, zone: null }])).toBeNull()
  })
})
