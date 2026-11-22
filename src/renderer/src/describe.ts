import type { Translate } from '@shared/i18n'
import { durationText, formatCoords, type Photo } from '@shared/photo'

/**
 * Date as shown to the user: shooting date, or the date from the file name or the file date,
 * marked as such (tz.md, пп. 4.2, 4.13).
 */
export function photoDate(p: Photo, t: Translate): string {
  if (!p.date) return t('photo.noDate')
  if (p.dateSource === 'file') return t('photo.fileDate', { date: p.date })
  if (p.dateSource === 'name') return t('photo.nameDate', { date: p.date.endsWith(' 00:00:00') ? p.date.slice(0, 10) : p.date })
  return p.date
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
