import { describe, expect, it } from 'vitest'
import type { Photo } from '@shared/photo'
import { UndoHistory } from '@shared/undo'

const photo = (id: number, lat: number | null): Photo => ({
  id,
  name: `p${id}.jpg`,
  path: `D:\\p${id}.jpg`,
  date: null,
  dateSource: 'file',
  coords: lat === null ? null : { lat, lon: 10 },
  coordSource: lat === null ? null : 'exif',
  address: null,
  altitude: null,
  modified: false
})

describe('Undo and Redo of coordinate changes (tz.md, п. 6.6)', () => {
  it('a step puts back how the photos were; Redo puts the change back', () => {
    const h = new UndoHistory()
    const before = [photo(0, 1), photo(1, null)]
    h.record('place', before)
    const after = [photo(0, 5), photo(1, 5)]
    expect(h.next().undo).toEqual({ kind: 'place', count: 2 })
    const step = h.undo(after)!
    expect(step.states.map((s) => s.coords?.lat ?? null)).toEqual([1, null])
    expect(h.next()).toEqual({ undo: null, redo: { kind: 'place', count: 2 } })
    const again = h.redo(before)!
    expect(again.states.map((s) => s.coords?.lat)).toEqual([5, 5])
    expect(h.next().undo).toEqual({ kind: 'place', count: 2 })
  })

  it('a new change drops Redo', () => {
    const h = new UndoHistory()
    h.record('place', [photo(0, 1)])
    h.undo([photo(0, 2)])
    h.record('clear', [photo(0, 1)])
    expect(h.next().redo).toBeNull()
    expect(h.next().undo?.kind).toBe('clear')
  })

  it('photos of one drop onto a track are one step', () => {
    const h = new UndoHistory()
    h.record('track', [photo(0, null)], 7)
    h.record('track', [photo(1, null)], 7)
    h.record('track', [photo(0, 3)], 7)
    expect(h.next().undo).toEqual({ kind: 'track', count: 2 })
    const step = h.undo([photo(0, 4), photo(1, 4)])!
    expect(step.states.map((s) => s.coords)).toEqual([null, null])
  })

  it('nothing to undo; clear empties both', () => {
    const h = new UndoHistory()
    expect(h.undo([])).toBeNull()
    h.record('paste', [photo(0, 1)])
    h.clear()
    expect(h.next()).toEqual({ undo: null, redo: null })
  })
})

describe('Undo and Redo of the favourite places (tz.md, пп. 5.3, 6.6)', () => {
  it('a step puts back the whole list; it lives in the same history as the photos', () => {
    const h = new UndoHistory()
    const a = { name: 'A', lat: 1, lon: 1 }
    const b = { name: 'B', lat: 2, lon: 2 }
    h.record('place', [photo(0, 1)])
    h.recordFavorites([a])
    const step = h.undo([photo(0, 5)], [a, b])!
    expect(step.kind).toBe('favorites')
    expect(step.favorites).toEqual([a])
    const again = h.redo([photo(0, 5)], [a])!
    expect(again.favorites).toEqual([a, b])
    h.undo([photo(0, 5)], [a, b])
    // The photo step under it is next.
    expect(h.undo([photo(0, 5)], [a])!.states[0]!.coords?.lat).toBe(1)
    h.clear()
    expect(h.next()).toEqual({ undo: null, redo: null })
  })
})

describe('Undo of the shooting direction (tz.md, пп. 4.21, 6.6)', () => {
  it('a step keeps the direction a photo had, and that it had none', () => {
    const before: Photo = { id: 0, name: 'a.jpg', path: 'a.jpg', date: null, dateSource: 'file', coords: { lat: 1, lon: 2 }, coordSource: 'exif', address: null, altitude: null, modified: false }
    const h = new UndoHistory()
    h.record('direction', [before, { ...before, id: 1, direction: 30 }])
    const step = h.undo([{ ...before, direction: 90 }, { ...before, id: 1, direction: 90 }])!
    expect(step.kind).toBe('direction')
    expect('direction' in step.states[0]!).toBe(false)
    expect(step.states[1]!.direction).toBe(30)
  })
})
