import { describe, expect, it } from 'vitest'
import { pathFromArgv } from '@shared/argv'
import { baseNameOf, formatOf, isSidecar, isSupported, sidecarNameOf, sidecarOwners } from '@shared/formats'
import { parseThumbUrl, thumbUrl } from '@shared/ipc'

describe('formats (tz.md, п. 3.3)', () => {
  it('ordinary formats and DNG are written into the file', () => {
    for (const n of ['a.jpg', 'a.JPEG', 'a.heic', 'a.HIF', 'a.png', 'a.webp', 'a.avif', 'a.tif', 'a.TIFF', 'a.dng']) {
      expect(formatOf(n)?.write, n).toBe('file')
    }
  })

  it('other RAW formats are written to the XMP sidecar', () => {
    for (const n of ['a.CR2', 'a.cr3', 'a.nef', 'a.arw', 'a.raf', 'a.orf', 'a.rw2', 'a.pef']) {
      expect(formatOf(n)?.write, n).toBe('xmp')
    }
  })

  it('previews: image, embedded, heic', () => {
    expect(formatOf('a.png')?.preview).toBe('image')
    expect(formatOf('a.tiff')?.preview).toBe('image')
    expect(formatOf('a.heic')?.preview).toBe('heic')
    expect(formatOf('a.dng')?.preview).toBe('embedded')
    expect(formatOf('a.cr2')?.preview).toBe('embedded')
  })

  it('videos (п. 3.3.6): the QuickTime family into the file, the rest to the sidecar', () => {
    for (const n of ['a.MOV', 'a.mp4', 'a.m4v', 'a.3gp', 'a.qt']) {
      expect(formatOf(n), n).toMatchObject({ write: 'file', video: true, raw: false, preview: 'system', track: true })
    }
    for (const n of ['a.AVI', 'a.mpg', 'a.mpeg', 'a.mkv', 'a.wmv', 'a.vob', 'a.flv']) {
      expect(formatOf(n), n).toMatchObject({ write: 'xmp', video: true, raw: false, preview: 'system', track: false })
    }
    // AVCHD streams may carry a GPS track (Sony, Panasonic).
    expect(formatOf('a.MTS')).toMatchObject({ write: 'xmp', track: true })
    expect(formatOf('a.m2ts')).toMatchObject({ write: 'xmp', track: true })
    expect(formatOf('a.jpg')).toMatchObject({ video: false, track: false })
  })

  it('unsupported files and sidecars', () => {
    expect(isSupported('a.mp3')).toBe(false)
    expect(isSupported('a.mod')).toBe(false)
    expect(isSupported('a.xmp')).toBe(false)
    expect(isSupported('noext')).toBe(false)
    expect(isSidecar('a.XMP')).toBe(true)
  })

  it('who owns the sidecar (п. 3.7): RAW, else a video written to the sidecar, else everyone', () => {
    expect(sidecarOwners(['IMG_1.CR2', 'IMG_1.JPG', 'IMG_1.AVI'])).toEqual(new Set(['IMG_1.CR2']))
    expect(sidecarOwners(['IMG_1.dng', 'IMG_1.jpg'])).toEqual(new Set(['IMG_1.dng']))
    expect(sidecarOwners(['MVI_1.AVI', 'MVI_1.JPG'])).toEqual(new Set(['MVI_1.AVI']))
    // An iPhone Live Photo: neither is written to the sidecar, both read it as before.
    expect(sidecarOwners(['IMG_2.HEIC', 'IMG_2.MOV'])).toEqual(new Set(['IMG_2.HEIC', 'IMG_2.MOV']))
    expect(sidecarOwners(['A.jpg', 'B.avi'])).toEqual(new Set(['A.jpg', 'B.avi']))
  })

  it('sidecar name as in Lightroom (tz.md, п. 6.4)', () => {
    expect(sidecarNameOf('IMG_0001.CR2')).toBe('IMG_0001.xmp')
    expect(baseNameOf('my.photo.jpg')).toBe('my.photo')
  })
})

describe('launch parameter: folder or photo', () => {
  const dirs = new Set(['D:\\Trip', 'D:\\dev\\geophotos', 'D:\\Trip\\IMG_1.jpg'])
  const isDir = (p: string): boolean => dirs.has(p)

  it('takes the last existing folder', () => {
    expect(pathFromArgv(['D:\\Trip'], isDir)).toBe('D:\\Trip')
    expect(pathFromArgv(['--inspect', 'D:\\Trip', '--flag'], isDir)).toBe('D:\\Trip')
    expect(pathFromArgv(['D:\\Trip\\IMG_1.jpg'], isDir)).toBe('D:\\Trip\\IMG_1.jpg')
  })

  it('skips the app folder and dots (development)', () => {
    expect(pathFromArgv(['.', 'D:\\dev\\geophotos'], isDir, 'D:\\dev\\geophotos')).toBeUndefined()
    expect(pathFromArgv(['D:\\Nope'], isDir)).toBeUndefined()
  })
})

describe('thumbnail URLs', () => {
  it('round trip', () => {
    expect(parseThumbUrl(thumbUrl(3, 12))).toEqual({ generation: 3, id: 12, large: false })
    expect(parseThumbUrl('thumb://f3/12/')).toEqual({ generation: 3, id: 12, large: false })
    expect(parseThumbUrl(thumbUrl(3, 12, true))).toEqual({ generation: 3, id: 12, large: true })
    expect(parseThumbUrl('https://x')).toBeNull()
  })
})
