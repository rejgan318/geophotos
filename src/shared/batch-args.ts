/**
 * Launch parameters of the batch mode (tz.md, п. 10):
 *   GeoPhotos.exe --batch [--no-address] [--no-altitude] [--subfolders] [--overwrite] <folder | file ...>
 */
export interface BatchArgs {
  /** Folders and photos to process, as given. */
  paths: string[]
  address: boolean
  altitude: boolean
  subfolders: boolean
  overwrite: boolean
}

export const BATCH_SWITCH = '--batch'

/** Whether the program was started in the batch mode. */
export function isBatch(args: readonly string[]): boolean {
  return args.some((a) => a.toLowerCase() === BATCH_SWITCH)
}

/** Switches of Electron and Chromium that may come along in development: not ours, ignored. */
const FOREIGN = /^--(inspect|remote-debugging|enable-|disable-|no-sandbox|allow-|user-data-dir|lang=)/i

/**
 * Parses what follows the program in the command line. In development the app's folder (".")
 * comes first; it is skipped like the switches of Electron itself.
 */
export function parseBatchArgs(args: readonly string[], appPath?: string): BatchArgs | { error: string } {
  const norm = (p: string): string => p.replace(/[\\/]+$/, '').toLowerCase()
  const app = appPath ? norm(appPath) : undefined
  const out: BatchArgs = { paths: [], address: true, altitude: true, subfolders: false, overwrite: false }
  for (const a of args) {
    const low = a.toLowerCase()
    if (!a || low === BATCH_SWITCH) continue
    if (low === '--no-address') out.address = false
    else if (low === '--no-altitude') out.altitude = false
    else if (low === '--subfolders') out.subfolders = true
    else if (low === '--overwrite') out.overwrite = true
    else if (a.startsWith('-')) {
      if (FOREIGN.test(a)) continue
      return { error: `Unknown parameter: ${a}` }
    } else if (a === '.' || (app && norm(a) === app)) continue
    else out.paths.push(a)
  }
  if (!out.paths.length) return { error: 'No folder or photo given' }
  if (!out.address && !out.altitude) return { error: 'Nothing to do: both --no-address and --no-altitude' }
  return out
}
