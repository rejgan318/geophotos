// Leaflet.markercluster is a UMD plugin that extends the global `L`,
// so Leaflet must be global before the plugin module is evaluated.
import L from 'leaflet'

declare global {
  interface Window {
    L: typeof L
  }
}

window.L = L

export default L
