import { ADDRESS_SVG, ALTITUDE_SVG, PENCIL_SVG, PHOTO_SVG, PIN_OFF_SVG, PIN_SVG } from './icons'

/**
 * Help → Keyboard Shortcuts (F1): keys, mouse actions and marks of the program.
 * The list is data here and its texts are `help.*` keys of the language files, so adding a
 * key to the program means adding a line here; a missing translation shows English.
 */
export type Row =
  | { keys: string[]; text: string }
  | { action: string; text: string }
  | { icon: string; color: string; text: string }

export interface Section {
  title: string
  rows: Row[]
}

/** Key names are text keys where a language may have its own word (Space → «Пробел»). */
export const SECTIONS: Section[] = [
  {
    title: 'help.keyboard',
    rows: [
      { keys: ['←', '→'], text: 'help.prevNext' },
      { keys: ['Home', 'End'], text: 'help.firstLast' },
      { keys: ['help.key.space'], text: 'help.photoView' },
      { keys: ['C'], text: 'help.showOnMap' },
      { keys: ['T'], text: 'help.thumbnails' },
      { keys: ['Ctrl+A'], text: 'help.selectAll' },
      { keys: ['Ctrl+C'], text: 'help.copy' },
      { keys: ['Ctrl+V'], text: 'help.paste' },
      { keys: ['Del'], text: 'help.delete' },
      { keys: ['Ctrl+S'], text: 'help.save' },
      { keys: ['Ctrl+O'], text: 'help.open' },
      { keys: ['F5'], text: 'help.refresh' },
      { keys: ['F1'], text: 'help.help' },
      { keys: ['Enter'], text: 'help.search' }
    ]
  },
  {
    title: 'help.mouse',
    rows: [
      { keys: ['help.key.click'], text: 'help.click' },
      { keys: ['Ctrl+help.key.click'], text: 'help.ctrlClick' },
      { keys: ['Shift+help.key.click'], text: 'help.shiftClick' },
      { keys: ['help.key.doubleClick'], text: 'help.doubleClick' },
      { action: 'help.action.doubleClickMap', text: 'help.doubleClickMap' },
      { action: 'help.action.dragToMap', text: 'help.dragToMap' },
      { action: 'help.action.dragToPhoto', text: 'help.dragToPhoto' },
      { action: 'help.action.dragMarker', text: 'help.dragMarker' },
      { action: 'help.action.dropOnMark', text: 'help.dropOnMark' }
    ]
  },
  {
    title: 'help.marks',
    rows: [
      { icon: PIN_SVG, color: 'var(--marker-color)', text: 'help.markCoords' },
      { icon: PIN_SVG, color: 'var(--marker-selected)', text: 'help.markSelected' },
      { icon: PENCIL_SVG, color: 'var(--modified)', text: 'help.markModified' },
      { icon: ADDRESS_SVG, color: 'var(--address)', text: 'help.markAddress' },
      { icon: ALTITUDE_SVG, color: 'var(--altitude)', text: 'help.markAltitude' },
      { icon: PHOTO_SVG, color: 'var(--selected)', text: 'help.markFilters' },
      { icon: PIN_OFF_SVG, color: 'var(--no-coords)', text: 'help.markNoCoords' }
    ]
  }
]

/** All text keys the help uses (checked against the language files by a test). */
export function helpTextKeys(): string[] {
  const keys = new Set<string>(['help.title', 'help.close'])
  for (const section of SECTIONS) {
    keys.add(section.title)
    for (const row of section.rows) {
      keys.add(row.text)
      if ('action' in row) keys.add(row.action)
      if ('keys' in row) for (const k of row.keys) for (const part of k.split('+')) if (part.startsWith('help.')) keys.add(part)
    }
  }
  return [...keys]
}

