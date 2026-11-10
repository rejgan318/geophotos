import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC, type FolderData, type FolderLoading, type InitData } from '@shared/ipc'
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
  pathForFile: (file) => webUtils.getPathForFile(file)
}

contextBridge.exposeInMainWorld('geophotos', api)
