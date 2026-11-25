import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { addRecent, idsByPath, removeRecent, samePath } from '@shared/recent'
import { readState, writeState } from '../../src/main/state'

let tmp: string | undefined
const stateFile = (): string => {
  tmp = mkdtempSync(join(tmpdir(), 'geophotos-state-'))
  return join(tmp, 'state.json')
}
afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true })
  tmp = undefined
})

const NIGHT = 'T:\\Медиа\\Фото\\2021-07 Поход в горы'

describe('recent folders (tz.md, п. 3.1)', () => {
  it('latest first, no duplicates (case and trailing slash ignored), at most 10', () => {
    let list: string[] = []
    for (let i = 0; i < 12; i++) list = addRecent(list, `D:\\f${i}`)
    expect(list).toHaveLength(10)
    expect(list[0]).toBe('D:\\f11')
    list = addRecent(list, 'd:\\F5\\')
    expect(list[0]).toBe('d:\\F5\\')
    expect(list.filter((f) => samePath(f, 'D:\\f5'))).toHaveLength(1)
    expect(removeRecent(list, 'D:\\F5')).not.toContain('d:\\F5\\')
  })
})

describe('File → Refresh keeps the selection by path (tz.md, п. 3.8)', () => {
  it('photos are found by path in the re-read folder; gone ones are left out', () => {
    const after = [
      { id: 0, path: 'D:\\Trip\\new.jpg' },
      { id: 1, path: 'D:\\Trip\\a.jpg' },
      { id: 2, path: 'D:\\Trip\\sub\\b.jpg' }
    ]
    expect(idsByPath(after, ['d:/trip/A.JPG', 'D:\\Trip\\sub\\b.jpg', 'D:\\Trip\\deleted.jpg'])).toEqual([1, 2])
    expect(idsByPath(after, [])).toEqual([])
  })
})

describe('state between runs (tz.md, п. 7.5)', () => {
  const NONE = { lastSession: null, window: null, map: null, tools: { address: false, altitude: false }, addFolder: null, stripPosition: 'bottom' as const }

  it('recent folders survive a restart, including non-Latin paths', () => {
    const file = stateFile()
    writeState(file, { recentFolders: [NIGHT, 'D:\\a'], ...NONE })
    expect(readState(file)).toEqual({ recentFolders: [NIGHT, 'D:\\a'], ...NONE })
    expect(existsSync(`${file}.tmp`)).toBe(false)
  })

  it('missing or broken file: default state', () => {
    const file = stateFile()
    expect(readState(file)).toEqual({ recentFolders: [], ...NONE })
    writeFileSync(file, '{ broken')
    expect(readState(file)).toEqual({ recentFolders: [], ...NONE })
    writeFileSync(file, '{ "recentFolders": [5, "", "D:\\\\ok"] }')
    expect(readState(file)).toEqual({ recentFolders: ['D:\\ok'], ...NONE })
  })

  it('the old single last folder is picked up', () => {
    const file = stateFile()
    writeFileSync(file, JSON.stringify({ lastFolder: 'D:\\old' }))
    expect(readState(file)).toEqual({ recentFolders: ['D:\\old'], ...NONE })
  })

  it('the folder, photo, strip scroll and subfolders choice of the last session survive a restart (пп. 7.1, 3.2)', () => {
    const file = stateFile()
    const lastSession = { folder: NIGHT, photo: `${NIGHT}\\IMG_0001.CR2`, scroll: 840, subfolders: true, added: [], removed: [] }
    writeState(file, { recentFolders: [NIGHT], ...NONE, lastSession })
    expect(readState(file)).toEqual({ recentFolders: [NIGHT], ...NONE, lastSession })
    // Files of earlier versions have no scroll, no subfolders choice, no added or removed files.
    writeFileSync(file, JSON.stringify({ lastSession: { folder: 'D:\\x', photo: 5 } }))
    expect(readState(file).lastSession).toEqual({ folder: 'D:\\x', photo: null, scroll: 0, subfolders: false, added: [], removed: [] })
    writeFileSync(file, JSON.stringify({ lastSession: { photo: 'D:\\x\\a.jpg' } }))
    expect(readState(file).lastSession).toBeNull()
  })

  it('the project survives a restart: added files, files taken off the strip, no folder (п. 3.1)', () => {
    const file = stateFile()
    const lastSession = {
      folder: NIGHT,
      photo: 'E:\\Phone\\a.jpg',
      scroll: 0,
      subfolders: false,
      added: ['E:\\Phone\\a.jpg', 'E:\\Phone\\b.heic'],
      removed: [`${NIGHT}\\IMG_0002.CR2`]
    }
    writeState(file, { recentFolders: [NIGHT], ...NONE, lastSession })
    expect(readState(file).lastSession).toEqual(lastSession)
    // Only added files: no folder, so nothing of a folder taken off.
    const only = { ...lastSession, folder: null, removed: [] }
    writeState(file, { recentFolders: [], ...NONE, lastSession: only })
    expect(readState(file).lastSession).toEqual(only)
    writeFileSync(file, JSON.stringify({ lastSession: { folder: null, added: [5, ''], removed: ['x'] } }))
    expect(readState(file).lastSession).toBeNull()
  })

  it('window, map place, tile source and thumbnail mode survive a restart (п. 7.1)', () => {
    const file = stateFile()
    const window = { x: -1200, y: 40, width: 1100, height: 700, maximized: true }
    const map = { lat: -33.85, lon: 151.21, zoom: 13, source: 'topo', thumbnails: true }
    const tools = { address: true, altitude: true }
    writeState(file, { recentFolders: [], lastSession: null, window, map, tools, addFolder: null, stripPosition: 'left' })
    expect(readState(file)).toEqual({ recentFolders: [], lastSession: null, window, map, tools, addFolder: null, stripPosition: 'left' })
  })

  it('broken window or map parts are dropped, the rest is kept', () => {
    const file = stateFile()
    writeFileSync(
      file,
      JSON.stringify({
        recentFolders: ['D:\\a'],
        window: { x: 1, y: 2, width: 'wide', height: 500 },
        map: { lat: 95, lon: 0, zoom: 3, source: 'osm' }
      })
    )
    expect(readState(file)).toEqual({ recentFolders: ['D:\\a'], ...NONE })
  })

  it('is plain JSON', () => {
    const file = stateFile()
    writeState(file, { recentFolders: ['D:\\a "quoted" path'], ...NONE })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ recentFolders: ['D:\\a "quoted" path'], ...NONE })
  })
})

describe('state: the folder of Add Files (tz.md, п. 3.1)', () => {
  it('survives a restart; missing in older files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'geophotos-state-'))
    try {
      const file = join(dir, 'state.json')
      writeState(file, { recentFolders: [], lastSession: null, window: null, map: null, tools: { address: false, altitude: false }, addFolder: 'E:\Phone', stripPosition: 'bottom' })
      expect(readState(file).addFolder).toBe('E:\Phone')
      writeFileSync(file, JSON.stringify({ recentFolders: [] }))
      expect(readState(file).addFolder).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('state: where the strip is (tz.md, п. 4.1)', () => {
  it('survives a restart; missing or unknown in older files: at the bottom', () => {
    const file = stateFile()
    writeFileSync(file, JSON.stringify({ recentFolders: [], stripPosition: 'left' }))
    expect(readState(file).stripPosition).toBe('left')
    writeFileSync(file, JSON.stringify({ recentFolders: [], stripPosition: 'top' }))
    expect(readState(file).stripPosition).toBe('bottom')
    writeFileSync(file, JSON.stringify({ recentFolders: [] }))
    expect(readState(file).stripPosition).toBe('bottom')
  })
})
