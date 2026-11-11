import { describe, expect, it } from 'vitest'
import { fallbackSession, staleFallbackLogs } from '../../src/main/log-files'

describe('backup log files are limited (tz.md, п. 6.9)', () => {
  const names = [
    'main.log',
    'main.1.log',
    'main.4.log',
    'main-20261101-090000-100.log',
    'main-20261101-090000-100.1.log',
    'main-20261105-120000-7.log',
    'main-20261110-235959-42.log',
    'main-20261111-080000-5.log',
    'main-20261111-080000-12.log',
    'notes.txt',
    'main-broken.log'
  ]

  it('recognises backup files and their rotations', () => {
    expect(fallbackSession('main-20261101-090000-100.log')).toBe('20261101-090000-100')
    expect(fallbackSession('main-20261101-090000-100.3.log')).toBe('20261101-090000-100')
    expect(fallbackSession('MAIN-20261101-090000-100.LOG')).toBe('20261101-090000-100')
    expect(fallbackSession('main.log')).toBeNull()
    expect(fallbackSession('main.1.log')).toBeNull()
    expect(fallbackSession('main-broken.log')).toBeNull()
  })

  it('keeps the latest sessions, removes the older ones with their rotations', () => {
    expect(staleFallbackLogs(names, 3)).toEqual([
      'main-20261101-090000-100.log',
      'main-20261101-090000-100.1.log',
      'main-20261105-120000-7.log'
    ])
  })

  it('same second: the process id decides, as a number', () => {
    expect(staleFallbackLogs(names, 1)).not.toContain('main-20261111-080000-12.log')
    expect(staleFallbackLogs(names, 1)).toContain('main-20261111-080000-5.log')
  })

  it('main.log, its rotations and other files are never deleted', () => {
    const removed = staleFallbackLogs(names, 0)
    for (const n of ['main.log', 'main.1.log', 'main.4.log', 'notes.txt', 'main-broken.log']) {
      expect(removed).not.toContain(n)
    }
    expect(removed).toHaveLength(6)
  })

  it('nothing to remove when there are few sessions', () => {
    expect(staleFallbackLogs(names, 5)).toEqual([])
    expect(staleFallbackLogs(['main.log'], 1)).toEqual([])
  })
})
