import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'jsonc-parser'
import type { Strings } from '@shared/i18n'

export const FALLBACK_LANGUAGE = 'en'

function readStrings(file: string): Strings {
  return parse(readFileSync(file, 'utf8')) as Strings
}

/**
 * The languages there are files for (tz.md, п. 2.3), each named in itself ("language.name":
 * "Русский"), for Tools → Language. A new language is a new file.
 */
export function listLanguages(localesDir: string): { code: string; name: string }[] {
  const list: { code: string; name: string }[] = []
  for (const file of readdirSync(localesDir).filter((f) => f.endsWith('.json')).sort()) {
    const code = file.slice(0, -'.json'.length)
    try {
      const name = readStrings(join(localesDir, file))['language.name']
      list.push({ code, name: typeof name === 'string' && name ? name : code })
    } catch {
      // A broken file is not offered.
    }
  }
  return list
}

/**
 * Texts of the chosen language on top of English, so a missing key shows English text.
 * `missing` is true when the language file does not exist.
 */
export function loadStrings(localesDir: string, language: string): { strings: Strings; missing: boolean } {
  const fallback = readStrings(join(localesDir, `${FALLBACK_LANGUAGE}.json`))
  if (language === FALLBACK_LANGUAGE) return { strings: fallback, missing: false }
  const file = join(localesDir, `${language}.json`)
  if (!existsSync(file)) return { strings: fallback, missing: true }
  return { strings: { ...fallback, ...readStrings(file) }, missing: false }
}
