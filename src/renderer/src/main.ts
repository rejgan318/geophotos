import './style.css'
import { makeTranslate } from '@shared/i18n'
import type { FolderData } from '@shared/photo'
import { photoCoords, photoDate } from './describe'
import { MapView } from './map'
import { isNavKey, navigate } from './navigation'
import { Strip } from './strip'

const byId = (id: string): HTMLElement => document.getElementById(id)!

/** Text fields keep their own keys (cursor movement). */
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
  const statusCounts = byId('status-counts')
  let folder: FolderData | null = null
  let selected: number | null = null

  const showStatus = (): void => {
    const p = selected === null ? undefined : folder?.photos[selected]
    if (!folder) statusPhoto.textContent = t('status.noFolder')
    else if (!p) statusPhoto.textContent = t('status.noSelection')
    else statusPhoto.textContent = `${p.name} · ${photoDate(p, t)} · ${photoCoords(p, t)}`
  }

  const showCounts = (): void => {
    const photos = folder?.photos ?? []
    statusCounts.textContent = t('status.counts', {
      total: photos.length,
      withCoords: photos.filter((p) => p.coords).length,
      modified: 0
    })
  }

  /** The one place where the selected photo changes: strip, map and status follow it. */
  const select = (id: number | null): void => {
    selected = id
    strip.setSelected(id)
    map.select(id)
    showStatus()
  }

  // Photo ids are their positions in the strip, so they double as indexes.
  const map = new MapView(byId('map'), init.map, (id) => select(id))
  const strip = new Strip(byId('strip'), t, (id) => select(id))
  new ResizeObserver(() => map.invalidateSize()).observe(byId('map'))

  // ← → Home End move the selection wherever the focus is, except text fields (tz.md, п. 4.4.1).
  // Captured before Leaflet and the strip, so neither pans nor scrolls on arrows.
  window.addEventListener(
    'keydown',
    (e) => {
      if (isTextInput(e.target) || e.ctrlKey || e.altKey || e.metaKey) return
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopPropagation()
        return
      }
      if (!isNavKey(e.key)) return
      e.preventDefault()
      e.stopPropagation()
      const next = navigate(e.key, selected, folder?.photos.length ?? 0)
      if (next !== null && next !== selected) select(next)
    },
    true
  )

  window.geophotos.onFolderLoading(({ folder: path }) => {
    strip.clear()
    statusPhoto.textContent = t('status.loading', { folder: path })
  })

  window.geophotos.onFolderLoaded((data) => {
    folder = data
    selected = null
    strip.setPhotos(data)
    map.setPhotos(data.photos)
    showCounts()
    // The photo chosen in the dialog or dropped onto the window becomes selected (tz.md, п. 3.1).
    if (data.selected !== null) select(data.selected)
    else showStatus()
  })

  // Dropping a folder or photo from Explorer opens it; anything else is ignored
  // (and never navigates the window to the file).
  document.addEventListener('dragover', (e) => {
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = e.dataTransfer.types.includes('Files') ? 'copy' : 'none'
  })
  document.addEventListener('drop', (e) => {
    e.preventDefault()
    const file = e.dataTransfer?.files[0]
    const path = file ? window.geophotos.pathForFile(file) : ''
    if (path) void window.geophotos.openPath(path)
  })

  showStatus()
  showCounts()
}

void start()
