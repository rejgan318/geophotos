import { contextBridge } from 'electron'
import type { GeoPhotosApi } from './api'

// The bridge between the window and main. Filled in as IPC channels appear.
const api: GeoPhotosApi = {}

contextBridge.exposeInMainWorld('geophotos', api)
