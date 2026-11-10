import type { FolderData, FolderLoading, InitData } from '../shared/ipc'

/** API exposed to the window as `window.geophotos`. */
export interface GeoPhotosApi {
  init(): Promise<InitData>
  onFolderLoading(cb: (data: FolderLoading) => void): void
  onFolderLoaded(cb: (data: FolderData) => void): void
  /** Opens a folder, or the folder of a photo with that photo selected. */
  openPath(path: string): Promise<void>
  /** Disk path of a file or folder dropped onto the window ('' if it has none). */
  pathForFile(file: File): string
}

declare global {
  interface Window {
    geophotos: GeoPhotosApi
  }
}
