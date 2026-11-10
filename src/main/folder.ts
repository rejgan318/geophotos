import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { baseNameOf, formatOf, isSidecar, isSupported, type PreviewKind } from '@shared/formats'
import { comparePhotos, embeddedPreviewTag, tagValue, toPhoto, type ExifRecord } from '@shared/metadata'
import type { Photo } from '@shared/photo'
import type { ExifTool } from './exiftool'

/** What main keeps about a photo besides what the window sees: how to make its thumbnail. */
export interface PhotoSource {
  path: string
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

const TAGS = [
  '-File:FileName',
  '-File:FileModifyDate',
  '-File:FileType',
  '-File:MIMEType',
  '-EXIF:DateTimeOriginal',
  '-XMP:DateTimeOriginal',
  '-EXIF:GPSLatitude',
  '-EXIF:GPSLatitudeRef',
  '-EXIF:GPSLongitude',
  '-EXIF:GPSLongitudeRef',
  '-XMP:GPSLatitude',
  '-XMP:GPSLongitude',
  '-EXIF:Orientation',
  '-PreviewImage',
  '-JpgFromRaw',
  '-OtherImage',
  '-ThumbnailImage',
  '-ExifTool:Error'
]

const SIDECAR_TAGS = ['-XMP:GPSLatitude', '-XMP:GPSLongitude']

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
  const sidecarOwner = (name: string): boolean => {
    const base = baseNameOf(name).toLowerCase()
    return !rawBases.has(base) || !!formatOf(name)?.raw
  }

  const records = await readRecords(exiftool, folder, photoNames, TAGS)
  const sidecars = new Map<string, ExifRecord>()
  if (sidecarNames.length) {
    const recs = await readRecords(exiftool, folder, sidecarNames, SIDECAR_TAGS)
    for (const [name, rec] of recs) sidecars.set(baseNameOf(name).toLowerCase(), rec)
  }

  const items = photoNames.map((name) => {
    const path = join(folder, name)
    const rec = records.get(name.toLowerCase())
    const sidecar = sidecarOwner(name) ? sidecars.get(baseNameOf(name).toLowerCase()) : undefined
    const format = formatOf(name)!
    const orientation = Number(tagValue(rec ?? {}, 'Orientation', 'EXIF') ?? 1)
    const source: PhotoSource = {
      path,
      preview: format.preview,
      previewTag: format.preview === 'image' ? null : embeddedPreviewTag(rec),
      orientation: Number.isInteger(orientation) && orientation >= 1 && orientation <= 8 ? orientation : 1
    }
    return { photo: toPhoto(name, path, rec, sidecar), source }
  })

  items.sort((a, b) => comparePhotos(a.photo, b.photo))
  return {
    photos: items.map((it, id) => ({ id, ...it.photo })),
    sources: items.map((it) => it.source)
  }
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

function baseOfSourceFile(rec: ExifRecord): string | undefined {
  const src = rec['SourceFile']
  if (typeof src !== 'string') return undefined
  return src.split(/[\\/]/).at(-1)
}
