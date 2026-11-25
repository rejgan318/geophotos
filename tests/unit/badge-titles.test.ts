import { describe, expect, it } from 'vitest'
import type { Photo } from '@shared/photo'
import { badgeTitles } from '../../src/renderer/src/describe'

const t = (key: string): string => `<${key}>`

function photo(extra: Partial<Photo> = {}): Photo {
  return {
    id: 0,
    name: 'IMG_0001.jpg',
    path: 'C:\\Demo\\IMG_0001.jpg',
    date: '2026-06-01 10:00:00',
    dateSource: 'shot',
    coords: null,
    coordSource: null,
    address: null,
    altitude: null,
    modified: false,
    ...extra
  }
}

describe('tooltips of the strip badges are their values (tz.md, п. 4.3)', () => {
  it('coordinates, address and altitude', () => {
    const p = photo({
      coords: { lat: 48.8584, lon: 2.2945 },
      address: { country: 'France', countryCode: 'FR', state: 'Île-de-France', city: 'Paris', location: 'Avenue Gustave Eiffel 5' },
      altitude: 35.4
    })
    expect(badgeTitles(p, t)).toEqual({
      coords: '48.858400, 2.294500',
      address: 'Avenue Gustave Eiffel 5, Paris, Île-de-France, France',
      altitude: '35 m'
    })
  })

  it('only the badges the photo has', () => {
    expect(badgeTitles(photo(), t)).toEqual({})
    expect(badgeTitles(photo({ altitude: 0 }), t)).toEqual({ altitude: '0 m' })
  })

  it('a video: its length; unknown length — just "video"', () => {
    expect(badgeTitles(photo({ video: { duration: 47 } }), t).video).toBe('0:47')
    expect(badgeTitles(photo({ video: { duration: null } }), t).video).toBe('<photo.video>')
  })
})
