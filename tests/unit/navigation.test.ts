import { describe, expect, it } from 'vitest'
import { isNavKey, navigate } from '../../src/renderer/src/navigation'

describe('keyboard navigation in the strip (tz.md, п. 4.4.1)', () => {
  it('→ and ← move by one, without wrap-around', () => {
    expect(navigate('ArrowRight', 3, 10)).toBe(4)
    expect(navigate('ArrowLeft', 3, 10)).toBe(2)
    expect(navigate('ArrowRight', 9, 10)).toBe(9)
    expect(navigate('ArrowLeft', 0, 10)).toBe(0)
  })

  it('nothing selected: → selects the first, ← the last', () => {
    expect(navigate('ArrowRight', null, 10)).toBe(0)
    expect(navigate('ArrowLeft', null, 10)).toBe(9)
  })

  it('Home and End', () => {
    expect(navigate('Home', 5, 10)).toBe(0)
    expect(navigate('End', null, 10)).toBe(9)
  })

  it('no photos: nothing to select', () => {
    expect(navigate('ArrowRight', null, 0)).toBeNull()
  })

  it('only these keys navigate', () => {
    expect(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].every(isNavKey)).toBe(true)
    expect(['PageUp', 'PageDown'].every(isNavKey)).toBe(true)
    expect(isNavKey('Insert')).toBe(false)
    expect(isNavKey('a')).toBe(false)
  })
})

describe('↑ ↓ in the strip on the left and in the grid (tz.md, п. 4.17)', () => {
  it('the strip at the bottom: ↑ ↓ do nothing', () => {
    expect(navigate('ArrowUp', 3, 10)).toBeNull()
    expect(navigate('ArrowDown', 3, 10, 0)).toBeNull()
  })

  it('the strip on the left: ↑ ↓ are the previous and next photo', () => {
    expect(navigate('ArrowUp', 3, 10, 1)).toBe(2)
    expect(navigate('ArrowDown', 3, 10, 1)).toBe(4)
    expect(navigate('ArrowUp', 0, 10, 1)).toBe(0)
    expect(navigate('ArrowDown', 9, 10, 1)).toBe(9)
  })

  it('the grid: ↑ ↓ go a row up and down; ← → stay the neighbours', () => {
    // 4 columns, 10 photos: rows 0–3, 4–7, 8–9.
    expect(navigate('ArrowDown', 1, 10, 4)).toBe(5)
    expect(navigate('ArrowUp', 5, 10, 4)).toBe(1)
    expect(navigate('ArrowRight', 3, 10, 4)).toBe(4)
  })

  it('the grid: no row above — stays; nothing below — the last photo', () => {
    expect(navigate('ArrowUp', 2, 10, 4)).toBe(2)
    expect(navigate('ArrowDown', 6, 10, 4)).toBe(9)
    expect(navigate('ArrowDown', 9, 10, 4)).toBe(9)
  })

  it('nothing selected: ↓ the first, ↑ the last', () => {
    expect(navigate('ArrowDown', null, 10, 4)).toBe(0)
    expect(navigate('ArrowUp', null, 10, 4)).toBe(9)
  })
})

describe('PageUp / PageDown (tz.md, п. 4.4.1)', () => {
  it('move the selection by a screen of photos; beyond the ends — the first or the last', () => {
    expect(navigate('PageDown', 3, 100, 0, 10)).toBe(13)
    expect(navigate('PageUp', 13, 100, 0, 10)).toBe(3)
    expect(navigate('PageDown', 95, 100, 0, 10)).toBe(99)
    expect(navigate('PageUp', 4, 100, 0, 10)).toBe(0)
  })

  it('the grid: a screen of rows, the same column', () => {
    // 8 columns, 3 rows on screen: a page is 24 photos.
    expect(navigate('PageDown', 2, 100, 8, 24)).toBe(26)
    expect(navigate('PageUp', 26, 100, 8, 24)).toBe(2)
  })

  it('nothing selected: PageDown the first, PageUp the last', () => {
    expect(navigate('PageDown', null, 100, 0, 10)).toBe(0)
    expect(navigate('PageUp', null, 100, 0, 10)).toBe(99)
  })
})
