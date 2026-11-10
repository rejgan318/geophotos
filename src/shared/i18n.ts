/** Interface texts of one language: key → text with {name} placeholders (tz.md, п. 2.3). */
export type Strings = Record<string, string>

export type Translate = (key: string, params?: Record<string, string | number>) => string

export function makeTranslate(strings: Strings): Translate {
  return (key, params) => {
    const text = strings[key]
    if (text === undefined) return key
    if (!params) return text
    return text.replace(/\{(\w+)\}/g, (m, name: string) =>
      name in params ? String(params[name]) : m
    )
  }
}
