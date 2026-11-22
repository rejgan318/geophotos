import { copyFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { scanFolder, type ScannedFolder } from '../../src/main/folder'
import { makeThumbnail } from '../../src/main/thumbnails'
import { savePhotos } from '../../src/main/save'
import { newExifTool, hasVideos, tempDir, VIDEO_DIR, makeJpeg } from './helpers'

const et = newExifTool()
afterAll(() => et.close())

// The user's sample videos (tz.md, п. 3.3.6): read only.
describe.skipIf(!hasVideos)('videos of the user (tz.md, пп. 3.3.6, 4.2)', () => {
  let folder: ScannedFolder
  const photo = (name: string) => folder.photos.find((p) => p.name === name)

  beforeAll(async () => {
    folder = await scanFolder(VIDEO_DIR, et)
  })

  it('every video is read without errors', () => {
    const videos = folder.photos.filter((p) => p.video)
    expect(videos.length).toBeGreaterThanOrEqual(9)
    for (const v of videos) expect(v.error, v.name).toBeUndefined()
  })

  it('phones: coordinates from QuickTime, the time at the place of shooting', () => {
    expect(photo('20190816_192927.mp4')).toMatchObject({
      coords: { lat: 40.6252, lon: -73.2877 },
      coordSource: 'quicktime',
      date: '2019-08-16 19:29:50',
      dateSource: 'shot'
    })
    expect(photo('VID_20250426_101211.mp4')).toMatchObject({ date: '2025-04-26 10:12:20' })
  })

  it('cameras: local time; the video stands next to the photo taken right after it', () => {
    expect(photo('MVI_3380.MOV')?.date).toBe('2010-07-03 21:19:02')
    expect(photo('IMG_3381_DxO.jpg')?.date).toBe('2010-07-03 21:19:56')
    const order = folder.photos.map((p) => p.name)
    expect(order.indexOf('IMG_3381_DxO.jpg')).toBe(order.indexOf('MVI_3380.MOV') + 1)
    expect(photo('P7020044.MOV')?.date).toBe('2005-07-02 17:50:33')
    expect(photo('MVI_3573.MOV')?.date).toBe('2012-01-19 15:54:15')
  })

  it('no date in the file: from the name, then the file time', () => {
    expect(photo('1998 03 19 Юля и Аня дома на Ньютона.avi')).toMatchObject({ date: '1998-03-19 00:00:00', dateSource: 'name' })
    expect(photo('M2U00030.MPG')?.dateSource).toBe('file')
  })

  it('length; the system makes the thumbnail', () => {
    expect(photo('MVI_3380.MOV')?.video?.duration).toBeCloseTo(16.24, 1)
    expect(photo('1998 03 19 Юля и Аня дома на Ньютона.avi')?.video?.duration).toBeGreaterThan(300)
    const i = folder.photos.findIndex((p) => p.name === 'M2U00030.MPG')
    expect(folder.sources[i]).toMatchObject({ preview: 'system', write: 'xmp', previewTag: null })
  })

  it('without the system thumbnail (outside Electron) a video cannot be shown (→ placeholder)', async () => {
    const i = folder.photos.findIndex((p) => p.name === 'MVI_3380.MOV')
    await expect(makeThumbnail(folder.sources[i]!, et)).rejects.toThrow()
  })
})

// Copies of the user's videos in a temporary folder (tz.md, пп. 6.3, 6.4, 6.6).
describe.skipIf(!hasVideos)('placing videos (0.22.0)', () => {
  const tmp = tempDir()
  afterAll(() => tmp.remove())
  const names = ['MVI_3380.MOV', '20190816_192927.mp4', 'M2U00030.MPG']

  it('written into MOV and MP4, into the sidecar for MPG; read back; the file time kept', async () => {
    for (const n of names) copyFileSync(join(VIDEO_DIR, n), join(tmp.dir, n))
    const before = new Map(names.map((n) => [n, statSync(join(tmp.dir, n)).mtimeMs]))
    const scan = await scanFolder(tmp.dir, et)
    const addr = { country: 'Україна', countryCode: 'UA', state: '', city: 'Харків', location: 'Сумська, 1' }
    const items = scan.photos.map((p, i) => ({
      photo: { ...p, coords: { lat: 49.9935, lon: 36.2304 }, address: addr, altitude: 135, modified: true },
      source: scan.sources[i]!,
      old: p.coords
    }))
    const log = { info: () => {}, error: () => {} }
    const out = await savePhotos(et, items, log)
    expect(out.failed).toEqual([])
    for (const s of out.saved) {
      expect(s.photo, s.photo.name).toMatchObject({ coords: { lat: 49.9935, lon: 36.2304 }, altitude: 135, address: { city: 'Харків' } })
    }
    for (const n of names) expect(statSync(join(tmp.dir, n)).mtimeMs, n).toBe(before.get(n))
    expect(existsSync(join(tmp.dir, 'M2U00030.xmp'))).toBe(true)
    expect(existsSync(join(tmp.dir, 'MVI_3380.xmp'))).toBe(false)

    // Opened again: the same, from QuickTime (MOV, MP4) and from the sidecar (MPG).
    const again = await scanFolder(tmp.dir, et)
    const by = (n: string) => again.photos.find((p) => p.name === n)!
    expect(by('MVI_3380.MOV')).toMatchObject({ coordSource: 'quicktime', altitude: 135, address: { city: 'Харків' } })
    expect(by('M2U00030.MPG')).toMatchObject({ coordSource: 'sidecar', altitude: 135 })
    // The camera's time is not touched.
    expect(by('MVI_3380.MOV').date).toBe('2010-07-03 21:19:02')

    // Del.
    const del = again.photos.map((p, i) => ({ photo: { ...p, coords: null, address: null, altitude: null, modified: true }, source: again.sources[i]!, old: p.coords }))
    const removed = await savePhotos(et, del, log)
    expect(removed.failed).toEqual([])
    const last = await scanFolder(tmp.dir, et)
    for (const p of last.photos) expect(p, p.name).toMatchObject({ coords: null, address: null, altitude: null })
  })
})

describe('videos without samples', () => {
  const tmp = tempDir()
  afterAll(() => tmp.remove())

  it('a JPEG named .avi is a read error, not a video', async () => {
    const file = join(tmp.dir, 'fake.avi')
    await makeJpeg(file)
    const { photos } = await scanFolder(tmp.dir, et)
    expect(photos[0]?.video).toBeDefined()
    expect(photos[0]?.error).toMatch(/Not a video/)
  })
})
