import { describe, expect, it } from 'vitest'
import { parseAddress, pointKey, pointsWithoutAddress, reverseUrl } from '@shared/geocode'
import type { LatLon, Photo } from '@shared/photo'

describe('address by coordinates (tz.md, п. 5.5)', () => {
  it('request: the point, details, the interface language first', () => {
    const url = new URL(reverseUrl('https://nominatim.openstreetmap.org/', { lat: 49.8419, lon: 24.0315 }, 'ru'))
    expect(url.origin + url.pathname).toBe('https://nominatim.openstreetmap.org/reverse')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      lat: '49.8419',
      lon: '24.0315',
      format: 'jsonv2',
      zoom: '18',
      addressdetails: '1',
      'accept-language': 'ru,en'
    })
    expect(new URL(reverseUrl('https://x.org', { lat: 0, lon: 0 }, 'en')).searchParams.get('accept-language')).toBe('en')
  })

  it('answer: country, code, state, city, street with house number', () => {
    expect(
      parseAddress({
        address: {
          house_number: '1',
          road: 'площа Ринок',
          city: 'Львів',
          state: 'Львівська область',
          country: 'Україна',
          country_code: 'ua'
        }
      })
    ).toEqual({ country: 'Україна', countryCode: 'UA', state: 'Львівська область', city: 'Львів', location: 'площа Ринок, 1' })
  })

  it('a village instead of a city, a street without a number, no state', () => {
    expect(parseAddress({ address: { village: 'Тустань', road: 'Шевченка', country: 'Україна', country_code: 'ua' } })).toEqual({
      country: 'Україна',
      countryCode: 'UA',
      state: '',
      city: 'Тустань',
      location: 'Шевченка'
    })
  })

  it('no address (the sea) or an error: null', () => {
    expect(parseAddress({ error: 'Unable to geocode' })).toBeNull()
    expect(parseAddress({ address: {} })).toBeNull()
    expect(parseAddress(null)).toBeNull()
  })

  it('points to ask: one per point, without those that have an address or got no answer', () => {
    const A = { lat: 1, lon: 2 }
    const B = { lat: 3, lon: 4 }
    const photo = (id: number, coords: LatLon | null, address = false): Photo => ({
      id, name: `${id}`, path: `${id}`, date: null, dateSource: 'file', coords, coordSource: null,
      address: address ? { country: 'X', countryCode: '', state: '', city: '', location: '' } : null, modified: false
    })
    const photos = [photo(0, A), photo(1, A), photo(2, null), photo(3, B, true), photo(4, B)]
    expect([...pointsWithoutAddress(photos, new Set()).values()]).toEqual([A, B])
    expect([...pointsWithoutAddress(photos, new Set([pointKey(A)])).values()]).toEqual([B])
  })
})
