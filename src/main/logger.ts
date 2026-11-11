import { appendFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join, parse } from 'node:path'
import log from 'electron-log/main'
import type { LogLevel } from '@shared/settings'
import { staleFallbackLogs } from './log-files'

export { log }

/** Name of the log file number `n`: main.log, main.1.log, main.2.log… */
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
 * Log file in <userData>/logs (tz.md, п. 6.9). When the file grows over maxSizeKb it is
 * renamed to main.1.log (older ones shift up); maxFiles files are kept, including the current one.
 *
 * If main.log cannot be written — e.g. it is open in a viewer that denies writing — the log goes
 * to main-<date>-<pid>.log in the same folder instead of being lost (electron-log would drop
 * every line of the session silently).
 */
export function setupLog(
  logsDir: string,
  opts: { level: LogLevel; maxSizeKb: number; maxFiles: number; console: boolean }
): void {
  mkdirSync(logsDir, { recursive: true })
  const removed = removeStaleFallbackLogs(logsDir, opts.maxFiles)
  const mainPath = join(logsDir, 'main.log')
  let path = mainPath
  let fallbackReason: string | null = null

  const useFallback = (reason: string): void => {
    if (path !== mainPath) return
    const d = new Date()
    const p2 = (n: number): string => String(n).padStart(2, '0')
    const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`
    path = join(logsDir, `main-${stamp}-${process.pid}.log`)
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

  // main.log becoming unwritable later: switch to the fallback file for the rest of the session.
  if (path === mainPath) {
    file.getFile().on('error', (e: unknown) => {
      useFallback(`${mainPath} became unwritable: ${String(e)}`)
      log.warn(`Log continues here: ${fallbackReason}`)
    })
  } else {
    log.warn(`Log is written here instead of main.log: ${fallbackReason}`)
  }
  if (removed.length) log.info(`Old backup log files removed: ${removed.join(', ')}`)
}

/**
 * Backup log files of earlier sessions (main.log was locked then) are not rotated away:
 * only the latest maxFiles sessions are kept. A file that cannot be deleted now stays.
 */
function removeStaleFallbackLogs(logsDir: string, maxFiles: number): string[] {
  let names: string[]
  try {
    names = readdirSync(logsDir)
  } catch {
    return []
  }
  const removed: string[] = []
  for (const name of staleFallbackLogs(names, maxFiles)) {
    try {
      rmSync(join(logsDir, name))
      removed.push(name)
    } catch {
      // Open in another program: try again at the next start.
    }
  }
  return removed
}
