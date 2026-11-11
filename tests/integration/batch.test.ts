import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { LatLon } from '@shared/photo'
import { runBatch, type BatchDeps, type BatchProgress } from '../../src/main/batch'
import { scanFolder } from '../../src/main/folder'
import { makeJpeg, newExifTool, tempDir, writeTags } from './helpers'

const et = newExifTool()
afterAll(() => et.close())

/** Services that answer at once: the city is named by the latitude, the altitude is the latitude ×10. */
function deps(calls: { reverse: number; elevations: number }): BatchDeps {
  return {
    exiftool: et,
    reverse: async (c: LatLon) => {
      calls.reverse++
      return { ok: true, address: { country: 'Testland', countryCode: 'TL', state: '', city: `City ${c.lat}`, location: '' } }
    },
    elevations: async (points: readonly LatLon[]) => {
      calls.elevations++
      return { ok: true, values: points.map((c) => c.lat * 10) }
    },
    log: { info: () => {}, error: () => {}, warn: () => {} },
    addressIntervalMs: 0
  }
}

async function photoAt(file: string, c: LatLon | null, extra: string[] = []): Promise<void> {
  await makeJpeg(file)
  if (c) {
    await writeTags(et, file, [
      '-n',
      `-EXIF:GPSLatitude=${c.lat}`,
      '-EXIF:GPSLatitudeRef=N',
      `-EXIF:GPSLongitude=${c.lon}`,
      '-EXIF:GPSLongitudeRef=E',
      ...extra
    ])
  }
}

describe('batch mode (tz.md, п. 10)', () => {
  const tmp = tempDir()
  afterAll(() => tmp.remove())

  it('only photos with coordinates; existing data kept; one request per point; subfolders on demand', async () => {
    const dir = join(tmp.dir, 'trip')
    mkdirSync(join(dir, 'day2'), { recursive: true })
    await photoAt(join(dir, 'a.jpg'), { lat: 10, lon: 20 })
    await photoAt(join(dir, 'a2.jpg'), { lat: 10, lon: 20 })
    await photoAt(join(dir, 'has.jpg'), { lat: 30, lon: 40 }, ['-XMP-photoshop:City=Kept', '-EXIF:GPSAltitude=5', '-EXIF:GPSAltitudeRef=0'])
    await photoAt(join(dir, 'none.jpg'), null)
    await photoAt(join(dir, 'day2', 'b.jpg'), { lat: 50, lon: 60 })

    const calls = { reverse: 0, elevations: 0 }
    const progress: BatchProgress[] = []
    const out = await runBatch([dir], { address: true, altitude: true, subfolders: false, overwrite: false }, deps(calls), (p) => progress.push(p), () => false)
    expect(out).toEqual({ written: 2, skipped: 2, failed: [], cancelled: false })
    // a.jpg and a2.jpg share a point: one address request, one altitude request for all.
    expect(calls).toEqual({ reverse: 1, elevations: 1 })
    // Steps: one address request, one altitude request, two photos to write.
    expect(progress.at(-1)).toMatchObject({ phase: 'write', done: 4, total: 4, seconds: 0 })

    const photos = (await scanFolder(dir, et, { subfolders: true })).photos
    const by = (n: string) => photos.find((p) => p.name === n)!
    expect(by('a.jpg')).toMatchObject({ address: { city: 'City 10' }, altitude: 100 })
    expect(by('has.jpg')).toMatchObject({ address: { city: 'Kept' }, altitude: 5 })
    expect(by('none.jpg')).toMatchObject({ coords: null, address: null, altitude: null })
    expect(by(join('day2', 'b.jpg'))).toMatchObject({ address: null, altitude: null })

    // --subfolders --overwrite --no-altitude: the subfolder too, existing addresses replaced, altitudes left.
    const again = await runBatch([dir], { address: true, altitude: false, subfolders: true, overwrite: true }, deps(calls), () => {}, () => false)
    expect(again).toMatchObject({ written: 2, failed: [] })
    const after = (await scanFolder(dir, et, { subfolders: true })).photos
    const by2 = (n: string) => after.find((p) => p.name === n)!
    expect(by2('has.jpg')).toMatchObject({ address: { city: 'City 30' }, altitude: 5 })
    expect(by2(join('day2', 'b.jpg'))).toMatchObject({ address: { city: 'City 50' }, altitude: null })
  })

  it('single files of a folder; a missing path is an error', async () => {
    const dir = join(tmp.dir, 'files')
    mkdirSync(dir)
    await photoAt(join(dir, 'x.jpg'), { lat: 1, lon: 2 })
    await photoAt(join(dir, 'y.jpg'), { lat: 3, lon: 4 })
    const out = await runBatch(
      [join(dir, 'x.jpg'), join(dir, 'nope.jpg')],
      { address: false, altitude: true, subfolders: false, overwrite: false },
      deps({ reverse: 0, elevations: 0 }),
      () => {},
      () => false
    )
    expect(out.written).toBe(1)
    expect(out.failed).toEqual([{ name: join(dir, 'nope.jpg'), error: 'Not found' }])
    const photos = (await scanFolder(dir, et)).photos
    expect(photos.map((p) => [p.name, p.altitude])).toEqual([
      ['x.jpg', 10],
      ['y.jpg', null]
    ])
  })

  it('cancel while asking: what was found is still written, the rest is not asked', async () => {
    const dir = join(tmp.dir, 'cancel')
    mkdirSync(dir)
    await photoAt(join(dir, 'p1.jpg'), { lat: 1, lon: 1 })
    await photoAt(join(dir, 'p2.jpg'), { lat: 2, lon: 2 })
    await photoAt(join(dir, 'p3.jpg'), { lat: 3, lon: 3 })
    const calls = { reverse: 0, elevations: 0 }
    const out = await runBatch([dir], { address: true, altitude: false, subfolders: false, overwrite: false }, deps(calls), () => {}, () => calls.reverse >= 1)
    expect(out).toMatchObject({ cancelled: true, written: 1, skipped: 2 })
    expect(calls.reverse).toBe(1)
  })
})
