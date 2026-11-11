import { net } from 'electron'
import { elevationUrl, parseElevations } from '@shared/elevation'
import type { LatLon } from '@shared/photo'
import { throttled } from './throttle'

export type ElevationResult = { ok: true; values: (number | null)[] } | { ok: false; error: string }

/**
 * Altitudes of points from the Open-Meteo Elevation API (tz.md, п. 5.6): up to 100 points per
 * request, at most one request per second (the free service allows 600 a minute).
 */
export class ElevationService {
  constructor(
    private readonly baseUrl: string,
    private readonly userAgent: string
  ) {}

  get(points: readonly LatLon[]): Promise<ElevationResult> {
    const url = elevationUrl(this.baseUrl, points)
    return throttled(url, 1000, async () => {
      try {
        const res = await net.fetch(url, { headers: { 'User-Agent': this.userAgent }, signal: AbortSignal.timeout(15000) })
        if (!res.ok) return { ok: false, error: `HTTP ${res.status} ${res.statusText}`.trim() }
        const values = parseElevations(await res.json(), points.length)
        return values ? { ok: true, values } : { ok: false, error: 'unexpected answer' }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    })
  }
}
