import type { Translate } from '@shared/i18n'
import { thumbUrl } from '@shared/ipc'
import type { FolderData, LatLon, Photo } from '@shared/photo'
import { photoTooltip } from './describe'
import { ADDRESS_SVG, FILE_SVG, PENCIL_SVG, PIN_SVG } from './icons'
import type { Selection } from './selection'

/** Type of the data carried by a drag of photos out of the strip. */
export const PHOTO_DRAG_TYPE = 'application/x-geophotos-photos'

export interface StripHandlers {
  /** A click on a photo, with the modifier keys. */
  onClick(id: number, mods: { ctrl: boolean; shift: boolean }): void
  /** A double click on a photo: show it on the map. */
  onDoubleClick(id: number): void
  /** A drag starts on a photo: returns the photos it carries (п. 4.5). */
  onDragStart(id: number): number[]
  onDragEnd(): void
  /** The dragged photos are dropped onto a photo with coordinates: they get its coordinates. */
  onDropOnPhoto(ids: number[], coords: LatLon): void
  /** The photos being dragged right now (drag data cannot be read before the drop). */
  dragged(): number[] | null
}

/**
 * The thumbnail strip at the bottom (tz.md, пп. 4.1–4.5): photos in date order, marks for
 * coordinates and for unsaved changes, a placeholder with the file name when there is nothing
 * to show. The selection is kept by the window; the strip reports clicks and drags.
 */
export class Strip {
  private items = new Map<number, HTMLElement>()
  private photos: Photo[] = []
  private generation = 0
  private selected: ReadonlySet<number> = new Set()
  private current: number | null = null
  private ghost: HTMLElement

  constructor(
    private readonly el: HTMLElement,
    private readonly t: Translate,
    private readonly h: StripHandlers
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
    // Drag image: the thumbnail with the number of photos carried.
    this.ghost = document.createElement('div')
    this.ghost.id = 'drag-ghost'
    document.body.append(this.ghost)
  }

  clear(): void {
    this.el.replaceChildren()
    this.items.clear()
    this.photos = []
    this.selected = new Set()
    this.current = null
  }

  setPhotos(data: FolderData): void {
    this.clear()
    this.photos = [...data.photos]
    this.generation = data.generation
    const frag = document.createDocumentFragment()
    for (const p of data.photos) {
      const item = this.makeItem(p)
      this.items.set(p.id, item)
      frag.append(item)
    }
    this.el.append(frag)
    this.el.scrollLeft = 0
  }

  /** Changed photos: marks and tooltip follow; the image stays. */
  updatePhotos(changed: Photo[]): void {
    for (const p of changed) {
      this.photos[p.id] = p
      const item = this.items.get(p.id)
      if (item) this.decorate(item, p)
    }
  }

  private makeItem(p: Photo): HTMLElement {
    const item = document.createElement('div')
    item.className = 'thumb'
    item.draggable = true
    item.dataset['id'] = String(p.id)

    const img = document.createElement('img')
    img.loading = 'lazy'
    img.decoding = 'async'
    img.draggable = false
    img.alt = ''
    img.src = thumbUrl(this.generation, p.id)
    img.addEventListener('error', () => img.replaceWith(this.placeholder(p)), { once: true })
    item.append(img)
    if (p.error) item.classList.add('has-error')
    this.decorate(item, p)

    item.addEventListener('click', (e) => this.h.onClick(p.id, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey }))
    item.addEventListener('dblclick', (e) => {
      if (!e.ctrlKey && !e.shiftKey && !e.metaKey) this.h.onDoubleClick(p.id)
    })
    item.addEventListener('dragstart', (e) => this.dragStart(e, p.id))
    item.addEventListener('dragend', () => {
      this.clearDropTarget()
      this.h.onDragEnd()
    })
    // Dropping onto a photo with coordinates gives them to the dragged photos (п. 4.5).
    item.addEventListener('dragover', (e) => {
      if (!this.canDropOn(p.id)) return
      e.preventDefault()
      e.stopPropagation()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
      this.setDropTarget(item)
    })
    item.addEventListener('dragleave', (e) => {
      if (!item.contains(e.relatedTarget as Node | null)) item.classList.remove('drop-target')
    })
    item.addEventListener('drop', (e) => {
      const ids = this.h.dragged()
      const target = this.photos[p.id]
      this.clearDropTarget()
      if (!ids || !target?.coords || !this.canDropOn(p.id)) return
      e.preventDefault()
      e.stopPropagation()
      this.h.onDropOnPhoto(ids, target.coords)
    })
    return item
  }

  /** A target needs coordinates; dropping a photo onto itself does nothing. */
  private canDropOn(id: number): boolean {
    const ids = this.h.dragged()
    if (!ids || !this.photos[id]?.coords) return false
    return !(ids.length === 1 && ids[0] === id)
  }

  private dragStart(e: DragEvent, id: number): void {
    const ids = this.h.onDragStart(id)
    if (!e.dataTransfer) return
    e.dataTransfer.effectAllowed = 'copy'
    e.dataTransfer.setData(PHOTO_DRAG_TYPE, JSON.stringify(ids))
    const item = this.items.get(id)
    const img = item?.querySelector('img, .placeholder')
    this.ghost.replaceChildren()
    if (img) this.ghost.append(img.cloneNode(true))
    if (ids.length > 1) {
      const n = document.createElement('span')
      n.className = 'count'
      n.textContent = String(ids.length)
      this.ghost.append(n)
    }
    e.dataTransfer.setDragImage(this.ghost, 36, 36)
  }

  private setDropTarget(item: HTMLElement): void {
    for (const el of this.el.querySelectorAll('.drop-target')) if (el !== item) el.classList.remove('drop-target')
    item.classList.add('drop-target')
  }

  private clearDropTarget(): void {
    for (const el of this.el.querySelectorAll('.drop-target')) el.classList.remove('drop-target')
  }

  /** Marks of a photo (п. 4.3): has coordinates, modified and not saved; tooltip (п. 4.13). */
  private decorate(item: HTMLElement, p: Photo): void {
    item.title = photoTooltip(p, this.t)
    item.classList.toggle('modified', p.modified)
    let badge = item.querySelector<HTMLElement>('.badge-coords')
    if (p.coords && !badge) {
      badge = document.createElement('div')
      badge.className = 'badge-coords'
      badge.title = this.t('photo.hasCoords')
      badge.innerHTML = PIN_SVG
      item.append(badge)
    } else if (!p.coords && badge) {
      badge.remove()
    }
    // Only the fact that there is an address; the address itself is in the photo view (п. 4.3).
    let addr = item.querySelector<HTMLElement>('.badge-address')
    if (p.address && !addr) {
      addr = document.createElement('div')
      addr.className = 'badge-address'
      addr.title = this.t('photo.hasAddress')
      addr.innerHTML = ADDRESS_SVG
      item.append(addr)
    } else if (!p.address && addr) {
      addr.remove()
    }
    let mod = item.querySelector<HTMLElement>('.badge-modified')
    if (p.modified && !mod) {
      mod = document.createElement('div')
      mod.className = 'badge-modified'
      mod.title = this.t('photo.modified')
      mod.innerHTML = PENCIL_SVG
      item.append(mod)
    } else if (!p.modified && mod) {
      mod.remove()
    }
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

  /**
   * Shows only the given photos (filter, tz.md, п. 4.13); `empty` is the text shown when
   * there are photos but none passes the filter.
   */
  setShown(shown: ReadonlySet<number>, empty: string): void {
    for (const [id, item] of this.items) item.hidden = !shown.has(id)
    let note = this.el.querySelector<HTMLElement>('.strip-empty')
    if (!shown.size && this.items.size) {
      if (!note) {
        note = document.createElement('div')
        note.className = 'strip-empty'
        this.el.append(note)
      }
      note.textContent = empty
    } else {
      note?.remove()
    }
  }

  /** Marks the selected photos; the strip scrolls so that the current one is visible. */
  setSelection(sel: Selection): void {
    for (const id of this.selected) if (!sel.ids.has(id)) this.items.get(id)?.classList.remove('selected')
    for (const id of sel.ids) this.items.get(id)?.classList.add('selected')
    for (const el of this.el.querySelectorAll('.current')) el.classList.remove('current')
    this.selected = new Set(sel.ids)
    const moved = sel.current !== this.current
    this.current = sel.current
    const item = sel.current === null ? undefined : this.items.get(sel.current)
    if (!item) return
    item.classList.add('current')
    if (moved) item.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
}
