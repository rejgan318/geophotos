/**
 * Points whose address or altitude did not come (tz.md, пп. 5.5, 5.6). A point the service could
 * not answer (an error, a timeout) is asked again in the background, later and later; after the
 * last try, and for a point that simply has no address (the sea), it is not asked again until the
 * folder is opened again or the mode is turned on again.
 */
export const RETRY_DELAYS_MS: readonly number[] = [30_000, 120_000, 600_000]

interface Entry {
  tries: number
  /** Not to be asked before this moment, ms. */
  until: number
  /** Not to be asked again. */
  final: boolean
}

export class RetryBook {
  private readonly entries = new Map<string, Entry>()

  constructor(private readonly delays: readonly number[] = RETRY_DELAYS_MS) {}

  /** No answer this time: the point waits for its next try, or gives up after the last. */
  failed(key: string, now: number): void {
    const e = this.entries.get(key) ?? { tries: 0, until: 0, final: false }
    const delay = this.delays[e.tries]
    e.tries++
    if (delay === undefined) e.final = true
    else e.until = now + delay
    this.entries.set(key, e)
  }

  /** The service answered that there is nothing at the point: no more tries. */
  nothing(key: string): void {
    this.entries.set(key, { tries: 0, until: 0, final: true })
  }

  /** The point got its data after all. */
  done(key: string): void {
    this.entries.delete(key)
  }

  /** Points not to be asked now: given up, or waiting for their next try. */
  blocked(now: number): Set<string> {
    const keys = new Set<string>()
    for (const [k, e] of this.entries) if (e.final || e.until > now) keys.add(k)
    return keys
  }

  /** Points waiting for a next try (they will be asked later). */
  waiting(now: number): Set<string> {
    const keys = new Set<string>()
    for (const [k, e] of this.entries) if (!e.final && e.until > now) keys.add(k)
    return keys
  }

  /** When the next waiting point may be asked; null if none waits. */
  nextAt(now: number): number | null {
    let next: number | null = null
    for (const e of this.entries.values()) if (!e.final && e.until > now) next = next === null ? e.until : Math.min(next, e.until)
    return next
  }

  /** Points given up on: not to be asked any more. */
  finalKeys(): Set<string> {
    const keys = new Set<string>()
    for (const [k, e] of this.entries) if (e.final) keys.add(k)
    return keys
  }

  /** Points given up on. */
  isFinal(key: string): boolean {
    return this.entries.get(key)?.final === true
  }

  clear(): void {
    this.entries.clear()
  }
}
