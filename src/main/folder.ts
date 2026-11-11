import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { baseNameOf, formatOf, isSidecar, isSupported, sidecarNameOf, type PreviewKind } from '@shared/formats'
import {
  comparePhotos,
  embeddedPreviewTag,
  pickCoords,
  tagValue,
  toPhoto,
  xmpCoords,
  type ExifRecord
} from '@shared/metadata'
import type { CoordSource, LatLon, Photo } from '@shared/photo'
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
}

const COORD_TAGS = [
  '-EXIF:GPSLatitude',
  '-EXIF:GPSLatitudeRef',
  '-EXIF:GPSLongitude',
  '-EXIF:GPSLongitudeRef',
  '-XMP:GPSLatitude',
  '-XMP:GPSLongitude'
]

const TAGS = [
  '-File:FileName',
  '-File:FileModifyDate',
  '-File:FileType',
  '-File:MIMEType',
  '-EXIF:DateTimeOriginal',
  '-XMP:DateTimeOriginal',
  ...COORD_TAGS,
  '-EXIF:Orientation',
  '-PreviewImage',
  '-JpgFromRaw',
  '-OtherImage',
  '-ThumbnailImage',
  '-ExifTool:Error'
]

const SIDECAR_TAGS = ['-File:FileName', '-XMP:GPSLatitude', '-XMP:GPSLongitude']

/** Reads the photos of one folder, without subfolders (tz.md, п. 9.1). */
export async function scanFolder(folder: string, exiftool: ExifTool): Promise<ScannedFolder> {
  const entries = await readdir(folder, { withFileTypes: true })
  const names = entries.filter((e) => e.isFile()).map((e) => e.name)
  const photoNames = names.filter(isSupported)
  const sidecarNames = names.filter(isSidecar)
  if (!photoNames.length) return { photos: [], sources: [] }

  // A sidecar belongs to the RAW file with the same name if there is one (tz.md, п. 3.7).
  const rawBases = new Set(
    photoNames.filter((n) => formatOf(n)?.raw).map((n) => baseNameOf(n).toLowerCase())
  )
  const ownsSidecar = (name: string): boolean => {
    const base = baseNameOf(name).toLowerCase()
    return !rawBases.has(base) || !!formatOf(name)?.raw
  }
  // Existing sidecars by base name, with their actual file names.
  const sidecarFiles = new Map(sidecarNames.map((n) => [baseNameOf(n).toLowerCase(), n]))

  const records = await readRecords(exiftool, folder, photoNames, TAGS)
  const sidecars = sidecarNames.length
    ? await readRecords(exiftool, folder, sidecarNames, SIDECAR_TAGS)
    : new Map<string, ExifRecord>()

  const items = photoNames.map((name) => {
    const path = join(folder, name)
    const rec = records.get(name.toLowerCase())
    const format = formatOf(name)!
    const own = ownsSidecar(name)
    const sidecarFile = own ? sidecarFiles.get(baseNameOf(name).toLowerCase()) : undefined
    const sidecarRec = sidecarFile ? sidecars.get(sidecarFile.toLowerCase()) : undefined
    const orientation = Number(tagValue(rec ?? {}, 'Orientation', 'EXIF') ?? 1)
    const source: PhotoSource = {
      path,
      write: format.write,
      xmpCoords: !!rec && xmpCoords(rec) !== null,
      sidecar: own
        ? {
            path: join(folder, sidecarFile ?? sidecarNameOf(name)),
            exists: !!sidecarFile,
            coords: !!sidecarRec && xmpCoords(sidecarRec) !== null
          }
        : null,
      preview: format.preview,
      previewTag: format.preview === 'image' ? null : embeddedPreviewTag(rec),
      orientation: Number.isInteger(orientation) && orientation >= 1 && orientation <= 8 ? orientation : 1
    }
    return { photo: toPhoto(name, path, rec, sidecarRec), source }
  })

  items.sort((a, b) => comparePhotos(a.photo, b.photo))
  return {
    photos: items.map((it, id) => ({ id, ...it.photo })),
    sources: items.map((it) => it.source)
  }
}

export interface RereadCoords {
  coords: LatLon | null
  coordSource: CoordSource | null
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
  const files = await recordsByPath(exiftool, sources.map((s) => s.path), ['-File:FileName', ...COORD_TAGS])
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

/** exiftool records by lower-case full path (files missing on disk are absent). */
async function recordsByPath(exiftool: ExifTool, paths: string[], tags: string[]): Promise<Map<string, ExifRecord>> {
  const byName = new Map<string, string>()
  for (const p of paths) byName.set(fileNameOf(p).toLowerCase(), p.toLowerCase())
  // Missing files (a sidecar not created yet) make exiftool report an error: no records then.
  const recs = await exiftool.json(['-n', '-G0', ...tags, ...paths]).catch(() => [])
  const map = new Map<string, ExifRecord>()
  for (const rec of recs) {
    // SourceFile comes back with forward slashes; the file name identifies it within the folder.
    const name = tagValue(rec, 'FileName', 'File') ?? baseOfSourceFile(rec)
    const path = typeof name === 'string' ? byName.get(name.toLowerCase()) : undefined
    if (path) map.set(path, rec)
  }
  return map
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
