export const APP_NAME = 'GeoPhotos'

/** Window title: app name, open folder and `*` for unsaved changes (tz.md, п. 4.13). */
export function windowTitle(folder?: string, dirty = false): string {
  if (!folder) return APP_NAME
  return `${dirty ? '* ' : ''}${folder} — ${APP_NAME}`
}
