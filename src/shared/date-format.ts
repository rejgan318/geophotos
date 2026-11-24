// Dates for the window: no time zone data here, so the window does not load it.

/**
 * A wall time "YYYY-MM-DD HH:MM:SS" in the regional format of a locale (tz.md, п. 4.13):
 * "03.07.2010 21:19:56" for ru-RU, "7/3/2010 9:19:56 PM" for en-US. `dateOnly` — without the time.
 * The wall time is shown as it is: no time zone is applied.
 */
export function formatWallTime(wall: string, locale: string, dateOnly = false): string {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(wall)
  if (!m) return wall
  const [, y, mo, d, h, mi, s] = m.map(Number) as number[]
  const instant = new Date(Date.UTC(y!, mo! - 1, d!, h!, mi!, s!))
  const opts: Intl.DateTimeFormatOptions = { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }
  if (!dateOnly) Object.assign(opts, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  try {
    return new Intl.DateTimeFormat(locale, opts).format(instant).replace(/,(?= )/, '')
  } catch {
    return wall
  }
}

/**
 * An instant (ms) as the local time of a place (time zone `zone`; null — the computer's), in the
 * regional format of a locale: times of tracks (tz.md, п. 3.9.5). `part`: the date and time, or
 * only the time.
 */
export function formatInstant(ms: number, zone: string | null, locale: string, part: 'dateTime' | 'time' = 'dateTime'): string {
  const opts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit' }
  if (part === 'dateTime') Object.assign(opts, { year: 'numeric', month: '2-digit', day: '2-digit' })
  if (zone) opts.timeZone = zone
  try {
    return new Intl.DateTimeFormat(locale, opts).format(new Date(ms)).replace(/,(?= )/, '')
  } catch {
    return new Date(ms).toISOString()
  }
}
