import { statSync } from 'node:fs'
import { dirname } from 'node:path'
import { ELEVATION_BATCH } from '@shared/elevation'
import { pointKey } from '@shared/geocode'
import { canEdit, sameAddress, sameAltitude, type Address, type LatLon, type Photo } from '@shared/photo'
import { samePath } from '@shared/recent'
import type { ElevationResult } from './elevation'
import type { ExifTool } from './exiftool'
import { scanFolder, type PhotoSource } from './folder'
import type { ReverseResult } from './geocode'
import { savePhotos, type SaveLog } from './save'

/**
 * Batch processing (tz.md, п. 10): addresses and altitudes for the photos with coordinates of the
 * given folders and files, written to the files at once, without the main window. Also used to
 * finish the queue in the background when the program is closed (п. 10).
 */
export interface BatchOptions {
  address: boolean
  altitude: boolean
  /** Folders are read with their subfolders. */
  subfolders: boolean
  /** Replace an address or altitude a photo already has. */
  overwrite: boolean
}

export interface BatchDeps {
  exiftool: ExifTool
  reverse(c: LatLon): Promise<ReverseResult>
  elevations(points: readonly LatLon[]): Promise<ElevationResult>
  log: SaveLog & { warn(msg: string): void }
  /** Pause between address requests, ms: for the time estimate. */
  addressIntervalMs: number
  /** Pause before asking again the points the service did not answer, ms (default 10 s). */
  retryDelayMs?: number
}

/** Points the service did not answer are asked again this many times, at the end. */
export const BATCH_RETRIES = 2

export type BatchPhase = 'scan' | 'address' | 'altitude' | 'write'

export interface BatchProgress {
  phase: BatchPhase
  /** Steps done and all steps: address requests, altitude requests and photos to write. */
  done: number
  total: number
  /** Within the phase: done and all of it. */
  phaseDone: number
  phaseTotal: number
  /** About how long the rest takes; null while unknown. */
  seconds: number | null
}

export interface BatchFailure {
  name: string
  error: string
}

export interface BatchOutcome {
  /** Photos written. */
  written: number
  /** Photos without coordinates, with nothing to add, or left out by the cancel. */
  skipped: number
  failed: BatchFailure[]
  cancelled: boolean
}

interface Item {
  photo: Photo
  source: PhotoSource
  needAddress: boolean
  needAltitude: boolean
}

/** About how long writing one photo takes until it is measured, s. */
const WRITE_SECONDS = 0.15

/**
 * Runs the batch: reads the photos, asks the addresses (one point at a time) and the altitudes
 * (up to 100 points a request) for the points that need them, then writes each photo. A cancel
 * stops the asking or writing; what was found by then is still written (asking cancelled).
 */
export async function runBatch(
  paths: readonly string[],
  opts: BatchOptions,
  deps: BatchDeps,
  onProgress: (p: BatchProgress) => void,
  cancelled: () => boolean
): Promise<BatchOutcome> {
  const failed: BatchFailure[] = []
  let skipped = 0
  onProgress({ phase: 'scan', done: 0, total: 0, phaseDone: 0, phaseTotal: paths.length, seconds: null })

  // The photos: whole folders, or single files of a folder.
  const items: Item[] = []
  const folders = new Map<string, { all: boolean; files: string[]; subfolders: boolean }>()
  for (const p of paths) {
    let isDir: boolean
    try {
      isDir = statSync(p).isDirectory()
    } catch {
      failed.push({ name: p, error: 'Not found' })
      continue
    }
    const folder = isDir ? p : dirname(p)
    const entry = folders.get(folder.toLowerCase()) ?? { all: false, files: [], subfolders: false }
    if (isDir) {
      entry.all = true
      entry.subfolders ||= opts.subfolders
    } else entry.files.push(p)
    folders.set(folder.toLowerCase(), entry)
  }
  let scanned = 0
  for (const [key, entry] of folders) {
    const folder = entry.all ? paths.find((p) => p.toLowerCase() === key) ?? key : dirname(entry.files[0]!)
    try {
      const scan = await scanFolder(folder, deps.exiftool, { subfolders: entry.all && entry.subfolders })
      for (const dir of scan.unreadable) deps.log.warn(`Batch: subfolder skipped, cannot be read: ${dir}`)
      scan.photos.forEach((photo, i) => {
        if (!entry.all && !entry.files.some((f) => samePath(f, photo.path))) return
        // Videos are not written yet (tz.md, п. 9.3: 0.21.0).
        if (!canEdit(photo)) return
        const needAddress = opts.address && !!photo.coords && (opts.overwrite || !photo.address)
        const needAltitude = opts.altitude && !!photo.coords && (opts.overwrite || photo.altitude === null)
        if (!needAddress && !needAltitude) {
          skipped++
          return
        }
        items.push({ photo, source: scan.sources[i]!, needAddress, needAltitude })
      })
    } catch (e) {
      failed.push({ name: folder, error: e instanceof Error ? e.message : String(e) })
    }
    onProgress({ phase: 'scan', done: 0, total: 0, phaseDone: ++scanned, phaseTotal: folders.size, seconds: null })
  }

  // The points to ask, once each.
  const addressPoints = uniquePoints(items.filter((it) => it.needAddress))
  const altitudePoints = uniquePoints(items.filter((it) => it.needAltitude))
  const altitudeBatches = Math.ceil(altitudePoints.length / ELEVATION_BATCH)
  const total = addressPoints.length + altitudeBatches + items.length
  let done = 0
  let writeSeconds = WRITE_SECONDS
  const seconds = (addressLeft: number, batchesLeft: number, writesLeft: number): number =>
    Math.ceil((addressLeft * Math.max(deps.addressIntervalMs, 300)) / 1000 + batchesLeft + writesLeft * writeSeconds)
  const report = (phase: BatchPhase, phaseDone: number, phaseTotal: number, left: number): void =>
    onProgress({ phase, done, total, phaseDone, phaseTotal, seconds: left })

  const addresses = new Map<string, Address>()
  const addressErrors = new Map<string, string>()
  let stopped = false
  const pause = (): Promise<void> => new Promise((r) => setTimeout(r, deps.retryDelayMs ?? 10_000))

  // Addresses, one point at a time; the points the service did not answer are asked again at
  // the end, after a pause (a point with no address there is not).
  let ask = addressPoints
  for (let pass = 0; pass <= BATCH_RETRIES && ask.length && !stopped; pass++) {
    if (pass) {
      deps.log.info(`Batch: asking ${ask.length} address(es) again`)
      await pause()
    }
    const again: [string, LatLon][] = []
    for (const [i, [key, point]] of ask.entries()) {
      report('address', i, ask.length, seconds(ask.length - i, altitudeBatches, items.length))
      if (cancelled()) {
        stopped = true
        break
      }
      const res = await deps.reverse(point)
      if (res.ok && res.address) {
        addresses.set(key, res.address)
        addressErrors.delete(key)
      } else if (res.ok) addressErrors.set(key, 'no address at this point')
      else {
        addressErrors.set(key, `address not received: ${res.error}`)
        again.push([key, point])
      }
      if (!pass) done++
    }
    ask = again
  }

  // Altitudes, up to 100 points a request; failed requests are asked again the same way.
  const altitudes = new Map<string, number>()
  const altitudeErrors = new Map<string, string>()
  let pending = altitudePoints
  for (let pass = 0; pass <= BATCH_RETRIES && pending.length && !stopped; pass++) {
    if (pass) {
      deps.log.info(`Batch: asking ${pending.length} altitude(s) again`)
      await pause()
    }
    const batches = Math.ceil(pending.length / ELEVATION_BATCH)
    const again: [string, LatLon][] = []
    for (let b = 0; b < batches; b++) {
      report('altitude', b, batches, seconds(0, batches - b, items.length))
      if (cancelled()) {
        stopped = true
        break
      }
      const batch = pending.slice(b * ELEVATION_BATCH, (b + 1) * ELEVATION_BATCH)
      const res = await deps.elevations(batch.map(([, c]) => c))
      batch.forEach(([key, point], i) => {
        const v = res.ok ? res.values[i] : null
        if (v !== null && v !== undefined) {
          altitudes.set(key, v)
          altitudeErrors.delete(key)
        } else if (res.ok) altitudeErrors.set(key, 'no altitude at this point')
        else {
          altitudeErrors.set(key, `altitude not received: ${res.error}`)
          again.push([key, point])
        }
      })
      if (!pass) done++
    }
    pending = again
  }

  // Each photo gets what was found for its point; a photo with nothing new is not written.
  let written = 0
  const toWrite: { item: Item; photo: Photo }[] = []
  for (const it of items) {
    const key = pointKey(it.photo.coords!)
    const address = it.needAddress && addresses.has(key) ? addresses.get(key)! : it.photo.address
    const altitude = it.needAltitude && altitudes.has(key) ? altitudes.get(key)! : it.photo.altitude
    const reasons = [
      ...(it.needAddress && addressErrors.has(key) ? [addressErrors.get(key)!] : []),
      ...(it.needAltitude && altitudeErrors.has(key) ? [altitudeErrors.get(key)!] : [])
    ]
    if (sameAddress(address, it.photo.address) && sameAltitude(altitude, it.photo.altitude)) {
      if (reasons.length) failed.push({ name: it.photo.path, error: reasons.join('; ') })
      else skipped++
      continue
    }
    if (reasons.length) deps.log.warn(`Batch: ${it.photo.path}: ${reasons.join('; ')}`)
    toWrite.push({ item: it, photo: { ...it.photo, address, altitude, modified: true } })
  }
  done += items.length - toWrite.length

  // Cancelled while asking: what was found is written all the same (it is quick); a cancel
  // during the writing stops it.
  const askingCancelled = stopped
  for (const [i, w] of toWrite.entries()) {
    report('write', i, toWrite.length, seconds(0, 0, toWrite.length - i))
    if (!askingCancelled && cancelled()) {
      stopped = true
      skipped += toWrite.length - i
      break
    }
    const start = Date.now()
    const outcome = await savePhotos(deps.exiftool, [{ photo: w.photo, source: w.item.source, old: w.item.photo.coords }], deps.log)
    writeSeconds = (writeSeconds + (Date.now() - start) / 1000) / 2
    // The reason without the path repeated: the path is the name of the entry.
    if (outcome.failed.length) failed.push({ name: w.photo.path, error: outcome.failed[0]!.error.replace(`: ${w.photo.path}`, '') })
    else written++
    done++
  }
  report('write', toWrite.length, toWrite.length, 0)
  return { written, skipped, failed, cancelled: stopped }
}

/** The different points of the photos, in order. */
function uniquePoints(items: readonly Item[]): [string, LatLon][] {
  const points = new Map<string, LatLon>()
  for (const it of items) {
    const c = it.photo.coords!
    const key = pointKey(c)
    if (!points.has(key)) points.set(key, c)
  }
  return [...points]
}
