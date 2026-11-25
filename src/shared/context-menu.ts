/**
 * The context menu of a photo (tz.md, п. 9.3, 0.34.0): which items it has and which of them are
 * available. The same conditions as the Edit and View menus (п. 4.9); a track has only the items
 * that make sense for it.
 */
export type ContextItem = 'showOnMap' | 'copyCoords' | 'pasteCoords' | 'clearCoords' | 'removeFromStrip' | 'showInExplorer' | 'openDefault'

export interface ContextItemState {
  item: ContextItem
  enabled: boolean
}

interface Item {
  coords: unknown
  track?: unknown
}

/**
 * `current` — the photo the menu is for (it is the current one); `picked` — the selected ones;
 * `saving` — Save is running (editing waits).
 */
export function contextItems(current: Item, picked: readonly Item[], saving: boolean): ContextItemState[] {
  const photos = picked.filter((p) => !p.track)
  const all: ContextItemState[] = [
    { item: 'showOnMap', enabled: !!current.coords || !!current.track },
    { item: 'copyCoords', enabled: !!current.coords && !current.track },
    { item: 'pasteCoords', enabled: !saving && photos.length > 0 },
    { item: 'clearCoords', enabled: !saving && photos.some((p) => p.coords) },
    { item: 'removeFromStrip', enabled: !saving && picked.length > 0 },
    { item: 'showInExplorer', enabled: true },
    { item: 'openDefault', enabled: true }
  ]
  const forTrack: ContextItem[] = ['showOnMap', 'removeFromStrip', 'showInExplorer', 'openDefault']
  return current.track ? all.filter((s) => forTrack.includes(s.item)) : all
}

/** Size of the thumbnails in the grid, px (tz.md, п. 4.17): Ctrl+wheel, Ctrl + «+» / «−», Ctrl+0. */
export const GRID_THUMB = { min: 80, max: 240, step: 20, normal: 120 } as const

/** The next size: `dir` 1 — larger, -1 — smaller, 0 — the normal size. Kept within the limits, on the steps. */
export function nextGridThumb(size: number, dir: 1 | -1 | 0): number {
  if (dir === 0) return GRID_THUMB.normal
  const snapped = Math.round(size / GRID_THUMB.step) * GRID_THUMB.step
  return Math.min(GRID_THUMB.max, Math.max(GRID_THUMB.min, snapped + dir * GRID_THUMB.step))
}

/** A size read from the state file: a known step within the limits, otherwise the normal size. */
export function validGridThumb(v: unknown): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= GRID_THUMB.min && v <= GRID_THUMB.max && v % GRID_THUMB.step === 0
    ? v
    : GRID_THUMB.normal
}
