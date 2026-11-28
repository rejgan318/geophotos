import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { assignCoords, assignDirection } from '@shared/edits'
import type { FileMeta, LatLon, Photo } from '@shared/photo'
import { scanFolder, type ScannedFolder } from '../../src/main/folder'
import { savePhotos, type SaveLog, type SaveOutcome } from '../../src/main/save'
import { makeJpeg, newExifTool, tempDir, writeTags } from './helpers'

const et = newExifTool()
const tmp = tempDir()
afterAll(() => {
  et.close()
  tmp.remove()
})

const log: SaveLog = { info: () => {}, error: () => {} }
const sha = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex')
const meta = (p: Photo): FileMeta => ({ coords: p.coords, address: p.address, altitude: p.altitude, ...(p.direction !== undefined ? { direction: p.direction } : {}) })

const near = (c: LatLon | null | undefined, expected: LatLon): void => {
  expect(c?.lat).toBeCloseTo(expected.lat, 6)
  expect(c?.lon).toBeCloseTo(expected.lon, 6)
}

/** Applies a change to the only photo of the folder (as the window does) and saves it. */
async function change(
  folder: ScannedFolder,
  edit: (photos: Photo[], file: FileMeta[]) => Photo[],
  xmpOnly: boolean
): Promise<SaveOutcome> {
  const photos = [...folder.photos]
  const file = photos.map(meta)
  for (const p of edit(photos, file)) photos[p.id] = p
  const items = photos.filter((p) => p.modified).map((p) => ({ photo: p, source: folder.sources[p.id]!, old: file[p.id]?.coords ?? null }))
  return savePhotos(et, items, log, undefined, { xmpOnly })
}

async function folderWith(name: string, tags: string[] = []): Promise<{ dir: string; file: string }> {
  const dir = join(tmp.dir, name)
  mkdirSync(dir)
  const file = join(dir, 'IMG_0001.JPG')
  await makeJpeg(file)
  if (tags.length) await writeTags(et, file, ['-n', ...tags])
  return { dir, file }
}

const EXIF_AT = (c: LatLon): string[] => [
  `-EXIF:GPSLatitude=${Math.abs(c.lat)}`,
  `-EXIF:GPSLatitudeRef=${c.lat < 0 ? 'S' : 'N'}`,
  `-EXIF:GPSLongitude=${Math.abs(c.lon)}`,
  `-EXIF:GPSLongitudeRef=${c.lon < 0 ? 'W' : 'E'}`
]

describe('save.xmpOnly (tz.md, п. 6.4)', () => {
  it('the JPEG is not changed: coordinates and direction go to IMG_0001.JPG.xmp, read first after', async () => {
    const { dir, file } = await folderWith('new')
    const hash = sha(file)
    const folder = await scanFolder(dir, et)
    expect(folder.sources[0]!.fullSidecar).toEqual({ path: `${file}.xmp`, exists: false, coords: false })
    const at = { lat: -33.8568, lon: 151.2153 }
    const outcome = await change(folder, (photos, f) => {
      const placed = assignCoords(photos, f, [0], at)
      return assignDirection(placed, f, [0], 271.6)
    }, true)
    expect(outcome.failed).toEqual([])
    expect(sha(file)).toBe(hash)
    expect(existsSync(`${file}.xmp`)).toBe(true)
    // Not the Lightroom name of a RAW sidecar.
    expect(existsSync(join(dir, 'IMG_0001.xmp'))).toBe(false)
    const saved = outcome.saved[0]!
    expect(saved.photo.coordSource).toBe('sidecar')
    near(saved.photo.coords, at)
    expect(saved.photo.direction).toBe(272)
    expect(saved.source.fullSidecar).toEqual({ path: `${file}.xmp`, exists: true, coords: true })
    const again = await scanFolder(dir, et)
    expect(again.photos.map((p) => p.name)).toEqual(['IMG_0001.JPG'])
    expect(again.photos[0]!.coordSource).toBe('sidecar')
    near(again.photos[0]!.coords, at)
    expect(again.photos[0]!.direction).toBe(272)
  })

  it('coordinates inside the file: new ones go to the XMP and win; Del cannot remove the inner ones', async () => {
    const inside = { lat: 10, lon: 20 }
    const { dir, file } = await folderWith('inside', EXIF_AT(inside))
    const hash = sha(file)
    const folder = await scanFolder(dir, et)
    expect(folder.sources[0]!.innerCoords).toBe(true)
    const moved = { lat: 10.5, lon: 20.5 }
    expect((await change(folder, (p, f) => assignCoords(p, f, [0], moved), true)).failed).toEqual([])
    expect(sha(file)).toBe(hash)
    const after = await scanFolder(dir, et)
    expect(after.photos[0]!.coordSource).toBe('sidecar')
    near(after.photos[0]!.coords, moved)

    const del = await change(after, (p, f) => assignCoords(p, f, [0], null), true)
    expect(del.failed).toHaveLength(1)
    expect(del.failed[0]!.error).toMatch(/inside the file/)
    expect(sha(file)).toBe(hash)
  })

  it('Del removes the coordinates from the XMP when the file has none of its own', async () => {
    const { dir, file } = await folderWith('del')
    const hash = sha(file)
    const first = await scanFolder(dir, et)
    expect((await change(first, (p, f) => assignCoords(p, f, [0], { lat: 1, lon: 2 }), true)).failed).toEqual([])
    const placed = await scanFolder(dir, et)
    const del = await change(placed, (p, f) => assignCoords(p, f, [0], null), true)
    expect(del.failed).toEqual([])
    expect(del.saved[0]!.photo.coords).toBeNull()
    expect(sha(file)).toBe(hash)
    expect((await scanFolder(dir, et)).photos[0]!.coords).toBeNull()
  })
})

describe('the sidecar of the whole file name without save.xmpOnly (tz.md, пп. 3.7, 6.3)', () => {
  it('is read first and gets the same values when the file is written', async () => {
    const { dir, file } = await folderWith('both', EXIF_AT({ lat: 10, lon: 20 }))
    await writeTags(et, `${file}.xmp`, ['-n', '-XMP-exif:GPSLatitude=30', '-XMP-exif:GPSLongitude=40'])
    const folder = await scanFolder(dir, et)
    expect(folder.photos[0]!.coordSource).toBe('sidecar')
    near(folder.photos[0]!.coords, { lat: 30, lon: 40 })
    const at = { lat: -5, lon: -6 }
    const outcome = await change(folder, (p, f) => assignCoords(p, f, [0], at), false)
    expect(outcome.failed).toEqual([])
    const [rec] = await et.json(['-n', '-G0', '-EXIF:GPSLatitude', '-EXIF:GPSLatitudeRef', file])
    expect(rec!['EXIF:GPSLatitude']).toBeCloseTo(5, 6)
    expect(rec!['EXIF:GPSLatitudeRef']).toBe('S')
    const [side] = await et.json(['-n', '-G0', '-XMP:GPSLatitude', '-XMP:GPSLongitude', `${file}.xmp`])
    expect(side!['XMP:GPSLatitude']).toBeCloseTo(-5, 6)
    expect(side!['XMP:GPSLongitude']).toBeCloseTo(-6, 6)
    near((await scanFolder(dir, et)).photos[0]!.coords, at)
  })
})

describe('the shooting direction (tz.md, п. 4.21)', () => {
  it('is written to EXIF from true north and read back; a move over 30 m removes it from the file', async () => {
    const at = { lat: 48.8584, lon: 2.2945 }
    const { dir, file } = await folderWith('direction', EXIF_AT(at))
    const folder = await scanFolder(dir, et)
    expect((await change(folder, (p, f) => assignDirection(p, f, [0], 45), false)).failed).toEqual([])
    const [rec] = await et.json(['-n', '-G0', '-EXIF:GPSImgDirection', '-EXIF:GPSImgDirectionRef', file])
    expect(rec!['EXIF:GPSImgDirection']).toBe(45)
    expect(rec!['EXIF:GPSImgDirectionRef']).toBe('T')
    const set = await scanFolder(dir, et)
    expect(set.photos[0]!.direction).toBe(45)
    expect(set.photos[0]!.modified).toBe(false)

    // About 11 m: the place is only corrected, the direction stays and nothing more is written.
    const corrected = assignCoords(set.photos, set.photos.map(meta), [0], { lat: at.lat + 0.0001, lon: at.lon })
    expect(corrected[0]!.direction).toBe(45)

    // About 1.1 km: the direction goes.
    expect((await change(set, (p, f) => assignCoords(p, f, [0], { lat: at.lat + 0.01, lon: at.lon }), false)).failed).toEqual([])
    const [gone] = await et.json(['-n', '-G0', '-EXIF:GPSImgDirection', file])
    expect(gone!['EXIF:GPSImgDirection']).toBeUndefined()
    expect((await scanFolder(dir, et)).photos[0]!.direction).toBeUndefined()
  })
})
