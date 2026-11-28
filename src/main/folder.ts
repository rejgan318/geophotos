import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { baseNameOf, formatOf, isSidecar, isSupported, sidecarNameOf, sidecarOwners, type PreviewKind } from '@shared/formats'
import {
  ADDRESS_READ_ARGS,
  comparePhotos,
  pickAddress,
  pickAltitude,
  embeddedPreviewTag,
  firstTrackPoint,
  pickCoords,
  pickDirection,
  type TrackPoint,
  tagValue,
  toPhoto,
  xmpCoords,
  type ExifRecord
} from '@shared/metadata'
import { contentId, embeddedLiveTag, LIVE_MARK_TAGS, LIVE_VIDEO_TAGS, livePairs } from '@shared/live'
import type { Address, CoordSource, LatLon, Photo } from '@shared/photo'
import type { WriteInfo } from '@shared/write-plan'
import { displayName, parentOf } from '@shared/project'
import { allPoints, isTrackFile, timeSpan, trackInfo, type TrackData } from '@shared/track'
import { wallTime, zoneAt } from '@shared/dates'
import { readTrack } from './tracks'
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
  /**
   * A live photo (tz.md, п. 3.3.7): the tag of the video inside the file, or the MOV of an iPhone
   * pair — written together with the photo (its WriteInfo). Null for others.
   */
  live: { kind: 'embedded'; tag: string } | { kind: 'pair'; video: WriteInfo } | null
  /**
   * A track (tz.md, п. 3.9): its lines and points, and the time zone of its place (local times of
   * the tooltip and the summary). Null for a track file that could not be read; absent for photos.
   */
  track?: { data: TrackData; zone: string | null } | null
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

/** Where the camera looked (tz.md, пп. 4.20, 4.21). */
const DIRECTION_TAGS = ['-EXIF:GPSImgDirection', '-XMP:GPSImgDirection']

const TAGS = [
  // Not to the end of a JPEG (tz.md, п. 3.10): 2.6 times faster on phone photos. What is lost is the
  // video of a Motion Photo at the end of the file: such a photo is known by its XMP mark instead
  // (LIVE_MARK_TAGS), and the video itself is taken out when it plays.
  '-fast',
  '-File:FileName',
  '-File:FileModifyDate',
  '-File:FileSize',
  '-File:FileType',
  '-File:MIMEType',
  '-EXIF:DateTimeOriginal',
  // The time zone of the shooting time (phones): the exact instant, for the place on a track (tz.md, п. 3.9.7).
  '-EXIF:OffsetTimeOriginal',
  // Where the camera looked (phones; tz.md, 0.35.0): the sector at the current photo's marker.
  '-EXIF:GPSImgDirection',
  '-XMP:GPSImgDirection',
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
  // Live photos (tz.md, п. 3.3.7): the video inside, the identifier of an iPhone pair.
  ...LIVE_VIDEO_TAGS.map((t) => `-${t}`),
  ...LIVE_MARK_TAGS.map((t) => `-${t}`),
  '-ContentIdentifier',
  '-ExifTool:Error'
]

const SIDECAR_TAGS = [
  '-File:FileName',
  '-XMP:GPSLatitude',
  '-XMP:GPSLongitude',
  '-XMP:GPSAltitude',
  '-XMP:GPSAltitudeRef',
  '-XMP:GPSImgDirection',
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

/**
 * Reads some files (tz.md, п. 3.1: added to the strip). Named by their path from `folder` (the
 * opened one) if they are in it, else by the full path (п. 3.2). Read by the same rules as a
 * folder: the XMP next to a file (п. 3.7) and the MOV of an iPhone Live Photo (п. 3.3.7) come
 * along although not given. Files that are not photos or videos, or are missing, are skipped.
 * A folder that cannot be read: its files are skipped, the folder is in `unreadable`.
 */
export async function scanFiles(folder: string | null, files: readonly string[], exiftool: ExifTool): Promise<ScannedFolder> {
  const byDir = new Map<string, { dir: string; names: Set<string> }>()
  for (const file of files) {
    const name = fileNameOf(file)
    if (!isSupported(name) && !isTrackFile(name)) continue
    const dir = parentOf(file)
    const key = dir.toLowerCase()
    const entry = byDir.get(key) ?? { dir, names: new Set<string>() }
    entry.names.add(name.toLowerCase())
    byDir.set(key, entry)
  }
  const unreadable: string[] = []
  const items: Item[] = []
  for (const { dir, names } of byDir.values()) {
    try {
      items.push(...(await scanOne(folder, dir, exiftool, names)))
    } catch {
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

/**
 * The photos of one folder (`dir`), named by their path from the opened `root` (п. 3.2). With
 * `only` (lower-case file names), just those files — and the MOV of a live pair of a photo
 * among them (п. 3.3.7).
 */
async function scanOne(root: string | null, folder: string, exiftool: ExifTool, only?: ReadonlySet<string>): Promise<Item[]> {
  const entries = await readdir(folder, { withFileTypes: true })
  const names = entries.filter((e) => e.isFile()).map((e) => e.name)
  const supported = names.filter(isSupported)
  const given = (n: string): boolean => !only || only.has(n.toLowerCase())
  // Tracks of the folder (tz.md, п. 3.9.2) are items of the strip too.
  const tracks = await Promise.all(names.filter((n) => isTrackFile(n) && given(n)).map((n) => trackItem(root, join(folder, n))))
  return [...tracks, ...(await scanPhotos(root, folder, exiftool, names, supported, given))]
}

/**
 * A track file as an item of the strip (tz.md, п. 3.9.3): dated by its first time, as local time
 * of its place. A file that cannot be read is an item with an error (shown as a placeholder).
 */
async function trackItem(root: string | null, path: string): Promise<Item> {
  let data: TrackData | null = null
  let error: string | undefined
  try {
    data = await readTrack(path)
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }
  const size = (await stat(path).catch(() => null))?.size
  const span = data ? timeSpan(data) : null
  const first = data ? (allPoints(data)[0] ?? data.waypoints[0]) : undefined
  const zone = first ? zoneAt(first) : undefined
  const date = span ? wallTime(new Date(span.start), zone) : null
  return {
    photo: {
      name: displayName(root, path),
      path,
      date,
      dateSource: 'shot',
      coords: null,
      coordSource: null,
      address: null,
      altitude: null,
      modified: false,
      ...(error ? { error } : {}),
      ...(size !== undefined ? { size } : {}),
      track: data ? trackInfo(data) : { points: 0, waypoints: 0, distance: 0, duration: null, color: 0 }
    },
    source: {
      path,
      write: 'file',
      xmpCoords: false,
      sidecar: null,
      preview: 'track',
      previewTag: null,
      orientation: 1,
      live: null,
      track: data ? { data, zone: zone ?? null } : null
    }
  }
}

/** The photos and videos of one folder (see scanOne). */
async function scanPhotos(
  root: string | null,
  folder: string,
  exiftool: ExifTool,
  names: string[],
  supported: string[],
  given: (n: string) => boolean
): Promise<Item[]> {
  // Videos that may be the MOV of a live pair of a given photo: the same base name.
  const photoBases = new Set(supported.filter((n) => given(n) && !formatOf(n)!.video).map((n) => baseNameOf(n).toLowerCase()))
  const photoNames = supported.filter((n) => given(n) || (formatOf(n)!.video && photoBases.has(baseNameOf(n).toLowerCase())))
  const sidecarNames = names.filter(isSidecar)
  if (!photoNames.length) return []

  // Who owns an XMP is decided by the whole folder (п. 3.7: a RAW of the name wins over a video).
  const own = sidecarOwners(supported)
  // Existing sidecars by base name, with their actual file names. "IMG_0001.JPG.xmp" has the base
  // name "IMG_0001.JPG": the sidecar of that whole file name (п. 3.7), found by the file's own name.
  const sidecarFiles = new Map(sidecarNames.map((n) => [baseNameOf(n).toLowerCase(), n]))
  const fullSidecar = (name: string): { file: string | undefined; rec: ExifRecord | undefined } => {
    const file = sidecarFiles.get(name.toLowerCase())
    return { file, rec: file ? sidecars.get(file.toLowerCase()) : undefined }
  }

  const records = await readRecords(exiftool, folder, photoNames, TAGS)
  const sidecars = sidecarNames.length
    ? await readRecords(exiftool, folder, sidecarNames, SIDECAR_TAGS)
    : new Map<string, ExifRecord>()

  // iPhone Live Photos (п. 3.3.7): the MOV of a pair is not an item of its own, it goes with the photo.
  const pairs = livePairs(
    photoNames.map((name) => ({ name, video: formatOf(name)!.video, contentId: contentId(records.get(name.toLowerCase())) }))
  )
  const pairedVideos = new Set(pairs.values())

  // Videos with no coordinates anywhere else: their GPS track, read deeper (п. 3.3.6). Slow, so
  // only for them.
  const deep = photoNames.filter((name) => {
    if (!formatOf(name)!.track || pairedVideos.has(name)) return false
    const rec = records.get(name.toLowerCase())
    const side = fullSidecar(name).rec ?? (own.has(name) ? sidecars.get(sidecarFiles.get(baseNameOf(name).toLowerCase())?.toLowerCase() ?? '') : undefined)
    return !!rec && !rec['ExifTool:Error'] && pickCoords(rec, side).coords === null
  })
  const tracks = await readTracks(exiftool, folder, deep)

  return photoNames.filter((name) => !pairedVideos.has(name) && given(name)).map((name) => {
    const path = join(folder, name)
    const rec = records.get(name.toLowerCase())
    const format = formatOf(name)!
    const pairName = pairs.get(name)
    const pairRec = pairName ? records.get(pairName.toLowerCase()) : undefined
    const embedded = format.video ? null : embeddedLiveTag(rec)
    const live: PhotoSource['live'] = pairName
      ? {
          kind: 'pair',
          // Written with the photo; the sidecar of the name, if any, is the photo's.
          video: {
            path: join(folder, pairName),
            write: formatOf(pairName)!.write,
            video: true,
            xmpCoords: !!pairRec && xmpCoords(pairRec) !== null,
            sidecar: null,
            fullSidecar: fullSidecarInfo(folder, pairName, fullSidecar(pairName))
          }
        }
      : embedded
        ? { kind: 'embedded', tag: embedded }
        : null
    const owns = own.has(name)
    const sidecarFile = owns ? sidecarFiles.get(baseNameOf(name).toLowerCase()) : undefined
    const sidecarRec = sidecarFile ? sidecars.get(sidecarFile.toLowerCase()) : undefined
    // The sidecar of the whole file name is read first (п. 3.7).
    const full = fullSidecar(name)
    const side = full.rec ?? sidecarRec
    const orientation = Number(tagValue(rec ?? {}, 'Orientation', 'EXIF') ?? 1)
    const source: PhotoSource = {
      path,
      write: format.write,
      video: format.video,
      xmpCoords: !!rec && xmpCoords(rec) !== null,
      innerCoords: !!rec && pickCoords(rec, undefined).coords !== null,
      fullSidecar: fullSidecarInfo(folder, name, full),
      sidecar: owns
        ? {
            path: join(folder, sidecarFile ?? sidecarNameOf(name)),
            exists: !!sidecarFile,
            coords: !!sidecarRec && xmpCoords(sidecarRec) !== null
          }
        : null,
      preview: format.preview,
      previewTag: format.preview === 'embedded' || format.preview === 'heic' ? embeddedPreviewTag(rec) : null,
      orientation: Number.isInteger(orientation) && orientation >= 1 && orientation <= 8 ? orientation : 1,
      live
    }
    const track = tracks.get(name.toLowerCase()) ?? null
    const photo = toPhoto(displayName(root, path), path, rec, side, { video: format.video, track })
    return { photo: live ? { ...photo, live: true as const } : photo, source }
  })
}

/** The sidecar of the whole file name of a file (п. 6.4): where it is or would be, and what it holds. */
function fullSidecarInfo(folder: string, name: string, found: { file: string | undefined; rec: ExifRecord | undefined }): NonNullable<WriteInfo['fullSidecar']> {
  return {
    path: join(folder, found.file ?? `${name}.xmp`),
    exists: !!found.file,
    coords: !!found.rec && xmpCoords(found.rec) !== null
  }
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
  /** Absent — none. */
  direction?: number
  xmpCoords: boolean
  innerCoords: boolean
  sidecarExists: boolean
  sidecarCoords: boolean
  fullSidecarExists: boolean
  fullSidecarCoords: boolean
}

/**
 * Reads the coordinates of some photos again, after writing (tz.md, п. 6.8), by the same rules
 * as when the folder is opened (п. 3.7). Results are in the order of `sources`.
 */
export async function rereadCoords(exiftool: ExifTool, sources: readonly PhotoSource[]): Promise<RereadCoords[]> {
  if (!sources.length) return []
  const files = await recordsByPath(exiftool, sources.map((s) => s.path), ['-File:FileName', ...COORD_TAGS, ...DIRECTION_TAGS, ...ADDRESS_READ_ARGS])
  const fullPath = (s: PhotoSource): string => s.fullSidecar?.path ?? `${s.path}.xmp`
  // Both sidecars of each file: the one of its base name it owns and the one of its whole name (п. 3.7).
  const sidecarPaths = sources.flatMap((s) => [...(s.sidecar ? [s.sidecar.path] : []), ...(s.track === undefined ? [fullPath(s)] : [])])
  const sidecars = sidecarPaths.length
    ? await recordsByPath(exiftool, sidecarPaths, SIDECAR_TAGS)
    : new Map<string, ExifRecord>()
  return sources.map((s) => {
    const rec = files.get(s.path.toLowerCase()) ?? {}
    const base = s.sidecar ? sidecars.get(s.sidecar.path.toLowerCase()) : undefined
    const full = sidecars.get(fullPath(s).toLowerCase())
    const side = full ?? base
    const { coords, source } = pickCoords(rec, side)
    const direction = pickDirection(rec, side)
    return {
      coords,
      coordSource: source,
      address: pickAddress(rec, side),
      altitude: pickAltitude(rec, side),
      ...(direction !== null ? { direction } : {}),
      xmpCoords: xmpCoords(rec) !== null,
      innerCoords: pickCoords(rec, undefined).coords !== null,
      sidecarExists: !!base,
      sidecarCoords: !!base && xmpCoords(base) !== null,
      fullSidecarExists: !!full,
      fullSidecarCoords: !!full && xmpCoords(full) !== null
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
  // Split among the exiftool processes (tz.md, п. 3.10).
  const recs = await exiftool.jsonFiles(['-n', '-G0', ...tags], names.map((n) => join(folder, n)))
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
  const recs = await exiftool.jsonFiles(['-n', '-G0', ...tags], paths).catch(() => [])
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
