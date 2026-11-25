import type { Strings } from './i18n'
import type { Address, FolderData, LatLon, Photo } from './photo'
import type { SearchResult } from './search'
import type { MapSource, MarkerStyle } from './settings'
import type { TrackData } from './track'
import type { UpdateState } from './updates'

/** IPC channels between main and the window. All IPC names and payloads live here. */
export const IPC = {
  /** invoke, window → main: everything the window needs at start. */
  init: 'app:init',
  /** event, main → window: a folder is being read. */
  folderLoading: 'folder:loading',
  /** event, main → window: a folder was read. */
  folderLoaded: 'folder:loaded',
  /** invoke, window → main: folders and files dropped from Explorer (tz.md, п. 3.1). */
  openPaths: 'paths:open',
  /** invoke, window → main: take photos off the strip (Del, tz.md, п. 6.6). */
  removePhotos: 'photos:remove',
  /** invoke, window → main: the lines and points of a track of the strip (tz.md, п. 3.9). */
  trackData: 'track:data',
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
  /** event, main → window: how many points still wait for their address and altitude (пп. 5.5, 5.6). */
  queueState: 'queue:state',
  /** event, main → window: progress and result of saving. */
  saveState: 'save:state',
  /** invoke, window → main: find a place by name. */
  search: 'search:places',
  /** invoke, window → main: open a video in the default program (photo view, tz.md, п. 4.14). */
  openInPlayer: 'video:openInPlayer',
  /** invoke, window → main: data of Help → About. */
  aboutInfo: 'about:info',
  /** event, main → window: a new version is downloaded or released (tz.md, п. 2.5). */
  updateState: 'update:state',
  /** invoke, window → main: the update in the status bar was clicked. */
  updateApply: 'update:apply',
  /** invoke, window → main: open a license file (links in About). */
  aboutOpen: 'about:open',
  /** invoke, batch window → main: the interface texts (tz.md, п. 10). */
  batchInit: 'batch:init',
  /** event, main → batch window: progress. */
  batchState: 'batch:state',
  /** event, main → batch window: the result. */
  batchDone: 'batch:done',
  /** send, batch window → main: Cancel. */
  batchCancel: 'batch:cancel',
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
  /** Colours of tracks and the zoom from which waypoint names show (tz.md, п. 3.9.5). */
  tracks: { colors: string[]; labelZoom: number }
  /** Scheme of thumbnail URLs: `${thumbScheme}://f<generation>/<photo id>`. */
  thumbScheme: string
  /** Locale of the regional format of the system: dates are shown in it (tz.md, п. 4.13). */
  dateLocale: string
  /** Already known at start (tz.md, п. 2.5); later ones come as events. */
  update: UpdateState | null
  /** Where the strip is, as at the end of the last run (tz.md, п. 4.1). */
  stripPosition: StripPosition
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
  /** Files are being added (tz.md, п. 3.1): the strip stays as it is meanwhile. */
  adding?: boolean
}

/** A track for the map (tz.md, п. 3.9): its lines and points, the time zone of its place. */
export interface TrackForMap {
  data: TrackData
  /** IANA time zone of the place of the track (local times); null — unknown. */
  zone: string | null
}

/** Del (tz.md, п. 6.6): the selected items leave the strip. */
export interface RemovePhotosRequest {
  /** Generation the ids belong to: a request for an older strip is ignored. */
  generation: number
  ids: number[]
}

/** Checks a remove request coming from the window. */
export function validRemovePhotos(v: unknown): v is RemovePhotosRequest {
  if (!v || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  const ids = r['ids']
  return (
    Number.isInteger(r['generation']) &&
    Array.isArray(ids) &&
    ids.every((id) => Number.isInteger(id) && (id as number) >= 0)
  )
}

export interface SetCoordsRequest {
  ids: number[]
  /** null removes the coordinates (Del, tz.md, п. 6.6). */
  coords: LatLon | null
  /** Ctrl+V of what Ctrl+C took from a photo (п. 4.10): its address and altitude go along. */
  copied?: { address: Address | null; altitude: number | null }
}

const ADDRESS_KEYS = ['country', 'countryCode', 'state', 'city', 'location'] as const

function validCopied(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  const alt = r['altitude']
  if (alt !== null && !(typeof alt === 'number' && Number.isFinite(alt))) return false
  const a = r['address']
  if (a === null) return true
  if (!a || typeof a !== 'object') return false
  // No line breaks or control characters: they would become exiftool options (ExifTool.run).
  // eslint-disable-next-line no-control-regex
  return ADDRESS_KEYS.every((k) => { const s = (a as Record<string, unknown>)[k]; return typeof s === 'string' && !/[\u0000-\u001f\u007f\u2028\u2029]/.test(s) })
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

/** Where the strip is: under the map or left of it (View → Strip Position; tz.md, п. 4.1). */
export type StripPosition = 'bottom' | 'left'

export function isStripPosition(v: unknown): v is StripPosition {
  return v === 'bottom' || v === 'left'
}

export interface UiState {
  ids: number[]
  /** The photo of the status bar, followed by the map and the photo view. */
  current: number | null
  filter: StripFilter
  view: ViewMode
  mapMode: MapMode
  /** The strip fills the window instead of the map (G, View → Grid; tz.md, п. 4.17). */
  grid: boolean
}

export type WindowCommand =
  | { type: 'toggleView' }
  | { type: 'showOnMap' }
  | { type: 'toggleThumbnails' }
  | { type: 'toggleGrid' }
  | { type: 'setStripPosition'; position: StripPosition }
  | { type: 'setFilter'; filter: StripFilter }
  | { type: 'copyCoords' }
  | { type: 'pasteCoords' }
  | { type: 'clearCoords' }
  | { type: 'removeFromStrip' }
  | { type: 'selectAll' }
  | { type: 'toggleHelp' }
  | { type: 'showAbout' }

/** Help → About (tz.md, п. 4.9). */
export interface AboutInfo {
  version: string
  exiftoolVersion: string
  exiftoolPath: string
  electron: string
  node: string
}

/** What a link in About opens; main knows the paths, the window only names the target. */
export type AboutTarget = 'license' | 'notices'

/** Saving (tz.md, п. 6.8): n of N while it goes, then the result. */
export type SaveState =
  | { phase: 'progress'; done: number; total: number }
  /** Saving waits until the addresses and altitudes are found (пп. 5.5, 5.6): how many are left. */
  | { phase: 'waiting'; left: number }
  | { phase: 'done'; saved: number; failed: number }

/** Addresses and altitudes still to find: points left and about how long, seconds (пп. 5.5, 5.6). */
export interface QueueState {
  address: number
  altitude: number
  seconds: number
}

/** Progress of the batch mode (tz.md, п. 10): the phase, steps, about how long is left. */
export interface BatchState {
  /** xiftool — installing exiftool (tz.md, п. 2.2): phaseDone / phaseTotal are megabytes. */
  phase: 'scan' | 'address' | 'altitude' | 'write' | 'exiftool'
  done: number
  total: number
  phaseDone: number
  phaseTotal: number
  seconds: number | null
}

/** Result of the batch mode. */
export interface BatchDone {
  written: number
  skipped: number
  failed: { name: string; error: string }[]
  cancelled: boolean
}

export type { FolderData, SearchResult }

export const THUMB_SCHEME = 'thumb'

/** Thumbnail of the strip, or with `large` the image of the photo view. */
export function thumbUrl(generation: number, id: number, large = false): string {
  return `${THUMB_SCHEME}://f${generation}/${id}${large ? '/large' : ''}`
}

/** The short video of a live photo (tz.md, п. 3.3.7), served the same way as the thumbnails. */
export function liveUrl(generation: number, id: number): string {
  return `${THUMB_SCHEME}://f${generation}/${id}/live`
}

/** Parses a thumbnail URL back; null if it is not one. */
export function parseThumbUrl(url: string): { generation: number; id: number; large: boolean; live: boolean } | null {
  const m = /^thumb:\/\/f(\d+)\/(\d+)(\/large|\/live)?\/?$/.exec(url)
  return m ? { generation: Number(m[1]), id: Number(m[2]), large: m[3] === '/large', live: m[3] === '/live' } : null
}

/** Checks a set-coordinates request coming from the window. */
export function validSetCoords(v: unknown): v is SetCoordsRequest {
  if (!v || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  const c = r['coords'] as Record<string, unknown> | null | undefined
  const ids = r['ids']
  if (!Array.isArray(ids) || !ids.every((id) => Number.isInteger(id) && (id as number) >= 0)) return false
  if (r['copied'] !== undefined && (c === null || !validCopied(r['copied']))) return false
  if (c === null) return true
  return (
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
  if (typeof r['grid'] !== 'boolean') return null
  return {
    ids: ids as number[],
    current: current as number | null,
    filter: r['filter'] as StripFilter,
    view: r['view'],
    mapMode: r['mapMode'],
    grid: r['grid']
  }
}
