import { appendFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join, parse } from 'node:path'
import log from 'electron-log/main'
import type { LogLevel } from '@shared/settings'
import { LOG_NAME, oldNamedLogs, staleFallbackLogs } from './log-files'

export { log }

/** Name of the log file number `n`: geophotos.log, geophotos.1.log, geophotos.2.log… */
function numbered(dir: string, name: string, ext: string, n: number): string {
  return join(dir, n === 0 ? `${name}${ext}` : `${name}.${n}${ext}`)
}

function canAppend(file: string): boolean {
  try {
    appendFileSync(file, '')
    return true
  } catch {
    return false
  }
}

/**
 * Log file in <userData>/logs (tz.md, п. 6.9): geophotos.log. When the file grows over maxSizeKb
 * it is renamed to geophotos.1.log (older ones shift up); maxFiles files are kept, including the
 * current one.
 *
 * If geophotos.log cannot be written — e.g. it is open in a viewer that denies writing — the log
 * goes to geophotos-<date>-<pid>.log in the same folder instead of being lost (electron-log would
 * drop every line of the session silently).
 */
export function setupLog(
  logsDir: string,
  opts: { level: LogLevel; maxSizeKb: number; maxFiles: number; console: boolean }
): void {
  mkdirSync(logsDir, { recursive: true })
  const removed = removeLogs(logsDir, (names) => staleFallbackLogs(names, opts.maxFiles))
  const oldRemoved = removeLogs(logsDir, oldNamedLogs)
  const mainPath = join(logsDir, `${LOG_NAME}.log`)
  let path = mainPath
  let fallbackReason: string | null = null

  const useFallback = (reason: string): void => {
    if (path !== mainPath) return
    const d = new Date()
    const p2 = (n: number): string => String(n).padStart(2, '0')
    const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`
    path = join(logsDir, `${LOG_NAME}-${stamp}-${process.pid}.log`)
    fallbackReason = reason
  }

  if (!canAppend(mainPath)) useFallback(`${mainPath} cannot be written (open in another program?)`)

  const file = log.transports.file
  file.resolvePathFn = () => path
  file.level = opts.level
  file.maxSize = opts.maxSizeKb * 1024
  file.archiveLogFn = (oldFile) => {
    const p = parse(oldFile.toString())
    try {
      const last = numbered(p.dir, p.name, p.ext, opts.maxFiles - 1)
      if (opts.maxFiles <= 1 || existsSync(last)) rmSync(last, { force: true })
      for (let n = opts.maxFiles - 2; n >= 0; n--) {
        const from = numbered(p.dir, p.name, p.ext, n)
        if (existsSync(from)) renameSync(from, numbered(p.dir, p.name, p.ext, n + 1))
      }
    } catch (e) {
      console.error('Could not rotate log', e)
    }
  }
  log.transports.console.level = opts.console ? 'debug' : false

  // geophotos.log becoming unwritable later: switch to the fallback file for the rest of the session.
  if (path === mainPath) {
    file.getFile().on('error', (e: unknown) => {
      useFallback(`${mainPath} became unwritable: ${String(e)}`)
      log.warn(`Log continues here: ${fallbackReason}`)
    })
  } else {
    log.warn(`Log is written here instead of ${LOG_NAME}.log: ${fallbackReason}`)
  }
  if (removed.length) log.info(`Old backup log files removed: ${removed.join(', ')}`)
  if (oldRemoved.length) log.info(`Log files with the old name removed: ${oldRemoved.join(', ')}`)
}

/**
 * Removes log files picked from the folder: backup files of earlier sessions beyond the latest
 * maxFiles (they are not rotated away), and files with the old name main.log. A file that cannot
 * be deleted now (open in another program) stays until the next start.
 */
function removeLogs(logsDir: string, pick: (names: string[]) => string[]): string[] {
  let names: string[]
  try {
    names = readdirSync(logsDir)
  } catch {
    return []
  }
  const removed: string[] = []
  for (const name of pick(names)) {
    try {
      rmSync(join(logsDir, name))
      removed.push(name)
    } catch {
      // Open in another program: try again at the next start.
    }
  }
  return removed
}
