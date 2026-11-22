import type { Translate } from '@shared/i18n'
import { formatWallTime } from '@shared/date-format'
import { durationText, fileSizeParts, formatCoords, type Photo } from '@shared/photo'

/** Regional format of the system for dates (tz.md, п. 4.13); set once at start. */
let dateLocale = 'en-US'

export function setDateLocale(locale: string): void {
  dateLocale = locale
}

/**
 * Date as shown to the user, in the regional format of the system; where it was taken from is
 * not marked (tz.md, п. 4.13). A date from the file name without a time is shown without one.
 */
export function photoDate(p: Photo, t: Translate): string {
  if (!p.date) return t('photo.noDate')
  return formatWallTime(p.date, dateLocale, p.dateSource === 'name' && p.date.endsWith(' 00:00:00'))
}

/** "6,4 МБ" in the interface language (status bar, п. 4.13). */
export function fileSize(bytes: number, t: Translate): string {
  const { value, digits, unit } = fileSizeParts(bytes)
  const n = value.toLocaleString(t('locale'), { minimumFractionDigits: digits, maximumFractionDigits: digits })
  return t(unit, { n })
}

/**
 * The current photo in the status bar (п. 4.13): the name, then dim parts — date, size, length
 * of a video.
 */
export function statusParts(p: Photo, t: Translate): { name: string; rest: string[] } {
  const rest = [photoDate(p, t)]
  if (p.size !== undefined) rest.push(fileSize(p.size, t))
  if (p.video?.duration != null) rest.push(durationText(p.video.duration))
  return { name: p.name, rest }
}

/** Name and date, and the length of a video: "MVI_0592.MOV · 2010-08-21 05:32:16 · 0:15". */
export function nameLine(p: Photo, t: Translate): string {
  const parts = [p.name, photoDate(p, t)]
  if (p.video?.duration != null) parts.push(durationText(p.video.duration))
  return parts.join(' · ')
}

export function photoCoords(p: Photo, t: Translate): string {
  return p.coords ? formatCoords(p.coords) : t('photo.noCoords')
}

/** Tooltip of a thumbnail: name, date, coordinates (and a read error, if any). */
export function photoTooltip(p: Photo, t: Translate): string {
  const lines = [p.name, photoDate(p, t), photoCoords(p, t)]
  if (p.video) {
    lines.splice(1, 0, p.video.duration === null ? t('photo.video') : t('photo.videoLength', { length: durationText(p.video.duration) }))
  }
  if (p.modified) lines.push(t('photo.modified'))
  if (p.error) lines.push(t('photo.readError', { error: p.error }))
  return lines.join('\n')
}
