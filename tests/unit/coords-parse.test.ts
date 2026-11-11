import { describe, expect, it } from 'vitest'
import { clipboardText, parseCoords } from '@shared/coords-parse'

const near = (text: string, lat: number, lon: number): void => {
  const c = parseCoords(text)
  expect(c, text).not.toBeNull()
  expect(c!.lat, text).toBeCloseTo(lat, 5)
  expect(c!.lon, text).toBeCloseTo(lon, 5)
}

describe('parsing coordinates (tz.md, п. 4.12)', () => {
  it('decimal degrees', () => {
    near('49.84193, 24.03152', 49.84193, 24.03152)
    near('-33.8568 151.2153', -33.8568, 151.2153)
    near('49.84193,24.03152', 49.84193, 24.03152)
    near('49.84193;24.03152', 49.84193, 24.03152)
  })

  it('comma as the decimal mark when numbers are split by a space or semicolon', () => {
    near('49,84193 24,03152', 49.84193, 24.03152)
    near('49,84193; 24,03152', 49.84193, 24.03152)
  })

  it('an unclear comma is not accepted', () => {
    expect(parseCoords('49,84193, 24,03152')).toBeNull()
    expect(parseCoords('49,84193,24,03152')).toBeNull()
  })

  it('degrees-minutes-seconds and degrees-minutes', () => {
    near(`49°50'30.9"N 24°01'53.5"E`, 49 + 50 / 60 + 30.9 / 3600, 24 + 1 / 60 + 53.5 / 3600)
    near(`49°50.516'N 24°1.891'E`, 49 + 50.516 / 60, 24 + 1.891 / 60)
    near('N 49 50 30.9 E 24 1 53.5', 49 + 50 / 60 + 30.9 / 3600, 24 + 1 / 60 + 53.5 / 3600)
    near(`-33°51'24" 151°12'55"`, -(33 + 51 / 60 + 24 / 3600), 151 + 12 / 60 + 55 / 3600)
  })

  it('letters before or after, any case, Latin and Cyrillic; S and W are negative', () => {
    near('33.8568S 151.2153E', -33.8568, 151.2153)
    near('s 33.8568 e 151.2153', -33.8568, 151.2153)
    near('40.7 N, 74.0 W', 40.7, -74)
    near('49.84 С 24.03 В', 49.84, 24.03)
    near('ю 10 з 20', -10, -20)
    // Letters name the latitude themselves, whatever the order.
    near('24.03152 E 49.84193 N', 49.84193, 24.03152)
  })

  it('marks may be left out or be their variants', () => {
    near('49°50′30.9″N 24°01′53.5″E', 49 + 50 / 60 + 30.9 / 3600, 24 + 1 / 60 + 53.5 / 3600)
    near('49°50’30.9”N 24°01’53.5”E', 49 + 50 / 60 + 30.9 / 3600, 24 + 1 / 60 + 53.5 / 3600)
    near('49 50 30.9 N 24 1 53.5 E', 49 + 50 / 60 + 30.9 / 3600, 24 + 1 / 60 + 53.5 / 3600)
  })

  it('extra spaces, brackets and labels are ignored', () => {
    near('  (49.84193 ,   24.03152)  ', 49.84193, 24.03152)
    near('lat: 49.84193, lon: 24.03152', 49.84193, 24.03152)
    near('Широта: 49.84193; Долгота: 24.03152', 49.84193, 24.03152)
    near('[lat=49.84193 lng=24.03152]', 49.84193, 24.03152)
  })

  it('longitude first is swapped only when it cannot be latitude', () => {
    near('151.2153, -33.8568', -33.8568, 151.2153)
    near('24.03152, 49.84193', 24.03152, 49.84193)
  })

  it('out of range and other text are rejected', () => {
    for (const bad of [
      '',
      'hello',
      '49.84193',
      '1 2 3',
      '95, 200',
      '49.8 N 24.0 N',
      '49.8 N 24.0',
      `49°61'N 24°E`,
      '-49.8 N 24 E',
      'Lviv 49.84 24.03'
    ]) {
      expect(parseCoords(bad), bad).toBeNull()
    }
  })
})

describe('Ctrl+C of a photo (tz.md, п. 4.10)', () => {
  it('Ctrl+V reads back what Ctrl+C put into the clipboard', () => {
    for (const c of [
      { lat: 49.841914, lon: 24.031138 },
      { lat: -33.856812, lon: 151.215312 },
      { lat: 0, lon: -179.5 }
    ]) {
      expect(parseCoords(clipboardText(c))).toEqual(c)
    }
  })
})
