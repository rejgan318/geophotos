import type { Translate } from '@shared/i18n'
import { thumbUrl } from '@shared/ipc'
import type { FolderData, Photo } from '@shared/photo'
import { photoTooltip } from './describe'

const PIN_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>'
const FILE_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h8l6 6v14H6zM14 2v6h6" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>'

/**
 * The thumbnail strip at the bottom (tz.md, пп. 4.1–4.3): photos in date order, a mark on
 * photos with coordinates, a placeholder with the file name when there is nothing to show.
 * Step 1: one photo is selected (full selection comes with step 2); the selection itself is
 * kept by the window, the strip reports clicks and shows what is selected.
 */
export class Strip {
  private items = new Map<number, HTMLElement>()
  private selected: number | null = null

  constructor(
    private readonly el: HTMLElement,
    private readonly t: Translate,
    private readonly onPick: (photoId: number) => void
  ) {
    // Mouse wheel scrolls the strip sideways.
    el.addEventListener(
      'wheel',
      (e) => {
        if (e.deltaY && !e.shiftKey) {
          el.scrollLeft += e.deltaY
          e.preventDefault()
        }
      },
      { passive: false }
    )
  }

  clear(): void {
    this.el.replaceChildren()
    this.items.clear()
    this.selected = null
  }

  setPhotos(data: FolderData): void {
    this.clear()
    const frag = document.createDocumentFragment()
    for (const p of data.photos) {
      const item = this.makeItem(p, data.generation)
      this.items.set(p.id, item)
      frag.append(item)
    }
    this.el.append(frag)
    this.el.scrollLeft = 0
  }

  private makeItem(p: Photo, generation: number): HTMLElement {
    const item = document.createElement('div')
    item.className = 'thumb'
    item.title = photoTooltip(p, this.t)

    const img = document.createElement('img')
    img.loading = 'lazy'
    img.decoding = 'async'
    img.draggable = false
    img.alt = ''
    img.src = thumbUrl(generation, p.id)
    img.addEventListener('error', () => img.replaceWith(this.placeholder(p)), { once: true })
    item.append(img)

    if (p.coords) {
      const badge = document.createElement('div')
      badge.className = 'badge-coords'
      badge.title = this.t('photo.hasCoords')
      badge.innerHTML = PIN_SVG
      item.append(badge)
    }
    if (p.error) item.classList.add('has-error')

    item.addEventListener('click', () => this.onPick(p.id))
    return item
  }

  private placeholder(p: Photo): HTMLElement {
    const ph = document.createElement('div')
    ph.className = 'placeholder'
    ph.innerHTML = FILE_SVG
    const name = document.createElement('span')
    name.textContent = p.name
    ph.append(name)
    return ph
  }

  /** Marks the selected photo and scrolls the strip so that it is visible. */
  setSelected(photoId: number | null): void {
    if (this.selected !== null) this.items.get(this.selected)?.classList.remove('selected')
    this.selected = photoId
    const item = photoId === null ? undefined : this.items.get(photoId)
    if (!item) return
    item.classList.add('selected')
    item.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
}
