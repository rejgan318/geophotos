import { describe, expect, it } from 'vitest'
import { assignCoords, normalizeCoords, photoCounts, photosAt, photosToSave } from '@shared/edits'
import { validSetCoords } from '@shared/ipc'
import type { LatLon, Photo } from '@shared/photo'

function photo(id: number, coords: LatLon | null, modified = false): Photo {
  return {
    id, name: `p${id}.jpg`, path: `C:\\f\\p${id}.jpg`, date: null, dateSource: 'file',
    coords, coordSource: coords ? 'exif' : null, modified
  }
}

const A = { lat: 49.84, lon: 24.03 }
const B = { lat: -33.8568, lon: 151.2153 }

describe('assigning coordinates (tz.md, пп. 4.5, 4.7)', () => {
  const photos = [photo(0, A), photo(1, null), photo(2, A), photo(3, B)]
  const file = photos.map((p) => p.coords)

  it('all given photos get the point and are marked modified', () => {
    const changed = assignCoords(photos, file, [1, 3], A)
    expect(changed.map((p) => p.id)).toEqual([1, 3])
    for (const p of changed) {
      expect(p.coords).toEqual(A)
      expect(p.modified).toBe(true)
    }
    // The original list is not changed.
    expect(photos[1]!.coords).toBeNull()
  })

  it('photos already at the point are not changed', () => {
    expect(assignCoords(photos, file, [0, 2], A)).toEqual([])
  })

  it('moving a photo back to its file coordinates removes the mark', () => {
    const moved = [...photos]
    moved[3] = { ...photo(3, A), modified: true }
    const [back] = assignCoords(moved, file, [3], B)
    expect(back!.modified).toBe(false)
  })

  it('unknown ids and duplicates are ignored', () => {
    expect(assignCoords(photos, file, [1, 1, 99], B).map((p) => p.id)).toEqual([1])
  })

  it('coordinates are rounded and the longitude wrapped', () => {
    expect(normalizeCoords({ lat: 10.123456789, lon: 190 })).toEqual({ lat: 10.1234568, lon: -170 })
    expect(normalizeCoords({ lat: 0, lon: -200 })).toEqual({ lat: 0, lon: 160 })
    expect(normalizeCoords({ lat: 0, lon: 180 })).toEqual({ lat: 0, lon: 180 })
    expect(normalizeCoords({ lat: 0, lon: -180 })).toEqual({ lat: 0, lon: -180 })
  })

  it('a marker moves all photos at exactly its point', () => {
    expect(photosAt(photos, A)).toEqual([0, 2])
    expect(photosAt(photos, { lat: 49.84, lon: 24.0300001 })).toEqual([])
  })
})

describe('what is saved and counted', () => {
  const photos = [photo(0, A, true), photo(1, null), photo(2, B, true), photo(3, B)]

  it('"Save" takes all modified photos, "Save Selected" only the selected ones (п. 6.1)', () => {
    expect(photosToSave(photos).map((p) => p.id)).toEqual([0, 2])
    expect(photosToSave(photos, new Set([2, 3])).map((p) => p.id)).toEqual([2])
    expect(photosToSave(photos, new Set([1, 3]))).toEqual([])
  })

  it('status bar counter (п. 4.13)', () => {
    expect(photoCounts(photos)).toEqual({ total: 4, withCoords: 3, modified: 2 })
  })
})

describe('requests from the window are checked', () => {
  it('valid and invalid requests', () => {
    expect(validSetCoords({ ids: [0, 2], coords: A })).toBe(true)
    expect(validSetCoords({ ids: [-1], coords: A })).toBe(false)
    expect(validSetCoords({ ids: [1.5], coords: A })).toBe(false)
    expect(validSetCoords({ ids: [0], coords: { lat: 91, lon: 0 } })).toBe(false)
    expect(validSetCoords({ ids: [0], coords: { lat: NaN, lon: 0 } })).toBe(false)
    expect(validSetCoords({ ids: 'x', coords: A })).toBe(false)
    expect(validSetCoords(null)).toBe(false)
  })
})
