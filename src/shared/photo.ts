export interface LatLon {
  lat: number
  lon: number
}

/** Where the shown coordinates were read from (tz.md, п. 3.7). */
export type CoordSource = 'sidecar' | 'xmp' | 'exif'

export interface Photo {
  /** Index in the folder's photo list; stable while the folder is open. */
  id: number
  name: string
  path: string
  /** Local wall time "YYYY-MM-DD HH:MM:SS"; null if neither shooting nor file date is known. */
  date: string | null
  /** `shot` — date of shooting; `file` — file modification time used instead (п. 4.2). */
  dateSource: 'shot' | 'file'
  coords: LatLon | null
  coordSource: CoordSource | null
  /** Read error reported by exiftool (broken file etc.). */
  error?: string
}

export interface FolderData {
  folder: string
  photos: Photo[]
  /** Generation of the opened folder; part of thumbnail URLs so old ones are not reused. */
  generation: number
  /** Photo to select right after opening (the chosen or dropped photo), or null. */
  selected: number | null
}

export function formatCoords(c: LatLon): string {
  return `${c.lat.toFixed(6)}, ${c.lon.toFixed(6)}`
}
