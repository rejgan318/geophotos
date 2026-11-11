import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parse, type ParseError } from 'jsonc-parser'
import { afterEach, describe, expect, it } from 'vitest'
import { makeTranslate } from '@shared/i18n'
import { mapSources, mergeSettings, type Settings } from '@shared/settings'
import { ensureUserSettingsFile, loadSettings, setUserSetting } from '../../src/main/settings'
import { helpTextKeys } from '../../src/renderer/src/help-content'

const root = resolve(import.meta.dirname, '../..')
const defaultsPath = join(root, 'config', 'settings.json')
const schemaPath = join(root, 'schemas', 'settings.schema.json')

let tmp: string | undefined
function userFile(text: string | null): string {
  tmp = mkdtempSync(join(tmpdir(), 'geophotos-settings-'))
  const file = join(tmp, 'settings.json')
  if (text !== null) writeFileSync(file, text)
  return file
}
afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true })
  tmp = undefined
})

const load = (text: string | null) => loadSettings({ defaults: defaultsPath, schema: schemaPath, user: userFile(text) })

describe('mergeSettings (tz.md, п. 8.3)', () => {
  it('overlays objects field by field, replaces other values', () => {
    const def = { a: 1, o: { x: 1, y: 2 }, list: [1, 2] }
    expect(mergeSettings(def, { o: { y: 3 }, list: [9] })).toEqual({ a: 1, o: { x: 1, y: 3 }, list: [9] })
    expect(mergeSettings(def, { $schema: 'x' })).toEqual(def)
    expect(def.o.y).toBe(2)
  })
})

describe('config files (tz-config.md)', () => {
  it('defaults are valid and complete: every schema field has a value', () => {
    const { settings, userProblems } = load(null)
    expect(userProblems).toEqual([])
    const schema = parse(readFileSync(schemaPath, 'utf8'))
    const check = (props: Record<string, { properties?: object }>, value: Record<string, unknown>, path: string): void => {
      for (const [key, sub] of Object.entries(props)) {
        if (key === '$schema') continue
        expect(value, `${path}${key}`).toHaveProperty(key)
        if (sub.properties) check(sub.properties as never, value[key] as never, `${path}${key}.`)
      }
    }
    check(schema.properties, settings as never, '')
  })

  it('user file changes only its fields', () => {
    const { settings, userProblems } = load(`{
      // comment
      "language": "ru",
      "map": { "tileSources": { "google": { "maxZoom": 18 } } },
    }`)
    expect(userProblems).toEqual([])
    expect(settings.language).toBe('ru')
    expect(settings.map.tileSources['google']?.maxZoom).toBe(18)
    expect(settings.map.tileSources['google']?.url).toContain('google.com')
    expect(settings.map.tileSources['osm']?.url).toContain('openstreetmap')
    // A source added in a new version reaches an older user file (tz.md, п. 5.1).
    expect(mapSources(settings).sources.at(-1)?.key).toBe('topo')
  })

  it('invalid user file: problems with file, field, reason; defaults used (п. 8.4)', () => {
    const { settings, userProblems } = load('{ "map": { "initialView": { "zoom": 99 } }, "lnguage": "ru" }')
    expect(settings.language).toBe('en')
    expect(settings.map.initialView.zoom).toBe(5)
    const fields = userProblems.map((p) => p.field)
    expect(fields).toContain('map.initialView.zoom')
    expect(fields).toContain('lnguage')
    expect(userProblems.every((p) => p.file.endsWith('settings.json') && p.reason)).toBe(true)
  })

  it('syntax error is reported with line and column', () => {
    const { settings, userProblems } = load('{\n  "language": "ru"\n  "exiftoolPath": "x"\n}')
    expect(settings.language).toBe('en')
    expect(userProblems[0]?.field).toMatch(/^line 3, column/)
  })

  it('created user file: all fields with defaults and comments, valid (tz-config.md, п. 6.3)', () => {
    const file = userFile(null)
    expect(ensureUserSettingsFile(file, schemaPath, defaultsPath)).toBe(true)
    const text = readFileSync(file, 'utf8')
    if (process.env['SHOW_SETTINGS_FILE']) writeFileSync(process.env['SHOW_SETTINGS_FILE'], text)

    const value = parse(text)
    expect(value.$schema).toMatch(/^file:\/\/\/.*settings\.schema\.json$/)
    const { settings, userProblems } = loadSettings({ defaults: defaultsPath, schema: schemaPath, user: file })
    expect(userProblems).toEqual([])
    const { $schema: _s, ...rest } = value
    expect(rest).toEqual(Object.fromEntries(Object.entries(load(null).settings).filter(([k]) => k !== '$schema')))
    expect(settings.language).toBe('en')

    // Comments: header first, a description above fields, allowed values and ranges.
    expect(text.indexOf('// GeoPhotos user settings')).toBeLessThan(text.indexOf('"$schema"'))
    expect(text).toMatch(/\/\/ Interface language[^\n]*\n(\s*\/\/[^\n]*\n)*\s*"language"/)
    expect(text).toContain('// Allowed: error, warn, info, verbose, debug.')
    expect(text).toContain('// Range: 0 to 22.')
    // Tile source fields are explained once, not for every source.
    expect(text.match(/Tile address template/g)).toHaveLength(1)
    // …but a field that first appears in a later source is explained there.
    expect(text).toMatch(/\/\/ Characters substituted for \{s\}[^\n]*\n\s*"subdomains"/)
  })

  it('user file with fields is never overwritten; one with only $schema is recreated', () => {
    const file = userFile('{ "language": "ru" }')
    expect(ensureUserSettingsFile(file, schemaPath, defaultsPath)).toBe(false)
    expect(readFileSync(file, 'utf8')).toBe('{ "language": "ru" }')
    writeFileSync(file, '{\n  "$schema": "file:///x.json"\n  // old comment\n}')
    expect(ensureUserSettingsFile(file, schemaPath, defaultsPath)).toBe(true)
    expect(parse(readFileSync(file, 'utf8')).language).toBe('en')
  })

  it('the program sets a field of the user file, keeping comments (tz.md, п. 3.2; tz-config.md, п. 5)', () => {
    const file = userFile('{\r\n  // my note\r\n  "language": "ru"\r\n}\r\n')
    setUserSetting(file, schemaPath, defaultsPath, ['folders', 'subfolders'], 'yes')
    const text = readFileSync(file, 'utf8')
    expect(text).toContain('// my note')
    expect(text).not.toMatch(/[^\r]\n/)
    expect(parse(text)).toEqual({ language: 'ru', folders: { subfolders: 'yes' } })
    expect(load(text).settings.folders.subfolders).toBe('yes')
  })

  it('setting a field without a user file creates the full file first', () => {
    const file = userFile(null)
    setUserSetting(file, schemaPath, defaultsPath, ['folders', 'subfolders'], 'no')
    const value = parse(readFileSync(file, 'utf8'))
    expect(value.folders.subfolders).toBe('no')
    expect(value.language).toBe('en')
  })

  it('tile sources without url are skipped', () => {
    const s = load(null).settings
    const custom: Settings = { ...s, map: { ...s.map, tileSources: { ...s.map.tileSources, bad: { name: 'x' } } } }
    const { sources, skipped } = mapSources(custom)
    expect(sources.map((x) => x.key)).toEqual(['osm', 'esri', 'google', 'topo'])
    expect(skipped).toEqual(['bad'])
  })
})

describe('localization (tz.md, п. 2.3)', () => {
  const dir = join(root, 'locales')
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'))

  it('all languages have the same keys', () => {
    const en = Object.keys(parse(readFileSync(join(dir, 'en.json'), 'utf8'))).sort()
    expect(files.length).toBeGreaterThanOrEqual(2)
    for (const f of files) {
      expect(Object.keys(parse(readFileSync(join(dir, f), 'utf8'))).sort(), f).toEqual(en)
    }
  })

  it('language files have no syntax errors (a tolerant parse would hide them)', () => {
    for (const f of files) {
      const errors: ParseError[] = []
      parse(readFileSync(join(dir, f), 'utf8'), errors)
      expect(errors, f).toEqual([])
    }
  })

  it('every text of Help → Keyboard Shortcuts is in every language', () => {
    for (const f of files) {
      const strings = parse(readFileSync(join(dir, f), 'utf8')) as Record<string, string>
      for (const key of helpTextKeys()) expect(strings[key], `${f}: ${key}`).toBeTruthy()
    }
  })

  it('placeholders are substituted', () => {
    const t = makeTranslate({ a: 'Total: {n} of {m}' })
    expect(t('a', { n: 1, m: 2 })).toBe('Total: 1 of 2')
    expect(t('missing')).toBe('missing')
  })
})
