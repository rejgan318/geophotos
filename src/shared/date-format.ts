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
