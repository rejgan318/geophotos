import { describe, expect, it } from 'vitest'
import { fallbackSession, oldNamedLogs, staleFallbackLogs } from '../../src/main/log-files'

describe('backup log files are limited (tz.md, п. 6.9)', () => {
  const names = [
    'geophotos.log',
    'geophotos.1.log',
    'geophotos.4.log',
    'geophotos-20261101-090000-100.log',
    'geophotos-20261101-090000-100.1.log',
    'geophotos-20261105-120000-7.log',
    'geophotos-20261110-235959-42.log',
    'geophotos-20261111-080000-5.log',
    'geophotos-20261111-080000-12.log',
    'notes.txt',
    'geophotos-broken.log'
  ]

  it('recognises backup files and their rotations', () => {
    expect(fallbackSession('geophotos-20261101-090000-100.log')).toBe('20261101-090000-100')
    expect(fallbackSession('geophotos-20261101-090000-100.3.log')).toBe('20261101-090000-100')
    expect(fallbackSession('GEOPHOTOS-20261101-090000-100.LOG')).toBe('20261101-090000-100')
    expect(fallbackSession('geophotos.log')).toBeNull()
    expect(fallbackSession('geophotos.1.log')).toBeNull()
    expect(fallbackSession('geophotos-broken.log')).toBeNull()
  })

  it('keeps the latest sessions, removes the older ones with their rotations', () => {
    expect(staleFallbackLogs(names, 3)).toEqual([
      'geophotos-20261101-090000-100.log',
      'geophotos-20261101-090000-100.1.log',
      'geophotos-20261105-120000-7.log'
    ])
  })

  it('same second: the process id decides, as a number', () => {
    expect(staleFallbackLogs(names, 1)).not.toContain('geophotos-20261111-080000-12.log')
    expect(staleFallbackLogs(names, 1)).toContain('geophotos-20261111-080000-5.log')
  })

  it('geophotos.log, its rotations and other files are never deleted', () => {
    const removed = staleFallbackLogs(names, 0)
    for (const n of ['geophotos.log', 'geophotos.1.log', 'geophotos.4.log', 'notes.txt', 'geophotos-broken.log']) {
      expect(removed).not.toContain(n)
    }
    expect(removed).toHaveLength(6)
  })

  it('nothing to remove when there are few sessions', () => {
    expect(staleFallbackLogs(names, 5)).toEqual([])
    expect(staleFallbackLogs(['geophotos.log'], 1)).toEqual([])
  })
})

describe('the log was main.log before 0.15.0', () => {
  it('files with the old name are found for removal, nothing else', () => {
    const names = [
      'main.log',
      'main.1.log',
      'main-20261101-090000-100.log',
      'main-20261101-090000-100.2.log',
      'geophotos.log',
      'geophotos-20261111-080000-5.log',
      'main-notes.log',
      'domain.log',
      'main.txt'
    ]
    expect(oldNamedLogs(names)).toEqual(['main.log', 'main.1.log', 'main-20261101-090000-100.log', 'main-20261101-090000-100.2.log'])
  })
})
