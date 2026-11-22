import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { scanFolder, type ScannedFolder } from '../../src/main/folder'
import { makeThumbnail } from '../../src/main/thumbnails'
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
