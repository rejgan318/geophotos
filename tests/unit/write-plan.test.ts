import { describe, expect, it } from 'vitest'
import { writePlan, writeResult, type WriteInfo } from '@shared/write-plan'

const SW = { lat: -33.8568, lon: -151.2153 }

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
      '-EXIF:GPSLongitudeRef=W'
    ])
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

  it('a sidecar of an ordinary file is updated only if it has coordinates', () => {
    const base = { path: 'h.heic', write: 'file' as const, xmpCoords: false }
    const withCoords = writePlan({ ...base, sidecar: { path: 'h.xmp', exists: true, coords: true } }, SW)
    expect(withCoords.map((s) => [s.path, s.kind])).toEqual([
      ['h.heic', 'file'],
      ['h.xmp', 'sidecar']
    ])
    expect(withCoords[1]!.args).toEqual(['-overwrite_original', '-n', '-XMP-exif:GPSLatitude=-33.8568', '-XMP-exif:GPSLongitude=-151.2153'])
    expect(writePlan({ ...base, sidecar: { path: 'h.xmp', exists: true, coords: false } }, SW)).toHaveLength(1)
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
        args: ['-overwrite_original', '-n', '-XMP-exif:GPSLatitude=-33.8568', '-XMP-exif:GPSLongitude=-151.2153']
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
