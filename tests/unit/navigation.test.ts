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
    expect(['ArrowLeft', 'ArrowRight', 'Home', 'End'].every(isNavKey)).toBe(true)
    expect(isNavKey('ArrowUp')).toBe(false)
    expect(isNavKey('a')).toBe(false)
  })
})
