import { describe, expect, it } from 'vitest'
import { isNewer, latestVersion, releasePageUrl } from '@shared/updates'

describe('checking for updates (tz.md, п. 2.5)', () => {
  it('reads the version of latest.yml', () => {
    const yml = [
      'version: 0.30.0',
      'files:',
      '  - url: GeoPhotos-Setup-0.30.0.exe',
      '    sha512: abc==',
      '    size: 123',
      "releaseDate: '2026-11-26T10:00:00.000Z'"
    ].join('\n')
    expect(latestVersion(yml)).toBe('0.30.0')
    expect(latestVersion("version: '1.2.3'\n")).toBe('1.2.3')
    expect(latestVersion('files: []\n')).toBeNull()
    expect(latestVersion('<html>Not Found</html>')).toBeNull()
    // A version line further down, not the files' ones.
    expect(latestVersion('path: x\nversion: 0.31.2\n')).toBe('0.31.2')
  })

  it('compares versions by numbers, not as text', () => {
    expect(isNewer('0.30.0', '0.29.0')).toBe(true)
    expect(isNewer('0.29.0', '0.29.0')).toBe(false)
    expect(isNewer('0.28.9', '0.29.0')).toBe(false)
    expect(isNewer('0.100.0', '0.99.0')).toBe(true)
    expect(isNewer('1.0.0', '0.99.99')).toBe(true)
    expect(isNewer('0.29.1', '0.29.0')).toBe(true)
    // A release is newer than a test build of the same numbers, not the other way round.
    expect(isNewer('0.30.0', '0.30.0-test')).toBe(true)
    expect(isNewer('0.30.0-test', '0.30.0')).toBe(false)
    expect(isNewer('garbage', '0.29.0')).toBe(false)
  })

  it('links the release page of a version', () => {
    expect(releasePageUrl('0.30.0')).toBe('https://github.com/rejgan318/geophotos/releases/tag/v0.30.0')
  })
})
