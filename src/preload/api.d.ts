import type { UpdateState } from '../shared/updates'
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
  RemovePhotosRequest,
  SaveState,
  SearchResult,
  SetCoordsRequest,
  TrackForMap,
  UiState,
  ViewState,
  WindowAction,
  WindowCommand
} from '../shared/ipc'

/** API exposed to the window as `window.geophotos`. */
export interface GeoPhotosApi {
  init(): Promise<InitData>
  onFolderLoading(cb: (data: FolderLoading) => void): void
  onFolderLoaded(cb: (data: FolderData) => void): void
  /**
   * Folders and files dropped from Explorer (tz.md, п. 3.1): the first folder opens (a new
   * project), the files are added to the strip.
   */
  openPaths(paths: string[]): Promise<void>
  /** Takes photos off the strip (Del, tz.md, п. 6.6); the strip comes again through onFolderLoaded. */
  removePhotos(req: RemovePhotosRequest): Promise<void>
  /** Lines and points of a track of the strip (tz.md, п. 3.9); null — not a track, or another strip. */
  trackData(generation: number, id: number): Promise<TrackForMap | null>
  /** Disk path of a file or folder dropped onto the window ('' if it has none). */
  pathForFile(file: File): string
  /** Gives photos new coordinates; the change comes back through onPhotosChanged. */
  setCoords(req: SetCoordsRequest): Promise<void>
  onPhotosChanged(cb: (data: PhotosChanged) => void): void
  /** Tells main the selection, filter and view mode (Save Selected, View menu, last session). */
  reportState(state: UiState): void
  /** Tells main the place of the map, tile source and strip scroll (next run). */
  reportView(view: ViewState): void
  /** The context menu, the start screen, the grid size (tz.md, пп. 4.17–4.19). */
  action(a: WindowAction): void
  /** Nothing is being opened and nothing is open: the start screen may show. */
  onIdle(cb: () => void): void
  /** The recent folders changed (the start screen). */
  onRecent(cb: (list: string[]) => void): void
  /** Commands of the View menu. */
  onCommand(cb: (cmd: WindowCommand) => void): void
  onSaveState(cb: (state: SaveState) => void): void
  /** Addresses still to find (tz.md, п. 5.5). */
  onQueueState(cb: (state: QueueState) => void): void
  searchPlaces(query: string): Promise<SearchResult>
  /** Opens a video in the default program of Windows (photo view, tz.md, п. 4.14). */
  openInPlayer(id: number): Promise<void>
  /** A new version (tz.md, п. 2.5): shown in the status bar; a click applies it. */
  onUpdateState(cb: (s: UpdateState) => void): void
  applyUpdate(): Promise<void>
  aboutInfo(): Promise<AboutInfo>
  /** Opens the settings file (created if missing) or the log folder. */
  openAboutTarget(target: AboutTarget): Promise<void>
  /** Batch window (tz.md, п. 10): texts, progress, result, Cancel. */
  batchInit(): Promise<{ strings: Record<string, string> }>
  onBatchState(cb: (s: BatchState) => void): void
  onBatchDone(cb: (d: BatchDone) => void): void
  batchCancel(): void
  /** The batch window asks to be as tall as its content, px. */
  batchFit(height: number): void
  readClipboard(): Promise<string>
  writeClipboard(text: string): Promise<void>
}

declare global {
  interface Window {
    geophotos: GeoPhotosApi
  }
}
