import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { scanFolder, type ScannedFolder } from '../../src/main/folder'
import { LARGE_SIZE, makeImage, makeThumbnail, THUMB_SIZE } from '../../src/main/thumbnails'
import { copyMaster, hasMaster, newExifTool, tempDir } from './helpers'

const et = newExifTool()
afterAll(() => et.close())

async function expectThumb(buf: Buffer): Promise<void> {
  const m = await sharp(buf).metadata()
  expect(m.format).toBe('jpeg')
  expect(Math.max(m.width ?? 0, m.height ?? 0)).toBeLessThanOrEqual(THUMB_SIZE)
  expect(Math.max(m.width ?? 0, m.height ?? 0)).toBeGreaterThan(THUMB_SIZE / 2)
}

describe.skipIf(!hasMaster)('thumbnails of every test photo (tz.md, п. 3.3.4)', () => {
  const tmp = tempDir()
  let folder: ScannedFolder

  beforeAll(async () => {
    await copyMaster(tmp.dir)
    folder = await scanFolder(tmp.dir, et)
  })
  afterAll(() => tmp.remove())

  it('each photo gets a JPEG thumbnail', async () => {
    for (const [i, photo] of folder.photos.entries()) {
      const source = folder.sources[i]!
      // Videos get the thumbnail of Windows, which needs Electron (tz.md, п. 3.3.6).
      if (source.preview === 'system') continue
      await expectThumb(await makeThumbnail(source, et)).catch((e: unknown) => {
        throw new Error(`${photo.name}: ${String(e)}`)
      })
    }
  })

  it('the photo view gets a large image of every photo, up to LARGE_SIZE (tz.md, п. 9.3)', async () => {
    for (const [i, photo] of folder.photos.entries()) {
      if (folder.sources[i]!.preview === 'system') continue
      const m = await sharp(await makeImage(folder.sources[i]!, et, LARGE_SIZE)).metadata()
      const side = Math.max(m.width ?? 0, m.height ?? 0)
      expect(m.format, photo.name).toBe('jpeg')
      expect(side, photo.name).toBeLessThanOrEqual(LARGE_SIZE)
      expect(side, photo.name).toBeGreaterThan(THUMB_SIZE)
    }
  })

  it('RAW and HEIC use the embedded preview', () => {
    const src = (n: string) => folder.sources[folder.photos.findIndex((p) => p.name === n)]!
    expect(src('cr2-no-xmp.CR2').previewTag).toBe('PreviewImage')
    expect(src('dng.dng').previewTag).toBe('PreviewImage')
    expect(src('HEIC-xmp-coord.HEIC').previewTag).toBe('PreviewImage')
  })
})

describe('thumbnail failures', () => {
  const tmp = tempDir()
  afterAll(() => tmp.remove())

  it('a broken file cannot be shown (→ placeholder, п. 3.3.5)', async () => {
    const file = join(tmp.dir, 'broken.jpg')
    writeFileSync(file, Buffer.from('this is not a jpeg at all'))
    const { sources } = await scanFolder(tmp.dir, et)
    await expect(makeThumbnail(sources[0]!, et)).rejects.toThrow()
  })
})
