import { describe, expect, it } from 'vitest'
import { exiftoolCandidates } from '@shared/exiftool-places'

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
