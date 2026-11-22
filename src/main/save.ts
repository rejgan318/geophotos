import { constants, existsSync, rmSync } from 'node:fs'
import { access } from 'node:fs/promises'
import { addressText, formatCoords, type LatLon, type Photo } from '@shared/photo'
import { writePlan, writeResult, type WriteStep } from '@shared/write-plan'
import type { ExifTool } from './exiftool'
import { rereadCoords, type PhotoSource } from './folder'

/** Logging used by saving; main passes electron-log, tests a stub. */
export interface SaveLog {
  info(msg: string): void
  error(msg: string): void
}

export interface SaveItem {
  photo: Photo
  source: PhotoSource
  /** Coordinates in the file before writing (for the log, tz.md, п. 6.9). */
  old: LatLon | null
}

export interface SaveFailure {
  id: number
  name: string
  error: string
}

export interface SaveOutcome {
  /** Written photos with coordinates read back from the files (п. 6.8). */
  saved: { id: number; photo: Photo; source: PhotoSource }[]
  failed: SaveFailure[]
}

function coordsText(c: LatLon | null): string {
  return c ? formatCoords(c) : 'none'
}

/** Why a file cannot be written, found before exiftool runs (exiftool would leave a temp file). */
async function checkWritable(step: WriteStep): Promise<string | null> {
  if (step.create) return null
  try {
    await access(step.path, constants.W_OK)
    return null
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return `File not found: ${step.path}`
    if (code === 'EPERM' || code === 'EACCES') return `File is read-only or access is denied: ${step.path}`
    return `${String(e)}: ${step.path}`
  }
}

/** Runs one write; throws with the reason. A temp file left by exiftool is removed. */
async function runStep(exiftool: ExifTool, step: WriteStep): Promise<void> {
  const reason = await checkWritable(step)
  if (reason) throw new Error(reason)
  const tmp = `${step.path}_exiftool_tmp`
  // Left by an earlier failure: exiftool refuses to write while it exists.
  if (existsSync(tmp)) rmSync(tmp, { force: true })
  try {
    const { stdout, stderr } = await exiftool.run([...step.args, step.path])
    const res = writeResult(stdout.toString('utf8'), stderr)
    if (!res.ok) throw new Error(res.error)
  } finally {
    if (existsSync(tmp)) rmSync(tmp, { force: true })
  }
}

/**
 * Writes the coordinates of the photos one by one (tz.md, п. 6): each file by its plan; a photo
 * whose write fails is reported and keeps its unsaved coordinates. The written photos are read
 * again (п. 6.8). Each write goes to the log with old and new coordinates (п. 6.9).
 */
export async function savePhotos(
  exiftool: ExifTool,
  items: readonly SaveItem[],
  log: SaveLog,
  onProgress?: (done: number, total: number) => void
): Promise<SaveOutcome> {
  const written: SaveItem[] = []
  const failed: SaveFailure[] = []
  let done = 0
  for (const item of items) {
    const { photo, source } = item
    try {
      // A RAW file, or a video exiftool cannot write, is never changed (пп. 6.4, 3.3.6): coordinates
      // inside it cannot be removed. Nor can a GPS track of a video (п. 6.6).
      if (!photo.coords && source.write === 'xmp' && photo.coordSource !== 'sidecar') {
        throw new Error(
          source.video
            ? 'The coordinates are inside the video file, which the program cannot change'
            : 'The coordinates are inside the RAW file, which the program never changes'
        )
      }
      if (!photo.coords && photo.coordSource === 'track') {
        throw new Error('The coordinates are in the GPS track of the video, which the program does not remove')
      }
      const steps = writePlan(source, photo.coords, photo.address, photo.altitude)
      for (const step of steps) await runStep(exiftool, step)
      written.push(item)
      log.info(
        `${photo.coords ? 'Coordinates written' : 'Coordinates removed'}: ${photo.path}; old: ${coordsText(item.old)}; new: ${coordsText(photo.coords)}; ` +
          `address: ${photo.address ? addressText(photo.address) || '(empty)' : 'none'}; ` +
          `altitude: ${photo.altitude === null ? 'none' : `${photo.altitude} m`}; ` +
          `to: ${steps.map((s) => (s.create ? `${s.path} (created)` : s.path)).join(', ')}`
      )
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      failed.push({ id: photo.id, name: photo.name, error })
      log.error(`Write error: ${photo.path}: ${error}; coordinates not saved: ${coordsText(photo.coords)}`)
    }
    onProgress?.(++done, items.length)
  }

  const reread = await rereadCoords(exiftool, written.map((w) => w.source))
  const saved = written.map((w, i) => {
    const r = reread[i]!
    const source: PhotoSource = {
      ...w.source,
      xmpCoords: r.xmpCoords,
      sidecar: w.source.sidecar ? { ...w.source.sidecar, exists: r.sidecarExists, coords: r.sidecarCoords } : null
    }
    const photo: Photo = { ...w.photo, coords: r.coords, coordSource: r.coordSource, address: r.address, altitude: r.altitude, modified: false }
    return { id: w.photo.id, photo, source }
  })
  return { saved, failed }
}
