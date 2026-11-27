import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { applyEdits, modify, parse } from 'jsonc-parser'
import { MAX_RECENT } from '@shared/recent'
import { isStripPosition, type StripPosition } from '@shared/ipc'
import { GRID_THUMB, validGridThumb, validStripThumb } from '@shared/context-menu'
import { validFoundEggs, type FoundEgg } from '@shared/eggs'
import { RECENT_PLACES, validFavorites, validPlace, type Place } from '@shared/search'

/**
 * Program state between runs (tz.md, п. 7.5): a service file in userData, separate from the
 * settings, not edited by the user. It keeps the recent folders (п. 3.1), latest first, and what
 * was on screen when the program was closed (п. 7.1).
 */
export interface AppState {
  recentFolders: string[]
  /**
   * The project (tz.md, п. 3.1: the open folder, files added to it, files of it taken off the
   * strip), the current photo and the strip scroll at exit; opened at the next start without a
   * parameter.
   */
  lastSession: Session | null
  /** Position and size of the window (its normal size when maximized). */
  window: WindowState | null
  /** Place and zoom of the map, its tile source, markers or thumbnails. */
  map: MapState | null
  /** Modes of the Tools menu (tz.md, пп. 5.5, 5.6). */
  tools: ToolsState
  /** The folder files were last added from (Add Files…, tz.md, п. 3.1): its dialog opens there. */
  addFolder: string | null
  /** Where the strip is (View → Strip Position, tz.md, п. 4.1). */
  stripPosition: StripPosition
  /** Size of the thumbnails in the grid, px (п. 4.17). */
  gridThumb: number
  /** Size of the thumbnails in the strip, px (п. 4.1). */
  stripThumb: number
  /** The search history: places found and gone to, latest first (п. 5.3). */
  places: Place[]
  /** Favourite places, in the order they were added (п. 5.3). */
  favorites: Place[]
  /** The easter eggs found, in the order found, with the date (п. 9.3). */
  eggs: FoundEgg[]
}

export interface Session {
  /** null — only added files. */
  folder: string | null
  photo: string | null
  scroll: number
  subfolders: boolean
  added: string[]
  removed: string[]
}

export interface ToolsState {
  address: boolean
  altitude: boolean
}

export interface WindowState {
  x: number
  y: number
  width: number
  height: number
  maximized: boolean
}

export interface MapState {
  lat: number
  lon: number
  zoom: number
  /** Key of the tile source (settings, map.tileSources). */
  source: string
  thumbnails: boolean
}

const EMPTY: AppState = { recentFolders: [], lastSession: null, window: null, map: null, tools: { address: false, altitude: false }, addFolder: null, stripPosition: 'bottom', gridThumb: GRID_THUMB.normal, stripThumb: GRID_THUMB.normal, places: [], favorites: [], eggs: [] }

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function readSession(v: unknown): AppState['lastSession'] {
  if (!isObj(v)) return null
  const folder = typeof v['folder'] === 'string' && v['folder'] ? v['folder'] : null
  const paths = (x: unknown): string[] => (Array.isArray(x) ? x.filter((p): p is string => typeof p === 'string' && p !== '') : [])
  const added = paths(v['added'])
  if (!folder && !added.length) return null
  return {
    folder,
    photo: typeof v['photo'] === 'string' && v['photo'] ? v['photo'] : null,
    scroll: isNum(v['scroll']) && v['scroll'] >= 0 ? v['scroll'] : 0,
    // Whether photos from subfolders were loaded (tz.md, п. 3.2): restored without asking.
    subfolders: v['subfolders'] === true,
    // Files added to the folder and files of it taken off the strip (п. 3.1); none before 0.25.0.
    added,
    removed: folder ? paths(v['removed']) : []
  }
}

function readWindow(v: unknown): WindowState | null {
  if (!isObj(v)) return null
  const { x, y, width, height } = v
  if (!isNum(x) || !isNum(y) || !isNum(width) || !isNum(height) || width < 100 || height < 100) return null
  return { x, y, width, height, maximized: v['maximized'] === true }
}

function readMap(v: unknown): MapState | null {
  if (!isObj(v)) return null
  const { lat, lon, zoom, source } = v
  if (!isNum(lat) || !isNum(lon) || !isNum(zoom) || Math.abs(lat) > 90 || zoom < 0) return null
  return { lat, lon, zoom, source: typeof source === 'string' ? source : '', thumbnails: v['thumbnails'] === true }
}

/** Reads the state; a missing or broken file gives the default (empty) state. */
export function readState(file: string): AppState {
  try {
    const value = parse(readFileSync(file, 'utf8')) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...EMPTY }
    const v = value as Record<string, unknown>
    const list = Array.isArray(v['recentFolders']) ? v['recentFolders'] : []
    const recentFolders = list.filter((f): f is string => typeof f === 'string' && f !== '').slice(0, MAX_RECENT)
    // Earlier builds kept only the last folder.
    if (!recentFolders.length && typeof v['lastFolder'] === 'string' && v['lastFolder']) {
      recentFolders.push(v['lastFolder'])
    }
    return {
      recentFolders,
      lastSession: readSession(v['lastSession']),
      window: readWindow(v['window']),
      map: readMap(v['map']),
      tools: {
        address: isObj(v['tools']) && v['tools']['address'] === true,
        altitude: isObj(v['tools']) && v['tools']['altitude'] === true
      },
      addFolder: typeof v['addFolder'] === 'string' && v['addFolder'] ? v['addFolder'] : null,
      stripPosition: isStripPosition(v['stripPosition']) ? v['stripPosition'] : 'bottom',
      gridThumb: validGridThumb(v['gridThumb']),
      stripThumb: validStripThumb(v['stripThumb']),
      places: (Array.isArray(v['places']) ? v['places'] : []).map(validPlace).filter((p): p is Place => !!p).slice(0, RECENT_PLACES),
      favorites: validFavorites(v['favorites']),
      eggs: validFoundEggs(v['eggs'])
    }
  } catch {
    return { ...EMPTY }
  }
}

/**
 * Writes the state through a temporary file, so a crash never leaves a half-written file.
 * If the file is open in another program, replacing it fails on Windows: then it is
 * overwritten in place. Throws only if neither works.
 */
export function writeState(file: string, state: AppState): void {
  let text = '{}'
  for (const [key, value] of Object.entries(state)) {
    text = applyEdits(text, modify(text, [key], value, { formattingOptions: { insertSpaces: true, tabSize: 2 } }))
  }
  text += '\n'
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  try {
    writeFileSync(tmp, text, 'utf8')
    renameSync(tmp, file)
  } catch {
    rmSync(tmp, { force: true })
    writeFileSync(file, text, 'utf8')
  }
}
