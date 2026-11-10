import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'jsonc-parser'
import type { Strings } from '@shared/i18n'

export const FALLBACK_LANGUAGE = 'en'

function readStrings(file: string): Strings {
  return parse(readFileSync(file, 'utf8')) as Strings
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
