export const APP_NAME = 'GeoPhotos'

/** Window title: app name, open folder and `*` for unsaved changes (tz.md, п. 4.13). */
/**
 * Title of the window (tz.md, п. 4.13): the name of the open folder — not its whole path, which
 * the taskbar would cut before the name — then the program; `*` for unsaved changes.
 */
export function windowTitle(folder?: string, dirty = false): string {
  if (!folder) return APP_NAME
  const name = folder.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) || folder
  const shown = /^[A-Za-z]:$/.test(name) ? `${name}\\` : name
  return `${dirty ? '* ' : ''}${shown} — ${APP_NAME}`
}
