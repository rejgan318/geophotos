import { describe, expect, it } from 'vitest'
import { RetryBook } from '@shared/retry'

describe('points asked again (tz.md, пп. 5.5, 5.6)', () => {
  it('no answer: asked again later and later, given up after the last try', () => {
    const book = new RetryBook([10, 100])
    book.failed('a', 0)
    expect(book.blocked(5)).toEqual(new Set(['a']))
    expect(book.waiting(5)).toEqual(new Set(['a']))
    expect(book.nextAt(5)).toBe(10)
    // Its time has come: it may be asked again.
    expect(book.blocked(10)).toEqual(new Set())
    book.failed('a', 10)
    expect(book.nextAt(10)).toBe(110)
    book.failed('a', 110)
    // Three failures with two delays: given up.
    expect(book.isFinal('a')).toBe(true)
    expect(book.blocked(1_000_000)).toEqual(new Set(['a']))
    expect(book.waiting(1_000_000)).toEqual(new Set())
    expect(book.nextAt(1_000_000)).toBeNull()
  })

  it('nothing at the point: never again; a later answer clears the point', () => {
    const book = new RetryBook([10])
    book.nothing('sea')
    expect(book.blocked(0)).toEqual(new Set(['sea']))
    expect(book.waiting(0)).toEqual(new Set())
    book.failed('b', 0)
    book.done('b')
    expect(book.blocked(0)).toEqual(new Set(['sea']))
    book.clear()
    expect(book.blocked(0)).toEqual(new Set())
  })
})
