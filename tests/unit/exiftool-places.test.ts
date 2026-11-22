import { describe, expect, it } from 'vitest'
import { exiftoolCandidates, exiftoolZipName, exiftoolZipUrl, parseExiftoolVersion, parseSha256 } from '@shared/exiftool-places'

describe('installing exiftool: what exiftool.org publishes (tz.md, п. 2.2)', () => {
  it('the version', () => {
    expect(parseExiftoolVersion('13.64\n')).toBe('13.64')
    expect(parseExiftoolVersion('<html>')).toBeNull()
    expect(parseExiftoolVersion('13.64; rm -rf')).toBeNull()
  })

  it('the zip and its checksum', () => {
    expect(exiftoolZipName('13.64')).toBe('exiftool-13.64_64.zip')
    expect(exiftoolZipUrl('13.64')).toBe('https://sourceforge.net/projects/exiftool/files/exiftool-13.64_64.zip/download')
    const sums = [
      'SHA2-256(exiftool-13.64_32.zip)= 965455b189bb6ce629a7ee1aa164511ceb49f5bf147aa21e316d802acf499a35',
      'SHA2-256(exiftool-13.64_64.zip)= 72C29C44D1E860EEBCAEFA71692D979AF9858FE9A6D7D791A5E7F1DAC77804AF',
      'SHA1(exiftool-13.64_64.zip)= f1f362586e35e08267beaaa8a4d08720ee5dd2fe'
    ].join('\r\n')
    expect(parseSha256(sums, 'exiftool-13.64_64.zip')).toBe('72c29c44d1e860eebcaefa71692d979af9858fe9a6d7d791a5e7f1dac77804af')
    expect(parseSha256(sums, 'exiftool-13.65_64.zip')).toBeNull()
  })
})

describe('usual places of exiftool (tz.md, п. 2.2)', () => {
  it('next to the program first, then installers and package managers', () => {
    const list = exiftoolCandidates(
      {
        LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local',
        ProgramFiles: 'C:\\Program Files',
        'ProgramFiles(x86)': 'C:\\Program Files (x86)',
        ProgramData: 'C:\\ProgramData',
        USERPROFILE: 'C:\\Users\\u',
        SystemRoot: 'C:\\Windows'
      },
      'D:\\GeoPhotos\\'
    )
    expect(list[0]).toBe('D:\\GeoPhotos\\exiftool.exe')
    expect(list).toContain('C:\\Users\\u\\AppData\\Local\\Programs\\ExifTool\\ExifTool.exe')
    expect(list).toContain('C:\\Program Files\\ExifTool\\ExifTool.exe')
    expect(list).toContain('C:\\ProgramData\\chocolatey\\bin\\exiftool.exe')
    expect(list).toContain('C:\\Users\\u\\scoop\\shims\\exiftool.exe')
    expect(list.at(-1)).toBe('C:\\Windows\\exiftool.exe')
  })

  it('missing variables are skipped, no duplicates', () => {
    expect(exiftoolCandidates({}, 'C:\\App')).toEqual(['C:\\App\\exiftool.exe', 'C:\\App\\exiftool\\exiftool.exe'])
    expect(exiftoolCandidates({ SystemRoot: 'C:\\App' }, 'C:\\App')).toHaveLength(2)
  })
})
