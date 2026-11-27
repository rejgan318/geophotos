import type { Translate } from '@shared/i18n'
import { liveUrl, thumbUrl } from '@shared/ipc'
import { dropOnPhoto } from '@shared/edits'
import { type FolderData, type LatLon, type Photo } from '@shared/photo'
import { badgeTitles, photoTooltip } from './describe'
import { ADDRESS_SVG, ALTITUDE_SVG, FILE_SVG, LIVE_SVG, PENCIL_SVG, PIN_SVG, TRACK_SVG, VIDEO_SVG } from './icons'
import type { Selection } from './selection'

/** Type of the data carried by a drag of photos out of the strip. */
export const PHOTO_DRAG_TYPE = 'application/x-geophotos-photos'

/** How the strip is laid out (tz.md, пп. 4.1, 4.17): a row at the bottom, a column on the left, a grid. */
export type StripLayout = 'bottom' | 'left' | 'grid'

export interface StripHandlers {
  /** A click on a photo, with the modifier keys. */
  onClick(id: number, mods: { ctrl: boolean; shift: boolean }): void
  /** A double click on a photo: show it on the map. */
  onDoubleClick(id: number): void
  /** A right click on a photo: its context menu at this point (tz.md, п. 4.19). */
  onContextMenu(id: number, x: number, y: number): void
  /** Ctrl+wheel: larger (1) or smaller (-1) thumbnails — of the grid or of the strip (пп. 4.17, 4.1). */
  onZoom(dir: 1 | -1): void
  /** A drag starts on a photo: returns the photos it carries (п. 4.5). */
  onDragStart(id: number): number[]
  onDragEnd(): void
  /**
   * A drag that ended on its own thumbnail without a drop: the hand shook on a click (tz.md, п. 4.5);
   * it is that click, with the same Ctrl and Shift.
   */
  onDragClick(id: number, mods: { ctrl: boolean; shift: boolean }): void
  /** A drop onto a photo (п. 4.5): these photos get these coordinates. */
  onDropOnPhoto(ids: number[], coords: LatLon): void
  /** The photos being dragged right now (drag data cannot be read before the drop). */
  dragged(): number[] | null
  /** Whether some of these photos have a place on this track (tz.md, п. 3.9.7). */
  canDropOnTrack(ids: number[], track: number): boolean
  /** Photos dropped onto a track: each gets its place on it. */
  onDropOnTrack(ids: number[], track: number): void
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
  /** A drag from the strip is on (the dimming of thumbnails belongs to it). */
  private dragging = false
  /** The thumbnail the drag began on, with the keys held, and whether the mouse is still over it. */
  private dragFrom: { id: number; ctrl: boolean; shift: boolean; over: boolean } | null = null
  private layout: StripLayout = 'bottom'

  constructor(
    private readonly el: HTMLElement,
    private readonly t: Translate,
    private readonly h: StripHandlers
  ) {
    // Mouse wheel scrolls the strip at the bottom sideways; on the left and in the grid it scrolls
    // down as usual.
    el.addEventListener(
      'wheel',
      (e) => {
        if (e.ctrlKey) {
          e.preventDefault()
          if (e.deltaY) this.h.onZoom(e.deltaY < 0 ? 1 : -1)
          return
        }
        if (this.layout === 'bottom' && e.deltaY && !e.shiftKey) {
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
    // The end of a drag reaches the window even when the thumbnail it started on misses it.
    window.addEventListener('dragend', (e) => this.endDrag(e), true)
    // Is the drag still over the thumbnail it began on (a shaken click, п. 4.5)?
    window.addEventListener(
      'dragover',
      (e) => {
        if (!this.dragFrom) return
        const item = this.items.get(this.dragFrom.id)
        this.dragFrom.over = !!item && e.target instanceof Node && item.contains(e.target)
      },
      true
    )
    window.addEventListener('drop', () => setTimeout(() => this.endDrag(), 0), true)
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
    this.el.scrollTo(0, 0)
  }

  /** A row at the bottom, a column on the left or a grid; the current photo stays in view. */
  setLayout(layout: StripLayout): void {
    if (layout === this.layout) return
    this.layout = layout
    this.revealCurrent()
  }

  /** The scroll along the strip (kept for the next run, tz.md, п. 7.1): sideways at the bottom, down on the left. */
  get scroll(): number {
    return this.layout === 'bottom' ? this.el.scrollLeft : this.el.scrollTop
  }

  set scroll(v: number) {
    if (this.layout === 'bottom') this.el.scrollLeft = v
    else this.el.scrollTop = v
  }

  /** How many photos a row of the grid holds (↑ ↓ go that far, tz.md, п. 4.17); 1 when not known. */
  columns(): number {
    let top: number | null = null
    let n = 0
    for (const item of this.items.values()) {
      if (item.hidden) continue
      if (top === null) top = item.offsetTop
      else if (item.offsetTop !== top) break
      n++
    }
    return Math.max(n, 1)
  }

  private lastPage = 1

  /**
   * How many photos one screen of the strip holds (PageUp / PageDown, tz.md, п. 4.4.1): along the
   * row at the bottom, down the column on the left, the visible rows times the columns in the grid.
   * While the strip is hidden (the photo view of the grid), the last measured value.
   */
  pageSize(): number {
    let item: HTMLElement | undefined
    for (const it of this.items.values()) if (!it.hidden) { item = it; break }
    if (!item || !this.el.clientHeight) return this.lastPage
    const gap = 6
    const fit = (room: number, size: number): number => Math.max(1, Math.floor((room + gap) / (size + gap)))
    const across = this.layout === 'bottom'
    let n = across ? fit(this.el.clientWidth, item.offsetWidth) : fit(this.el.clientHeight, item.offsetHeight)
    if (this.layout === 'grid') n *= this.columns()
    this.lastPage = n
    return n
  }

  /** Where the context menu of the current photo opens from the keyboard: its thumbnail; null — not on screen. */
  currentPoint(): { x: number; y: number } | null {
    const item = this.current === null ? undefined : this.items.get(this.current)
    if (!item || !this.el.clientHeight) return null
    const b = item.getBoundingClientRect()
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
  }

  /** Scrolls so that the current photo is visible. */
  /**
   * The thumbnails change size (`change`): the current one stays where it is on screen, the strip grows
   * or shrinks around it (tz.md, пп. 4.1, 4.17); one that was out of sight is brought in.
   */
  keepCurrent(change: () => void): void {
    const item = this.current === null ? undefined : this.items.get(this.current)
    const view = this.el.getBoundingClientRect()
    const r = item?.getBoundingClientRect()
    const across = this.layout === 'bottom'
    const seen = !!r && (across ? r.right > view.left && r.left < view.right : r.bottom > view.top && r.top < view.bottom)
    const before = r ? (across ? (r.left + r.right) / 2 - view.left : (r.top + r.bottom) / 2 - view.top) : 0
    change()
    if (!item || !seen) return this.revealCurrent()
    const n = item.getBoundingClientRect()
    const after = across ? (n.left + n.right) / 2 - view.left : (n.top + n.bottom) / 2 - view.top
    if (across) this.el.scrollLeft += after - before
    else this.el.scrollTop += after - before
  }

  revealCurrent(): void {
    const item = this.current === null ? undefined : this.items.get(this.current)
    item?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
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
    item.className = p.track ? 'thumb is-track' : 'thumb'
    // A track is not dragged anywhere (tz.md, п. 3.9.4).
    item.draggable = !p.track
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
    // A track (tz.md, п. 3.9.3): its badge in the place of the video one.
    if (p.track) {
      const b = document.createElement('div')
      b.className = 'badge-video badge-track'
      b.title = this.t('track.badge')
      b.innerHTML = TRACK_SVG
      item.append(b)
    }
    if (p.video) {
      const v = document.createElement('div')
      v.className = 'badge-video'
      v.title = badgeTitles(p, this.t).video ?? ''
      v.innerHTML = VIDEO_SVG
      item.append(v)
    }
    // A live photo (tz.md, п. 3.3.7): the badge in the place of the video one; its video plays
    // round while the mouse is over it.
    if (p.live) {
      const b = document.createElement('div')
      b.className = 'badge-video badge-live'
      b.title = this.t('photo.live')
      b.innerHTML = LIVE_SVG
      item.append(b)
      item.addEventListener('mouseenter', () => this.playLive(item, p.id, true))
      item.addEventListener('mouseleave', () => this.stopLive(item))
    }
    this.decorate(item, p)

    item.addEventListener('click', (e) => this.h.onClick(p.id, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey }))
    item.addEventListener('dblclick', (e) => {
      if (!e.ctrlKey && !e.shiftKey && !e.metaKey) this.h.onDoubleClick(p.id)
    })
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      this.h.onContextMenu(p.id, e.clientX, e.clientY)
    })
    item.addEventListener('dragstart', (e) => this.dragStart(e, p.id))
    item.addEventListener('dragend', (e) => this.endDrag(e))
    // Dropping onto a photo with coordinates gives them to the dragged photos; onto one without,
    // it gets the common coordinates of the dragged photos (п. 4.5).
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
      const onTrack = !!this.photos[p.id]?.track
      const drop = onTrack ? null : this.dropOn(p.id)
      const ok = onTrack ? this.canDropOn(p.id) : !!drop
      this.clearDropTarget()
      if (!ok || !ids) return
      e.preventDefault()
      e.stopPropagation()
      // Onto a track (п. 3.9.7): each photo to its own place on it.
      if (onTrack) this.h.onDropOnTrack(ids, p.id)
      else this.h.onDropOnPhoto(drop!.ids, drop!.coords)
    })
    return item
  }

  /** What a drop onto this photo would do; null — it cannot be dropped here. */
  private dropOn(id: number): { ids: number[]; coords: LatLon } | null {
    const ids = this.h.dragged()
    return ids ? dropOnPhoto(this.photos, ids, id) : null
  }

  private canDropOn(id: number): boolean {
    const ids = this.h.dragged()
    if (!ids) return false
    if (this.photos[id]?.track) return this.h.canDropOnTrack(ids, id)
    return this.dropOn(id) !== null
  }

  /**
   * While photos are dragged, the thumbnails a drop on which would do nothing are dimmed
   * (tz.md, п. 4.5); the dragged ones themselves are not.
   */
  private markTargets(on: boolean): void {
    const dragged = new Set(on ? (this.h.dragged() ?? []) : [])
    for (const [id, item] of this.items) item.classList.toggle('no-drop', on && !dragged.has(id) && !this.canDropOn(id))
  }

  /**
   * The drag is over (on the thumbnail, or caught by the window if the thumbnail did not get it):
   * the dimming and the drop target go. Safe to call twice.
   */
  private endDrag(e?: DragEvent): void {
    if (!this.dragging) return
    this.dragging = false
    const from = this.dragFrom
    this.dragFrom = null
    this.clearDropTarget()
    this.markTargets(false)
    this.h.onDragEnd()
    if (from?.over && e?.dataTransfer?.dropEffect === 'none') this.h.onDragClick(from.id, { ctrl: from.ctrl, shift: from.shift })
  }

  private dragStart(e: DragEvent, id: number): void {
    const ids = this.h.onDragStart(id)
    this.dragging = true
    this.dragFrom = { id, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, over: true }
    // After the drag image is taken (dimming now would dim it too) — and only if the drag is still
    // on: a quick drag may be over before that frame, and the dimming would then stay.
    requestAnimationFrame(() => {
      if (this.dragging) this.markTargets(true)
    })
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
    // The tooltip of a badge is its value (п. 4.3).
    const titles = badgeTitles(p, this.t)
    item.classList.toggle('modified', p.modified)
    let badge = item.querySelector<HTMLElement>('.badge-coords')
    if (p.coords && !badge) {
      badge = document.createElement('div')
      badge.className = 'badge-coords'
      badge.innerHTML = PIN_SVG
      item.append(badge)
    } else if (!p.coords && badge) {
      badge.remove()
    }
    if (badge && titles.coords) badge.title = titles.coords
    let addr = item.querySelector<HTMLElement>('.badge-address')
    if (p.address && !addr) {
      addr = document.createElement('div')
      addr.className = 'badge-address'
      addr.innerHTML = ADDRESS_SVG
      item.append(addr)
    } else if (!p.address && addr) {
      addr.remove()
    }
    if (addr && titles.address) addr.title = titles.address
    let alt = item.querySelector<HTMLElement>('.badge-altitude')
    if (p.altitude !== null && !alt) {
      alt = document.createElement('div')
      alt.className = 'badge-altitude'
      alt.innerHTML = ALTITUDE_SVG
      item.append(alt)
    } else if (p.altitude === null && alt) {
      alt.remove()
    }
    if (alt && titles.altitude) alt.title = titles.altitude
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

  /**
   * Plays the video of a live photo over its thumbnail, muted (п. 3.3.7): round while hovered
   * (`loop`), or once when it becomes the current photo. Nothing if the video cannot be played:
   * the thumbnail stays.
   */
  private playLive(item: HTMLElement, id: number, loop: boolean): void {
    let video = item.querySelector<HTMLVideoElement>('video.live-video')
    if (video) {
      video.loop = loop
      if (video.paused || video.ended) void video.play().catch(() => {})
      return
    }
    video = document.createElement('video')
    video.className = 'live-video'
    video.muted = true
    video.playsInline = true
    video.loop = loop
    video.src = liveUrl(this.generation, id)
    const v = video
    v.addEventListener('ended', () => v.remove())
    v.addEventListener('error', () => v.remove())
    item.append(v)
    void v.play().catch(() => v.remove())
  }

  private stopLive(item: HTMLElement): void {
    item.querySelector('video.live-video')?.remove()
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
    // A live photo that has just become the current one plays its video once (п. 3.3.7), unless
    // the mouse is already playing it.
    if (moved && this.photos[sel.current!]?.live && !item.matches(':hover')) this.playLive(item, sel.current!, false)
  }
}
