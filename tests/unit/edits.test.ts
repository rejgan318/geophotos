import { describe, expect, it } from 'vitest'
import { assignAddress, assignAltitude, assignCoords, assignDirection, DIRECTION_KEEP_METERS, dropOnPhoto, isModified, normalizeCoords, pastePhotoData, photoCounts, photosAt, photosToSave } from '@shared/edits'
import { validSetCoords, validSetDirection } from '@shared/ipc'
import type { Address, FileMeta, LatLon, Photo } from '@shared/photo'

function photo(id: number, coords: LatLon | null, modified = false): Photo {
  return {
    id, name: `p${id}.jpg`, path: `C:\\f\\p${id}.jpg`, date: null, dateSource: 'file',
    coords, coordSource: coords ? 'exif' : null, address: null, altitude: null, modified
  }
}

const A = { lat: 49.84, lon: 24.03 }
const B = { lat: -33.8568, lon: 151.2153 }

describe('assigning coordinates (tz.md, пп. 4.5, 4.7)', () => {
  const photos = [photo(0, A), photo(1, null), photo(2, A), photo(3, B)]
  const file = photos.map((p) => ({ coords: p.coords, address: p.address, altitude: p.altitude }))

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

  it('Del removes coordinates: modified if the file had them, saved like any change (п. 6.6)', () => {
    const changed = assignCoords(photos, file, [0, 1, 3], null)
    // Photo 1 had no coordinates: nothing to remove.
    expect(changed.map((p) => [p.id, p.coords, p.modified])).toEqual([
      [0, null, true],
      [3, null, true]
    ])
    expect(photosToSave(changed).map((p) => p.id)).toEqual([0, 3])
    // Placing a removed photo back at its file point removes the mark.
    expect(assignCoords(changed, file, [0], A)[0]!.modified).toBe(false)
    expect(validSetCoords({ ids: [0], coords: null })).toBe(true)
  })

  it('the address goes with the old coordinates; a found address is a change too (пп. 5.5, 6.2)', () => {
    const LVIV: Address = { country: 'Україна', countryCode: 'UA', state: 'Львівська область', city: 'Львів', location: 'площа Ринок, 1' }
    const withAddress = [{ ...photo(0, A), address: LVIV }, photo(1, A)]
    const fileMeta = withAddress.map((p) => ({ coords: p.coords, address: p.address, altitude: p.altitude }))
    // Moving drops the address.
    const [moved] = assignCoords(withAddress, fileMeta, [0], B)
    expect(moved).toMatchObject({ coords: B, address: null, modified: true })
    // Back at the file point, but without the file's address: still modified.
    const [back] = assignCoords([moved!, withAddress[1]!], fileMeta, [0], A)
    expect(back).toMatchObject({ coords: A, address: null, modified: true })
    // The same address found again: no longer modified.
    expect(assignAddress([back!, withAddress[1]!], fileMeta, [0], LVIV)[0]!.modified).toBe(false)
    // A photo that had none gets one: modified; the same one again changes nothing.
    const [got] = assignAddress(withAddress, fileMeta, [1], LVIV)
    expect(got).toMatchObject({ address: LVIV, modified: true })
    expect(assignAddress([withAddress[0]!, got!], fileMeta, [1], LVIV)).toEqual([])
  })

  it('the altitude goes with the old coordinates too; a found altitude is a change (пп. 5.6, 6.2)', () => {
    const high = [{ ...photo(0, A), altitude: 290 }, photo(1, A)]
    const fileMeta = high.map((p) => ({ coords: p.coords, address: p.address, altitude: p.altitude }))
    expect(assignCoords(high, fileMeta, [0], B)[0]).toMatchObject({ altitude: null, modified: true })
    const [got] = assignAltitude(high, fileMeta, [1], 290)
    expect(got).toMatchObject({ altitude: 290, modified: true })
    // The same altitude again (to a centimetre): nothing changes.
    expect(assignAltitude([high[0]!, got!], fileMeta, [0, 1], 290.001)).toEqual([])
  })

  it('drop in the strip works both ways (п. 4.5)', () => {
    // photos: 0 A, 1 none, 2 A, 3 B
    // Onto a photo with coordinates: the dragged ones get them.
    expect(dropOnPhoto(photos, [1], 3)).toEqual({ ids: [1], coords: B })
    expect(dropOnPhoto(photos, [0, 1], 3)).toEqual({ ids: [0, 1], coords: B })
    // Onto a photo without coordinates: it gets the common coordinates of the dragged ones.
    expect(dropOnPhoto(photos, [0], 1)).toEqual({ ids: [1], coords: A })
    expect(dropOnPhoto(photos, [0, 2], 1)).toEqual({ ids: [1], coords: A })
    // Different points, or a dragged photo without coordinates: nothing to give.
    expect(dropOnPhoto(photos, [0, 3], 1)).toBeNull()
    expect(dropOnPhoto([...photos, photo(4, null)], [4], 1)).toBeNull()
    // Onto itself: nothing.
    expect(dropOnPhoto(photos, [3], 3)).toBeNull()
  })

  it('Ctrl+V of a copied photo: coordinates, address and altitude go together (п. 4.10)', () => {
    const LVIV: Address = { country: 'Україна', countryCode: 'UA', state: '', city: 'Львів', location: '' }
    // 0: elsewhere with its own address and altitude; 1: none; 2: already at A with other data.
    const list = [
      { ...photo(0, B), address: { ...LVIV, city: 'Sydney' }, altitude: 50 },
      photo(1, null),
      { ...photo(2, A), altitude: 999 }
    ]
    const meta = list.map((p) => ({ coords: p.coords, address: p.address, altitude: p.altitude }))
    const changed = pastePhotoData(list, meta, [0, 1, 2], A, LVIV, 290)
    expect(changed.map((p) => [p.id, p.coords, p.address?.city, p.altitude, p.modified])).toEqual([
      [0, A, 'Львів', 290, true],
      [1, A, 'Львів', 290, true],
      [2, A, 'Львів', 290, true]
    ])
    // Copied without address and altitude: the pasted photos have none either.
    const bare = pastePhotoData(list, meta, [2], A, null, null)
    expect(bare.map((p) => [p.id, p.address, p.altitude])).toEqual([[2, null, null]])
    expect(validSetCoords({ ids: [0], coords: A, copied: { address: LVIV, altitude: 290 } })).toBe(true)
    expect(validSetCoords({ ids: [0], coords: A, copied: { address: { city: 1 }, altitude: 290 } })).toBe(false)
    expect(validSetCoords({ ids: [0], coords: null, copied: { address: null, altitude: null } })).toBe(false)
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
    expect(photoCounts(photos)).toEqual({ total: 4, withCoords: 3, withoutCoords: 1, modified: 2 })
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

describe('the shooting direction (tz.md, п. 4.21)', () => {
  const withDir = (id: number, coords: LatLon | null, direction?: number): Photo => ({ ...photo(id, coords), ...(direction !== undefined ? { direction } : {}) })
  const fileOf = (ps: Photo[]): FileMeta[] => ps.map((p) => ({ coords: p.coords, address: null, altitude: null, ...(p.direction !== undefined ? { direction: p.direction } : {}) }))

  it('Alt+drag gives the direction to the photos with coordinates, whole degrees 0–359', () => {
    const photos = [withDir(0, A), withDir(1, null), withDir(2, A, 90)]
    const changed = assignDirection(photos, fileOf(photos), [0, 1, 2], 359.6)
    expect(changed.map((p) => [p.id, p.direction, p.modified])).toEqual([[0, 0, true], [2, 0, true]])
    // The same direction again: nothing changes.
    expect(assignDirection(photos, fileOf(photos), [2], 90.2)).toEqual([])
    expect(assignDirection(photos, fileOf(photos), [0], -90)[0]!.direction).toBe(270)
  })

  it('a move of up to 30 m keeps the direction, a longer one removes it', () => {
    const photos = [withDir(0, A, 45), withDir(1, A, 45), withDir(2, null)]
    const file = fileOf(photos)
    // 0.0002° of latitude is about 22 m; 0.0003° about 33 m.
    const [near] = assignCoords(photos, file, [0], { lat: A.lat + 0.0002, lon: A.lon })
    expect(near!.direction).toBe(45)
    const [far] = assignCoords(photos, file, [1], { lat: A.lat + 0.0003, lon: A.lon })
    expect('direction' in far!).toBe(false)
    expect(far!.modified).toBe(true)
    // Ctrl+Del removes it with the coordinates.
    expect('direction' in assignCoords(photos, file, [0], null)[0]!).toBe(false)
    expect(DIRECTION_KEEP_METERS).toBe(30)
  })

  it('a new direction is a change; back to the one in the file — not', () => {
    const photos = [withDir(0, A, 45)]
    const file = fileOf(photos)
    const [turned] = assignDirection(photos, file, [0], 100)
    expect(turned!.modified).toBe(true)
    expect(assignDirection([turned!], file, [0], 45)[0]!.modified).toBe(false)
    expect(isModified({ coords: A, address: null, altitude: null }, { coords: A, address: null, altitude: null, direction: 10 })).toBe(true)
  })

  it('the request from the window is checked', () => {
    expect(validSetDirection({ ids: [0, 3], direction: 271 })).toBe(true)
    expect(validSetDirection({ ids: [0], direction: Infinity })).toBe(false)
    expect(validSetDirection({ ids: [-1], direction: 5 })).toBe(false)
    expect(validSetDirection({ ids: [0] })).toBe(false)
  })
})
