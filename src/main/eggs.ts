import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { eggCode, eggTitle, validEggs, type Egg, type EggForMap } from '@shared/eggs'
import { THUMB_SCHEME } from '@shared/ipc'

/**
 * The easter eggs (tz.md, п. 9.3) from `eggs/` of the program: the coded list and photos made by
 * scripts/make-eggs.mjs. No folder or a broken list — no eggs, the program works as usual.
 */
export class Eggs {
  private readonly list: Egg[]

  constructor(private readonly dir: string) {
    const file = join(dir, 'eggs.bin')
    let list: Egg[] = []
    if (existsSync(file)) {
      try {
        list = validEggs(JSON.parse(new TextDecoder().decode(eggCode(readFileSync(file)))))
      } catch {
        list = []
      }
    }
    this.list = list
  }

  get count(): number {
    return this.list.length
  }

  has(id: number): boolean {
    return this.list.some((e) => e.id === id)
  }

  /** The eggs for the window, named in its language. */
  forMap(language: string): EggForMap[] {
    return this.list.map((e) => ({ id: e.id, lat: e.lat, lon: e.lon, title: eggTitle(e.title, language), url: eggUrl(e.id) }))
  }

  /** The photo of the egg, decoded; null if there is none. */
  photo(id: number): Uint8Array | null {
    const egg = this.list.find((e) => e.id === id)
    if (!egg) return null
    try {
      return eggCode(readFileSync(join(this.dir, egg.file)))
    } catch {
      return null
    }
  }
}

/** The photo of an egg is served by the thumbnail scheme, on its own host. */
export function eggUrl(id: number): string {
  return `${THUMB_SCHEME}://egg/${id}`
}

export function parseEggUrl(url: string): number | null {
  const m = /^thumb:\/\/egg\/(\d+)\/?$/.exec(url)
  return m ? Number(m[1]) : null
}
