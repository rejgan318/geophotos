import L from './leaflet-global'
import type { Translate } from '@shared/i18n'
import type { TrackForMap } from '@shared/ipc'
import type { Photo } from '@shared/photo'
import { nearestPoint, trackBounds, type TrackPoint } from '@shared/track'
import { numberText, speedText, trackTime } from './describe'
import { flagSvg } from './icons'

export interface TrackHandlers {
  /** A click on the line of a track: select it in the strip (tz.md, п. 3.9.4). */
  onClick(id: number): void
}

interface Shown {
  id: number
  color: string
  track: TrackForMap
  /** The lines and the dark casing under them, one pair per segment. */
  lines: L.Polyline[]
  casings: L.Polyline[]
  flags: L.Marker[]
}

/** Line widths, px: a track, the selected track; the casing is wider by this much. */
const WIDTH = 4
const WIDTH_SELECTED = 6
const CASING = 3

/**
 * Tracks on the map (tz.md, п. 3.9.5): lines in the colours of the settings, waypoints as flags
 * of the track's colour with their names, a tooltip of the nearest point under the mouse. A click
 * on a line selects the track. The selected track is wider and over the others.
 */
export class TrackLayer {
  private shown = new Map<number, Shown>()
  private current: number | null = null
  /** Tracks hidden for the track view (п. 3.9.6): all but this one. */
  private only: number | null = null
  private generation = -1
  /** The point of the track view's profile under the mouse (п. 3.9.6). */
  private probe: L.CircleMarker | null = null

  constructor(
    private readonly map: L.Map,
    private readonly config: { colors: string[]; labelZoom: number },
    private readonly t: Translate,
    private readonly h: TrackHandlers
  ) {
    // Under the photo markers (600), over the tiles and other overlays (400).
    map.createPane('tracks').style.zIndex = '450'
    map.createPane('trackFlags').style.zIndex = '590'
    map.on('zoomend', () => this.updateLabels())
  }

  /** The tracks of the strip; their lines and points come from main. Resolves when all are drawn. */
  async setTracks(photos: readonly Photo[], generation: number): Promise<void> {
    this.clear()
    this.generation = generation
    const tracks = photos.filter((p) => p.track && !p.error)
    const data = await Promise.all(tracks.map((p) => window.geophotos.trackData(generation, p.id)))
    // Another strip came meanwhile.
    if (generation !== this.generation) return
    tracks.forEach((p, i) => {
      const track = data[i]
      if (track) this.draw(p.id, this.colorOf(p), track)
    })
    this.setCurrent(this.current)
  }

  clear(): void {
    for (const s of this.shown.values()) for (const l of [...s.casings, ...s.lines, ...s.flags]) l.remove()
    this.shown.clear()
    this.current = null
    this.only = null
    this.probe?.remove()
    this.probe = null
  }

  /** Colour of a track by its index (tz.md, п. 3.9.5). */
  colorOf(p: Photo): string {
    const colors = this.config.colors
    return colors[(p.track?.color ?? 0) % colors.length] ?? '#2979FF'
  }

  has(id: number): boolean {
    return this.shown.has(id)
  }

  data(id: number): TrackForMap | null {
    return this.shown.get(id)?.track ?? null
  }

  private draw(id: number, color: string, track: TrackForMap): void {
    const s: Shown = { id, color, track, lines: [], casings: [], flags: [] }
    for (const seg of track.data.segments) {
      const latlngs = seg.map((p) => L.latLng(p.lat, p.lon))
      // A dark casing keeps the line visible on the satellite too.
      const casing = L.polyline(latlngs, { pane: 'tracks', color: '#000', opacity: 0.35, weight: WIDTH + CASING, interactive: false })
      const line = L.polyline(latlngs, { pane: 'tracks', color, weight: WIDTH, opacity: 0.95, lineJoin: 'round' })
      line.bindTooltip('', { sticky: true, direction: 'top', offset: [0, -8], className: 'track-tip' })
      line.on('mousemove', (e: L.LeafletMouseEvent) => {
        const p = nearestPoint(track.data, { lat: e.latlng.lat, lon: e.latlng.lng })
        if (p) line.setTooltipContent(this.pointText(p, track.zone))
      })
      line.on('click', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e)
        this.h.onClick(id)
      })
      line.on('dblclick', (e: L.LeafletMouseEvent) => L.DomEvent.stopPropagation(e))
      s.casings.push(casing.addTo(this.map))
      s.lines.push(line.addTo(this.map))
    }
    for (const w of track.data.waypoints) {
      const flag = L.marker([w.lat, w.lon], {
        pane: 'trackFlags',
        icon: L.divIcon({ className: 'track-flag', html: flagSvg(color), iconSize: [20, 26], iconAnchor: [3, 25] }),
        keyboard: false
      })
      if (w.name) flag.bindTooltip(w.name, { direction: 'right', offset: [12, -16], className: 'flag-label' })
      flag.on('click', () => this.h.onClick(id))
      s.flags.push(flag.addTo(this.map))
    }
    this.shown.set(id, s)
    this.updateLabels()
  }

  /** Names of waypoints: always shown from the zoom of the settings, below it only on hover. */
  private updateLabels(): void {
    const always = this.map.getZoom() >= this.config.labelZoom
    for (const s of this.shown.values()) {
      for (const f of s.flags) {
        const tip = f.getTooltip()
        if (!tip) continue
        const text = tip.getContent()
        if (tip.options.permanent === always) continue
        f.unbindTooltip()
        f.bindTooltip(text as string, { direction: 'right', offset: [12, -16], className: 'flag-label', permanent: always })
      }
    }
  }

  /** "14:32:07 · 1 245 м" and the sensors of the point that has them (tz.md, п. 3.9.5). */
  pointText(p: TrackPoint, zone: string | null): string {
    const first: string[] = []
    if (p.t !== null) first.push(trackTime(p.t, zone, 'time'))
    if (p.ele !== null) first.push(this.t('unit.m', { n: numberText(p.ele, this.t) }))
    const second: string[] = []
    if (p.hr !== undefined) second.push(`♥ ${numberText(p.hr, this.t)}`)
    if (p.speed !== undefined) second.push(speedText(p.speed, this.t))
    if (p.cad !== undefined) second.push(this.t('track.cadence', { n: numberText(p.cad, this.t) }))
    if (p.temp !== undefined) second.push(this.t('unit.celsius', { n: numberText(p.temp, this.t) }))
    if (p.power !== undefined) second.push(this.t('unit.watt', { n: numberText(p.power, this.t) }))
    const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    return [first.join(' · '), second.join(' · ')].filter((s) => s).map(esc).join('<br>')
  }

  /** The selected track: wider, over the others (п. 3.9.4); null — none. */
  setCurrent(id: number | null): void {
    this.current = id
    for (const s of this.shown.values()) {
      const on = s.id === id
      s.lines.forEach((l) => l.setStyle({ weight: on ? WIDTH_SELECTED : WIDTH }))
      s.casings.forEach((l) => l.setStyle({ weight: (on ? WIDTH_SELECTED : WIDTH) + CASING }))
    }
    const s = id === null ? undefined : this.shown.get(id)
    if (s) {
      s.casings.forEach((l) => l.bringToFront())
      s.lines.forEach((l) => l.bringToFront())
    }
  }

  /** Bounds of a track, or of all tracks (null id); null — nothing to show. */
  bounds(id: number | null = null): L.LatLngBounds | null {
    let b: L.LatLngBounds | null = null
    for (const s of this.shown.values()) {
      if (id !== null && s.id !== id) continue
      const tb = trackBounds(s.track.data)
      if (!tb) continue
      const sb = L.latLngBounds([tb.south, tb.west], [tb.north, tb.east])
      b = b ? b.extend(sb) : sb
    }
    return b
  }

  /** The selected track came into view only if it is wholly off the map (п. 3.9.4). */
  reveal(id: number): void {
    const b = this.bounds(id)
    if (b && !this.map.getBounds().intersects(b)) this.fit(id)
  }

  /** The whole track on the map: double click, C, View → Show on Map (п. 3.9.4). */
  fit(id: number, opts: { animate?: boolean; topLeft?: [number, number]; bottomRight?: [number, number] } = {}): void {
    const b = this.bounds(id)
    if (!b) return
    this.map.fitBounds(b, {
      paddingTopLeft: opts.topLeft ?? [40, 40],
      paddingBottomRight: opts.bottomRight ?? [40, 40],
      maxZoom: 17,
      ...(opts.animate === undefined ? {} : { animate: opts.animate })
    })
  }

  /**
   * The track view (п. 3.9.6) shows one track only: the others are hidden; null shows all again.
   */
  showOnly(id: number | null): void {
    this.only = id
    for (const s of this.shown.values()) {
      const visible = id === null || s.id === id
      for (const l of [...s.casings, ...s.lines, ...s.flags]) {
        if (visible && !this.map.hasLayer(l)) l.addTo(this.map)
        else if (!visible && this.map.hasLayer(l)) l.remove()
      }
    }
    if (id === null) {
      this.probe?.remove()
      this.probe = null
    }
  }

  /** A dot at a point of the track (the profile under the mouse in the track view); null hides it. */
  showProbe(p: { lat: number; lon: number } | null, color: string): void {
    if (!p) {
      this.probe?.remove()
      this.probe = null
      return
    }
    if (!this.probe) {
      this.probe = L.circleMarker([p.lat, p.lon], { pane: 'trackFlags', radius: 7, color: '#fff', weight: 2.5, fillColor: color, fillOpacity: 1, interactive: false }).addTo(this.map)
    } else this.probe.setLatLng([p.lat, p.lon])
  }

  get onlyId(): number | null {
    return this.only
  }
}
