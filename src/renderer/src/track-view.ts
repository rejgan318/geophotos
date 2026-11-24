import type { Translate } from '@shared/i18n'
import type { TrackForMap } from '@shared/ipc'
import { durationText } from '@shared/photo'
import { profile, trackStats, type TrackPoint } from '@shared/track'
import { distanceText, numberText, speedText, trackTime } from './describe'

/**
 * The track view (tz.md, п. 3.9.6): over the dimmed, still map — the summary at the top left and
 * the profile at the bottom (altitude, and heart rate under it when the track has them).
 * The mouse over the profile shows the values there and a dot at that place of the track.
 */
export class TrackSummaryView {
  private readonly stats: HTMLElement
  private readonly chart: HTMLElement
  private resize: ResizeObserver
  private shown: { name: string; track: TrackForMap; color: string } | null = null

  constructor(
    private readonly host: HTMLElement,
    private readonly t: Translate,
    /** The place under the mouse on the profile; null — the mouse left it. */
    private readonly onProbe: (p: TrackPoint | null, color: string) => void
  ) {
    this.stats = document.createElement('div')
    this.stats.className = 'track-stats'
    this.chart = document.createElement('div')
    this.chart.className = 'track-profile'
    this.stats.hidden = true
    this.chart.hidden = true
    host.append(this.stats, this.chart)
    this.resize = new ResizeObserver(() => {
      if (this.shown) this.drawProfile()
    })
    this.resize.observe(host)
  }

  get visible(): boolean {
    return this.shown !== null
  }

  /**
   * Room the panels take on the map, px: the track is fitted into the rest (left of and above
   * the summary is free, so it takes the width at the left; the profile takes the bottom).
   */
  margins(): { topLeft: [number, number]; bottomRight: [number, number] } {
    const host = this.host.getBoundingClientRect()
    const s = this.stats.hidden ? null : this.stats.getBoundingClientRect()
    const c = this.chart.hidden ? null : this.chart.getBoundingClientRect()
    // The summary is narrow and tall: beside it, unless it would leave too little room.
    const left = s && s.width < host.width * 0.45 ? s.right - host.left + 20 : 30
    const bottom = c ? host.bottom - c.top + 20 : 30
    return { topLeft: [left, 30], bottomRight: [30, bottom] }
  }

  show(name: string, track: TrackForMap, color: string): void {
    this.shown = { name, track, color }
    this.fillStats()
    this.stats.hidden = false
    this.drawProfile()
  }

  hide(): void {
    this.shown = null
    this.stats.hidden = true
    this.chart.hidden = true
    this.onProbe(null, '')
  }

  private fillStats(): void {
    if (!this.shown) return
    const { name, track } = this.shown
    const t = this.t
    const s = trackStats(track.data)
    const rows: [string, string][] = []
    if (s.start !== null) rows.push([t('track.start'), trackTime(s.start, track.zone)])
    if (s.end !== null) rows.push([t('track.end'), trackTime(s.end, track.zone)])
    rows.push([t('track.distance'), distanceText(s.distance, t)])
    if (s.duration !== null) rows.push([t('track.duration'), durationText(s.duration)])
    if (s.moving !== null) rows.push([t('track.moving'), durationText(s.moving)])
    if (s.stops) rows.push([t('track.stops'), s.stops.count ? t('track.stopsValue', { count: s.stops.count, time: durationText(s.stops.seconds) }) : t('track.none')])
    if (s.avgSpeed !== null) rows.push([t('track.avgSpeed'), speedText(s.avgSpeed, t)])
    if (s.maxSpeed !== null) rows.push([t('track.maxSpeed'), speedText(s.maxSpeed, t)])
    if (s.ascent !== null && s.descent !== null) {
      rows.push([t('track.climb'), `↑ ${t('unit.m', { n: numberText(s.ascent, t) })}   ↓ ${t('unit.m', { n: numberText(s.descent, t) })}`])
    }
    if (s.minEle !== null && s.maxEle !== null) {
      rows.push([t('track.elevation'), `${t('unit.m', { n: numberText(s.minEle, t) })} – ${t('unit.m', { n: numberText(s.maxEle, t) })}`])
    }
    if (s.hrAvg !== null && s.hrMax !== null) {
      rows.push([t('track.hr'), t('track.hrValue', { avg: numberText(s.hrAvg, t), max: numberText(s.hrMax, t) })])
    }
    rows.push([t('track.pointCount'), numberText(s.points, t)])
    if (s.waypoints) rows.push([t('track.waypointCount'), numberText(s.waypoints, t)])
    if (track.data.creator) rows.push([t('track.creator'), track.data.creator])

    const title = document.createElement('div')
    title.className = 'ts-title'
    title.textContent = track.data.name && track.data.name !== name ? `${track.data.name} — ${name}` : name
    const table = document.createElement('dl')
    for (const [k, v] of rows) {
      const dt = document.createElement('dt')
      dt.textContent = k
      const dd = document.createElement('dd')
      dd.textContent = v
      table.append(dt, dd)
    }
    this.stats.replaceChildren(title, table)
  }

  /** Altitude by distance; heart rate (or else speed) under it when the track has them. */
  private drawProfile(): void {
    if (!this.shown) return
    const { track, color } = this.shown
    const all = profile(track.data)
    const series: { key: 'ele' | 'hr'; label: string; color: string; value: (p: TrackPoint) => number | null; text: (v: number) => string }[] = []
    const t = this.t
    if (all.some((x) => x.p.ele !== null)) {
      series.push({ key: 'ele', label: t('track.elevation'), color, value: (p) => p.ele, text: (v) => t('unit.m', { n: numberText(v, t) }) })
    }
    // Only altitude and heart rate (the user's choice): speed is in the summary and the tooltip.
    if (all.some((x) => x.p.hr !== undefined)) {
      series.push({ key: 'hr', label: t('track.hr'), color: '#ff5c7a', value: (p) => p.hr ?? null, text: (v) => `♥ ${numberText(v, t)}` })
    }
    if (!series.length || all.length < 2) {
      this.chart.hidden = true
      return
    }
    this.chart.hidden = false
    const W = Math.max(200, this.chart.clientWidth || this.host.clientWidth - 40)
    const rowH = 70
    const H = rowH * series.length
    const total = all.at(-1)!.at || 1
    const x = (at: number): number => (at / total) * W
    const NS = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(NS, 'svg')
    svg.setAttribute('width', String(W))
    svg.setAttribute('height', String(H))
    // At most ~1 point per pixel: long tracks have many more.
    const step = Math.max(1, Math.floor(all.length / W))
    const pts = all.filter((_, i) => i % step === 0 || i === all.length - 1)
    series.forEach((s, row) => {
      const vals = pts.map((x) => s.value(x.p)).filter((v): v is number => v !== null)
      if (!vals.length) return
      let lo = Infinity
      let hi = -Infinity
      for (const v of vals) {
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
      if (hi - lo < 1) hi = lo + 1
      const top = row * rowH + 14
      const bottom = row * rowH + rowH - 4
      const y = (v: number): number => bottom - ((v - lo) / (hi - lo)) * (bottom - top)
      const line = pts.flatMap((q) => {
        const v = s.value(q.p)
        return v === null ? [] : [`${x(q.at).toFixed(1)},${y(v).toFixed(1)}`]
      })
      const area = document.createElementNS(NS, 'path')
      area.setAttribute('d', `M${line[0]!.split(',')[0]},${bottom} L${line.join(' L')} L${line.at(-1)!.split(',')[0]},${bottom} Z`)
      area.setAttribute('fill', s.color)
      area.setAttribute('fill-opacity', '0.25')
      const path = document.createElementNS(NS, 'polyline')
      path.setAttribute('points', line.join(' '))
      path.setAttribute('fill', 'none')
      path.setAttribute('stroke', s.color)
      path.setAttribute('stroke-width', '2')
      const label = document.createElementNS(NS, 'text')
      label.setAttribute('x', '4')
      label.setAttribute('y', String(row * rowH + 11))
      label.setAttribute('class', 'tp-label')
      label.textContent = `${s.label}: ${s.text(lo)} – ${s.text(hi)}`
      svg.append(area, path, label)
    })
    const cursor = document.createElementNS(NS, 'line')
    cursor.setAttribute('y1', '0')
    cursor.setAttribute('y2', String(H))
    cursor.setAttribute('class', 'tp-cursor')
    cursor.style.display = 'none'
    svg.append(cursor)
    const readout = document.createElement('div')
    readout.className = 'tp-readout'
    readout.hidden = true

    svg.addEventListener('mousemove', (e) => {
      const r = svg.getBoundingClientRect()
      const at = ((e.clientX - r.left) / W) * total
      // The point at this distance (binary search: distances only grow).
      let lo = 0
      let hi = all.length - 1
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (all[mid]!.at < at) lo = mid + 1
        else hi = mid
      }
      const q = all[lo]!
      const px = x(q.at)
      cursor.setAttribute('x1', String(px))
      cursor.setAttribute('x2', String(px))
      cursor.style.display = ''
      const parts = [distanceText(q.at, t)]
      if (q.p.t !== null) parts.push(trackTime(q.p.t, track.zone, 'time'))
      for (const s of series) {
        const v = s.value(q.p)
        if (v !== null) parts.push(s.text(v))
      }
      readout.textContent = parts.join(' · ')
      readout.hidden = false
      readout.style.left = `${Math.min(px + 8, W - 220)}px`
      this.onProbe(q.p, color)
    })
    svg.addEventListener('mouseleave', () => {
      cursor.style.display = 'none'
      readout.hidden = true
      this.onProbe(null, color)
    })
    this.chart.replaceChildren(svg, readout)
  }
}
