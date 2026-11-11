/** Settings as described by schemas/settings.schema.json. */
export interface TileSource {
  name?: string
  url?: string
  subdomains?: string
  attribution?: string
  maxZoom?: number
}

export interface Settings {
  language: string
  exiftoolPath: string
  map: {
    initialView: { lat: number; lon: number; zoom: number }
    defaultSource: string
    markers: MarkerStyle
    /** Longer side of the thumbnail over a hovered marker, px (tz.md, п. 4.8.2). */
    hoverThumbSize: number
    /** Thumbnails on the map instead of markers (tz.md, п. 4.8.3). */
    thumbnails: { size: number }
    tileSources: Record<string, TileSource>
  }
  log: { level: LogLevel; maxSizeKb: number; maxFiles: number }
  search: { url: string }
  /** Addresses by coordinates (tz.md, п. 5.5). */
  geocode: { url: string; minIntervalMs: number }
  /** Photos from subfolders (tz.md, п. 3.2). */
  folders: { subfolders: 'ask' | 'yes' | 'no' }
}

/** Look of map markers (tz.md, п. 4.8.1). */
export interface MarkerStyle {
  color: string
  selectedColor: string
  /** Pin height, px. */
  size: number
}

export type LogLevel = 'error' | 'warn' | 'info' | 'verbose' | 'debug'

type Json = unknown

function isPlainObject(v: Json): v is Record<string, Json> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Overlays the user config on the defaults field by field (tz.md, п. 8.3).
 * Objects are merged recursively; any other value (including arrays) replaces the default.
 * The `$schema` field is not carried over: it only matters inside a file.
 */
export function mergeSettings<T>(defaults: T, user: Json): T {
  return mergeValue(defaults, user, true) as T
}

function mergeValue(base: Json, over: Json, top = false): Json {
  if (over === undefined) return base
  if (!isPlainObject(base) || !isPlainObject(over)) return over
  const result: Record<string, Json> = { ...base }
  for (const [key, value] of Object.entries(over)) {
    if (top && key === '$schema') continue
    result[key] = mergeValue(base[key], value)
  }
  return result
}

/** A tile source ready for the map: name and url are always present. */
export interface MapSource {
  key: string
  name: string
  url: string
  subdomains: string
  attribution: string
  maxZoom: number
}

/** Tile sources in config order; sources without url are skipped (reported in `skipped`). */
export function mapSources(settings: Settings): { sources: MapSource[]; skipped: string[] } {
  const sources: MapSource[] = []
  const skipped: string[] = []
  for (const [key, s] of Object.entries(settings.map.tileSources)) {
    if (!s.url) {
      skipped.push(key)
      continue
    }
    sources.push({
      key,
      name: s.name ?? key,
      url: s.url,
      subdomains: s.subdomains ?? 'abc',
      attribution: s.attribution ?? '',
      maxZoom: s.maxZoom ?? 19
    })
  }
  return { sources, skipped }
}
