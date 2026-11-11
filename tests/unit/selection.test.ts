import { describe, expect, it } from 'vitest'
import type { LatLon, Photo } from '@shared/photo'
import { effectiveFilter, matchesFilter, toggleFilter, visibleIds } from '../../src/renderer/src/filter'
import { navigateShown } from '../../src/renderer/src/navigation'
import {
  clickSelect,
  dragSelection,
  EMPTY_SELECTION,
  restrictSelection,
  selectAll,
  single
} from '../../src/renderer/src/selection'

const ids = (s: { ids: ReadonlySet<number> }): number[] => [...s.ids].sort((a, b) => a - b)
const plain = { ctrl: false, shift: false }
const ctrl = { ctrl: true, shift: false }
const shift = { ctrl: false, shift: true }
const all = (n: number): number[] => Array.from({ length: n }, (_, i) => i)
const ORDER = all(12)

describe('selection in the strip (tz.md, п. 4.4)', () => {
  it('click selects one photo', () => {
    const s = clickSelect(clickSelect(EMPTY_SELECTION, 3, plain, ORDER), 5, plain, ORDER)
    expect(ids(s)).toEqual([5])
    expect(s.current).toBe(5)
  })

  it('Ctrl+click adds and removes', () => {
    let s = clickSelect(single(2), 5, ctrl, ORDER)
    expect(ids(s)).toEqual([2, 5])
    expect(s.current).toBe(5)
    s = clickSelect(s, 5, ctrl, ORDER)
    expect(ids(s)).toEqual([2])
    expect(s.current).toBe(2)
    // The last one stays (a photo is always selected).
    s = clickSelect(s, 2, ctrl, ORDER)
    expect(ids(s)).toEqual([2])
    expect(s.current).toBe(2)
  })

  it('Shift+click selects a range from the last clicked photo, in both directions', () => {
    let s = clickSelect(single(4), 7, shift, ORDER)
    expect(ids(s)).toEqual([4, 5, 6, 7])
    s = clickSelect(s, 2, shift, ORDER)
    expect(ids(s)).toEqual([2, 3, 4])
    expect(s.current).toBe(2)
  })

  it('Ctrl+Shift+click adds a range to the selection', () => {
    let s = clickSelect(single(0), 8, ctrl, ORDER)
    s = clickSelect(s, 10, { ctrl: true, shift: true }, ORDER)
    expect(ids(s)).toEqual([0, 8, 9, 10])
  })

  it('Shift+click with nothing selected selects one photo', () => {
    expect(ids(clickSelect(EMPTY_SELECTION, 3, shift, ORDER))).toEqual([3])
  })

  it('Ctrl+A selects all, the current photo stays', () => {
    const s = selectAll(single(2), all(5))
    expect(ids(s)).toEqual([0, 1, 2, 3, 4])
    expect(s.current).toBe(2)
    expect(selectAll(EMPTY_SELECTION, [])).toBe(EMPTY_SELECTION)
  })

  it('dragging a selected photo carries the selection, an unselected one only itself', () => {
    const s = clickSelect(single(1), 3, ctrl, ORDER)
    expect(ids(dragSelection(s, 1))).toEqual([1, 3])
    expect(dragSelection(s, 1).current).toBe(1)
    expect(ids(dragSelection(s, 2))).toEqual([2])
  })
})

function photo(id: number, coords: LatLon | null, modified = false): Photo {
  return { id, name: `${id}`, path: `${id}`, date: null, dateSource: 'file', coords, coordSource: null, modified }
}

describe('strip filter by the status bar counter (tz.md, п. 4.13)', () => {
  const C = { lat: 1, lon: 2 }
  const photos = [photo(0, null), photo(1, C), photo(2, null), photo(3, C, true), photo(4, C), photo(5, null)]

  it('all, with coordinates, modified', () => {
    expect(visibleIds(photos, 'all')).toEqual([0, 1, 2, 3, 4, 5])
    expect(visibleIds(photos, 'coords')).toEqual([1, 3, 4])
    expect(visibleIds(photos, 'noCoords')).toEqual([0, 2, 5])
    expect(visibleIds(photos, 'modified')).toEqual([3])
    expect(matchesFilter(photos[0]!, 'coords')).toBe(false)
  })

  it('a second click on the active filter switches it off', () => {
    expect(toggleFilter('all', 'coords')).toBe('coords')
    expect(toggleFilter('coords', 'coords')).toBe('all')
    expect(toggleFilter('coords', 'modified')).toBe('modified')
    expect(toggleFilter('all', 'all')).toBe('all')
  })

  it('hidden photos leave the selection; the current one moves to a shown photo', () => {
    const sel = { ids: new Set([0, 1, 3]), current: 0, anchor: 0 }
    const r = restrictSelection(sel, [1, 3, 4])
    expect(ids(r)).toEqual([1, 3])
    expect(r.current).toBe(3)
    expect(r.anchor).toBe(3)
    // Nothing hidden: the same selection object.
    expect(restrictSelection(sel, all(6))).toBe(sel)
  })

  it('a photo is always selected (п. 4.4): the first shown one when nothing selected is shown', () => {
    expect(restrictSelection(EMPTY_SELECTION, [2, 5])).toEqual(single(2))
    expect(restrictSelection(single(0), [2, 5])).toEqual(single(2))
    expect(restrictSelection(single(0), [])).toBe(EMPTY_SELECTION)
  })

  it('Ctrl+click does not deselect the last selected photo', () => {
    const s = single(4)
    expect(clickSelect(s, 4, ctrl, ORDER)).toBe(s)
  })

  it('an empty filter is not available: the active one falls back to "all"', () => {
    expect(effectiveFilter(photos, 'modified')).toBe('modified')
    const saved = photos.map((p) => ({ ...p, modified: false }))
    expect(effectiveFilter(saved, 'modified')).toBe('all')
    expect(effectiveFilter([], 'coords')).toBe('all')
    // All photos placed: "without coordinates" is empty and falls back to "all".
    expect(effectiveFilter(photos, 'noCoords')).toBe('noCoords')
    expect(effectiveFilter(photos.map((p) => ({ ...p, coords: { lat: 1, lon: 2 } })), 'noCoords')).toBe('all')
  })

  it('Shift+click and Ctrl+A take only shown photos', () => {
    const order = [1, 3, 4]
    expect(ids(clickSelect(single(1), 4, shift, order))).toEqual([1, 3, 4])
    expect(ids(selectAll(EMPTY_SELECTION, order))).toEqual([1, 3, 4])
    expect(selectAll(EMPTY_SELECTION, order).current).toBe(1)
  })

  it('arrows move over shown photos only (п. 4.4.1)', () => {
    const order = [1, 3, 4]
    expect(navigateShown('ArrowRight', 1, order)).toBe(3)
    expect(navigateShown('ArrowRight', 4, order)).toBe(4)
    expect(navigateShown('ArrowLeft', 3, order)).toBe(1)
    expect(navigateShown('ArrowRight', null, order)).toBe(1)
    // The current photo is hidden: as if nothing were selected.
    expect(navigateShown('ArrowLeft', 2, order)).toBe(4)
    expect(navigateShown('End', 1, order)).toBe(4)
    expect(navigateShown('Home', 4, [])).toBeNull()
  })
})
