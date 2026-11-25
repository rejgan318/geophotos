import { describe, expect, it } from 'vitest'
import { contextItems, GRID_THUMB, nextGridThumb, validGridThumb } from '@shared/context-menu'

const on = (states: ReturnType<typeof contextItems>): string[] => states.filter((s) => s.enabled).map((s) => s.item)
const coords = { lat: 1, lon: 2 }

describe('context menu of a photo (tz.md, 0.34.0)', () => {
  it('a photo with coordinates, selected alone: everything is available', () => {
    const p = { coords }
    expect(on(contextItems(p, [p], false))).toEqual([
      'showOnMap', 'copyCoords', 'pasteCoords', 'clearCoords', 'removeFromStrip', 'showInExplorer', 'openDefault'
    ])
  })

  it('a photo without coordinates: no Show on Map, Copy, Delete Coordinates', () => {
    const p = { coords: null }
    expect(on(contextItems(p, [p], false))).toEqual(['pasteCoords', 'removeFromStrip', 'showInExplorer', 'openDefault'])
  })

  it('while saving: no editing', () => {
    const p = { coords }
    expect(on(contextItems(p, [p], true))).toEqual(['showOnMap', 'copyCoords', 'showInExplorer', 'openDefault'])
  })

  it('a track: only Show on Map, Take off the Strip, Explorer, default program', () => {
    const tr = { coords: null, track: true }
    expect(contextItems(tr, [tr], false).map((s) => s.item)).toEqual(['showOnMap', 'removeFromStrip', 'showInExplorer', 'openDefault'])
    expect(on(contextItems(tr, [tr], false))).toEqual(['showOnMap', 'removeFromStrip', 'showInExplorer', 'openDefault'])
  })
})

describe('size of the thumbnails in the grid', () => {
  it('steps of 20 between 80 and 240; Ctrl+0 — 120', () => {
    expect(nextGridThumb(120, 1)).toBe(140)
    expect(nextGridThumb(120, -1)).toBe(100)
    expect(nextGridThumb(240, 1)).toBe(240)
    expect(nextGridThumb(80, -1)).toBe(80)
    expect(nextGridThumb(200, 0)).toBe(GRID_THUMB.normal)
  })

  it('from the state file: unknown values give the normal size', () => {
    expect(validGridThumb(160)).toBe(160)
    expect(validGridThumb(170)).toBe(120)
    expect(validGridThumb(400)).toBe(120)
    expect(validGridThumb('big')).toBe(120)
  })
})
