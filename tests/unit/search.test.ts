import { describe, expect, it } from 'vitest'
import { parsePlaces, searchUrl, waitBeforeRequest } from '@shared/search'

describe('place search (tz.md, п. 5.3)', () => {
  it('request address from the configured service', () => {
    expect(searchUrl('https://nominatim.openstreetmap.org/', 'Львів, площа Ринок')).toBe(
      'https://nominatim.openstreetmap.org/search?q=%D0%9B%D1%8C%D0%B2%D1%96%D0%B2%2C+%D0%BF%D0%BB%D0%BE%D1%89%D0%B0+%D0%A0%D0%B8%D0%BD%D0%BE%D0%BA&format=jsonv2&limit=10'
    )
  })

  it('Nominatim answer: name, point, bounds as south-west-north-east', () => {
    const places = parsePlaces([
      {
        display_name: 'Ринок, Львів, Україна',
        lat: '49.8418',
        lon: '24.0316',
        boundingbox: ['49.8410', '49.8425', '24.0305', '24.0325']
      },
      { display_name: 'no bounds', lat: '-33.85', lon: '151.21' },
      { display_name: 'broken', lat: 'x', lon: '1' },
      { display_name: 'out of range', lat: '95', lon: '1' }
    ])
    expect(places).toEqual([
      { name: 'Ринок, Львів, Україна', lat: 49.8418, lon: 24.0316, bounds: [49.841, 24.0305, 49.8425, 24.0325] },
      { name: 'no bounds', lat: -33.85, lon: 151.21 }
    ])
    expect(parsePlaces({ error: 'x' })).toEqual([])
  })

  it('at most one request per second', () => {
    expect(waitBeforeRequest(null, 5000)).toBe(0)
    expect(waitBeforeRequest(5000, 5300)).toBe(700)
    expect(waitBeforeRequest(5000, 6500)).toBe(0)
  })
})
