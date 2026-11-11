import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { assignCoords } from '@shared/edits'
import type { LatLon, Photo } from '@shared/photo'
import { scanFolder, type ScannedFolder } from '../../src/main/folder'
import { savePhotos, type SaveLog, type SaveOutcome } from '../../src/main/save'
import { copyMaster, hasMaster, makeJpeg, newExifTool, tempDir, writeTags } from './helpers'

const et = newExifTool()
afterAll(() => et.close())

function memoryLog(): SaveLog & { lines: string[] } {
  const lines: string[] = []
  return { lines, info: (m) => lines.push(`info ${m}`), error: (m) => lines.push(`error ${m}`) }
}

const sha = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex')

/** XMP tags other than GPS and the toolkit name: what must survive an update (tz.md, п. 6.4). */
async function otherXmpTags(file: string): Promise<Record<string, unknown>> {
  const [rec] = await et.json(['-n', '-G1', '-a', '-XMP:all', file])
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(rec ?? {})) {
    if (k === 'SourceFile' || /GPS/.test(k) || /XMPToolkit/.test(k)) continue
    out[k] = v
  }
  return out
}

/** Gives the named photos coordinates (as the window does) and saves them. */
async function assignAndSave(
  folder: ScannedFolder,
  targets: Record<string, LatLon>,
  log: SaveLog
): Promise<SaveOutcome> {
  const photos = [...folder.photos]
  const file = photos.map((p) => p.coords)
  for (const [name, c] of Object.entries(targets)) {
    const p = photos.find((x) => x.name === name)
    if (!p) throw new Error(`no photo ${name}`)
    for (const ch of assignCoords(photos, file, [p.id], c)) photos[ch.id] = ch
  }
  const items = photos
    .filter((p) => p.modified)
    .map((p) => ({ photo: p, source: folder.sources[p.id]!, old: file[p.id] ?? null }))
  return savePhotos(et, items, log)
}

const near = (c: LatLon | null | undefined, expected: LatLon): void => {
  expect(c?.lat).toBeCloseTo(expected.lat, 6)
  expect(c?.lon).toBeCloseTo(expected.lon, 6)
}

describe.skipIf(!hasMaster)('saving the test photos (master set, tz.md, п. 9.2)', () => {
  const tmp = tempDir()
  const dir = tmp.dir
  const log = memoryLog()
  let before: ScannedFolder
  let after: ScannedFolder
  let outcome: SaveOutcome
  const hashes: Record<string, string> = {}
  let xmpBefore: Record<string, unknown>

  const targets: Record<string, LatLon> = {
    'without-coord.jpg': { lat: -33.8568, lon: 151.2153 },
    'with-coord.jpg': { lat: 40.7128, lon: -74.006 },
    'HEIC-xmp-coord.HEIC': { lat: 48.8584, lon: 2.2945 },
    'dng.dng': { lat: 51.5007, lon: -0.1246 },
    'cr2-no-xmp.CR2': { lat: 35.6586, lon: 139.7454 },
    'cr2-xmp-coord.CR2': { lat: -22.9519, lon: -43.2105 },
    'IMG_2743.JPG': { lat: 41.8902, lon: 12.4922 },
    'png.png': { lat: 1.5, lon: 2.5 },
    'tiff.tiff': { lat: -1.5, lon: -2.5 },
    'readonly.jpg': { lat: 10, lon: 20 }
  }

  beforeAll(async () => {
    await copyMaster(dir)
    copyFileSync(join(dir, 'without-coord.jpg'), join(dir, 'readonly.jpg'))
    chmodSync(join(dir, 'readonly.jpg'), 0o444)
    for (const n of ['cr2-no-xmp.CR2', 'cr2-xmp-coord.CR2', 'IMG_2743.CR2']) hashes[n] = sha(join(dir, n))
    xmpBefore = await otherXmpTags(join(dir, 'cr2-xmp-coord.xmp'))
    before = await scanFolder(dir, et)
    outcome = await assignAndSave(before, targets, log)
    after = await scanFolder(dir, et)
  })
  afterAll(() => {
    chmodSync(join(dir, 'readonly.jpg'), 0o666)
    tmp.remove()
  })

  const byName = (f: ScannedFolder, n: string): Photo => f.photos.find((p) => p.name === n)!

  it('the read-only file is in the error list, all others are written (п. 6.8)', () => {
    expect(outcome.failed.map((f) => f.name)).toEqual(['readonly.jpg'])
    expect(outcome.failed[0]!.error).toMatch(/read-only/)
    expect(outcome.saved).toHaveLength(Object.keys(targets).length - 1)
    for (const s of outcome.saved) expect(s.photo.modified).toBe(false)
  })

  it('after saving and reopening the folder the coordinates are the same', () => {
    for (const [name, c] of Object.entries(targets)) {
      if (name === 'readonly.jpg') continue
      near(byName(after, name).coords, c)
      // The photos read back right after saving show the same (п. 6.8).
      near(outcome.saved.find((s) => s.photo.name === name)?.photo.coords, c)
    }
    expect(byName(after, 'readonly.jpg').coords).toBeNull()
  })

  it('JPEG, HEIC, DNG, PNG, TIFF: coordinates in the file itself', async () => {
    for (const n of ['without-coord.jpg', 'with-coord.jpg', 'HEIC-xmp-coord.HEIC', 'dng.dng', 'png.png', 'tiff.tiff']) {
      const [rec] = await et.json(['-n', '-G0', '-EXIF:GPSLatitude', '-EXIF:GPSLongitude', '-EXIF:GPSLatitudeRef', join(dir, n)])
      const lat = Number(rec!['EXIF:GPSLatitude']) * (rec!['EXIF:GPSLatitudeRef'] === 'S' ? -1 : 1)
      expect(lat, n).toBeCloseTo(targets[n]!.lat, 6)
    }
    expect(existsSync(join(dir, 'dng.xmp'))).toBe(false)
  })

  it('HEIC: its sidecar with coordinates is updated too, so п. 3.7 reads the new ones', () => {
    expect(byName(after, 'HEIC-xmp-coord.HEIC').coordSource).toBe('sidecar')
  })

  it('CR2: only IMG_xxxx.xmp is written, the RAW is not changed', () => {
    expect(existsSync(join(dir, 'cr2-no-xmp.xmp'))).toBe(true)
    expect(byName(after, 'cr2-no-xmp.CR2').coordSource).toBe('sidecar')
    expect(byName(after, 'cr2-xmp-coord.CR2').coordSource).toBe('sidecar')
    for (const n of ['cr2-no-xmp.CR2', 'cr2-xmp-coord.CR2', 'IMG_2743.CR2']) expect(sha(join(dir, n)), n).toBe(hashes[n])
  })

  it('the earlier content of an existing XMP is kept', async () => {
    expect(await otherXmpTags(join(dir, 'cr2-xmp-coord.xmp'))).toEqual(xmpBefore)
  })

  it('RAW+JPEG pair: writing the JPEG does not create or change the RAW sidecar (п. 3.7)', () => {
    expect(existsSync(join(dir, 'IMG_2743.xmp'))).toBe(false)
    expect(byName(after, 'IMG_2743.CR2').coords).toBeNull()
  })

  it('no *_original copies and no exiftool temp files are left', () => {
    const junk = readdirSync(dir).filter((n) => /_original$|_exiftool_tmp$/.test(n))
    expect(junk).toEqual([])
  })

  it('the log has old and new coordinates of every written file (п. 6.9)', () => {
    const lines = log.lines.filter((l) => l.startsWith('info Coordinates written'))
    expect(lines).toHaveLength(outcome.saved.length)
    const withCoord = lines.find((l) => l.includes('with-coord.jpg'))!
    expect(withCoord).toMatch(/old: 52\.120741, 21\.362536; new: 40\.712800, -74\.006000/)
    expect(lines.find((l) => l.includes('without-coord.jpg'))).toMatch(/old: none; new: -33\.856800, 151\.215300/)
    expect(log.lines.some((l) => l.startsWith('error') && l.includes('readonly.jpg'))).toBe(true)
  })
})

describe('saving generated cases', () => {
  const tmp = tempDir()
  afterAll(() => tmp.remove())

  it('embedded XMP with coordinates is updated together with EXIF (п. 6.3)', async () => {
    const file = join(tmp.dir, 'xmp-inside.jpg')
    await makeJpeg(file)
    await writeTags(et, file, ['-n', '-XMP-exif:GPSLatitude=1', '-XMP-exif:GPSLongitude=2'])
    const folder = await scanFolder(tmp.dir, et)
    expect(folder.sources[0]!.xmpCoords).toBe(true)
    const outcome = await assignAndSave(folder, { 'xmp-inside.jpg': { lat: -45.25, lon: -60.75 } }, memoryLog())
    expect(outcome.failed).toEqual([])
    const again = await scanFolder(tmp.dir, et)
    expect(again.photos[0]!.coordSource).toBe('xmp')
    near(again.photos[0]!.coords, { lat: -45.25, lon: -60.75 })
    const [rec] = await et.json(['-n', '-G0', '-EXIF:GPSLatitude', '-EXIF:GPSLatitudeRef', file])
    expect(rec!['EXIF:GPSLatitude']).toBeCloseTo(45.25, 6)
    expect(rec!['EXIF:GPSLatitudeRef']).toBe('S')
  })

  it('subfolders: photos with the same name in different folders keep their own coordinates (п. 3.2)', async () => {
    const root = join(tmp.dir, 'nested')
    const deep = join(root, 'b', 'deeper')
    mkdirSync(join(root, 'a'), { recursive: true })
    mkdirSync(deep, { recursive: true })
    await makeJpeg(join(root, 'top.jpg'))
    await makeJpeg(join(root, 'a', 'same.jpg'))
    await makeJpeg(join(deep, 'same.jpg'))

    // Without subfolders only the folder itself is read.
    expect((await scanFolder(root, et)).photos.map((p) => p.name)).toEqual(['top.jpg'])

    const folder = await scanFolder(root, et, { subfolders: true })
    const a = join('a', 'same.jpg')
    const b = join('b', 'deeper', 'same.jpg')
    expect(folder.photos.map((p) => p.name).sort()).toEqual([a, b, 'top.jpg'].sort())
    const outcome = await assignAndSave(folder, { [a]: { lat: 10, lon: 20 }, [b]: { lat: -30, lon: -40 } }, memoryLog())
    expect(outcome.failed).toEqual([])
    // Read back after writing by the whole path, not by the file name.
    const byName = new Map(outcome.saved.map((s) => [s.photo.name, s.photo.coords]))
    near(byName.get(a), { lat: 10, lon: 20 })
    near(byName.get(b), { lat: -30, lon: -40 })
    const again = await scanFolder(root, et, { subfolders: true })
    near(again.photos.find((p) => p.name === a)?.coords, { lat: 10, lon: 20 })
    near(again.photos.find((p) => p.name === b)?.coords, { lat: -30, lon: -40 })
  })

  it('a leftover exiftool temp file does not block writing and is removed', async () => {
    const file = join(tmp.dir, 'leftover.jpg')
    await makeJpeg(file)
    copyFileSync(file, `${file}_exiftool_tmp`)
    const folder = await scanFolder(tmp.dir, et)
    const outcome = await assignAndSave(folder, { 'leftover.jpg': { lat: 5, lon: 6 } }, memoryLog())
    expect(outcome.failed).toEqual([])
    expect(existsSync(`${file}_exiftool_tmp`)).toBe(false)
  })
})
