import type { Strings } from './i18n'
import type { FolderData } from './photo'
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
  openPath: 'path:open'
} as const

export interface InitData {
  strings: Strings
  map: {
    sources: MapSource[]
    defaultSource: string
    initialView: { lat: number; lon: number; zoom: number }
    markers: MarkerStyle
  }
  /** Scheme of thumbnail URLs: `${thumbScheme}://f<generation>/<photo id>`. */
  thumbScheme: string
}

export interface FolderLoading {
  folder: string
}

export type { FolderData }

export const THUMB_SCHEME = 'thumb'

export function thumbUrl(generation: number, id: number): string {
  return `${THUMB_SCHEME}://f${generation}/${id}`
}

/** Parses a thumbnail URL back; null if it is not one. */
export function parseThumbUrl(url: string): { generation: number; id: number } | null {
  const m = /^thumb:\/\/f(\d+)\/(\d+)\/?$/.exec(url)
  return m ? { generation: Number(m[1]), id: Number(m[2]) } : null
}
