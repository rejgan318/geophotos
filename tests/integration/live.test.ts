import { copyFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { scanFolder } from '../../src/main/folder'
import { savePhotos } from '../../src/main/save'
import { hasMaster, MASTER_DIR, newExifTool, tempDir } from './helpers'

const et = newExifTool()
afterAll(() => et.close())

const files = ['IMG_9119.HEIC', 'IMG_9119.MOV', 'MVIMG_20261122_212538.jpg']
const have = hasMaster && files.every((f) => existsSync(join(MASTER_DIR, f)))
const log = { info: () => {}, error: () => {} }

// Live photos of the user (tz.md, п. 3.3.7), on copies.
describe.skipIf(!have)('live photos: writing', () => {
  const tmp = tempDir()
  afterAll(() => tmp.remove())

  it('the MOV of an iPhone pair gets the same as the photo; Del removes from both', async () => {
    for (const f of files) copyFileSync(join(MASTER_DIR, f), join(tmp.dir, f))
    const scan = await scanFolder(tmp.dir, et)
    expect(scan.photos.map((p) => p.name).sort()).toEqual(['IMG_9119.HEIC', 'MVIMG_20261122_212538.jpg'])
    const i = scan.photos.findIndex((p) => p.name === 'IMG_9119.HEIC')
    expect(scan.sources[i]!.live).toMatchObject({ kind: 'pair', video: { path: join(tmp.dir, 'IMG_9119.MOV'), write: 'file', video: true } })
    const p = scan.photos[i]!
    const addr = { country: 'Polska', countryCode: 'PL', state: '', city: 'Kraków', location: '' }
    const out = await savePhotos(et, [{ photo: { ...p, coords: { lat: 50.0614, lon: 19.9372 }, address: addr, altitude: 219, modified: true }, source: scan.sources[i]!, old: p.coords }], log)
    expect(out.failed).toEqual([])

    // The MOV on its own (read as a video, not as part of a pair).
    const [mov] = await et.json(['-n', '-G0', '-QuickTime:GPSCoordinates', '-XMP:City', join(tmp.dir, 'IMG_9119.MOV')])
    expect(mov!['QuickTime:GPSCoordinates']).toBe('50.0614 19.9372 219')
    expect(mov!['XMP:City']).toBe('Kraków')

    const del = await savePhotos(et, [{ photo: { ...out.saved[0]!.photo, coords: null, address: null, altitude: null, modified: true }, source: out.saved[0]!.source, old: null }], log)
    expect(del.failed).toEqual([])
    const [gone] = await et.json(['-n', '-G0', '-QuickTime:GPSCoordinates', join(tmp.dir, 'IMG_9119.MOV')])
    expect(gone!['QuickTime:GPSCoordinates']).toBeUndefined()
  })

  it('writing a Motion Photo keeps the video inside', async () => {
    const scan = await scanFolder(tmp.dir, et)
    const i = scan.photos.findIndex((p) => p.name === 'MVIMG_20261122_212538.jpg')
    const p = scan.photos[i]!
    const before = await et.binary(p.path, 'MotionPhotoVideo')
    const out = await savePhotos(et, [{ photo: { ...p, coords: { lat: 49.84, lon: 24.03 }, modified: true }, source: scan.sources[i]!, old: p.coords }], log)
    expect(out.failed).toEqual([])
    const after = await et.binary(p.path, 'MotionPhotoVideo')
    expect(after?.length).toBe(before?.length)
    expect(after?.equals(before!)).toBe(true)
  })
})
