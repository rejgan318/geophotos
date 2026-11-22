import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveLanguage } from '@shared/language'
import { listLanguages } from '../../src/main/locales'

describe('interface language (tz.md, п. 2.3)', () => {
  const have = ['en', 'ru', 'uk']

  it('a chosen language wins', () => {
    expect(resolveLanguage('uk', ['ru-RU'], have)).toBe('uk')
    expect(resolveLanguage('en', ['ru-RU'], have)).toBe('en')
  })

  it('"auto": the language of Windows if the program has it, else English', () => {
    expect(resolveLanguage('auto', ['ru-RU', 'en-US'], have)).toBe('ru')
    expect(resolveLanguage('auto', ['uk'], have)).toBe('uk')
    expect(resolveLanguage('auto', ['de-DE', 'uk-UA'], have)).toBe('uk')
    expect(resolveLanguage('auto', ['de-DE', 'fr-FR'], have)).toBe('en')
    expect(resolveLanguage('auto', [], have)).toBe('en')
  })

  it('Tools → Language lists the locale files, each named in itself', () => {
    expect(listLanguages(join(import.meta.dirname, '../../locales'))).toEqual([
      { code: 'en', name: 'English' },
      { code: 'ru', name: 'Русский' },
      { code: 'uk', name: 'Українська' }
    ])
  })
})
