import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  IPC,
  type AboutInfo,
  type FolderData,
  type FolderLoading,
  type InitData,
  type PhotosChanged,
  type SaveState,
  type SearchResult,
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
  openPath: (path) => ipcRenderer.invoke(IPC.openPath, path) as Promise<void>,
  pathForFile: (file) => webUtils.getPathForFile(file),
  setCoords: (req) => ipcRenderer.invoke(IPC.setCoords, req) as Promise<void>,
  onPhotosChanged: (cb) => {
    ipcRenderer.on(IPC.photosChanged, (_e, data: PhotosChanged) => cb(data))
  },
  reportState: (state) => ipcRenderer.send(IPC.uiState, state),
  reportView: (view) => ipcRenderer.send(IPC.viewState, view),
  onCommand: (cb) => {
    ipcRenderer.on(IPC.command, (_e, cmd: WindowCommand) => cb(cmd))
  },
  onSaveState: (cb) => {
    ipcRenderer.on(IPC.saveState, (_e, state: SaveState) => cb(state))
  },
  searchPlaces: (query) => ipcRenderer.invoke(IPC.search, query) as Promise<SearchResult>,
  aboutInfo: () => ipcRenderer.invoke(IPC.aboutInfo) as Promise<AboutInfo>,
  openAboutTarget: (target) => ipcRenderer.invoke(IPC.aboutOpen, target) as Promise<void>,
  readClipboard: () => ipcRenderer.invoke(IPC.clipboardRead) as Promise<string>,
  writeClipboard: (text) => ipcRenderer.invoke(IPC.clipboardWrite, text) as Promise<void>
}

contextBridge.exposeInMainWorld('geophotos', api)
