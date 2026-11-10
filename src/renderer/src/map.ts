import L from './leaflet-global'
import 'leaflet.markercluster'
import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import type { InitData } from '@shared/ipc'
import type { Photo } from '@shared/photo'
import type { MarkerStyle } from '@shared/settings'

/** Pin with a white dot; the tip is at the bottom centre (viewBox 24×34). */
function pinSvg(fill: string, stroke: string): string {
  return (
    '<svg viewBox="0 0 24 34" width="100%" height="100%" aria-hidden="true">' +
    `<path d="M12 1.5C6.2 1.5 1.8 5.9 1.8 11.5c0 7.6 10.2 20.8 10.2 20.8s10.2-13.2 10.2-20.8C22.2 5.9 17.8 1.5 12 1.5z" fill="${fill}" stroke="${stroke}" stroke-width="2.2"/>` +
    '<circle cx="12" cy="11.5" r="3.8" fill="#fff"/></svg>'
  )
}

function pinIcon(style: MarkerStyle, selected: boolean): L.DivIcon {
  const h = Math.round(style.size * (selected ? 1.3 : 1))
  const w = Math.round((h * 24) / 34)
  return L.divIcon({
    className: selected ? 'photo-pin selected' : 'photo-pin',
    html: pinSvg(selected ? style.selectedColor : style.color, '#fff'),
    iconSize: [w, h],
    iconAnchor: [w / 2, h]
  })
}

/** Internal parts of Leaflet.markercluster used to find the group a marker is hidden in. */
interface ClusterNode {
  _zoom: number
  __parent?: ClusterNode
  _icon?: HTMLElement | null
  getLatLng(): L.LatLng
}

/**
 * The map: tile sources with a switcher, photo markers grouped into clusters (tz.md, пп. 5.1, 4.8),
 * and the selected photo shown on it (п. 4.4.2).
 */
export class MapView {
  private readonly map: L.Map
  private readonly cluster: L.MarkerClusterGroup
  private readonly initialView: InitData['map']['initialView']
  private readonly style: MarkerStyle
  private readonly icon: L.DivIcon
  private readonly selectedIcon: L.DivIcon
  private markers = new Map<number, L.Marker>()
  private selected: number | null = null
  private highlighted: HTMLElement | null = null

  constructor(
    el: HTMLElement,
    config: InitData['map'],
    private readonly onMarkerClick: (photoId: number) => void
  ) {
    this.initialView = config.initialView
    this.style = config.markers
    this.icon = pinIcon(this.style, false)
    this.selectedIcon = pinIcon(this.style, true)

    // Arrow keys belong to the strip (п. 4.4.1); +/- still zoom.
    this.map = L.map(el, { zoomControl: true, worldCopyJump: true, keyboardPanDelta: 0 })

    const layers: Record<string, L.TileLayer> = {}
    let first: L.TileLayer | undefined
    let chosen: L.TileLayer | undefined
    for (const s of config.sources) {
      const layer = L.tileLayer(s.url, {
        subdomains: s.subdomains,
        attribution: s.attribution,
        maxZoom: s.maxZoom
      })
      layers[s.name] = layer
      first ??= layer
      if (s.key === config.defaultSource) chosen = layer
    }
    ;(chosen ?? first)?.addTo(this.map)
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
        const d = Math.round(base * 0.8 + Math.log2(n) * 6)
        return L.divIcon({
          className: 'photo-cluster',
          html: `<div style="width:${d}px;height:${d}px;line-height:${d}px">${n}</div>`,
          iconSize: [d, d]
        })
      }
    })
    this.map.addLayer(this.cluster)

    // Groups are re-created when the map moves or zooms: mark the selected one again.
    this.map.on('zoomend moveend', () => this.highlightGroup())
    this.cluster.on('animationend spiderfied unspiderfied', () => this.highlightGroup())

    this.showInitialView()
  }

  showInitialView(): void {
    const v = this.initialView
    this.map.setView([v.lat, v.lon], v.zoom)
  }

  /** Markers of photos with coordinates; the view fits them, or the initial view if none (п. 5.2). */
  setPhotos(photos: Photo[]): void {
    this.cluster.clearLayers()
    this.markers.clear()
    this.selected = null
    this.highlighted = null
    const points: L.LatLng[] = []
    for (const p of photos) {
      if (!p.coords) continue
      const ll = L.latLng(p.coords.lat, p.coords.lon)
      points.push(ll)
      const m = L.marker(ll, { icon: this.icon, title: p.name })
      m.on('click', () => this.onMarkerClick(p.id))
      this.markers.set(p.id, m)
    }
    this.cluster.addLayers([...this.markers.values()])
    if (points.length) {
      this.map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 16 })
    } else {
      this.showInitialView()
    }
  }

  /**
   * Shows the selected photo (п. 4.4.2): its marker gets the selected look; if the marker or
   * its group is off screen, the map pans to it without changing the zoom.
   */
  select(photoId: number | null): void {
    if (this.selected !== null) this.markers.get(this.selected)?.setIcon(this.icon).setZIndexOffset(0)
    this.selected = photoId
    const marker = photoId === null ? undefined : this.markers.get(photoId)
    if (marker) {
      marker.setIcon(this.selectedIcon).setZIndexOffset(10000)
      const target = this.shownAt(marker)
      if (!this.map.getBounds().pad(-0.08).contains(target)) this.map.panTo(target)
    }
    this.highlightGroup()
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

  private highlightGroup(): void {
    this.highlighted?.classList.remove('selected')
    this.highlighted = null
    const marker = this.selected === null ? undefined : this.markers.get(this.selected)
    if (!marker) return
    const visible = this.cluster.getVisibleParent(marker) as unknown as ClusterNode | null
    if (visible && visible !== (marker as unknown as ClusterNode) && visible._icon) {
      visible._icon.classList.add('selected')
      this.highlighted = visible._icon
    }
  }

  /** Leaflet must recompute its size after the layout changes. */
  invalidateSize(): void {
    this.map.invalidateSize()
  }
}
