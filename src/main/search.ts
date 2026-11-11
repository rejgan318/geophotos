import { net } from 'electron'
import { parsePlaces, searchUrl, type SearchResult } from '@shared/search'
import { throttled } from './throttle'

/**
 * Place search through Nominatim (tz.md, п. 5.3): at most one request per second (shared with
 * the addresses when they go to the same server, п. 5.5), the program names itself in User-Agent.
 */
export class PlaceSearch {
  constructor(
    private readonly baseUrl: string,
    private readonly userAgent: string,
    private readonly language: string
  ) {}

  search(query: string): Promise<SearchResult> {
    const url = searchUrl(this.baseUrl, query)
    return throttled(url, 1000, async () => {
      try {
        const res = await net.fetch(url, {
          headers: { 'User-Agent': this.userAgent, 'Accept-Language': this.language },
          signal: AbortSignal.timeout(15000)
        })
        if (!res.ok) return { ok: false, error: `HTTP ${res.status} ${res.statusText}`.trim() }
        return { ok: true, places: parsePlaces(await res.json()) }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    })
  }
}
