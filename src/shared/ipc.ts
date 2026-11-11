import type { Strings } from './i18n'
import type { FolderData, LatLon, Photo } from './photo'
import type { SearchResult } from './search'
import type { MapSource, MarkerStyle } from './settings'

/** IPC channels between main and the window. All IPC names and payloads live here. */
export const IPC = {
  /** invoke, window → main: everything the window needs at start. */
  init: 'app:init',
  /** event, main → window: a folder is being read. */
  folderLoading: 'folder:loading',
  /** event, main → window: a folder was read. */
  folderLoaded: 'folder:loaded',
  /** invoke, window → main: open a dropped folder or photo. */
  openPath: 'path:open',
  /** invoke, window → main: give photos new coordinates (not saved yet). */
  setCoords: 'photos:setCoords',
  /** event, main → window: some photos changed (coordinates, unsaved mark). */
  photosChanged: 'photos:changed',
  /** send, window → main: selection, filter and view mode (Save Selected, View menu, last session). */
  uiState: 'ui:state',
  /** send, window → main: place of the map, tile source, strip scroll (kept for the next run). */
  viewState: 'ui:viewState',
  /** event, main → window: a command from the menu (View). */
  command: 'ui:command',
  /** event, main → window: progress and result of saving. */
  saveState: 'save:state',
  /** invoke, window → main: find a place by name. */
  search: 'search:places',
  /** invoke, window → main: data of Help → About. */
  aboutInfo: 'about:info',
  /** invoke, window → main: open the settings file or the log folder (links in About). */
  aboutOpen: 'about:open',
  /** invoke, window → main: text of the clipboard (Ctrl+V). */
  clipboardRead: 'clipboard:read',
  /** invoke, window → main: put text into the clipboard (Ctrl+C). */
  clipboardWrite: 'clipboard:write'
} as const

export interface InitData {
  strings: Strings
  map: {
    sources: MapSource[]
    defaultSource: string
    initialView: { lat: number; lon: number; zoom: number }
    markers: MarkerStyle
    hoverThumbSize: number
    /** Longer side of a thumbnail on the map, px (tz.md, п. 4.8.3). */
    thumbSize: number
    /** Place and zoom of the map at the end of the last run; null — the settings' initial view. */
    saved: { lat: number; lon: number; zoom: number } | null
    /** Thumbnails on the map at the end of the last run (п. 7.1). */
    thumbnails: boolean
  }
  /** Scheme of thumbnail URLs: `${thumbScheme}://f<generation>/<photo id>`. */
  thumbScheme: string
}

/** What the window reports for the next run (tz.md, п. 7.1): the map and the strip scroll. */
export interface ViewState {
  lat: number
  lon: number
  zoom: number
  /** Key of the tile source shown. */
  source: string
  /** Scroll of the strip, px. */
  scroll: number
}

/** Checks the view state coming from the window; null if it is not one. */
export function validViewState(v: unknown): ViewState | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
  const { lat, lon, zoom, source, scroll } = r
  if (!num(lat) || !num(lon) || !num(zoom) || !num(scroll) || typeof source !== 'string') return null
  if (Math.abs(lat) > 90 || zoom < 0 || scroll < 0) return null
  return { lat, lon, zoom, source, scroll }
}

export interface FolderLoading {
  folder: string
}

export interface SetCoordsRequest {
  ids: number[]
  coords: LatLon
}

export interface PhotosChanged {
  /** Generation of the folder the photos belong to. */
  generation: number
  photos: Photo[]
}

/** Filter of the strip and the map by the status bar counter (tz.md, п. 4.13). */
export type StripFilter = 'all' | 'coords' | 'noCoords' | 'modified'

/** What the main area shows: the map or the current photo (Space, View menu). */
export type ViewMode = 'map' | 'photo'

/** What stands for a photo on the map: a marker or its thumbnail (T, View menu; tz.md, п. 4.8.3). */
export type MapMode = 'pins' | 'thumbs'

export interface UiState {
  ids: number[]
  /** The photo of the status bar, followed by the map and the photo view. */
  current: number | null
  filter: StripFilter
  view: ViewMode
  mapMode: MapMode
}

export type WindowCommand =
  | { type: 'toggleView' }
  | { type: 'showOnMap' }
  | { type: 'toggleThumbnails' }
  | { type: 'setFilter'; filter: StripFilter }
  | { type: 'toggleHelp' }
  | { type: 'showAbout' }

/** Help → About (tz.md, п. 4.9). */
export interface AboutInfo {
  version: string
  exiftoolVersion: string
  exiftoolPath: string
  settings: string
  logs: string
  electron: string
  node: string
}

/** What a link in About opens; main knows the paths, the window only names the target. */
export type AboutTarget = 'settings' | 'logs' | 'license' | 'notices'

/** Saving (tz.md, п. 6.8): n of N while it goes, then the result. */
export type SaveState =
  | { phase: 'progress'; done: number; total: number }
  | { phase: 'done'; saved: number; failed: number }

export type { FolderData, SearchResult }

export const THUMB_SCHEME = 'thumb'

/** Thumbnail of the strip, or with `large` the image of the photo view. */
export function thumbUrl(generation: number, id: number, large = false): string {
  return `${THUMB_SCHEME}://f${generation}/${id}${large ? '/large' : ''}`
}

/** Parses a thumbnail URL back; null if it is not one. */
export function parseThumbUrl(url: string): { generation: number; id: number; large: boolean } | null {
  const m = /^thumb:\/\/f(\d+)\/(\d+)(\/large)?\/?$/.exec(url)
  return m ? { generation: Number(m[1]), id: Number(m[2]), large: !!m[3] } : null
}

/** Checks a set-coordinates request coming from the window. */
export function validSetCoords(v: unknown): v is SetCoordsRequest {
  if (!v || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  const c = r['coords'] as Record<string, unknown> | undefined
  const ids = r['ids']
  return (
    Array.isArray(ids) &&
    ids.every((id) => Number.isInteger(id) && (id as number) >= 0) &&
    !!c &&
    typeof c['lat'] === 'number' &&
    typeof c['lon'] === 'number' &&
    Number.isFinite(c['lat']) &&
    Number.isFinite(c['lon']) &&
    Math.abs(c['lat']) <= 90
  )
}

const FILTERS: readonly StripFilter[] = ['all', 'coords', 'noCoords', 'modified']

/** Checks the UI state coming from the window; null if it is not one. */
export function validUiState(v: unknown): UiState | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  const ids = r['ids']
  const current = r['current']
  if (!Array.isArray(ids) || !ids.every((id) => Number.isInteger(id) && (id as number) >= 0)) return null
  if (current !== null && !(Number.isInteger(current) && (current as number) >= 0)) return null
  if (!FILTERS.includes(r['filter'] as StripFilter)) return null
  if (r['view'] !== 'map' && r['view'] !== 'photo') return null
  if (r['mapMode'] !== 'pins' && r['mapMode'] !== 'thumbs') return null
  return {
    ids: ids as number[],
    current: current as number | null,
    filter: r['filter'] as StripFilter,
    view: r['view'],
    mapMode: r['mapMode']
  }
}
