import { describe, expect, it } from 'vitest'
import { quickTimeGpsArgs, writePlan as plan } from '@shared/write-plan'

describe('videos (tz.md, пп. 3.3.6, 6.3, 6.4)', () => {
  const mov = { path: 'D:\\v\\a.mov', write: 'file' as const, video: true, xmpCoords: false, sidecar: { path: 'D:\\v\\a.xmp', exists: false, coords: false } }
  const avi = { path: 'D:\\v\\b.avi', write: 'xmp' as const, video: true, xmpCoords: false, sidecar: { path: 'D:\\v\\b.xmp', exists: false, coords: false } }
  const addr = { country: 'Україна', countryCode: 'UA', state: '', city: 'Харків', location: '' }

  it('QuickTime: Keys and UserData, the old value removed first, the time of the file kept', () => {
    expect(quickTimeGpsArgs({ lat: 49.5, lon: -36.25 }, 120.456)).toEqual([
      '-QuickTime:GPSCoordinates=',
      '-Keys:GPSCoordinates=49.5 -36.25 120.46',
      '-UserData:GPSCoordinates=49.5 -36.25 120.46'
    ])
    const [step, ...rest] = plan(mov, { lat: 49.5, lon: 36.25 }, addr, null)
    expect(rest).toEqual([])
    expect(step!.args).toContain('-P')
    expect(step!.args).toContain('-Keys:GPSCoordinates=49.5 36.25')
    expect(step!.args).toContain('-XMP-photoshop:City=Харків')
    expect(step!.args.some((a) => a.startsWith('-EXIF:') || a.startsWith('-IPTC:'))).toBe(false)
  })

  it('Del removes the QuickTime GPS and the XMP GPS and places', () => {
    const [step] = plan(mov, null)
    expect(step!.args).toEqual(expect.arrayContaining(['-P', '-QuickTime:GPSCoordinates=', '-XMP-exif:GPS*=', '-XMP-photoshop:City=']))
    expect(step!.args).not.toContain('-GPS:all=')
  })

  it('AVI and the like: only the sidecar, created if missing', () => {
    expect(plan(avi, { lat: 1, lon: 2 })).toEqual([
      expect.objectContaining({ path: 'D:\\v\\b.xmp', kind: 'sidecar', create: true })
    ])
  })
})
import type { Address } from '@shared/photo'
import { writePlan, writeResult, xmpAddressArgs, type WriteInfo } from '@shared/write-plan'

const SW = { lat: -33.8568, lon: -151.2153 }
const LVIV: Address = { country: 'Україна', countryCode: 'UA', state: 'Львівська область', city: 'Львів', location: '' }
const NO_ADDRESS = [
  '-XMP-photoshop:Country=',
  '-XMP-iptcCore:CountryCode=',
  '-XMP-photoshop:State=',
  '-XMP-photoshop:City=',
  '-XMP-iptcCore:Location='
]
const NO_XMP_ALTITUDE = ['-XMP-exif:GPSAltitude=', '-XMP-exif:GPSAltitudeRef=']
const NO_IPTC = [
  '-IPTC:Country-PrimaryLocationName=',
  '-IPTC:Country-PrimaryLocationCode=',
  '-IPTC:Province-State=',
  '-IPTC:City=',
  '-IPTC:Sub-location='
]

describe('where coordinates are written (tz.md, пп. 6.2–6.4)', () => {
  it('JPEG: EXIF of the file with N/S/E/W, no backup copies', () => {
    const info: WriteInfo = { path: 'C:\\f\\a.jpg', write: 'file', xmpCoords: false, sidecar: null }
    const steps = writePlan(info, SW)
    expect(steps).toHaveLength(1)
    expect(steps[0]).toMatchObject({ path: 'C:\\f\\a.jpg', kind: 'file', create: false })
    expect(steps[0]!.args).toEqual([
      '-overwrite_original',
      '-n',
      '-EXIF:GPSLatitude=33.8568',
      '-EXIF:GPSLatitudeRef=S',
      '-EXIF:GPSLongitude=151.2153',
      '-EXIF:GPSLongitudeRef=W',
      // No altitude and no address: old ones go with the old coordinates (п. 6.2).
      '-EXIF:GPSAltitude=',
      '-EXIF:GPSAltitudeRef=',
      ...NO_ADDRESS,
      ...NO_IPTC
    ])
  })

  it('the altitude goes with the coordinates: EXIF, and XMP where the coordinates go (п. 5.6)', () => {
    const jpeg = writePlan({ path: 'a.jpg', write: 'file', xmpCoords: true, sidecar: null }, SW, null, 290.04)
    expect(jpeg[0]!.args).toEqual(
      expect.arrayContaining(['-EXIF:GPSAltitude=290.04', '-EXIF:GPSAltitudeRef=0', '-XMP-exif:GPSAltitude=290.04', '-XMP-exif:GPSAltitudeRef=0'])
    )
    // Below sea level: the value is unsigned, Ref 1.
    const dead = writePlan({ path: 'r.cr2', write: 'xmp', xmpCoords: false, sidecar: { path: 'r.xmp', exists: true, coords: true } }, SW, null, -430)
    expect(dead[0]!.args).toEqual(expect.arrayContaining(['-XMP-exif:GPSAltitude=430', '-XMP-exif:GPSAltitudeRef=1']))
  })

  it('the address goes to the XMP of the file; IPTC place names are removed (п. 5.5)', () => {
    const steps = writePlan({ path: 'a.jpg', write: 'file', xmpCoords: false, sidecar: null }, SW, LVIV)
    expect(steps[0]!.args).toEqual(
      expect.arrayContaining([
        '-XMP-photoshop:Country=Україна',
        '-XMP-iptcCore:CountryCode=UA',
        '-XMP-photoshop:State=Львівська область',
        '-XMP-photoshop:City=Львів',
        // An unknown field removes the tag.
        '-XMP-iptcCore:Location=',
        ...NO_IPTC
      ])
    )
  })

  it('embedded XMP with coordinates is updated with the same values', () => {
    const steps = writePlan({ path: 'a.jpg', write: 'file', xmpCoords: true, sidecar: null }, SW)
    expect(steps[0]!.args).toContain('-XMP-exif:GPSLatitude=-33.8568')
    expect(steps[0]!.args).toContain('-XMP-exif:GPSLongitude=-151.2153')
  })

  it('removing coordinates (п. 6.6): GPS, altitude and address go from the file and its sidecar', () => {
    const jpeg = writePlan({ path: 'a.jpg', write: 'file', xmpCoords: false, sidecar: { path: 'a.xmp', exists: true, coords: false } }, null)
    expect(jpeg.map((s) => [s.path, s.kind])).toEqual([
      ['a.jpg', 'file'],
      ['a.xmp', 'sidecar']
    ])
    expect(jpeg[0]!.args).toEqual(expect.arrayContaining(['-GPS:all=', '-XMP-exif:GPS*=', '-XMP-photoshop:City=', '-IPTC:City=']))
    expect(jpeg[1]!.args).toEqual(expect.arrayContaining(['-XMP-exif:GPS*=', '-XMP-photoshop:City=']))
    expect(jpeg[1]!.args).not.toContain('-GPS:all=')
    // RAW: only an existing sidecar; the RAW file is never touched, no sidecar is created.
    const raw = writePlan({ path: 'r.cr2', write: 'xmp', xmpCoords: false, sidecar: { path: 'r.xmp', exists: true, coords: true } }, null)
    expect(raw.map((s) => s.path)).toEqual(['r.xmp'])
    expect(writePlan({ path: 'r.cr2', write: 'xmp', xmpCoords: false, sidecar: { path: 'r.xmp', exists: false, coords: false } }, null)).toEqual([])
  })

  it('a sidecar of an ordinary file: coordinates only if it has them, the address always (read first, п. 3.7)', () => {
    const base = { path: 'h.heic', write: 'file' as const, xmpCoords: false }
    const withCoords = writePlan({ ...base, sidecar: { path: 'h.xmp', exists: true, coords: true } }, SW, LVIV)
    expect(withCoords.map((s) => [s.path, s.kind])).toEqual([
      ['h.heic', 'file'],
      ['h.xmp', 'sidecar']
    ])
    expect(withCoords[1]!.args).toEqual([
      '-overwrite_original',
      '-n',
      '-XMP-exif:GPSLatitude=-33.8568',
      '-XMP-exif:GPSLongitude=-151.2153',
      ...NO_XMP_ALTITUDE,
      ...xmpAddressArgs(LVIV)
    ])
    const noCoords = writePlan({ ...base, sidecar: { path: 'h.xmp', exists: true, coords: false } }, SW, LVIV)
    expect(noCoords[1]!.args).toEqual(['-overwrite_original', '-n', ...xmpAddressArgs(LVIV)])
    expect(writePlan({ ...base, sidecar: { path: 'h.xmp', exists: false, coords: false } }, SW)).toHaveLength(1)
  })

  it('RAW: only the sidecar; created when missing, the RAW itself untouched', () => {
    const steps = writePlan(
      { path: 'IMG.CR2', write: 'xmp', xmpCoords: false, sidecar: { path: 'IMG.xmp', exists: false, coords: false } },
      SW
    )
    expect(steps).toEqual([
      {
        path: 'IMG.xmp',
        kind: 'sidecar',
        create: true,
        args: ['-overwrite_original', '-n', '-XMP-exif:GPSLatitude=-33.8568', '-XMP-exif:GPSLongitude=-151.2153', ...NO_XMP_ALTITUDE, ...NO_ADDRESS]
      }
    ])
    const existing = writePlan(
      { path: 'IMG.CR2', write: 'xmp', xmpCoords: true, sidecar: { path: 'IMG.xmp', exists: true, coords: false } },
      SW
    )
    expect(existing[0]).toMatchObject({ path: 'IMG.xmp', create: false })
  })

  it('northern and eastern coordinates, numbers without exponent', () => {
    const steps = writePlan({ path: 'a.jpg', write: 'file', xmpCoords: true, sidecar: null }, { lat: 0.0000001, lon: 24 })
    expect(steps[0]!.args).toEqual(
      expect.arrayContaining([
        '-EXIF:GPSLatitude=0.0000001',
        '-EXIF:GPSLatitudeRef=N',
        '-EXIF:GPSLongitudeRef=E',
        '-XMP-exif:GPSLongitude=24'
      ])
    )
  })
})

describe('exiftool write result', () => {
  it('success', () => {
    expect(writeResult('    1 image files updated\n', '')).toEqual({ ok: true })
    expect(writeResult('    1 image files created\n', '')).toEqual({ ok: true })
    expect(writeResult('    1 image files unchanged\n', '')).toEqual({ ok: true })
  })

  it('the reason of a failure comes from the error lines', () => {
    expect(
      writeResult('    0 image files updated\n    1 files weren\'t updated due to errors\n', 'Error renaming temporary file to ro.jpg\n')
    ).toEqual({ ok: false, error: 'Error renaming temporary file to ro.jpg' })
    expect(writeResult('    0 image files updated\n', 'Error: File format error - a.jpg\n')).toEqual({
      ok: false,
      error: 'File format error - a.jpg'
    })
    expect(writeResult('', '')).toEqual({ ok: false, error: 'exiftool did not write the file' })
  })
})

describe('the shooting direction and save.xmpOnly (tz.md, пп. 4.21, 6.4)', () => {
  const jpg: WriteInfo = { path: 'D:\p\IMG_0001.JPG', write: 'file', xmpCoords: false, sidecar: null }
  const mov: WriteInfo = { path: 'D:\p\IMG_0002.MOV', write: 'file', video: true, xmpCoords: false, sidecar: null }
  const cr2: WriteInfo = { path: 'D:\p\IMG_0003.CR2', write: 'xmp', xmpCoords: false, sidecar: { path: 'D:\p\IMG_0003.xmp', exists: false, coords: false } }
  const at = { lat: 1, lon: 2 }

  it('the direction goes to EXIF of a photo from true north; null removes it; undefined leaves it', () => {
    const [set] = writePlan(jpg, at, null, null, { direction: 271.456 })
    expect(set!.args).toEqual(expect.arrayContaining(['-EXIF:GPSImgDirection=271.46', '-EXIF:GPSImgDirectionRef=T']))
    const [gone] = writePlan(jpg, at, null, null, { direction: null })
    expect(gone!.args).toEqual(expect.arrayContaining(['-EXIF:GPSImgDirection=', '-EXIF:GPSImgDirectionRef=']))
    expect(writePlan(jpg, at)[0]!.args.some((a) => a.includes('GPSImgDirection'))).toBe(false)
  })

  it('a video keeps the direction in its XMP (QuickTime has no place for it); RAW in the sidecar', () => {
    expect(writePlan(mov, at, null, null, { direction: 90 })[0]!.args).toEqual(expect.arrayContaining(['-XMP-exif:GPSImgDirection=90', '-XMP-exif:GPSImgDirectionRef=T']))
    expect(writePlan(cr2, at, null, null, { direction: 90 })[0]!.args).toContain('-XMP-exif:GPSImgDirection=90')
  })

  it('xmpOnly: a photo or a video is not changed — everything goes to the sidecar of its whole name', () => {
    for (const info of [jpg, mov]) {
      const steps = writePlan(info, at, null, 100, { xmpOnly: true, direction: 10 })
      expect(steps).toEqual([expect.objectContaining({ path: `${info.path}.xmp`, kind: 'sidecar', create: true })])
      expect(steps[0]!.args).toEqual(expect.arrayContaining(['-XMP-exif:GPSLatitude=1', '-XMP-exif:GPSAltitude=100', '-XMP-exif:GPSImgDirection=10']))
      expect(steps[0]!.args.some((a) => a.startsWith('-EXIF:') || a.startsWith('-Keys:'))).toBe(false)
    }
    // An existing one is updated, not created.
    const known = { ...jpg, fullSidecar: { path: 'D:\p\IMG_0001.JPG.xmp', exists: true, coords: true } }
    expect(writePlan(known, at, null, null, { xmpOnly: true })[0]!.create).toBe(false)
    // RAW: as always, the Lightroom sidecar.
    expect(writePlan(cr2, at, null, null, { xmpOnly: true })).toEqual([expect.objectContaining({ path: 'D:\p\IMG_0003.xmp' })])
  })

  it('xmpOnly Del: only the sidecars there are; the file is not touched', () => {
    const known = { ...jpg, fullSidecar: { path: 'D:\p\IMG_0001.JPG.xmp', exists: true, coords: true } }
    expect(writePlan(known, null, null, null, { xmpOnly: true })).toEqual([
      expect.objectContaining({ path: 'D:\p\IMG_0001.JPG.xmp', kind: 'sidecar', args: expect.arrayContaining(['-XMP-exif:GPS*=']) })
    ])
    expect(writePlan(jpg, null, null, null, { xmpOnly: true })).toEqual([])
  })

  it('without xmpOnly an existing sidecar of the whole name gets the same values as the file', () => {
    const known = { ...jpg, fullSidecar: { path: 'D:\p\IMG_0001.JPG.xmp', exists: true, coords: true } }
    const steps = writePlan(known, at)
    expect(steps.map((s) => s.path)).toEqual([jpg.path, 'D:\p\IMG_0001.JPG.xmp'])
    expect(steps[1]!.args).toContain('-XMP-exif:GPSLatitude=1')
    expect(writePlan(known, null).map((s) => s.path)).toEqual([jpg.path, 'D:\p\IMG_0001.JPG.xmp'])
  })
})
