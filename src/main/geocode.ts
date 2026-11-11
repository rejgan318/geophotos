import { net } from 'electron'
import { parseAddress, reverseUrl } from '@shared/geocode'
import type { Address, LatLon } from '@shared/photo'
import { throttled } from './throttle'

export type ReverseResult = { ok: true; address: Address | null } | { ok: false; error: string }

/**
 * The address of a point from Nominatim (tz.md, п. 5.5), at most one request per interval
 * (shared with the place search on the same server); the program names itself in User-Agent.
 */
export class Geocoder {
  constructor(
    private readonly baseUrl: string,
    private readonly userAgent: string,
    private readonly language: string,
    readonly intervalMs: number
  ) {}

  reverse(c: LatLon): Promise<ReverseResult> {
    const url = reverseUrl(this.baseUrl, c, this.language)
    return throttled(url, this.intervalMs, async () => {
      try {
        const res = await net.fetch(url, { headers: { 'User-Agent': this.userAgent }, signal: AbortSignal.timeout(15000) })
        if (!res.ok) return { ok: false, error: `HTTP ${res.status} ${res.statusText}`.trim() }
        return { ok: true, address: parseAddress(await res.json()) }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    })
  }
}
