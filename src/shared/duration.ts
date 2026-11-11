import type { Translate } from './i18n'

/** "12 s", "1 min 30 s": about how long something takes (tz.md, п. 5.5). */
export function formatDuration(seconds: number, t: Translate): string {
  const total = Math.max(0, Math.ceil(seconds))
  const m = Math.floor(total / 60)
  const s = total % 60
  return m ? t('time.minSec', { m, s }) : t('time.sec', { s })
}
