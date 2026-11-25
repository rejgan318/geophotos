import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { UpdateState } from '@shared/updates'
import {
  IPC,
  type AboutInfo,
  type BatchDone,
  type BatchState,
  type FolderData,
  type FolderLoading,
  type InitData,
  type PhotosChanged,
  type QueueState,
  type SaveState,
  type SearchResult,
  type TrackForMap,
  type WindowAction,
  type WindowCommand
} from '@shared/ipc'
import type { GeoPhotosApi } from './api'

// The bridge between the window and main: the window has no direct access to Node.js.
const api: GeoPhotosApi = {
  init: () => ipcRenderer.invoke(IPC.init) as Promise<InitData>,
  onFolderLoading: (cb) => {
    ipcRenderer.on(IPC.folderLoading, (_e, data: FolderLoading) => cb(data))
  },
  onFolderLoaded: (cb) => {
    ipcRenderer.on(IPC.folderLoaded, (_e, data: FolderData) => cb(data))
  },
  openPaths: (paths) => ipcRenderer.invoke(IPC.openPaths, paths) as Promise<void>,
  removePhotos: (req) => ipcRenderer.invoke(IPC.removePhotos, req) as Promise<void>,
  trackData: (generation, id) => ipcRenderer.invoke(IPC.trackData, generation, id) as Promise<TrackForMap | null>,
  pathForFile: (file) => webUtils.getPathForFile(file),
  setCoords: (req) => ipcRenderer.invoke(IPC.setCoords, req) as Promise<void>,
  onPhotosChanged: (cb) => {
    ipcRenderer.on(IPC.photosChanged, (_e, data: PhotosChanged) => cb(data))
  },
  reportState: (state) => ipcRenderer.send(IPC.uiState, state),
  reportView: (view) => ipcRenderer.send(IPC.viewState, view),
  action: (a: WindowAction) => ipcRenderer.send(IPC.action, a),
  onIdle: (cb) => {
    ipcRenderer.on(IPC.idle, () => cb())
  },
  onRecent: (cb) => {
    ipcRenderer.on(IPC.recent, (_e, list: string[]) => cb(list))
  },
  onCommand: (cb) => {
    ipcRenderer.on(IPC.command, (_e, cmd: WindowCommand) => cb(cmd))
  },
  onSaveState: (cb) => {
    ipcRenderer.on(IPC.saveState, (_e, state: SaveState) => cb(state))
  },
  onQueueState: (cb) => {
    ipcRenderer.on(IPC.queueState, (_e, state: QueueState) => cb(state))
  },
  searchPlaces: (query) => ipcRenderer.invoke(IPC.search, query) as Promise<SearchResult>,
  openInPlayer: (id) => ipcRenderer.invoke(IPC.openInPlayer, id) as Promise<void>,
  onUpdateState: (cb) => {
    ipcRenderer.on(IPC.updateState, (_e, s: UpdateState) => cb(s))
  },
  applyUpdate: () => ipcRenderer.invoke(IPC.updateApply) as Promise<void>,
  aboutInfo: () => ipcRenderer.invoke(IPC.aboutInfo) as Promise<AboutInfo>,
  openAboutTarget: (target) => ipcRenderer.invoke(IPC.aboutOpen, target) as Promise<void>,
  batchInit: () => ipcRenderer.invoke(IPC.batchInit) as Promise<{ strings: Record<string, string> }>,
  onBatchState: (cb) => {
    ipcRenderer.on(IPC.batchState, (_e, s: BatchState) => cb(s))
  },
  onBatchDone: (cb) => {
    ipcRenderer.on(IPC.batchDone, (_e, d: BatchDone) => cb(d))
  },
  batchCancel: () => ipcRenderer.send(IPC.batchCancel),
  batchFit: (height) => ipcRenderer.send(IPC.batchFit, height),
  readClipboard: () => ipcRenderer.invoke(IPC.clipboardRead) as Promise<string>,
  writeClipboard: (text) => ipcRenderer.invoke(IPC.clipboardWrite, text) as Promise<void>
}

contextBridge.exposeInMainWorld('geophotos', api)
