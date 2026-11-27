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

describe('search history (tz.md, п. 5.3)', () => {
  it('the place gone to goes on top; again — moves up, not twice; at most 6 (one more than shown: the current place is not)', async () => {
    const { addRecentPlace, removeRecentPlace, validPlace } = await import('@shared/search')
    const a = { name: 'A', lat: 1, lon: 2 }
    const b = { name: 'B', lat: 3, lon: 4 }
    let list = addRecentPlace(addRecentPlace([], a), b)
    expect(list.map((p) => p.name)).toEqual(['B', 'A'])
    list = addRecentPlace(list, a)
    expect(list.map((p) => p.name)).toEqual(['A', 'B'])
    for (let i = 0; i < 12; i++) list = addRecentPlace(list, { name: `P${i}`, lat: i, lon: i })
    expect(list).toHaveLength(6)
    expect(removeRecentPlace(list, { name: 'P11', lat: 11, lon: 11 })).toHaveLength(5)
    expect(validPlace({ name: 'X', lat: 95, lon: 0 })).toBeNull()
    expect(validPlace({ name: 'X', lat: 5, lon: 0, bounds: [1, 2, 3, 4] })).toEqual({ name: 'X', lat: 5, lon: 0, bounds: [1, 2, 3, 4] })
  })
})

describe('favourite places (tz.md, п. 5.3)', () => {
  it('in the order added; added once; moved or renamed — keeps its place', async () => {
    const { addFavorite, removeFavorite, replaceFavorite, validFavorites } = await import('@shared/search')
    const w = { name: 'Paris', lat: 48.86, lon: 2.35 }
    const a = { name: 'amsterdam', lat: 52.37, lon: 4.9 }
    let list = addFavorite(addFavorite([], w), a)
    expect(list.map((p) => p.name)).toEqual(['Paris', 'amsterdam'])
    expect(addFavorite(list, w).map((p) => p.name)).toEqual(['Paris', 'amsterdam'])
    list = replaceFavorite(list, w, { name: 'Zoo', lat: 1, lon: 2 })
    expect(list.map((p) => p.name)).toEqual(['Zoo', 'amsterdam'])
    expect(removeFavorite(list, a).map((p) => p.name)).toEqual(['Zoo'])
    // From the state file: bad entries and repeats go, the rest in their order.
    expect(validFavorites([w, { name: '', lat: 1, lon: 1 }, a, w, 'x']).map((p) => p.name)).toEqual(['Paris', 'amsterdam'])
    expect(validFavorites(null)).toEqual([])
  })

  it('the name of a point from its address: street and city, else state and country', async () => {
    const { addressName } = await import('@shared/search')
    const a = { country: 'France', countryCode: 'FR', state: 'Île-de-France', city: 'Paris', location: 'Rue de Rivoli, 1' }
    expect(addressName(a)).toBe('Rue de Rivoli, 1, Paris')
    expect(addressName({ ...a, location: '', city: '' })).toBe('Île-de-France, France')
    expect(addressName({ ...a, location: '', city: '', state: '', country: '' })).toBeNull()
    expect(addressName(null)).toBeNull()
  })

  it('window actions of the places are checked', async () => {
    const { validWindowAction, placeMenuItems } = await import('@shared/ipc')
    expect(validWindowAction({ type: 'setFavorites', favorites: [{ name: 'B', lat: 1, lon: 1 }, { name: 'A', lat: 2, lon: 2 }, 5] })).toEqual({
      type: 'setFavorites',
      favorites: [{ name: 'B', lat: 1, lon: 1 }, { name: 'A', lat: 2, lon: 2 }]
    })
    expect(validWindowAction({ type: 'setFavorites', favorites: 'x' })).toBeNull()
    expect(validWindowAction({ type: 'placeMenu', kind: 'mark', x: 1, y: 2, lat: 3, lon: 4 })).toEqual({ type: 'placeMenu', kind: 'mark', x: 1, y: 2, lat: 3, lon: 4 })
    expect(validWindowAction({ type: 'placeMenu', kind: 'photo', x: 1, y: 2, lat: 3, lon: 4 })).toBeNull()
    expect(validWindowAction({ type: 'placeMenu', kind: 'mark', x: 1, y: 2, lat: 95, lon: 4 })).toBeNull()
    expect(placeMenuItems('mark')).toEqual(['copyCoords', 'openGoogleMaps', 'addFavorite', 'removeMark'])
    expect(placeMenuItems('favorite')).toEqual(['copyCoords', 'openGoogleMaps', 'rename', 'removeFavorite'])
  })
})
