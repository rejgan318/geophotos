import './style.css'
import { photoCounts, photosAt } from '@shared/edits'
import { makeTranslate } from '@shared/i18n'
import type { ViewMode } from '@shared/ipc'
import type { FolderData, LatLon } from '@shared/photo'
import { photoCoords, photoDate } from './describe'
import { MapView } from './map'
import { PhotoView } from './viewer'
import { HelpView } from './help'
import { effectiveFilter, matchesFilter, toggleFilter, visibleIds, type StripFilter } from './filter'
import { PENCIL_SVG, PHOTO_SVG, PIN_SVG } from './icons'
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

const byId = (id: string): HTMLElement => document.getElementById(id)!

/** Text fields keep their own keys (cursor movement, select all). */
function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

async function start(): Promise<void> {
  const init = await window.geophotos.init()
  const t = makeTranslate(init.strings)

  // Marker colors from the settings, shared by the map and the strip badges (tz.md, пп. 4.3, 4.8.1).
  document.documentElement.style.setProperty('--marker-color', init.map.markers.color)
  document.documentElement.style.setProperty('--marker-selected', init.map.markers.selectedColor)

  const statusPhoto = byId('status-photo')
  const statusNote = byId('status-note')
  const statusCounts = byId('status-counts')
  const progress = byId('progress')
  const progressText = byId('progress-text')
  let folder: FolderData | null = null
  let sel: Selection = EMPTY_SELECTION
  /** Photos being dragged from the strip (drag data cannot be read before the drop). */
  let dragged: number[] | null = null
  let saving = false
  /** Strip filter by the status bar counter (tz.md, п. 4.13) and the photos it shows, in strip order. */
  let filter: StripFilter = 'all'
  let order: number[] = []
  /** Map or photo in the main area (Space, View menu). */
  let view: ViewMode = 'map'

  const showStatus = (): void => {
    const p = sel.current === null ? undefined : folder?.photos[sel.current]
    const many = sel.ids.size > 1 ? `${t('status.selected', { count: sel.ids.size })} · ` : ''
    if (!folder) statusPhoto.textContent = t('status.noFolder')
    else if (!p) statusPhoto.textContent = t('status.noSelection')
    else {
      const mod = p.modified ? ` · ${t('photo.modified')}` : ''
      statusPhoto.textContent = `${many}${p.name} · ${photoDate(p, t)} · ${photoCoords(p, t)}${mod}`
    }
  }

  // The counter is three buttons that filter the strip; a second click on the active one
  // switches the filter off (tz.md, п. 4.13).
  const filterButtons = (
    [
      ['all', 'filter.total', 'total', PHOTO_SVG],
      ['coords', 'filter.withCoords', 'withCoords', PIN_SVG],
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

  const note = (text: string): void => {
    statusNote.textContent = text
  }

  /** The one place where the selection changes: strip, map, status and main follow it. */
  const select = (next: Selection): void => {
    sel = next
    strip.setSelection(sel)
    map.setSelection(sel.ids, sel.current)
    showStatus()
    showPhoto()
    reportState()
  }

  /** Main keeps the selection (Save Selected, last session) and the View menu state. */
  const reportState = (): void => {
    window.geophotos.reportState({ ids: [...sel.ids], current: sel.current, filter, view })
  }

  const showPhoto = (): void => {
    const p = sel.current === null ? null : (folder?.photos[sel.current] ?? null)
    viewer.show(p, folder?.generation ?? 0)
  }

  /** Space and View menu: the map or the current photo (tz.md, п. 9.3). */
  const toggleView = (): void => {
    view = view === 'map' ? 'photo' : 'map'
    viewer.setVisible(view === 'photo')
    showPhoto()
    if (view === 'map') map.invalidateSize()
    reportState()
  }

  const setCoords = async (ids: number[], coords: LatLon): Promise<void> => {
    if (!folder || saving || !ids.length) return
    note('')
    await window.geophotos.setCoords({ ids, coords })
  }

  // Photo ids are their positions in the strip, so they double as indexes.
  const map = new MapView(byId('map'), init.map, {
    onMarkerClick: (id, mods) =>
      select(mods.ctrl ? clickSelect(sel, id, { ctrl: true, shift: false }, order) : single(id)),
    // All photos at the marker's point move with it (tz.md, п. 4.7); with a filter on, only
    // the shown ones: hidden photos have no marker (п. 4.13).
    onMarkerMoved: async (id, to) => {
      const at = folder?.photos[id]?.coords
      if (!folder || !at) return
      const shown = folder.photos.filter((p) => matchesFilter(p, filter))
      await setCoords(photosAt(shown, at), to)
    },
    onDropPhotos: (ids, at) => void setCoords(ids, at),
    dragged: () => dragged
  })
  const strip = new Strip(byId('strip'), t, {
    onClick: (id, mods) => select(clickSelect(sel, id, mods, order)),
    onDragStart: (id) => {
      const next = dragSelection(sel, id)
      if (next.ids !== sel.ids || next.current !== sel.current) select(next)
      dragged = [...next.ids].sort((a, b) => a - b)
      return dragged
    },
    onDragEnd: () => (dragged = null),
    onDropOnPhoto: (ids, coords) => void setCoords(ids, coords),
    dragged: () => dragged
  })
  addSearchBox(map, t)
  const viewer = new PhotoView(byId('viewer'), t)
  const help = new HelpView(t)
  new ResizeObserver(() => map.invalidateSize()).observe(byId('map'))

  // Keys that work wherever the focus is, except text fields (tz.md, пп. 4.4, 4.4.1):
  // ← → Home End move the selection, Ctrl+A selects all. Captured before Leaflet and the strip,
  // so neither pans nor scrolls on arrows.
  window.addEventListener(
    'keydown',
    (e) => {
      // Help is on top: Esc closes it, other keys do nothing behind it.
      if (help.visible) {
        if (e.key === 'Escape') help.hide()
        if (e.key !== 'F1') {
          e.preventDefault()
          e.stopPropagation()
        }
        return
      }
      if (isTextInput(e.target)) return
      // Space switches map / photo; it must not press a focused button.
      if (e.key === ' ' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault()
        e.stopPropagation()
        if (!e.repeat && folder) toggleView()
        return
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        if (folder) select(selectAll(sel, order))
        return
      }
      if (e.ctrlKey || e.altKey || e.metaKey) return
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopPropagation()
        return
      }
      if (!isNavKey(e.key)) return
      e.preventDefault()
      e.stopPropagation()
      const next = navigateShown(e.key, sel.current, order)
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
    if (cmd.type === 'toggleView') {
      if (folder) toggleView()
    } else if (cmd.type === 'setFilter') {
      setFilter(cmd.filter)
    } else if (cmd.type === 'toggleHelp') {
      help.toggle()
    }
  })

  window.geophotos.onFolderLoading(({ folder: path }) => {
    strip.clear()
    note('')
    statusPhoto.textContent = t('status.loading', { folder: path })
  })

  window.geophotos.onFolderLoaded((data) => {
    folder = data
    sel = EMPTY_SELECTION
    filter = 'all'
    strip.setPhotos(data)
    map.setPhotos(data.photos)
    applyFilter()
    // The photo chosen in the dialog or dropped onto the window becomes selected (tz.md, п. 3.1).
    // Otherwise the first photo already is (a photo is always selected, п. 4.4).
    if (data.selected !== null) select(single(data.selected))
  })

  window.geophotos.onPhotosChanged(({ generation, photos }) => {
    if (!folder || folder.generation !== generation) return
    for (const p of photos) folder.photos[p.id] = p
    strip.updatePhotos(photos)
    map.updatePhotos(photos)
    // The filter is live: a saved photo leaves "modified", a placed one joins "with coordinates".
    applyFilter()
    showStatus()
  })

  // Saving (tz.md, п. 6.8): n of N over the window; the window waits until it ends.
  let progressTimer: number | undefined
  window.geophotos.onSaveState((s) => {
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

  // Dropping a folder or photo from Explorer opens it; photos dragged inside the window are
  // handled by the map and the strip; anything else is ignored (and never navigates the window).
  document.addEventListener('dragover', (e) => {
    const types = e.dataTransfer?.types ?? []
    if (types.includes(PHOTO_DRAG_TYPE)) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = types.includes('Files') ? 'copy' : 'none'
  })
  document.addEventListener('drop', (e) => {
    e.preventDefault()
    if (dragged) return
    const file = e.dataTransfer?.files[0]
    const path = file ? window.geophotos.pathForFile(file) : ''
    if (path) void window.geophotos.openPath(path)
  })

  showStatus()
  showCounts()
}

void start()
