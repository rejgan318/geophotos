import L from './leaflet-global'
import 'leaflet.markercluster'
import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import { thumbUrl, type InitData } from '@shared/ipc'
import { canEdit, type LatLon, type Photo } from '@shared/photo'
import type { Place } from '@shared/search'
import type { MarkerStyle } from '@shared/settings'
import { FILE_SVG } from './icons'

/** Pin with a white dot; the tip is at the bottom centre (viewBox 24×34). */
function pinSvg(fill: string, stroke: string): string {
  return (
    '<svg viewBox="0 0 24 34" width="100%" height="100%" aria-hidden="true">' +
    `<path d="M12 1.5C6.2 1.5 1.8 5.9 1.8 11.5c0 7.6 10.2 20.8 10.2 20.8s10.2-13.2 10.2-20.8C22.2 5.9 17.8 1.5 12 1.5z" fill="${fill}" stroke="${stroke}" stroke-width="2.2"/>` +
    '<circle cx="12" cy="11.5" r="3.8" fill="#fff"/></svg>'
  )
}

/** The selected pin differs only by color, not by size (tz.md, п. 4.8.1). */
function pinIcon(style: MarkerStyle, selected: boolean): L.DivIcon {
  const h = Math.round(style.size)
  const w = Math.round((h * 24) / 34)
  return L.divIcon({
    className: selected ? 'photo-pin selected' : 'photo-pin',
    html: pinSvg(selected ? style.selectedColor : style.color, '#fff'),
    iconSize: [w, h],
    iconAnchor: [w / 2, h],
    // The thumbnail on hover sits right above the pin (tz.md, п. 4.8.2).
    tooltipAnchor: [0, -h]
  })
}

/**
 * A photo's thumbnail standing on its point (tz.md, п. 4.8.3): a frame with the picture and a tail
 * whose tip is the point. The icon element has no size: the content sits above it, so any
 * proportions of the picture keep the tip on the point. A group shows its count in the corner.
 */
function thumbIcon(src: string, size: number, selected: boolean, count?: number): L.DivIcon {
  const badge = count === undefined ? '' : `<span class="pt-count">${count}</span>`
  return L.divIcon({
    className: `photo-thumb${count === undefined ? '' : ' photo-group'}${selected ? ' selected' : ''}`,
    html:
      `<div class="pt" style="--thumb-size:${size}px"><div class="pt-frame">` +
      `<img src="${src}" alt="" draggable="false"></div><div class="pt-tail"></div>${badge}</div>`,
    iconSize: null as unknown as L.PointExpression,
    iconAnchor: [0, 0]
  })
}

/** Mark of a found place (tz.md, п. 5.3): a ring, unlike the photo pins. */
function placeIcon(): L.DivIcon {
  return L.divIcon({ className: 'place-mark', html: '<div></div>', iconSize: [26, 26], iconAnchor: [13, 13] })
}

/** A drop this close to the place mark (px) lands exactly on it. */
const SNAP_PX = 24

/** Internal parts of Leaflet.markercluster used to find the group a marker is hidden in. */
interface ClusterNode {
  _zoom: number
  __parent?: ClusterNode
  _icon?: HTMLElement | null
  getLatLng(): L.LatLng
}

export interface MapHandlers {
  onMarkerClick(photoId: number, mods: { ctrl: boolean; shift: boolean }): void
  /** A marker was dragged to a new point: all photos at its old point move there (п. 4.7). */
  onMarkerMoved(photoId: number, to: LatLon): Promise<void>
  /** Photos dragged from the strip were dropped onto the map (п. 4.5). */
  onDropPhotos(ids: number[], at: LatLon): void
  /**
   * Double click on the map (not on a photo marker or group, п. 4.4.2). True if it was used
   * (the current photo got the point); otherwise the map zooms in as usual.
   */
  onMapDoubleClick(at: LatLon): boolean
  /** The photos being dragged from the strip right now, or null. */
  dragged(): number[] | null
  /** The map moved or zoomed, or another tile source was chosen (kept for the next run). */
  onViewChanged(): void
  /** Ctrl+drag on the map drew a rectangle: the photos with markers inside it (п. 4.4.3). */
  onBoxSelect(ids: number[]): void
}

/**
 * The map: tile sources with a switcher, photo markers grouped into clusters (tz.md, пп. 5.1, 4.8),
 * the selected photos shown on it (п. 4.4.2), editing by dragging (пп. 4.5, 4.7) and the mark of
 * a found place (п. 5.3).
 */
export class MapView {
  private readonly map: L.Map
  private readonly cluster: L.MarkerClusterGroup
  /** Key of the tile source shown. */
  private source = ''
  private readonly style: MarkerStyle
  private readonly icon: L.DivIcon
  private readonly selectedIcon: L.DivIcon
  private photos: Photo[] = []
  /** Generation of the open folder, part of thumbnail URLs. */
  private generation = 0
  private readonly hoverSize: number
  private readonly thumbSize: number
  /** Thumbnails instead of markers (T, View menu; tz.md, п. 4.8.3). */
  private thumbs = false
  /** The photo of each marker: a group shows its earliest photo. */
  private readonly photoOf = new WeakMap<L.Marker, number>()
  private markers = new Map<number, L.Marker>()
  private selected: ReadonlySet<number> = new Set()
  private current: number | null = null
  private highlighted: HTMLElement[] = []
  private place: L.Marker | null = null
  /** Photos that pass the strip filter (tz.md, п. 4.13); null — all. Others have no marker. */
  private shown: ReadonlySet<number> | null = null

  constructor(
    private readonly el: HTMLElement,
    config: InitData['map'],
    private readonly h: MapHandlers
  ) {
    this.style = config.markers
    this.hoverSize = config.hoverThumbSize
    this.thumbSize = config.thumbSize
    this.thumbs = config.thumbnails
    this.icon = pinIcon(this.style, false)
    this.selectedIcon = pinIcon(this.style, true)

    // Arrow keys belong to the strip (п. 4.4.1); +/- still zoom. Double click is handled below:
    // it can give the current photo its coordinates instead of zooming (п. 4.4.2).
    this.map = L.map(el, { zoomControl: true, worldCopyJump: true, keyboardPanDelta: 0, doubleClickZoom: false })
    this.map.on('dblclick', (e: L.LeafletMouseEvent) => {
      if (this.h.onMapDoubleClick(this.dropPoint(e.originalEvent))) return
      // The same as Leaflet's own double click zoom; Shift zooms out.
      const z = this.map.getZoom()
      const delta = this.map.options.zoomDelta ?? 1
      this.map.setZoomAround(e.containerPoint, e.originalEvent.shiftKey ? z - delta : z + delta)
    })

    const layers: Record<string, L.TileLayer> = {}
    const keys = new Map<L.Layer, string>()
    let first: L.TileLayer | undefined
    let chosen: L.TileLayer | undefined
    // Every source can be chosen at any zoom: beyond its own maximum its tiles are enlarged
    // (tz.md, п. 5.1), so the map can zoom as far as the most detailed source.
    const maxZoom = Math.max(...config.sources.map((s) => s.maxZoom))
    for (const s of config.sources) {
      const layer = L.tileLayer(s.url, {
        subdomains: s.subdomains,
        attribution: s.attribution,
        maxNativeZoom: s.maxZoom,
        maxZoom
      })
      layers[s.name] = layer
      keys.set(layer, s.key)
      first ??= layer
      if (s.key === config.defaultSource) chosen = layer
    }
    const start = chosen ?? first
    start?.addTo(this.map)
    this.source = start ? (keys.get(start) ?? '') : ''
    this.map.on('baselayerchange', (e: L.LayersControlEvent) => {
      this.source = keys.get(e.layer) ?? this.source
      this.h.onViewChanged()
    })
    L.control.layers(layers, undefined, { position: 'topright' }).addTo(this.map)
    L.control.scale({ imperial: false }).addTo(this.map)

    const base = this.style.size
    this.cluster = L.markerClusterGroup({
      showCoverageOnHover: false,
      maxClusterRadius: 50,
      // Photos at one point stay grouped until max zoom; a click then fans them out.
      spiderfyOnMaxZoom: true,
      iconCreateFunction: (c) => {
        const n = c.getChildCount()
        if (this.thumbs) {
          // The earliest photo of the group: ids follow the strip, which is in time order.
          const ids = c.getAllChildMarkers().map((m) => this.photoOf.get(m) ?? Infinity)
          return thumbIcon(thumbUrl(this.generation, Math.min(...ids)), this.thumbSize, false, n)
        }
        const d = Math.round(base * 0.8 + Math.log2(n) * 6)
        return L.divIcon({
          className: 'photo-cluster',
          html: `<div style="width:${d}px;height:${d}px;line-height:${d}px">${n}</div>`,
          iconSize: [d, d]
        })
      }
    })
    this.map.addLayer(this.cluster)

    // Groups are re-created when the map moves or zooms: mark the selected ones again. The group
    // layer is added when the map gets its first view, so this waits for it too: otherwise it would
    // run before the groups are redrawn, and a far move would lose the mark.
    this.map.whenReady(() => this.map.on('zoomend moveend', () => this.highlightGroups()))
    this.cluster.on('animationend spiderfied unspiderfied', () => this.highlightGroups())

    this.acceptDrops()
    this.boxSelect()
    // Where the map was at the end of the last run; the first time, the settings' view (п. 7.1).
    const v = config.saved ?? config.initialView
    this.map.setView([v.lat, v.lon], v.zoom)
    this.map.on('moveend', () => this.h.onViewChanged())

    // A thumbnail without a preview becomes a placeholder (load errors do not bubble: capture).
    el.addEventListener(
      'error',
      (e) => {
        const img = e.target
        if (!(img instanceof HTMLImageElement) || !img.parentElement?.classList.contains('pt-frame')) return
        const ph = document.createElement('div')
        ph.className = 'pt-placeholder'
        ph.innerHTML = FILE_SVG
        img.replaceWith(ph)
      },
      true
    )
  }

  /** Markers or thumbnails on the map (tz.md, п. 4.8.3); the view stays. */
  setThumbnails(on: boolean): void {
    if (on === this.thumbs) return
    this.thumbs = on
    this.cluster.clearLayers()
    this.markers.clear()
    this.highlighted = []
    for (const p of this.photos) {
      const m = this.makeMarker(p)
      if (m) this.markers.set(p.id, m)
    }
    this.cluster.addLayers([...this.markers.values()])
    this.highlightGroups()
  }

  /** The look of a photo on the map: a pin, or its thumbnail in the thumbnail mode. */
  private iconFor(id: number, selected: boolean): L.DivIcon {
    if (!this.thumbs) return selected ? this.selectedIcon : this.icon
    return thumbIcon(thumbUrl(this.generation, id), this.thumbSize, selected)
  }

  /** Selected photos are drawn over the others, the current one over all (п. 4.4.2). */
  private zFor(id: number): number {
    return id === this.current ? 20000 : this.selected.has(id) ? 10000 : 0
  }

  /** The Leaflet map, for controls placed on it (search box). */
  get leaflet(): L.Map {
    return this.map
  }

  /** Place, zoom and tile source of the map now (kept for the next run, п. 7.1). */
  view(): { lat: number; lon: number; zoom: number; source: string } {
    const c = this.map.getCenter().wrap()
    return { lat: c.lat, lon: c.lng, zoom: this.map.getZoom(), source: this.source }
  }

  /**
   * Markers of photos with coordinates. With `fit` the view shows them all (п. 5.2); without
   * photos with coordinates, or without `fit` (the folder of the last run), the map stays (п. 7.3).
   */
  setPhotos(photos: Photo[], generation: number, fit: boolean): void {
    this.generation = generation
    this.cluster.clearLayers()
    this.markers.clear()
    this.photos = [...photos]
    this.shown = null
    this.selected = new Set()
    this.current = null
    this.highlighted = []
    for (const p of photos) {
      const m = this.makeMarker(p)
      if (m) this.markers.set(p.id, m)
    }
    this.cluster.addLayers([...this.markers.values()])
    if (fit) this.fitMarkers()
  }

  /**
   * Fits the view to the markers shown now: on opening a folder (п. 5.2) and on a click on a
   * filter button (п. 4.13). False (and the view stays) when there are none.
   */
  fitMarkers(): boolean {
    const points = [...this.markers.values()].map((m) => m.getLatLng())
    if (!points.length) return false
    this.map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 16 })
    return true
  }

  /** Photos with new coordinates: their markers move; the view stays. */
  updatePhotos(changed: Photo[]): void {
    for (const p of changed) {
      this.photos[p.id] = p
      this.refreshMarker(p.id)
    }
    this.highlightGroups()
  }

  private refreshMarker(id: number): void {
    const old = this.markers.get(id)
    if (old) this.cluster.removeLayer(old)
    this.markers.delete(id)
    const p = this.photos[id]
    const m = p ? this.makeMarker(p) : null
    if (!m) return
    this.markers.set(id, m)
    this.cluster.addLayer(m)
  }

  /**
   * The filter of the strip applies to the map too (tz.md, п. 4.13): only the given photos keep
   * their markers. The view does not change.
   */
  setShown(shown: ReadonlySet<number>): void {
    this.shown = shown
    const add: L.Marker[] = []
    const remove: L.Marker[] = []
    for (const p of this.photos) {
      const m = this.markers.get(p.id)
      if (m && !shown.has(p.id)) {
        remove.push(m)
        this.markers.delete(p.id)
      } else if (!m && shown.has(p.id)) {
        const created = this.makeMarker(p)
        if (created) {
          this.markers.set(p.id, created)
          add.push(created)
        }
      }
    }
    if (remove.length) this.cluster.removeLayers(remove)
    if (add.length) this.cluster.addLayers(add)
    this.highlightGroups()
  }

  private makeMarker(p: Photo): L.Marker | null {
    if (!p.coords || (this.shown && !this.shown.has(p.id))) return null
    const m = L.marker(L.latLng(p.coords.lat, p.coords.lon), {
      icon: this.iconFor(p.id, this.selected.has(p.id)),
      zIndexOffset: this.zFor(p.id),
      // A video cannot be moved yet (tz.md, п. 9.3: 0.22.0).
      draggable: canEdit(p),
      autoPan: true
    })
    this.photoOf.set(m, p.id)
    // The photo's thumbnail over the pin while the mouse is on it, not while it is dragged
    // (п. 4.8.2); thumbnails on the map need none. Made on the first hover and kept: Leaflet
    // asks for the content again on every update.
    if (!this.thumbs) {
      let thumb: HTMLElement | null = null
      m.bindTooltip(() => (thumb ??= this.hoverThumb(p.id, m)), { direction: 'top', className: 'hover-thumb', opacity: 1 })
      m.on('dragstart', () => m.closeTooltip())
    }
    m.on('click', (e: L.LeafletMouseEvent) =>
      this.h.onMarkerClick(p.id, { ctrl: e.originalEvent.ctrlKey, shift: e.originalEvent.shiftKey })
    )
    m.on('dragend', () => {
      const to = m.getLatLng().wrap()
      // Whatever main decides, the marker then shows the photo's actual coordinates.
      void this.h.onMarkerMoved(p.id, { lat: to.lat, lon: to.lng }).finally(() => {
        if (this.markers.get(p.id) === m) this.refreshMarker(p.id)
        this.highlightGroups()
      })
    })
    return m
  }

  /**
   * Thumbnail with the file name shown over a hovered marker (tz.md, п. 4.8.2): the strip's
   * thumbnail with its proportions, or a placeholder if the photo has no preview.
   */
  private hoverThumb(id: number, marker: L.Marker): HTMLElement {
    const box = document.createElement('div')
    box.style.setProperty('--hover-size', `${this.hoverSize}px`)
    const img = document.createElement('img')
    img.alt = ''
    img.draggable = false
    // The tooltip is placed by its size: place it again once the image has one.
    img.addEventListener('load', () => marker.getTooltip()?.update(), { once: true })
    img.addEventListener(
      'error',
      () => {
        const ph = document.createElement('div')
        ph.className = 'hover-placeholder'
        ph.innerHTML = FILE_SVG
        img.replaceWith(ph)
        marker.getTooltip()?.update()
      },
      { once: true }
    )
    img.src = thumbUrl(this.generation, id)
    const name = document.createElement('div')
    name.className = 'hover-name'
    name.textContent = this.photos[id]?.name ?? ''
    box.append(img, name)
    return box
  }

  /**
   * Selection by a rectangle (tz.md, п. 4.4.3): Ctrl+drag on the map (not on a marker) draws it;
   * on release the photos whose markers are inside are reported, also those hidden in a group.
   * Shift+drag stays Leaflet's zoom to a box.
   */
  private boxSelect(): void {
    const container = this.map.getContainer()
    let start: L.Point | null = null
    let box: HTMLElement | null = null
    const corners = (a: L.Point, b: L.Point): [L.Point, L.Point] => [
      L.point(Math.min(a.x, b.x), Math.min(a.y, b.y)),
      L.point(Math.max(a.x, b.x), Math.max(a.y, b.y))
    ]
    const onMove = (e: MouseEvent): void => {
      if (!start || !box) return
      const [min, max] = corners(start, this.map.mouseEventToContainerPoint(e))
      Object.assign(box.style, { left: `${min.x}px`, top: `${min.y}px`, width: `${max.x - min.x}px`, height: `${max.y - min.y}px` })
    }
    const onUp = (e: MouseEvent): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      this.map.dragging.enable()
      box?.remove()
      box = null
      if (!start) return
      const [min, max] = corners(start, this.map.mouseEventToContainerPoint(e))
      start = null
      // A click, not a rectangle.
      if (max.x - min.x < 4 && max.y - min.y < 4) return
      const bounds = L.latLngBounds(this.map.containerPointToLatLng(min), this.map.containerPointToLatLng(max))
      const ids = [...this.markers].filter(([, m]) => bounds.contains(m.getLatLng())).map(([id]) => id)
      this.h.onBoxSelect(ids)
    }
    // Capture: the map must not start panning.
    container.addEventListener(
      'mousedown',
      (e) => {
        if (e.button !== 0 || !e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return
        if ((e.target as HTMLElement).closest('.leaflet-marker-icon, .leaflet-control')) return
        e.preventDefault()
        e.stopPropagation()
        this.map.dragging.disable()
        start = this.map.mouseEventToContainerPoint(e)
        box = document.createElement('div')
        box.className = 'select-box'
        container.append(box)
        document.addEventListener('mousemove', onMove)
        document.addEventListener('mouseup', onUp)
      },
      true
    )
  }

  /** Photos from the strip can be dropped anywhere on the map (п. 4.5). */
  private acceptDrops(): void {
    this.el.addEventListener('dragover', (e) => {
      if (!this.h.dragged()) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    })
    this.el.addEventListener('drop', (e) => {
      const ids = this.h.dragged()
      if (!ids) return
      e.preventDefault()
      e.stopPropagation()
      this.h.onDropPhotos(ids, this.dropPoint(e))
    })
  }

  /** The point under the mouse; next to the found place mark — the mark itself (п. 5.3). */
  private dropPoint(e: MouseEvent): LatLon {
    const pt = this.map.mouseEventToContainerPoint(e)
    if (this.place) {
      const mark = this.map.latLngToContainerPoint(this.place.getLatLng())
      if (mark.distanceTo(pt) <= SNAP_PX) {
        const ll = this.place.getLatLng()
        return { lat: ll.lat, lon: ll.lng }
      }
    }
    const ll = this.map.containerPointToLatLng(pt).wrap()
    return { lat: ll.lat, lon: ll.lng }
  }

  /**
   * Shows the selected photos (п. 4.4.2): their markers get the selected look; if the marker of
   * the current photo or its group is off screen, the map pans to it without changing the zoom.
   */
  setSelection(ids: ReadonlySet<number>, current: number | null): void {
    const before = this.selected
    const moved = current !== this.current
    const previous = this.current
    this.selected = new Set(ids)
    this.current = current
    for (const id of before) {
      if (!ids.has(id)) this.markers.get(id)?.setIcon(this.iconFor(id, false))
    }
    for (const id of ids) {
      if (!before.has(id)) this.markers.get(id)?.setIcon(this.iconFor(id, true))
    }
    for (const id of new Set([...before, ...ids, previous, current])) {
      if (id !== null) this.markers.get(id)?.setZIndexOffset(this.zFor(id))
    }
    const marker = current === null ? undefined : this.markers.get(current)
    if (marker && moved) {
      const target = this.shownAt(marker)
      if (!this.map.getBounds().pad(-0.08).contains(target)) this.map.panTo(target)
    }
    this.highlightGroups()
  }

  /**
   * Shows a photo on the map (double click in the strip): the map zooms in only as far as needed
   * for the marker to come out of its group (or fans the group out when photos stand at one
   * point), then centres on the marker. Nothing for a photo without a marker.
   */
  showOnMap(photoId: number): void {
    const marker = this.markers.get(photoId)
    if (!marker) return
    this.cluster.zoomToShowLayer(marker, () => {
      this.map.panTo(marker.getLatLng())
      this.highlightGroups()
    })
  }

  /** Pans to a point if it is off screen; the zoom stays (pasted coordinates, п. 4.10). */
  reveal(at: LatLon): void {
    const ll = L.latLng(at.lat, at.lon)
    if (!this.map.getBounds().pad(-0.08).contains(ll)) this.map.panTo(ll)
  }

  /** Where the marker is shown at the current zoom: itself, or the group it is hidden in. */
  private shownAt(marker: L.Marker): L.LatLng {
    return this.groupOf(marker)?.getLatLng() ?? marker.getLatLng()
  }

  /** The group hiding the marker at the current zoom; null if the marker is shown by itself. */
  private groupOf(marker: L.Marker): ClusterNode | null {
    const zoom = this.map.getZoom()
    let node = (marker as unknown as ClusterNode).__parent
    while (node && node._zoom > zoom) node = node.__parent
    // The top-level node (zoom below the lowest cluster level) is not shown on the map.
    if (!node || node._zoom < zoom || !node.__parent) return null
    return node
  }

  /** Groups that hide selected photos get the selected look. */
  private highlightGroups(): void {
    for (const el of this.highlighted) el.classList.remove('selected')
    this.highlighted = []
    for (const id of this.selected) {
      const marker = this.markers.get(id)
      if (!marker) continue
      const visible = this.cluster.getVisibleParent(marker) as unknown as ClusterNode | null
      if (visible && visible !== (marker as unknown as ClusterNode) && visible._icon) {
        visible._icon.classList.add('selected')
        this.highlighted.push(visible._icon)
      }
    }
  }

  /** Moves the map to a found place and puts a temporary mark there (п. 5.3). */
  showPlace(place: Place): void {
    const ll = L.latLng(place.lat, place.lon)
    if (!this.place) {
      // Under the photo pins: a photo dropped onto the mark stays easy to grab.
      this.place = L.marker(ll, { icon: placeIcon(), keyboard: false, zIndexOffset: -10000 })
      // A double click on the mark itself gives the current photo exactly its point (п. 4.4.2).
      this.place.on('dblclick', () => {
        const at = this.place?.getLatLng()
        if (at) this.h.onMapDoubleClick({ lat: at.lat, lon: at.lng })
      })
      this.place.addTo(this.map)
    } else {
      this.place.setLatLng(ll)
    }
    this.place.unbindTooltip().bindTooltip(place.name, { direction: 'top', offset: [0, -14] })
    if (place.bounds) {
      const [s, w, n, e] = place.bounds
      this.map.fitBounds(L.latLngBounds([s, w], [n, e]), { maxZoom: 17 })
    } else {
      this.map.setView(ll, Math.max(this.map.getZoom(), 15))
    }
  }

  clearPlace(): void {
    this.place?.remove()
    this.place = null
  }

  /** Leaflet must recompute its size after the layout changes. */
  invalidateSize(): void {
    this.map.invalidateSize()
  }
}
