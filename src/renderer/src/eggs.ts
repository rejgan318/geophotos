/**
 * The easter eggs "ATB bag" (tz.md, п. 9.3): photos hidden on the map. One is found when its point
 * stays well inside the view at EGG_ZOOM or closer for a second; then a card flies out of it with
 * confetti. Found eggs stay on the map (from EGG_ZOOM) as round thumbnails with a bag, apart from
 * the user's photos; a click shows the card again, without the celebration.
 */
import L from './leaflet-global'
import { EGG_DWELL_MS, EGG_ZOOM, eggsInView, type EggForMap, type FoundEgg } from '@shared/eggs'
import type { Translate } from '@shared/i18n'

/** A plain plastic bag with a blue circle: the sign of the eggs (not a logo). */
export const BAG_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3.5c0-1 1-1.5 1.6-.6L12 6.4l2.4-3.5c.6-.9 1.6-.4 1.6.6V7h2.2c.6 0 1 .4 1 1l-.9 12.2c0 .5-.5.8-1 .8H6.7c-.5 0-1-.3-1-.8L4.8 8c0-.6.4-1 1-1H8z" fill="#f4f4f4" stroke="#6b6b6b" stroke-width=".8"/><circle cx="12" cy="13.6" r="3.9" fill="#1d5bbf"/><path d="M10.3 15.4l1.7-4 1.7 4M10.9 14.1h2.2" stroke="#e3262f" stroke-width="1.1" fill="none" stroke-linecap="round"/></svg>'

/** The colours of the bag: confetti. */
const CONFETTI = ['#1d5bbf', '#ffffff', '#e3262f']

/** Size of a found egg on the map in the marker mode, px (in the thumbnail mode — as photo thumbnails). */
const PIN_SIZE = 40

/** Under the photo markers and places: an egg never covers the user's work. */
const EGG_Z = -20000

export interface EggHooks {
  /** Whether a find may wait no longer: nothing is being dragged now. */
  busy(): boolean
  /** Whether the map is what the window shows (not the photo view, the grid or a track view). */
  mapShown(): boolean
  /** A new egg was found: main keeps it with the date. */
  onFound(id: number): void
}

export class EggView {
  private readonly byId = new Map<number, EggForMap>()
  private found: FoundEgg[]
  private readonly layer = L.layerGroup()
  private readonly markers = new Map<number, L.Marker>()
  private timer: number | undefined
  private thumbs: boolean
  private card: HTMLElement | null = null
  private closing: (() => void) | null = null

  constructor(
    private readonly map: L.Map,
    data: { list: EggForMap[]; found: FoundEgg[] },
    private readonly t: Translate,
    private readonly thumbSize: number,
    thumbs: boolean,
    private readonly hooks: EggHooks
  ) {
    for (const e of data.list) this.byId.set(e.id, e)
    this.found = data.found.filter((f) => this.byId.has(f.id))
    this.thumbs = thumbs
    for (const f of this.found) this.addMarker(f.id)
    this.map.on('zoomend', () => this.showLayer())
    this.map.on('moveend', () => this.schedule())
    this.map.whenReady(() => {
      this.showLayer()
      this.schedule()
    })
  }

  get total(): number {
    return this.byId.size
  }

  /** The found eggs in the order found: name and date (About, tz.md, п. 9.3). */
  list(): { id: number; title: string; date: string }[] {
    return this.found.map((f) => ({ id: f.id, title: this.byId.get(f.id)?.title ?? '', date: f.date }))
  }

  get cardVisible(): boolean {
    return this.card !== null
  }

  closeCard(): void {
    this.closing?.()
  }

  /** Markers or thumbnails on the map (п. 4.8.3): the eggs follow in size. */
  setThumbnails(on: boolean): void {
    if (on === this.thumbs) return
    this.thumbs = on
    for (const [id, m] of this.markers) m.setIcon(this.icon(id))
  }

  /** The egg from the list in About: the map at its point at EGG_ZOOM, and its card without the celebration. */
  goTo(id: number): void {
    const egg = this.byId.get(id)
    if (!egg) return
    this.map.setView([egg.lat, egg.lon], EGG_ZOOM, { animate: false })
    void this.showCard(id, false)
  }

  /** A moment after the map stops: the dwell starts anew with every move. */
  schedule(): void {
    window.clearTimeout(this.timer)
    if (this.found.length >= this.byId.size) return
    this.timer = window.setTimeout(() => this.check(), EGG_DWELL_MS)
  }

  private check(): void {
    if (this.card || !this.hooks.mapShown()) return
    const b = this.map.getBounds()
    const seen = eggsInView([...this.byId.values()], { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }, this.map.getZoom(), new Set(this.found.map((f) => f.id)))
    const egg = seen[0]
    if (!egg) return
    // A photo is being dragged: the card waits until it is dropped (п. 9.3).
    if (this.hooks.busy()) {
      this.timer = window.setTimeout(() => this.check(), 300)
      return
    }
    this.found = [...this.found, { id: egg.id, date: new Date().toISOString() }]
    this.hooks.onFound(egg.id)
    this.addMarker(egg.id)
    void this.showCard(egg.id, true)
  }

  private showLayer(): void {
    const on = this.map.getZoom() >= EGG_ZOOM
    if (on && !this.map.hasLayer(this.layer)) this.layer.addTo(this.map)
    else if (!on && this.map.hasLayer(this.layer)) this.layer.remove()
  }

  private icon(id: number): L.DivIcon {
    const egg = this.byId.get(id)
    const size = this.thumbs ? this.thumbSize : PIN_SIZE
    const badge = Math.max(14, Math.round(size * 0.38))
    return L.divIcon({
      className: 'egg-marker',
      html: `<div class="egg-pic" style="width:${size}px;height:${size}px"><img src="${egg?.url ?? ''}" alt="" draggable="false"></div><span class="egg-bag" style="width:${badge}px;height:${badge}px">${BAG_SVG}</span>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2]
    })
  }

  private addMarker(id: number): void {
    const egg = this.byId.get(id)
    if (!egg || this.markers.has(id)) return
    const m = L.marker([egg.lat, egg.lon], { icon: this.icon(id), keyboard: false, zIndexOffset: EGG_Z })
    m.on('click', () => void this.showCard(id, false))
    // Not a photo: no menu, no mark under it (п. 5.3), no double click for the current photo.
    m.on('contextmenu', (e: L.LeafletMouseEvent) => e.originalEvent.preventDefault())
    this.markers.set(id, m)
    m.addTo(this.layer)
  }

  /**
   * The card of the egg over the map: its photo and "Easter egg n of N · place". `celebrate` —
   * just found: it flies out of its point turning over, with confetti; the last one has its own
   * finale. Closed by a click, Esc or Enter.
   */
  private async showCard(id: number, celebrate: boolean): Promise<void> {
    const egg = this.byId.get(id)
    if (!egg) return
    this.closeCard()
    const n = this.found.findIndex((f) => f.id === id) + 1
    const last = celebrate && this.found.length === this.byId.size

    const overlay = document.createElement('div')
    overlay.className = 'egg-overlay'
    const card = document.createElement('div')
    card.className = 'egg-card'
    const front = document.createElement('div')
    front.className = 'egg-front'
    const img = document.createElement('img')
    img.src = egg.url
    img.alt = egg.title
    img.draggable = false
    const caption = document.createElement('div')
    caption.className = 'egg-caption'
    caption.textContent = this.t('egg.caption', { n: String(n), total: String(this.byId.size), place: egg.title })
    front.append(img, caption)
    if (last) {
      const all = document.createElement('div')
      all.className = 'egg-all'
      all.textContent = this.t('egg.all', { total: String(this.byId.size) })
      front.append(all)
    }
    const back = document.createElement('div')
    back.className = 'egg-back'
    back.innerHTML = BAG_SVG
    card.append(front, back)
    overlay.append(card)
    overlay.title = this.t('egg.close')
    try {
      await img.decode()
    } catch {
      // No photo: the card still says what was found.
    }
    document.body.append(overlay)
    this.card = overlay

    let confetti: (() => void) | null = null
    const close = (): void => {
      if (this.card !== overlay) return
      this.card = null
      this.closing = null
      confetti?.()
      overlay.remove()
      // Another egg may be in view as well.
      this.schedule()
    }
    this.closing = close
    overlay.addEventListener('click', close)

    if (!celebrate) return
    // From the point of the egg on the map to the middle, turning over (about 0.4 s).
    const p = this.map.latLngToContainerPoint([egg.lat, egg.lon])
    const r = this.map.getContainer().getBoundingClientRect()
    const c = card.getBoundingClientRect()
    const dx = r.left + p.x - (c.left + c.width / 2)
    const dy = r.top + p.y - (c.top + c.height / 2)
    card.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(0.08) rotateY(180deg)` },
        { transform: 'translate(0, 0) scale(1) rotateY(0deg)' }
      ],
      { duration: 420, easing: 'cubic-bezier(.2,.8,.3,1)' }
    )
    window.setTimeout(() => {
      if (this.card === overlay) confetti = burst(overlay, card.getBoundingClientRect(), last)
    }, 300)
  }
}

/**
 * Confetti in the colours of the bag from the card (1–1.5 s; the finale — more and longer).
 * Returns the function that stops it.
 */
function burst(host: HTMLElement, from: DOMRect, big: boolean): () => void {
  const canvas = document.createElement('canvas')
  canvas.className = 'egg-confetti'
  const dpr = window.devicePixelRatio || 1
  canvas.width = window.innerWidth * dpr
  canvas.height = window.innerHeight * dpr
  host.append(canvas)
  const ctx = canvas.getContext('2d')
  if (!ctx) return () => canvas.remove()
  ctx.scale(dpr, dpr)
  const count = big ? 320 : 140
  const life = big ? 2600 : 1500
  const cx = from.left + from.width / 2
  const cy = from.top + from.height / 3
  const parts = Array.from({ length: count }, () => {
    const a = Math.random() * Math.PI * 2
    const v = (big ? 7 : 5) + Math.random() * (big ? 9 : 6)
    return {
      x: cx + (Math.random() - 0.5) * from.width * 0.6,
      y: cy,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v - (big ? 6 : 4),
      w: 5 + Math.random() * 5,
      h: 3 + Math.random() * 3,
      rot: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.4,
      color: CONFETTI[Math.floor(Math.random() * CONFETTI.length)]!
    }
  })
  const start = performance.now()
  let frame = 0
  const step = (now: number): void => {
    const t = now - start
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)
    if (t > life) {
      canvas.remove()
      return
    }
    ctx.globalAlpha = Math.min(1, (life - t) / 400)
    for (const p of parts) {
      p.vx *= 0.985
      p.vy = p.vy * 0.985 + 0.28
      p.x += p.vx
      p.y += p.vy
      p.rot += p.spin
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.rot)
      ctx.fillStyle = p.color
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.rot * 2)))
      ctx.restore()
    }
    frame = requestAnimationFrame(step)
  }
  frame = requestAnimationFrame(step)
  return () => {
    cancelAnimationFrame(frame)
    canvas.remove()
  }
}
