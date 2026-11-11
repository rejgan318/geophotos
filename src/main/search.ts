import { net } from 'electron'
import { parsePlaces, searchUrl, waitBeforeRequest, type SearchResult } from '@shared/search'

/**
 * Place search through Nominatim (tz.md, п. 5.3): at most one request per second,
 * the program names itself in User-Agent.
 */
export class PlaceSearch {
  private lastStart: number | null = null
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly baseUrl: string,
    private readonly userAgent: string,
    private readonly language: string
  ) {}

  search(query: string): Promise<SearchResult> {
    const run = this.queue.then(() => this.request(query))
    this.queue = run.catch(() => undefined)
    return run
  }

  private async request(query: string): Promise<SearchResult> {
    const wait = waitBeforeRequest(this.lastStart, Date.now())
    if (wait) await new Promise((r) => setTimeout(r, wait))
    this.lastStart = Date.now()
    try {
      const res = await net.fetch(searchUrl(this.baseUrl, query), {
        headers: { 'User-Agent': this.userAgent, 'Accept-Language': this.language },
        signal: AbortSignal.timeout(15000)
      })
      if (!res.ok) return { ok: false, error: `HTTP ${res.status} ${res.statusText}`.trim() }
      return { ok: true, places: parsePlaces(await res.json()) }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
}
