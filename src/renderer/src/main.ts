import './style.css'
import { clipboardText, parseCoords } from '@shared/coords-parse'
import { photoCounts, photosAt } from '@shared/edits'
import { formatDuration } from '@shared/duration'
import { makeTranslate } from '@shared/i18n'
import type { MapMode, StripPosition, ViewMode } from '@shared/ipc'
import type { Address, FolderData, LatLon } from '@shared/photo'
import type { UpdateState } from '@shared/updates'
import { setDateLocale, statusParts } from './describe'
import { MapView } from './map'
import { PhotoView } from './viewer'
import { HelpView } from './help'
import { AboutView } from './about'
import { effectiveFilter, matchesFilter, toggleFilter, visibleIds, type StripFilter } from './filter'
import { PENCIL_SVG, PHOTO_SVG, PIN_OFF_SVG, PIN_SVG } from './icons'
import { isNavKey, navigateShown } from './navigation'
import { addSearchBox } from './search'
import {
  clickSelect,
  dragSelection,
  EMPTY_SELECTION,
  restrictSelection,
  selectAll,
  single,
  type Selection
} from './selection'
import { PHOTO_DRAG_TYPE, Strip } from './strip'
import { nextGridThumb } from '@shared/context-menu'
import type L from './leaflet-global'
import { TrackLayer } from './track-layer'
import { TrackSummaryView } from './track-view'
import { placeAt, photoInstant, placeOnTracks } from '@shared/track-match'

const byId = (id: string): HTMLElement => document.getElementById(id)!

/** Text fields keep their own keys (cursor movement, select all). */
function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

async function start(): Promise<void> {
  const init = await window.geophotos.init()
  const t = makeTranslate(init.strings)
  setDateLocale(init.dateLocale)

  // Marker colors from the settings, shared by the map and the strip badges (tz.md, пп. 4.3, 4.8.1).
  document.documentElement.style.setProperty('--marker-color', init.map.markers.color)
  document.documentElement.style.setProperty('--marker-selected', init.map.markers.selectedColor)

  const statusPhoto = byId('status-photo')
  const statusNote = byId('status-note')
  const statusCounts = byId('status-counts')
  const statusQueue = byId('status-queue')
  // A new version (tz.md, п. 2.5): far right in the status bar; a click restarts or opens the release.
  const statusUpdate = byId('status-update') as HTMLButtonElement
  const showUpdate = (u: UpdateState | null): void => {
    statusUpdate.hidden = !u
    if (!u) return
    statusUpdate.textContent = t(u.kind === 'ready' ? 'update.ready' : 'update.available', { version: u.version })
    statusUpdate.title = t(u.kind === 'ready' ? 'update.readyHint' : 'update.availableHint')
  }
  statusUpdate.addEventListener('click', () => void window.geophotos.applyUpdate())
  showUpdate(init.update)
  window.geophotos.onUpdateState(showUpdate)
  const progress = byId('progress')
  const progressText = byId('progress-text')
  let folder: FolderData | null = null
  /** Whether an item of the strip is a track (tz.md, п. 3.9). */
  const isTrackId = (id: number): boolean => !!folder?.photos[id]?.track
  let sel: Selection = EMPTY_SELECTION
  /** Photos being dragged from the strip (drag data cannot be read before the drop). */
  let dragged: number[] | null = null
  let saving = false
  /** Strip filter by the status bar counter (tz.md, п. 4.13) and the photos it shows, in strip order. */
  let filter: StripFilter = 'all'
  let order: number[] = []
  /** Map or photo in the main area (Space, View menu). */
  let view: ViewMode = 'map'
  /** Markers or thumbnails on the map (T, View menu; tz.md, п. 4.8.3). */
  let mapMode: MapMode = init.map.thumbnails ? 'thumbs' : 'pins'
  /** Where the strip is (View → Strip Position, tz.md, п. 4.1); kept by main. */
  let stripPosition: StripPosition = init.stripPosition
  /** The strip over the whole window instead of the map (G, View → Grid, tz.md, п. 4.17); not kept. */
  let grid = false
  /** The strip scroll outside the grid: this one is kept for the next run (п. 7.1). */
  let lastScroll = 0
  /** Size of the thumbnails in the grid (п. 4.17); kept by main. */
  let gridThumb = init.gridThumb
  document.documentElement.style.setProperty('--grid-thumb', `${gridThumb}px`)

  const showStatus = (): void => {
    const p = sel.current === null ? undefined : folder?.photos[sel.current]
    if (!folder) statusPhoto.textContent = t('status.noFolder')
    else if (!p) statusPhoto.textContent = t('status.noSelection')
    // Name, then dim: date, size, length of a video (tz.md, п. 4.13). The coordinates are copied
    // by Ctrl+C, "modified" is the pencil badge in the strip.
    else {
      const span = (cls: string, text: string): HTMLSpanElement => {
        const s = document.createElement('span')
        s.className = cls
        s.textContent = text
        return s
      }
      const { name, rest } = statusParts(p, t)
      const parts: HTMLElement[] = []
      if (sel.ids.size > 1) parts.push(span('st-count', t('status.selected', { count: sel.ids.size })))
      parts.push(span('st-name', name))
      rest.forEach((text, i) => {
        if (i > 0) parts.push(span('st-sep', '·'))
        parts.push(span('st-meta', text))
      })
      statusPhoto.replaceChildren(...parts)
    }
  }

  // The counter is three buttons that filter the strip; a second click on the active one
  // switches the filter off (tz.md, п. 4.13).
  const filterButtons = (
    [
      ['all', 'filter.total', 'total', PHOTO_SVG],
      ['coords', 'filter.withCoords', 'withCoords', PIN_SVG],
      ['noCoords', 'filter.withoutCoords', 'withoutCoords', PIN_OFF_SVG],
      ['modified', 'filter.modified', 'modified', PENCIL_SVG]
    ] as const
  ).map(([key, label, count, svg]) => {
    // The same icons as the strip badges, with the number (tz.md, п. 4.13); the words are in the tooltip.
    const b = document.createElement('button')
    b.type = 'button'
    b.className = `filter-btn ${key}`
    const icon = document.createElement('span')
    icon.className = 'filter-icon'
    icon.innerHTML = svg
    const num = document.createElement('span')
    num.className = 'filter-count'
    b.append(icon, num)
    b.addEventListener('click', () => setFilter(toggleFilter(filter, key)))
    statusCounts.append(b)
    return { key, label, count, b, num }
  })

  const showCounts = (): void => {
    const counts = photoCounts(folder?.photos ?? [])
    for (const { key, label, count, b, num } of filterButtons) {
      const n = counts[count]
      num.textContent = String(n)
      b.title = `${t(label, { n })}
${t(key === 'all' ? 'filter.allHint' : 'filter.hint')}`
      b.setAttribute('aria-label', t(label, { n }))
      b.classList.toggle('active', filter === key)
      b.setAttribute('aria-pressed', String(filter === key))
      // A filter no photo passes is not available.
      b.disabled = key !== 'all' && n === 0
    }
  }

  /** Shows in the strip and on the map the photos that pass the filter; hidden photos leave the selection. */
  const applyFilter = (): void => {
    const photos = folder?.photos ?? []
    // An active filter that became empty falls back to "all"; the map does not move.
    filter = effectiveFilter(photos, filter)
    order = visibleIds(photos, filter)
    const shown = new Set(order)
    strip.setShown(shown, t('filter.empty'))
    map.setShown(shown)
    showCounts()
    // A photo is always selected (tz.md, п. 4.4): hidden ones leave, the first shown one comes in.
    const next = restrictSelection(sel, order)
    if (next !== sel) select(next)
    else reportState()
  }

  const setFilter = (f: StripFilter): void => {
    if (f === filter) return
    filter = f
    applyFilter()
    // The current photo stays in view if it is still shown.
    strip.setSelection(sel)
    // A click on a filter shows its photos on the map, as opening a folder does (п. 5.2);
    // live changes of the filter (after editing or saving) do not move the map.
    map.fitMarkers()
  }

  let noteTimer: number | undefined
  const note = (text: string): void => {
    window.clearTimeout(noteTimer)
    statusNote.textContent = text
  }
  /** A message that goes away by itself after a few seconds. */
  const shortNote = (text: string): void => {
    note(text)
    noteTimer = window.setTimeout(() => {
      if (statusNote.textContent === text) statusNote.textContent = ''
    }, 3000)
  }

  /** What the last Ctrl+C took from a photo: the clipboard text and the data that goes with it. */
  let copied: { text: string; address: Address | null; altitude: number | null } | null = null

  /** Ctrl+C: the current photo's coordinates, address and altitude (tz.md, п. 4.10). */
  const copyCoords = (): void => {
    const p = sel.current === null ? undefined : folder?.photos[sel.current]
    if (!p) return
    if (!p.coords) return shortNote(t('clipboard.noCoords'))
    const text = clipboardText(p.coords)
    void window.geophotos.writeClipboard(text)
    // The address and altitude go along while the clipboard still holds this text (п. 4.10).
    copied = { text, address: p.address, altitude: p.altitude }
  }

  /**
   * Ctrl+V: coordinates from the clipboard (copied from a photo or from elsewhere, п. 4.12) for
   * all selected photos; the map pans to them if they are off screen.
   */
  const pasteCoords = async (): Promise<void> => {
    if (!folder || saving || !sel.ids.size) return
    const text = await window.geophotos.readClipboard()
    const coords = parseCoords(text)
    if (!coords) return shortNote(t('clipboard.nothing'))
    // Copied from a photo here (the clipboard was not changed since): its address and altitude
    // too; from elsewhere: only the coordinates.
    const extra = copied && copied.text === text.trim() ? { address: copied.address, altitude: copied.altitude } : undefined
    await setCoords([...sel.ids], coords, extra)
    if (view === 'map') map.reveal(coords)
  }

  /** Del (п. 6.6): the selected photos or track leave the strip; main asks first if some have unsaved changes. */
  const removeFromStrip = (): void => {
    if (!folder || saving || !sel.ids.size) return
    void window.geophotos.removePhotos({ generation: folder.generation, ids: [...sel.ids] })
  }

  /** Ctrl+Del: the selected photos lose their coordinates (and address, altitude) until Save. */
  const clearCoords = (): void => {
    if (!folder || saving || !sel.ids.size) return
    void setCoords([...sel.ids].filter((id) => !isTrackId(id)), null)
  }

  /** Ctrl+A: all photos shown in the strip (п. 4.4). */
  const selectAllShown = (): void => {
    if (folder) select(selectAll(sel, order, isTrackId))
  }

  /** The one place where the selection changes: strip, map, status and main follow it. */
  const select = (next: Selection): void => {
    sel = next
    strip.setSelection(sel)
    map.setSelection(sel.ids, sel.current)
    showHint()
    if (view === 'map') tracks.revealHint()
    // The selected track is wider; if it is wholly off the map, the map shows it (tz.md, п. 3.9.4).
    const track = sel.current !== null && isTrackId(sel.current) ? sel.current : null
    tracks.setCurrent(track)
    if (track !== null && view === 'map') tracks.reveal(track)
    showStatus()
    showPhoto()
    reportState()
  }

  /**
   * The place of the current photo on a track (tz.md, п. 3.9.7): only for a photo without
   * coordinates whose time falls into a track.
   */
  const showHint = (): void => {
    const p = sel.current === null ? undefined : folder?.photos[sel.current]
    const place = p && !p.track && !p.coords ? placeOnTracks(p, tracks.zoned()) : null
    tracks.showHint(place?.at ?? null)
  }

  /** The place of a photo on one track (п. 3.9.7); null — none (no time, outside, a track itself). */
  const placeOn = (id: number, trackId: number): LatLon | null => {
    const p = folder?.photos[id]
    const tr = tracks.data(trackId)
    if (!p || p.track || !tr) return null
    const t = photoInstant(p, tr.zone)
    return t === null ? null : placeAt(tr.data, t)
  }

  /** Main keeps the selection (Save Selected, last session) and the View menu state. */
  const reportState = (): void => {
    window.geophotos.reportState({ ids: [...sel.ids], current: sel.current, filter, view, mapMode, grid })
  }

  /** The photo view, or for a track the track view (tz.md, пп. 4.14, 3.9.6). */
  const showPhoto = (): void => {
    const p = sel.current === null ? null : (folder?.photos[sel.current] ?? null)
    if (view === 'photo' && p?.track) {
      viewer.setVisible(false)
      enterTrackView(p.id)
      return
    }
    leaveTrackView()
    viewer.setVisible(view === 'photo')
    viewer.show(p, folder?.generation ?? 0)
  }

  /** Where the map was before the track view: it comes back after it (п. 3.9.6). */
  /**
   * Where the map was before the track view, and the item that was current then: the map comes
   * back there (п. 3.9.6) — unless another item became current meanwhile; then the map shows it.
   */
  let mapBefore: { center: L.LatLng; zoom: number; item: number | null } | null = null
  const enterTrackView = (id: number): void => {
    const p = folder?.photos[id]
    const data = tracks.data(id)
    if (!p || !data) {
      leaveTrackView()
      summary.hide()
      return
    }
    if (!mapBefore) mapBefore = { center: map.leaflet.getCenter(), zoom: map.leaflet.getZoom(), item: id }
    map.setStill(true)
    tracks.showOnly(id)
    summary.show(p.name, data, tracks.colorOf(p))
    // The whole track in the room the summary and the profile leave (tz.md, п. 3.9.6).
    tracks.fit(id, { animate: false, ...summary.margins() })
  }
  const leaveTrackView = (): void => {
    if (!summary.visible && !mapBefore) return
    summary.hide()
    tracks.showOnly(null)
    map.setStill(false)
    const before = mapBefore
    mapBefore = null
    if (!before) return
    map.leaflet.setView(before.center, before.zoom, { animate: false })
    const cur = sel.current
    if (cur === null || cur === before.item) return
    // Another track became current in the track view: the map shows the whole of it; a photo —
    // its marker, if it is off the map (п. 4.4.2).
    if (isTrackId(cur)) tracks.fit(cur, { animate: false })
    else map.revealCurrent()
  }

  /** Double click, C, View → Show on Map: the current photo on the map (tz.md, п. 4.4.2). */
  const showOnMap = (): void => {
    // From the grid: back to the map first (tz.md, п. 4.17).
    if (grid) leaveGrid()
    if (sel.current === null) return
    const p = folder?.photos[sel.current]
    // A track: the whole of it (tz.md, п. 3.9.4).
    if (p?.track) {
      if (view === 'photo') toggleView()
      tracks.fit(p.id)
      return
    }
    if (!p?.coords) return
    if (view === 'photo') toggleView()
    map.showOnMap(sel.current)
  }

  /**
   * The map place, tile source and strip scroll go to main for the next run (tz.md, п. 7.1),
   * once they settle.
   */
  let viewTimer: number | undefined
  const reportView = (): void => {
    window.clearTimeout(viewTimer)
    viewTimer = window.setTimeout(
      () => {
        if (!grid) lastScroll = strip.scroll
        window.geophotos.reportView({ ...map.view(), scroll: lastScroll })
      },
      300
    )
  }

  /** T and View menu: markers or thumbnails on the map. */
  const toggleThumbnails = (): void => {
    mapMode = mapMode === 'pins' ? 'thumbs' : 'pins'
    map.setThumbnails(mapMode === 'thumbs')
    reportState()
  }

  /** Space and View menu: the map or the current photo (tz.md, п. 9.3); in the grid, the grid or the photo. */
  const toggleView = (): void => {
    view = view === 'map' ? 'photo' : 'map'
    applyLayout()
    showPhoto()
    if (view === 'map') map.invalidateSize()
    reportState()
  }

  /**
   * The window follows the strip position and the grid (tz.md, пп. 4.1, 4.17): the strip at the
   * bottom or on the left of the map; the grid instead of the map; the photo view from the grid
   * over the whole window.
   */
  const applyLayout = (): void => {
    const cls = document.body.classList
    cls.toggle('strip-left', stripPosition === 'left')
    cls.toggle('grid', grid)
    cls.toggle('grid-photo', grid && view === 'photo')
    strip.setLayout(grid ? 'grid' : stripPosition)
    map.invalidateSize()
  }

  /** G and View → Grid; leaving it, the map comes back (also from the photo view). */
  const toggleGrid = (): void => {
    if (grid) return leaveGrid()
    if (!folder) return
    grid = true
    view = 'map'
    applyLayout()
    showPhoto()
    reportState()
  }

  const leaveGrid = (): void => {
    if (!grid) return
    grid = false
    view = 'map'
    applyLayout()
    showPhoto()
    // The strip back where it was outside the grid, with the current photo in view.
    strip.revealCurrent()
    reportState()
  }

  /** Ctrl+wheel, Ctrl + «+» / «−», Ctrl+0 in the grid (tz.md, п. 4.17); the current photo stays in view. */
  const zoomGrid = (dir: 1 | -1 | 0): void => {
    if (!grid || view !== 'map') return
    const next = nextGridThumb(gridThumb, dir)
    if (next === gridThumb) return
    gridThumb = next
    document.documentElement.style.setProperty('--grid-thumb', `${gridThumb}px`)
    strip.revealCurrent()
    window.geophotos.action({ type: 'gridThumb', size: gridThumb })
  }

  /**
   * The context menu of a photo (tz.md, п. 4.19): a photo not selected becomes the only selected
   * one; a selected one becomes the current one, the selection stays (as in Explorer).
   */
  const openContextMenu = (id: number, x: number, y: number): void => {
    if (!folder) return
    if (!sel.ids.has(id)) select(single(id))
    else if (sel.current !== id) select({ ids: sel.ids, current: id, anchor: sel.anchor })
    window.geophotos.action({ type: 'contextMenu', x, y })
  }

  /** The Menu key or Shift+F10: the context menu of the current photo, at its thumbnail or mid-window. */
  const contextMenuFromKeyboard = (): void => {
    if (sel.current === null) return
    const at = strip.currentPoint() ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    openContextMenu(sel.current, at.x, at.y)
  }

  const setStripPosition = (p: StripPosition): void => {
    stripPosition = p
    applyLayout()
    reportView()
  }

  /** New coordinates for the photos; null removes them (Del, tz.md, п. 6.6). */
  const setCoords = async (
    ids: number[],
    coords: LatLon | null,
    copiedData?: { address: Address | null; altitude: number | null }
  ): Promise<void> => {
    if (!folder || saving || !ids.length) return
    note('')
    await window.geophotos.setCoords({ ids, coords, ...(copiedData ? { copied: copiedData } : {}) })
  }

  // Photo ids are their positions in the strip, so they double as indexes.
  const map = new MapView(byId('map'), init.map, {
    onMarkerContextMenu: (id, x, y) => openContextMenu(id, x, y),
    onMarkerClick: (id, mods) =>
      select(mods.ctrl ? clickSelect(sel, id, { ctrl: true, shift: false }, order) : single(id)),
    // All photos at the marker's point move with it (tz.md, п. 4.7); with a filter on, only
    // the shown ones: hidden photos have no marker (п. 4.13).
    onMarkerMoved: async (id, to) => {
      const at = folder?.photos[id]?.coords
      if (!folder || !at) return
      // The marker of one of several selected photos: all selected photos with coordinates go
      // to the point (tz.md, п. 4.7); those without coordinates are not touched.
      if (sel.ids.has(id) && sel.ids.size > 1) {
        await setCoords([...sel.ids].filter((i) => folder?.photos[i]?.coords), to)
        return
      }
      const shown = folder.photos.filter((p) => matchesFilter(p, filter))
      await setCoords(photosAt(shown, at), to)
    },
    // A rectangle on the map selects the photos inside it instead of the old selection (п. 4.4.3);
    // the current one is the first of them in the strip. An empty rectangle changes nothing.
    onBoxSelect: (ids) => {
      const inside = order.filter((id) => ids.includes(id))
      if (!inside.length) return
      select({ ids: new Set(inside), current: inside[0]!, anchor: inside[0]! })
    },
    onDropPhotos: (ids, at) => void setCoords(ids, at),
    // Double click on the map places the current photo if it has no coordinates yet (tz.md,
    // п. 4.4.2); the other selected photos do not change.
    onMapDoubleClick: (at) => {
      const p = sel.current === null ? undefined : folder?.photos[sel.current]
      if (!p || p.coords || saving) return false
      void setCoords([p.id], at)
      return true
    },
    dragged: () => dragged,
    onViewChanged: () => reportView(),
    // Only the current photo, alone, snaps to its place on a track (tz.md, п. 3.9.7).
    snapPoint: (ids) => {
      const alone = ids === null || (ids.length === 1 && ids[0] === sel.current)
      return alone ? tracks.hint : null
    }
  })
  const strip = new Strip(byId('strip'), t, {
    onClick: (id, mods) => select(clickSelect(sel, id, mods, order, isTrackId)),
    // Double click: show the photo on the map (from the photo view, back to the map first).
    onDoubleClick: (id) => {
      if (sel.current !== id || sel.ids.size !== 1) select(single(id))
      showOnMap()
    },
    onContextMenu: (id, x, y) => openContextMenu(id, x, y),
    onZoom: (dir) => zoomGrid(dir),
    onDragStart: (id) => {
      const next = dragSelection(sel, id)
      if (next.ids !== sel.ids || next.current !== sel.current) select(next)
      dragged = [...next.ids].sort((a, b) => a - b)
      return dragged
    },
    onDragEnd: () => (dragged = null),
    onDropOnPhoto: (ids, coords) => void setCoords(ids, coords),
    dragged: () => dragged,
    canDropOnTrack: (ids, track) => ids.some((id) => placeOn(id, track) !== null),
    // Each photo to its place on the track by its time (tz.md, п. 3.9.7); coordinates are
    // replaced; photos with no place there do not change, silently.
    onDropOnTrack: (ids, track) => {
      void (async () => {
        for (const id of ids) {
          const at = placeOn(id, track)
          if (at) await setCoords([id], at)
        }
      })()
    }
  })
  const tracks = new TrackLayer(map.leaflet, init.tracks, t, {
    onClick: (id) => {
      if (view === 'map') select(single(id))
    }
  })
  const summary = new TrackSummaryView(byId('map'), t, (p, color) => tracks.showProbe(p, color))
  addSearchBox(map, t)
  const viewer = new PhotoView(byId('viewer'), t, (id) => void window.geophotos.openInPlayer(id))
  const help = new HelpView(t)
  const about = new AboutView(t)
  new ResizeObserver(() => map.invalidateSize()).observe(byId('map'))

  // Keys that work wherever the focus is, except text fields (tz.md, пп. 4.4, 4.4.1):
  // ← → Home End move the selection, Ctrl+A selects all. Captured before Leaflet and the strip,
  // so neither pans nor scrolls on arrows.
  window.addEventListener(
    'keydown',
    (e) => {
      // Help and About are on top: Esc closes them, other keys do nothing behind them.
      if (help.visible || about.visible) {
        if (e.key === 'Escape') {
          help.hide()
          about.hide()
        }
        if (e.key !== 'F1') {
          e.preventDefault()
          e.stopPropagation()
        }
        return
      }
      if (isTextInput(e.target)) return
      // Esc leaves the grid (tz.md, п. 4.17), also from the photo view opened in it.
      if (e.key === 'Escape' && grid) {
        e.preventDefault()
        e.stopPropagation()
        leaveGrid()
        return
      }
      // The context menu from the keyboard (tz.md, п. 4.19).
      if ((e.key === 'ContextMenu' && !e.ctrlKey && !e.altKey) || (e.key === 'F10' && e.shiftKey && !e.ctrlKey && !e.altKey)) {
        e.preventDefault()
        e.stopPropagation()
        if (!e.repeat) contextMenuFromKeyboard()
        return
      }
      // Ctrl + «+» / «−» / 0: the size of the thumbnails in the grid (п. 4.17); by the physical keys.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && grid) {
        const dir = e.code === 'Equal' || e.code === 'NumpadAdd' ? 1 : e.code === 'Minus' || e.code === 'NumpadSubtract' ? -1 : e.code === 'Digit0' || e.code === 'Numpad0' ? 0 : null
        if (dir !== null) {
          e.preventDefault()
          e.stopPropagation()
          zoomGrid(dir)
          return
        }
      }
      // G: the grid of thumbnails, by the physical key (also «П» in the Russian layout).
      if (e.code === 'KeyG' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault()
        e.stopPropagation()
        if (!e.repeat) toggleGrid()
        return
      }
      // Space switches map / photo; it must not press a focused button.
      if (e.key === ' ' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault()
        e.stopPropagation()
        if (!e.repeat && folder) toggleView()
        return
      }
      // C: show the current photo on the map. By the physical key, so it also works in the
      // Russian layout («С»); Ctrl+C and other combinations are left alone.
      if (e.code === 'KeyC' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault()
        e.stopPropagation()
        if (!e.repeat) showOnMap()
        return
      }
      // T: markers / thumbnails on the map, by the physical key (also «Е» in the Russian layout).
      if (e.code === 'KeyT' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault()
        e.stopPropagation()
        if (!e.repeat) toggleThumbnails()
        return
      }
      // Del (tz.md, п. 6.6): the selected photos or track leave the strip (main asks first if
      // some have unsaved changes). Ctrl+Del: the selected photos lose their coordinates (and
      // address, altitude) until Save.
      if (e.key === 'Delete' && !e.altKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault()
        e.stopPropagation()
        if (e.repeat) return
        if (e.ctrlKey) clearCoords()
        else removeFromStrip()
        return
      }
      // Ctrl+C / Ctrl+V of coordinates, by the physical key (any layout). Text fields keep
      // their own copy and paste: they returned above.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.code === 'KeyC' || e.code === 'KeyV')) {
        e.preventDefault()
        e.stopPropagation()
        if (!e.repeat) {
          if (e.code === 'KeyC') copyCoords()
          else void pasteCoords()
        }
        return
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        selectAllShown()
        return
      }
      if (e.ctrlKey || e.altKey || e.metaKey) return
      if (!isNavKey(e.key)) return
      // Taken also when they do nothing: the map must not pan on arrows, the strip must not scroll
      // on PageUp / PageDown by itself.
      e.preventDefault()
      e.stopPropagation()
      // How far ↑ ↓ go (tz.md, п. 4.17): a row in the grid, one photo in the strip on the left;
      // at the bottom and in the photo view of the grid (no strip on screen) they do nothing.
      const row = grid ? (view === 'photo' ? 0 : strip.columns()) : stripPosition === 'left' ? 1 : 0
      const next = navigateShown(e.key, sel.current, order, row, strip.pageSize())
      if (next !== null && (next !== sel.current || sel.ids.size !== 1)) select(single(next))
    },
    true
  )

  // A button activates on Space release: that is taken by the view switch above.
  window.addEventListener(
    'keyup',
    (e) => {
      if (e.key === ' ' && !isTextInput(e.target)) e.preventDefault()
    },
    true
  )

  window.geophotos.onCommand((cmd) => {
    if (cmd.type === 'copyCoords') {
      copyCoords()
    } else if (cmd.type === 'pasteCoords') {
      void pasteCoords()
    } else if (cmd.type === 'clearCoords') {
      clearCoords()
    } else if (cmd.type === 'removeFromStrip') {
      removeFromStrip()
    } else if (cmd.type === 'selectAll') {
      selectAllShown()
    } else if (cmd.type === 'toggleView') {
      if (folder) toggleView()
    } else if (cmd.type === 'showOnMap') {
      showOnMap()
    } else if (cmd.type === 'toggleThumbnails') {
      toggleThumbnails()
    } else if (cmd.type === 'toggleGrid') {
      toggleGrid()
    } else if (cmd.type === 'setStripPosition') {
      setStripPosition(cmd.position)
    } else if (cmd.type === 'setFilter') {
      setFilter(cmd.filter)
    } else if (cmd.type === 'toggleHelp') {
      about.hide()
      help.toggle()
    } else if (cmd.type === 'showAbout') {
      help.hide()
      void about.show()
    }
  })

  window.geophotos.onFolderLoading(({ folder: path, adding }) => {
    // Files being added (tz.md, п. 3.1): the strip stays as it is meanwhile.
    if (adding) return note(t('status.adding'))
    strip.clear()
    note('')
    statusPhoto.textContent = t('status.loading', { folder: path })
  })

  window.geophotos.onFolderLoaded((data) => {
    if (statusNote.textContent === t('status.adding')) note('')
    // Everything taken off the strip, no folder: nothing is open.
    folder = data.folder || data.photos.length ? data : null
    // Nothing open: no grid either.
    if (!folder && grid) leaveGrid()
    // Refresh keeps the selection and the filter (tz.md, п. 3.8); any other opening starts afresh.
    const keep = data.keep
    const cur = keep ? (data.selected ?? keep.ids.at(-1) ?? null) : null
    sel = keep && cur !== null ? { ids: new Set(keep.ids.length ? keep.ids : [cur]), current: cur, anchor: cur } : EMPTY_SELECTION
    filter = keep?.filter ?? 'all'
    strip.setPhotos(data)
    // The folder of the last run or a refresh: the map stays where it was (tz.md, пп. 7.1, 3.8);
    // added files: the map shows them (п. 3.1). The tracks count too (п. 3.9.5): they come from
    // main a moment later, so the map is fitted then.
    leaveTrackView()
    map.setPhotos(data.photos, data.generation, false)
    applyFilter()
    const fitAll = !data.restored && !data.show
    const show = data.show
    void tracks.setTracks(data.photos, data.generation).then(() => {
      if (folder !== data) return
      if (fitAll) map.fitMarkers(tracks.bounds())
      else if (show) {
        const added = show.filter(isTrackId)
        const b = added.reduce<L.LatLngBounds | null>((acc, id) => {
          const tb = tracks.bounds(id)
          return tb ? (acc ? acc.extend(tb) : tb) : acc
        }, null)
        map.fitPhotos(show, b)
      }
      tracks.setCurrent(sel.current !== null && isTrackId(sel.current) ? sel.current : null)
      showHint()
      // The track view of the current track, if it is on (the window was waiting for its data).
      if (view === 'photo') showPhoto()
    })
    if (keep && sel.current !== null) select(sel)
    // The photo chosen in the dialog or dropped onto the window becomes selected (tz.md, п. 3.1).
    // Otherwise the first photo already is (a photo is always selected, п. 4.4).
    else if (data.selected !== null) select(single(data.selected))
    // …and the strip scrolls back to where it was.
    if (data.restored) strip.scroll = lastScroll = data.restored.scroll
    reportView()
  })

  window.geophotos.onPhotosChanged(({ generation, photos }) => {
    if (!folder || folder.generation !== generation) return
    for (const p of photos) folder.photos[p.id] = p
    strip.updatePhotos(photos)
    map.updatePhotos(photos)
    // A placed photo loses its mark on the track; one that lost its coordinates gets it.
    showHint()
    // The filter is live: a saved photo leaves "modified", a placed one joins "with coordinates".
    applyFilter()
    showStatus()
    // A found address shows in the photo view at once.
    showPhoto()
  })

  // Addresses and altitudes still to find (tz.md, пп. 5.5, 5.6): how many points, about how long.
  window.geophotos.onQueueState((q) => {
    const list = [
      ...(q.address ? [t('queue.addresses', { count: q.address })] : []),
      ...(q.altitude ? [t('queue.altitudes', { count: q.altitude })] : [])
    ].join(', ')
    statusQueue.textContent = list ? t('queue.left', { list, time: formatDuration(q.seconds, t) }) : ''
  })

  // Saving (tz.md, п. 6.8): n of N over the window; the window waits until it ends.
  let progressTimer: number | undefined
  window.geophotos.onSaveState((s) => {
    // Saving waits for the addresses and altitudes (пп. 5.5, 5.6): the overlay says how many are left.
    if (s.phase === 'waiting') {
      progressText.textContent = t('save.waiting', { count: s.left })
      progress.hidden = s.left === 0
      return
    }
    if (s.phase === 'progress') {
      saving = true
      progressText.textContent = t('save.progress', { done: s.done, total: s.total })
      // Short saves do not flash the overlay.
      if (progressTimer === undefined && progress.hidden) {
        progressTimer = window.setTimeout(() => (progress.hidden = false), 300)
      }
      return
    }
    saving = false
    window.clearTimeout(progressTimer)
    progressTimer = undefined
    progress.hidden = true
    note(s.failed ? t('save.doneFailed', { saved: s.saved, failed: s.failed }) : t('save.done', { saved: s.saved }))
  })

  // Dropping from Explorer (tz.md, п. 3.1): a folder opens, files are added to the strip; photos
  // dragged inside the window are handled by the map and the strip; anything else is ignored
  // (and never navigates the window).
  document.addEventListener('dragover', (e) => {
    const types = e.dataTransfer?.types ?? []
    if (types.includes(PHOTO_DRAG_TYPE)) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = types.includes('Files') ? 'copy' : 'none'
  })
  document.addEventListener('drop', (e) => {
    e.preventDefault()
    if (dragged) return
    const paths = [...(e.dataTransfer?.files ?? [])].map((f) => window.geophotos.pathForFile(f)).filter((p) => p !== '')
    if (paths.length) void window.geophotos.openPaths(paths)
  })

  byId('strip').addEventListener('scroll', reportView, { passive: true })

  // The start screen (tz.md, п. 4.18): when nothing is open, over the map — Open Folder…, the
  // recent folders, a hint about dropping.
  const start = byId('start')
  let recent = init.recent
  const showStart = (): void => {
    start.hidden = !!folder
    if (folder) return
    const open = document.createElement('button')
    open.type = 'button'
    open.className = 'start-open'
    open.textContent = t('start.open')
    open.addEventListener('click', () => window.geophotos.action({ type: 'openFolder' }))
    const parts: HTMLElement[] = [open]
    if (recent.length) {
      const title = document.createElement('div')
      title.className = 'start-title'
      title.textContent = t('start.recent')
      const list = document.createElement('div')
      list.className = 'start-recent'
      for (const path of recent) {
        const b = document.createElement('button')
        b.type = 'button'
        b.textContent = path
        b.title = path
        b.addEventListener('click', () => window.geophotos.action({ type: 'openRecent', folder: path }))
        list.append(b)
      }
      parts.push(title, list)
    }
    const hint = document.createElement('div')
    hint.className = 'start-hint'
    hint.textContent = t('start.hint')
    parts.push(hint)
    const box = document.createElement('div')
    box.className = 'start-box'
    box.append(...parts)
    start.replaceChildren(box)
  }
  window.geophotos.onRecent((list) => {
    recent = list
    showStart()
  })
  window.geophotos.onFolderLoaded(() => showStart())
  showStart()

  applyLayout()
  showStatus()
  showCounts()
  // The View menu shows the mode of the map from the start, also without a folder.
  reportState()
  reportView()
}

void start()
