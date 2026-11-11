import type {
  FolderData,
  FolderLoading,
  InitData,
  PhotosChanged,
  SaveState,
  SearchResult,
  SetCoordsRequest,
  UiState,
  WindowCommand
} from '../shared/ipc'

/** API exposed to the window as `window.geophotos`. */
export interface GeoPhotosApi {
  init(): Promise<InitData>
  onFolderLoading(cb: (data: FolderLoading) => void): void
  onFolderLoaded(cb: (data: FolderData) => void): void
  /** Opens a folder, or the folder of a photo with that photo selected. */
  openPath(path: string): Promise<void>
  /** Disk path of a file or folder dropped onto the window ('' if it has none). */
  pathForFile(file: File): string
  /** Gives photos new coordinates; the change comes back through onPhotosChanged. */
  setCoords(req: SetCoordsRequest): Promise<void>
  onPhotosChanged(cb: (data: PhotosChanged) => void): void
  /** Tells main the selection, filter and view mode (Save Selected, View menu, last session). */
  reportState(state: UiState): void
  /** Commands of the View menu. */
  onCommand(cb: (cmd: WindowCommand) => void): void
  onSaveState(cb: (state: SaveState) => void): void
  searchPlaces(query: string): Promise<SearchResult>
}

declare global {
  interface Window {
    geophotos: GeoPhotosApi
  }
}
