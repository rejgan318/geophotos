/**
 * The interface language (tz.md, п. 2.3): the one of the settings, or with "auto" (nothing chosen
 * yet) the language of Windows if the program has it, else English.
 */
export const AUTO_LANGUAGE = 'auto'

export function resolveLanguage(setting: string, systemLanguages: readonly string[], available: readonly string[]): string {
  if (setting !== AUTO_LANGUAGE) return setting
  const have = new Set(available.map((l) => l.toLowerCase()))
  for (const s of systemLanguages) {
    const full = s.toLowerCase()
    if (have.has(full)) return available.find((l) => l.toLowerCase() === full)!
    const primary = full.split(/[-_]/)[0]!
    if (have.has(primary)) return available.find((l) => l.toLowerCase() === primary)!
  }
  return 'en'
}
