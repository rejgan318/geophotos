import type { Translate } from '@shared/i18n'
import { formatCoords, type Photo } from '@shared/photo'

/** Date as shown to the user: shooting date, or file date marked as such (tz.md, п. 4.13). */
export function photoDate(p: Photo, t: Translate): string {
  if (!p.date) return t('photo.noDate')
  return p.dateSource === 'file' ? t('photo.fileDate', { date: p.date }) : p.date
}

export function photoCoords(p: Photo, t: Translate): string {
  return p.coords ? formatCoords(p.coords) : t('photo.noCoords')
}

/** Tooltip of a thumbnail: name, date, coordinates (and a read error, if any). */
export function photoTooltip(p: Photo, t: Translate): string {
  const lines = [p.name, photoDate(p, t), photoCoords(p, t)]
  if (p.modified) lines.push(t('photo.modified'))
  if (p.error) lines.push(t('photo.readError', { error: p.error }))
  return lines.join('\n')
}
