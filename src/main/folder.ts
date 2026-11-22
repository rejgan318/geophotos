import { readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { baseNameOf, formatOf, isSidecar, isSupported, sidecarNameOf, sidecarOwners, type PreviewKind } from '@shared/formats'
import {
  ADDRESS_READ_ARGS,
  comparePhotos,
  pickAddress,
  pickAltitude,
  embeddedPreviewTag,
  firstTrackPoint,
  pickCoords,
  type TrackPoint,
  tagValue,
  toPhoto,
  xmpCoords,
  type ExifRecord
} from '@shared/metadata'
import type { Address, CoordSource, LatLon, Photo } from '@shared/photo'
import type { WriteInfo } from '@shared/write-plan'
import type { ExifTool } from './exiftool'

/**
 * What main keeps about a photo besides what the window sees: how to make its thumbnail and
 * where its coordinates are written (`WriteInfo`, tz.md, пп. 6.3–6.4).
 */
export interface PhotoSource extends WriteInfo {
  preview: PreviewKind
  /** Embedded preview tag for `embedded` and `heic`; null if the file has none. */
  previewTag: string | null
  /** EXIF orientation (1–8) of the file; embedded previews are stored unrotated. */
  orientation: number
}

export interface ScannedFolder {
  photos: Photo[]
  sources: PhotoSource[]
  /** Subfolders that could not be read (no access): skipped. */
  unreadable: string[]
}

const COORD_TAGS = [
  '-EXIF:GPSAltitude',
  '-EXIF:GPSAltitudeRef',
  '-XMP:GPSAltitude',
  '-XMP:GPSAltitudeRef',
  '-EXIF:GPSLatitude',
  '-EXIF:GPSLatitudeRef',
  '-EXIF:GPSLongitude',
  '-EXIF:GPSLongitudeRef',
  '-XMP:GPSLatitude',
  '-XMP:GPSLongitude',
  '-QuickTime:GPSCoordinates'
]

const TAGS = [
  '-File:FileName',
  '-File:FileModifyDate',
  '-File:FileSize',
  '-File:FileType',
  '-File:MIMEType',
  '-EXIF:DateTimeOriginal',
  '-XMP:DateTimeOriginal',
  // Videos (tz.md, пп. 3.3.6, 4.2): dates, the camera, the length.
  '-XMP:CreateDate',
  '-QuickTime:CreateDate',
  '-QuickTime:MediaCreateDate',
  '-QuickTime:CreationDate',
  '-RIFF:DateTimeOriginal',
  '-Make',
  '-Model',
  '-QuickTime:CompressorVersion',
  '-Duration',
  ...COORD_TAGS,
  ...ADDRESS_READ_ARGS,
  '-EXIF:Orientation',
  '-PreviewImage',
  '-JpgFromRaw',
  '-OtherImage',
  '-ThumbnailImage',
  '-ExifTool:Error'
]

const SIDECAR_TAGS = [
  '-File:FileName',
  '-XMP:GPSLatitude',
  '-XMP:GPSLongitude',
  '-XMP:GPSAltitude',
  '-XMP:GPSAltitudeRef',
  ...ADDRESS_READ_ARGS
]

/** Whether a folder has folders inside it (tz.md, п. 3.2). */
export async function hasSubfolders(folder: string): Promise<boolean> {
  const entries = await readdir(folder, { withFileTypes: true })
  return entries.some((e) => e.isDirectory())
}

/**
 * Reads the photos of a folder and, with `subfolders`, of all folders inside it, all levels
 * (tz.md, п. 3.2). A photo from a subfolder is named by its path from the folder
 * (`2024-05\IMG_0001.jpg`). The photos of all folders are in one time order.
 */
export async function scanFolder(
  folder: string,
  exiftool: ExifTool,
  opts: { subfolders?: boolean } = {}
): Promise<ScannedFolder> {
  const unreadable: string[] = []
  const dirs = opts.subfolders ? await allFolders(folder, unreadable) : [folder]
  const items: Item[] = []
  for (const dir of dirs) {
    try {
      items.push(...(await scanOne(folder, dir, exiftool)))
    } catch (e) {
      // The folder itself must be readable; a subfolder that is not is skipped.
      if (dir === folder) throw e
      unreadable.push(dir)
    }
  }
  items.sort((a, b) => comparePhotos(a.photo, b.photo))
  return {
    photos: items.map((it, id) => ({ id, ...it.photo })),
    sources: items.map((it) => it.source),
    unreadable
  }
}

/** The folder and every folder inside it, all levels; unreadable ones go to `unreadable`. */
async function allFolders(folder: string, unreadable: string[]): Promise<string[]> {
  const result: string[] = []
  const queue = [folder]
  while (queue.length) {
    const dir = queue.shift()!
    result.push(dir)
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      const subs = entries.filter((e) => e.isDirectory()).map((e) => join(dir, e.name))
      queue.push(...subs.sort((a, b) => a.localeCompare(b)))
    } catch (e) {
      if (dir === folder) throw e
      unreadable.push(dir)
      result.pop()
    }
  }
  return result
}

type Item = { photo: Omit<Photo, 'id'>; source: PhotoSource }

/** The photos of one folder (`dir`), named by their path from the opened `root`. */
async function scanOne(root: string, folder: string, exiftool: ExifTool): Promise<Item[]> {
  const entries = await readdir(folder, { withFileTypes: true })
  const names = entries.filter((e) => e.isFile()).map((e) => e.name)
  const photoNames = names.filter(isSupported)
  const sidecarNames = names.filter(isSidecar)
  if (!photoNames.length) return []

  const own = sidecarOwners(photoNames)
  // Existing sidecars by base name, with their actual file names.
  const sidecarFiles = new Map(sidecarNames.map((n) => [baseNameOf(n).toLowerCase(), n]))

  const records = await readRecords(exiftool, folder, photoNames, TAGS)
  const sidecars = sidecarNames.length
    ? await readRecords(exiftool, folder, sidecarNames, SIDECAR_TAGS)
    : new Map<string, ExifRecord>()

  // Videos with no coordinates anywhere else: their GPS track, read deeper (п. 3.3.6). Slow, so
  // only for them.
  const deep = photoNames.filter((name) => {
    if (!formatOf(name)!.track) return false
    const rec = records.get(name.toLowerCase())
    const side = own.has(name) ? sidecars.get(sidecarFiles.get(baseNameOf(name).toLowerCase())?.toLowerCase() ?? '') : undefined
    return !!rec && !rec['ExifTool:Error'] && pickCoords(rec, side).coords === null
  })
  const tracks = await readTracks(exiftool, folder, deep)

  return photoNames.map((name) => {
    const path = join(folder, name)
    const rec = records.get(name.toLowerCase())
    const format = formatOf(name)!
    const owns = own.has(name)
    const sidecarFile = owns ? sidecarFiles.get(baseNameOf(name).toLowerCase()) : undefined
    const sidecarRec = sidecarFile ? sidecars.get(sidecarFile.toLowerCase()) : undefined
    const orientation = Number(tagValue(rec ?? {}, 'Orientation', 'EXIF') ?? 1)
    const source: PhotoSource = {
      path,
      write: format.write,
      xmpCoords: !!rec && xmpCoords(rec) !== null,
      sidecar: owns
        ? {
            path: join(folder, sidecarFile ?? sidecarNameOf(name)),
            exists: !!sidecarFile,
            coords: !!sidecarRec && xmpCoords(sidecarRec) !== null
          }
        : null,
      preview: format.preview,
      previewTag: format.preview === 'embedded' || format.preview === 'heic' ? embeddedPreviewTag(rec) : null,
      orientation: Number.isInteger(orientation) && orientation >= 1 && orientation <= 8 ? orientation : 1
    }
    const track = tracks.get(name.toLowerCase()) ?? null
    return { photo: toPhoto(relative(root, path), path, rec, sidecarRec, { video: format.video, track }), source }
  })
}

/** The first point of the GPS track of each video, by lower-case file name (п. 3.3.6). */
async function readTracks(exiftool: ExifTool, folder: string, names: string[]): Promise<Map<string, TrackPoint>> {
  const map = new Map<string, TrackPoint>()
  if (!names.length) return map
  const tags = ['-GPSLatitude', '-GPSLongitude', '-GPSLatitudeRef', '-GPSLongitudeRef', '-GPSAltitude']
  const recs = await exiftool
    .json(['-ee', '-n', '-G3', '-api', 'LargeFileSupport=1', '-File:FileName', ...tags, ...names.map((n) => join(folder, n))])
    .catch(() => [])
  for (const rec of recs) {
    // With -G3 the tags of the file itself are in the "Main" group.
    const name = rec['Main:FileName'] ?? baseOfSourceFile(rec)
    const point = firstTrackPoint(rec)
    if (typeof name === 'string' && point) map.set(name.toLowerCase(), point)
  }
  return map
}

export interface RereadCoords {
  coords: LatLon | null
  coordSource: CoordSource | null
  address: Address | null
  altitude: number | null
  xmpCoords: boolean
  sidecarExists: boolean
  sidecarCoords: boolean
}

/**
 * Reads the coordinates of some photos again, after writing (tz.md, п. 6.8), by the same rules
 * as when the folder is opened (п. 3.7). Results are in the order of `sources`.
 */
export async function rereadCoords(exiftool: ExifTool, sources: readonly PhotoSource[]): Promise<RereadCoords[]> {
  if (!sources.length) return []
  const files = await recordsByPath(exiftool, sources.map((s) => s.path), ['-File:FileName', ...COORD_TAGS, ...ADDRESS_READ_ARGS])
  const sidecarPaths = sources.flatMap((s) => (s.sidecar ? [s.sidecar.path] : []))
  const sidecars = sidecarPaths.length
    ? await recordsByPath(exiftool, sidecarPaths, SIDECAR_TAGS)
    : new Map<string, ExifRecord>()
  return sources.map((s) => {
    const rec = files.get(s.path.toLowerCase()) ?? {}
    const side = s.sidecar ? sidecars.get(s.sidecar.path.toLowerCase()) : undefined
    const { coords, source } = pickCoords(rec, side)
    return {
      coords,
      coordSource: source,
      address: pickAddress(rec, side),
      altitude: pickAltitude(rec, side),
      xmpCoords: xmpCoords(rec) !== null,
      sidecarExists: !!side,
      sidecarCoords: !!side && xmpCoords(side) !== null
    }
  })
}

/** exiftool records by lower-case file name. */
async function readRecords(
  exiftool: ExifTool,
  folder: string,
  names: string[],
  tags: string[]
): Promise<Map<string, ExifRecord>> {
  const recs = await exiftool.json(['-n', '-G0', ...tags, ...names.map((n) => join(folder, n))])
  const map = new Map<string, ExifRecord>()
  for (const rec of recs) {
    const name = tagValue(rec, 'FileName', 'File') ?? baseOfSourceFile(rec)
    if (typeof name === 'string') map.set(name.toLowerCase(), rec)
  }
  return map
}

/**
 * exiftool records by lower-case full path (files missing on disk are absent). Matched by the
 * whole path: photos of different subfolders can have the same name (tz.md, п. 3.2).
 */
async function recordsByPath(exiftool: ExifTool, paths: string[], tags: string[]): Promise<Map<string, ExifRecord>> {
  const byKey = new Map<string, string>()
  for (const p of paths) byKey.set(pathKey(p), p.toLowerCase())
  // Missing files (a sidecar not created yet) make exiftool report an error: no records then.
  const recs = await exiftool.json(['-n', '-G0', ...tags, ...paths]).catch(() => [])
  const map = new Map<string, ExifRecord>()
  for (const rec of recs) {
    const src = rec['SourceFile']
    const path = typeof src === 'string' ? byKey.get(pathKey(src)) : undefined
    if (path) map.set(path, rec)
  }
  return map
}

/** A path to compare: exiftool gives SourceFile with forward slashes; case does not matter. */
function pathKey(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase()
}

function baseOfSourceFile(rec: ExifRecord): string | undefined {
  const src = rec['SourceFile']
  if (typeof src !== 'string') return undefined
  return fileNameOf(src)
}

/** Last part of a path with either kind of slash. */
function fileNameOf(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? path
}
