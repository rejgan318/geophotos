/**
 * Names of the log files (tz.md, п. 6.9): geophotos.log, its rotations geophotos.1.log,
 * geophotos.2.log…, and backup files: when geophotos.log cannot be written (open in another
 * program), a session logs to geophotos-<YYYYMMDD>-<HHMMSS>-<pid>.log instead; rotation adds
 * geophotos-…-<pid>.1.log and so on. Rotation never removes backup files, so each start keeps
 * only the latest sessions.
 */
export const LOG_NAME = 'geophotos'

const FALLBACK = /^geophotos-(\d{8}-\d{6}-\d+)(?:\.\d+)?\.log$/i

/** Before 0.15.0 the log was main.log (the electron-log default): main.log, main.N.log, main-….log. */
const OLD_NAME = /^main(?:\.\d+|-\d{8}-\d{6}-\d+(?:\.\d+)?)?\.log$/i

/** Session key of a backup log file ("20261111-124400-1234"), or null for other files. */
export function fallbackSession(name: string): string | null {
  return FALLBACK.exec(name)?.[1] ?? null
}

/** Sessions sort by date and time, then by process id. */
function compareSessions(a: string, b: string): number {
  const [da = '', ta = '', pa = '0'] = a.split('-')
  const [db = '', tb = '', pb = '0'] = b.split('-')
  return da.localeCompare(db) || ta.localeCompare(tb) || Number(pa) - Number(pb)
}

/**
 * Backup log files to delete: all files of every session except the `keep` latest ones.
 * geophotos.log, its rotations and any other files are never touched.
 */
export function staleFallbackLogs(names: readonly string[], keep: number): string[] {
  const sessions = [...new Set(names.map(fallbackSession).filter((s): s is string => s !== null))]
  sessions.sort(compareSessions)
  const stale = new Set(sessions.slice(0, Math.max(0, sessions.length - Math.max(0, keep))))
  return names.filter((n) => {
    const s = fallbackSession(n)
    return s !== null && stale.has(s)
  })
}

/** Log files with the old names (main.log and its relatives): removed at start. */
export function oldNamedLogs(names: readonly string[]): string[] {
  return names.filter((n) => OLD_NAME.test(n))
}
