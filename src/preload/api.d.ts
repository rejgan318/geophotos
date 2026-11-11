import type {
  AboutInfo,
  AboutTarget,
  BatchDone,
  BatchState,
  FolderData,
  FolderLoading,
  InitData,
  PhotosChanged,
  QueueState,
  SaveState,
  SearchResult,
  SetCoordsRequest,
  UiState,
  ViewState,
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
  /** Tells main the place of the map, tile source and strip scroll (next run). */
  reportView(view: ViewState): void
  /** Commands of the View menu. */
  onCommand(cb: (cmd: WindowCommand) => void): void
  onSaveState(cb: (state: SaveState) => void): void
  /** Addresses still to find (tz.md, п. 5.5). */
  onQueueState(cb: (state: QueueState) => void): void
  searchPlaces(query: string): Promise<SearchResult>
  aboutInfo(): Promise<AboutInfo>
  /** Opens the settings file (created if missing) or the log folder. */
  openAboutTarget(target: AboutTarget): Promise<void>
  /** Batch window (tz.md, п. 10): texts, progress, result, Cancel. */
  batchInit(): Promise<{ strings: Record<string, string> }>
  onBatchState(cb: (s: BatchState) => void): void
  onBatchDone(cb: (d: BatchDone) => void): void
  batchCancel(): void
  readClipboard(): Promise<string>
  writeClipboard(text: string): Promise<void>
}

declare global {
  interface Window {
    geophotos: GeoPhotosApi
  }
}
