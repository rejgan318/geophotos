import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { exiftoolVersion } from '../../src/main/exiftool'
import { scanFolder } from '../../src/main/folder'
import { copyMaster, EXIFTOOL, hasMaster, makeJpeg, newExifTool, tempDir, writeTags } from './helpers'

const et = newExifTool()
afterAll(() => et.close())

describe('exiftool', () => {
  it('is found and reports its version (tz.md, п. 2.2)', async () => {
    expect(await exiftoolVersion(EXIFTOOL)).toMatch(/^\d+\.\d+/)
  })

  it('a missing exiftool is an error', async () => {
    await expect(exiftoolVersion('Z:\\no\\such\\exiftool.exe')).rejects.toThrow()
  })

  it('runs many commands through one process', async () => {
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => et.run(['-ver'])))
    for (const r of results) expect(r.stdout.toString().trim()).toMatch(/^\d+\.\d+$/)
  })
})

describe.skipIf(!hasMaster)('test photos (master set)', () => {
  const tmp = tempDir()
  let photos: Awaited<ReturnType<typeof scanFolder>>['photos']
  const byName = (n: string) => photos.find((p) => p.name === n)!

  beforeAll(async () => {
    await copyMaster(tmp.dir)
    ;({ photos } = await scanFolder(tmp.dir, et))
  })
  afterAll(() => tmp.remove())

  it('all photos are found, sidecars are not photos', () => {
    // IMG_9119.MOV goes with IMG_9119.HEIC (a Live Photo, tz.md, п. 3.3.7).
    expect(photos).toHaveLength(15)
    expect(photos.some((p) => p.name.endsWith('.xmp'))).toBe(false)
    expect(photos.filter((p) => p.error)).toEqual([])
  })

  it('coordinates and where they come from (tz.md, п. 3.7)', () => {
    expect(byName('with-coord.jpg').coordSource).toBe('exif')
    expect(byName('with-coord.jpg').coords?.lat).toBeCloseTo(52.1207409, 6)
    expect(byName('with-coord.jpg').coords?.lon).toBeCloseTo(21.3625362, 6)
    expect(byName('cr2-xmp-coord.CR2').coordSource).toBe('sidecar')
    expect(byName('cr2-xmp-coord.CR2').coords?.lat).toBeCloseTo(49.9924539, 6)
    expect(byName('HEIC-xmp-coord.HEIC').coordSource).toBe('sidecar')
    expect(byName('HEIC-xmp-coord.HEIC').coords?.lon).toBeCloseTo(24.0305447, 6)
    expect(byName('IMG_2743.JPG').coordSource).toBe('exif')
    expect(byName('IMG_2743.CR2').coords).toBeNull()
    expect(byName('without-coord.jpg').coords).toBeNull()
    // A motion photo of Xiaomi 15 Ultra (added 2026-11-22): an ordinary JPEG with EXIF GPS.
    expect(byName('MVIMG_20261122_212538.jpg')).toMatchObject({ coordSource: 'exif', date: '2026-11-22 21:25:38' })
    expect(byName('MVIMG_20261122_212538.jpg').coords?.lat).toBeCloseTo(49.8627, 3)
    // An iPhone Live Photo (added 2026-11-22): one item, the MOV goes with the HEIC (п. 3.3.7).
    expect(byName('IMG_9119.HEIC')).toMatchObject({ coordSource: 'exif', date: '2026-11-12 16:45:55', live: true })
    expect(photos.find((p) => p.name === 'IMG_9119.MOV')).toBeUndefined()
    // A Motion Photo of Xiaomi: the video inside.
    expect(byName('MVIMG_20261122_212538.jpg').live).toBe(true)
    expect(photos.filter((p) => p.live)).toHaveLength(2)
    expect(photos.filter((p) => p.coords)).toHaveLength(6)
  })

  it('non-Latin and space in names are read', () => {
    expect(byName('С_кириллицей.jpg').date).toBeTruthy()
    expect(byName('With space.JPG').dateSource).toBe('shot')
  })

  it('no shooting date: the file date is used (tz.md, п. 4.2)', () => {
    for (const n of ['png.png', 'tiff.tiff', 'С_кириллицей.jpg']) {
      expect(byName(n).dateSource, n).toBe('file')
      expect(byName(n).date, n).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/)
    }
    expect(byName('dng.dng').date).toBe('2025-06-09 20:04:16')
  })

  it('the strip is ordered by date', () => {
    const dates = photos.map((p) => p.date ?? '')
    expect([...dates].sort()).toEqual(dates)
    expect(photos.map((p) => p.id)).toEqual(photos.map((_, i) => i))
  })
})

describe('generated cases', () => {
  const tmp = tempDir()
  let photos: Awaited<ReturnType<typeof scanFolder>>['photos']
  const byName = (n: string) => photos.find((p) => p.name === n)!

  beforeAll(async () => {
    const f = (n: string): string => join(tmp.dir, n)

    writeFileSync(f('broken.jpg'), Buffer.from('this is not a jpeg at all'))
    writeFileSync(f('garbage.png'), Buffer.from([0x00, 0xff, 0x13, 0x37, 0x42, 0x99, 0x01, 0x02, 0xfe, 0x7a]))

    await makeJpeg(f('xmp-only.jpg'))
    await writeTags(et, f('xmp-only.jpg'), ['-XMP:GPSLatitude=10.5', '-XMP:GPSLongitude=20.25'])

    await makeJpeg(f('south-west.jpg'))
    await writeTags(et, f('south-west.jpg'), [
      '-EXIF:GPSLatitude=33.8568', '-EXIF:GPSLatitudeRef=S',
      '-EXIF:GPSLongitude=70.5', '-EXIF:GPSLongitudeRef=W',
      '-EXIF:DateTimeOriginal=2020:05:05 10:00:00'
    ])

    // Sidecar and EXIF disagree: the sidecar wins.
    await makeJpeg(f('both.jpg'))
    await writeTags(et, f('both.jpg'), ['-EXIF:GPSLatitude=1', '-EXIF:GPSLatitudeRef=N', '-EXIF:GPSLongitude=1', '-EXIF:GPSLongitudeRef=E'])
    await et.run(['-o', f('both.xmp'), '-XMP:GPSLatitude=2', '-XMP:GPSLongitude=3'])

    // RAW+JPEG pair: the shared sidecar belongs to the RAW only (tz.md, п. 3.7).
    await makeJpeg(f('pair.jpg'))
    await writeTags(et, f('pair.jpg'), ['-EXIF:GPSLatitude=5', '-EXIF:GPSLatitudeRef=N', '-EXIF:GPSLongitude=6', '-EXIF:GPSLongitudeRef=E'])
    writeFileSync(f('pair.cr2'), Buffer.from('not really a raw'))
    await et.run(['-o', f('pair.xmp'), '-XMP:GPSLatitude=7', '-XMP:GPSLongitude=8'])

    await makeJpeg(f('no-date.jpg'))
    ;({ photos } = await scanFolder(tmp.dir, et))
  })
  afterAll(() => tmp.remove())

  it('a broken file is listed with an error and does not stop the others', () => {
    expect(byName('broken.jpg').error).toBeTruthy()
    expect(byName('garbage.png').error).toBeTruthy()
    expect(photos).toHaveLength(8)
    expect(photos.filter((p) => p.error).map((p) => p.name).sort()).toEqual(['broken.jpg', 'garbage.png', 'pair.cr2'])
  })

  it('embedded XMP only', () => {
    expect(byName('xmp-only.jpg')).toMatchObject({ coords: { lat: 10.5, lon: 20.25 }, coordSource: 'xmp' })
  })

  it('southern and western hemispheres', () => {
    expect(byName('south-west.jpg').coords).toEqual({ lat: -33.8568, lon: -70.5 })
  })

  it('sidecar wins over EXIF', () => {
    expect(byName('both.jpg')).toMatchObject({ coords: { lat: 2, lon: 3 }, coordSource: 'sidecar' })
  })

  it('RAW+JPEG pair: sidecar is the RAW one', () => {
    expect(byName('pair.cr2')).toMatchObject({ coords: { lat: 7, lon: 8 }, coordSource: 'sidecar' })
    expect(byName('pair.jpg')).toMatchObject({ coords: { lat: 5, lon: 6 }, coordSource: 'exif' })
  })

  it('no shooting date → file date', () => {
    expect(byName('no-date.jpg').dateSource).toBe('file')
  })

  it('an empty folder has no photos', async () => {
    const empty = tempDir()
    try {
      expect((await scanFolder(empty.dir, et)).photos).toEqual([])
    } finally {
      empty.remove()
    }
  })
})
