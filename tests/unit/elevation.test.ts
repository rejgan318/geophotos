import { describe, expect, it } from 'vitest'
import { elevationUrl, parseElevations, pointsWithoutAltitude } from '@shared/elevation'
import { pointKey } from '@shared/geocode'
import type { LatLon, Photo } from '@shared/photo'

describe('altitude by coordinates (tz.md, п. 5.6)', () => {
  it('request: all points at once, latitudes and longitudes as lists', () => {
    expect(elevationUrl('https://api.open-meteo.com/v1/elevation/', [{ lat: 49.8419, lon: 24.0315 }, { lat: -33.5, lon: 151 }])).toBe(
      'https://api.open-meteo.com/v1/elevation?latitude=49.841900,-33.500000&longitude=24.031500,151.000000'
    )
  })

  it('answer: one altitude per point; a broken answer is no answer', () => {
    expect(parseElevations({ elevation: [290, -430.5, null] }, 3)).toEqual([290, -430.5, null])
    expect(parseElevations({ elevation: [290] }, 2)).toBeNull()
    expect(parseElevations({ error: true, reason: 'x' }, 1)).toBeNull()
  })

  it('points to ask: one per point, without those that have an altitude or got no answer', () => {
    const A = { lat: 1, lon: 2 }
    const B = { lat: 3, lon: 4 }
    const photo = (id: number, coords: LatLon | null, altitude: number | null = null): Photo => ({
      id, name: `${id}`, path: `${id}`, date: null, dateSource: 'file', coords, coordSource: null,
      address: null, altitude, modified: false
    })
    const photos = [photo(0, A), photo(1, A), photo(2, null), photo(3, B, 0), photo(4, B)]
    // An altitude of 0 (the sea shore) is an altitude.
    expect([...pointsWithoutAltitude(photos, new Set()).values()]).toEqual([A, B])
    expect([...pointsWithoutAltitude(photos, new Set([pointKey(A)])).values()]).toEqual([B])
  })
})
