/** How long to wait for an answer of a data service (addresses, altitudes), ms. */
export const REQUEST_TIMEOUT_MS = 20_000

/**
 * Requests to one server, one at a time and at most one per interval (tz.md, пп. 5.3, 5.5:
 * Nominatim allows one request per second). Place search and addresses go to the same server,
 * so they share the limit: it is kept per server address (origin).
 */
const servers = new Map<string, { last: number | null; chain: Promise<unknown>; interval: number }>()

export function throttled<T>(url: string, intervalMs: number, request: () => Promise<T>): Promise<T> {
  const origin = new URL(url).origin
  let s = servers.get(origin)
  if (!s) servers.set(origin, (s = { last: null, chain: Promise.resolve(), interval: intervalMs }))
  // Two users of one server: the longer interval holds.
  s.interval = Math.max(s.interval, intervalMs)
  const server = s
  const run = server.chain.then(async () => {
    const wait = server.last === null ? 0 : Math.max(0, server.last + server.interval - Date.now())
    if (wait) await new Promise((r) => setTimeout(r, wait))
    server.last = Date.now()
    return request()
  })
  server.chain = run.catch(() => undefined)
  return run
}
