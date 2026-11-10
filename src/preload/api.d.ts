/** API exposed to the window as `window.geophotos`. */
export type GeoPhotosApi = Record<string, never>

declare global {
  interface Window {
    geophotos: GeoPhotosApi
  }
}
