import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { scanFiles } from '../../src/main/folder'
import { hasMaster, makeJpeg, MASTER_DIR, newExifTool, tempDir, writeTags } from './helpers'

const et = newExifTool()
afterAll(() => et.close())

// Files added to the strip (tz.md, п. 3.1): read one by one, from different folders.
describe('added files', () => {
  const tmp = tempDir()
  const trip = join(tmp.dir, 'Trip')
  const phone = join(tmp.dir, 'Phone')

  beforeAll(async () => {
    mkdirSync(join(trip, '2024'), { recursive: true })
    mkdirSync(phone)
    for (const f of [join(trip, 'a.jpg'), join(trip, 'b.jpg'), join(trip, '2024', 'c.jpg'), join(phone, 'p.jpg')]) await makeJpeg(f)
    await writeTags(et, join(phone, 'p.jpg'), ['-EXIF:DateTimeOriginal=2024:05:01 10:00:00', '-GPSLatitude=49.84', '-GPSLatitudeRef=N', '-GPSLongitude=24.03', '-GPSLongitudeRef=E'])
    await writeTags(et, join(trip, 'a.jpg'), ['-EXIF:DateTimeOriginal=2024:05:02 10:00:00'])
    writeFileSync(join(phone, 'notes.txt'), 'not a photo')
  })
  afterAll(() => tmp.remove())

  it('only the given files, in time order; names from the opened folder, else full paths (п. 3.2)', async () => {
    const files = [join(trip, 'a.jpg'), join(trip, '2024', 'c.jpg'), join(phone, 'p.jpg')]
    const scan = await scanFiles(trip, files, et)
    expect(scan.photos.map((p) => p.name)).toEqual([join(phone, 'p.jpg'), 'a.jpg', join('2024', 'c.jpg')])
    expect(scan.photos.map((p) => p.id)).toEqual([0, 1, 2])
    expect(scan.photos[0]!.coords?.lat).toBeCloseTo(49.84, 6)
    expect(scan.sources.map((s) => s.path)).toEqual(scan.photos.map((p) => p.path))
    expect(scan.unreadable).toEqual([])
  })

  it('without a folder every name is the full path', async () => {
    const scan = await scanFiles(null, [join(trip, 'b.jpg')], et)
    expect(scan.photos.map((p) => p.name)).toEqual([join(trip, 'b.jpg')])
  })

  it('not photos, missing files and missing folders are skipped', async () => {
    const scan = await scanFiles(null, [join(phone, 'notes.txt'), join(phone, 'gone.jpg'), join(tmp.dir, 'Nope', 'x.jpg'), join(phone, 'p.jpg')], et)
    expect(scan.photos.map((p) => p.name)).toEqual([join(phone, 'p.jpg')])
    expect(scan.unreadable).toEqual([join(tmp.dir, 'Nope')])
  })
})

const LIVE = ['IMG_9119.HEIC', 'IMG_9119.MOV', 'cr2-xmp-coord.CR2', 'cr2-xmp-coord.xmp']
const haveLive = hasMaster && LIVE.every((f) => existsSync(join(MASTER_DIR, f)))

// The user's photos (make-project.md, п. 7), on copies.
describe.skipIf(!haveLive)('added files: what comes along', () => {
  const tmp = tempDir()
  beforeAll(() => {
    for (const f of LIVE) copyFileSync(join(MASTER_DIR, f), join(tmp.dir, f))
  })
  afterAll(() => tmp.remove())

  it('the XMP next to a RAW is read although not given (п. 3.7)', async () => {
    const scan = await scanFiles(null, [join(tmp.dir, 'cr2-xmp-coord.CR2')], et)
    expect(scan.photos[0]).toMatchObject({ coordSource: 'sidecar' })
    expect(scan.sources[0]!.sidecar).toMatchObject({ exists: true, coords: true })
  })

  it('the MOV of an iPhone Live Photo comes with its photo (п. 3.3.7)', async () => {
    const scan = await scanFiles(null, [join(tmp.dir, 'IMG_9119.HEIC')], et)
    expect(scan.photos.map((p) => p.path)).toEqual([join(tmp.dir, 'IMG_9119.HEIC')])
    expect(scan.photos[0]!.live).toBe(true)
    expect(scan.sources[0]!.live).toMatchObject({ kind: 'pair', video: { path: join(tmp.dir, 'IMG_9119.MOV') } })
  })

  it('the MOV alone is an ordinary video; both given — one item', async () => {
    const alone = await scanFiles(null, [join(tmp.dir, 'IMG_9119.MOV')], et)
    expect(alone.photos.map((p) => [p.path, !!p.video, !!p.live])).toEqual([[join(tmp.dir, 'IMG_9119.MOV'), true, false]])
    const both = await scanFiles(null, [join(tmp.dir, 'IMG_9119.MOV'), join(tmp.dir, 'IMG_9119.HEIC')], et)
    expect(both.photos.map((p) => p.path)).toEqual([join(tmp.dir, 'IMG_9119.HEIC')])
  })
})
