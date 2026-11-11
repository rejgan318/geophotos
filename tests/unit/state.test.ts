import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { addRecent, removeRecent, samePath } from '@shared/recent'
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

const NIGHT = 'T:\\MyMedia\\Фото\\Харьков\\20210708 Ночной поход'

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

describe('state between runs (tz.md, п. 7.5)', () => {
  it('recent folders survive a restart, including non-Latin paths', () => {
    const file = stateFile()
    writeState(file, { recentFolders: [NIGHT, 'D:\\a'], lastSession: null })
    expect(readState(file)).toEqual({ recentFolders: [NIGHT, 'D:\\a'], lastSession: null })
    expect(existsSync(`${file}.tmp`)).toBe(false)
  })

  it('missing or broken file: default state', () => {
    const file = stateFile()
    expect(readState(file)).toEqual({ recentFolders: [], lastSession: null })
    writeFileSync(file, '{ broken')
    expect(readState(file)).toEqual({ recentFolders: [], lastSession: null })
    writeFileSync(file, '{ "recentFolders": [5, "", "D:\\\\ok"] }')
    expect(readState(file)).toEqual({ recentFolders: ['D:\\ok'], lastSession: null })
  })

  it('the old single last folder is picked up', () => {
    const file = stateFile()
    writeFileSync(file, JSON.stringify({ lastFolder: 'D:\\old' }))
    expect(readState(file)).toEqual({ recentFolders: ['D:\\old'], lastSession: null })
  })

  it('the folder and photo of the last session survive a restart (п. 7.1)', () => {
    const file = stateFile()
    const lastSession = { folder: NIGHT, photo: `${NIGHT}\\IMG_0001.CR2` }
    writeState(file, { recentFolders: [NIGHT], lastSession })
    expect(readState(file)).toEqual({ recentFolders: [NIGHT], lastSession })
    writeFileSync(file, JSON.stringify({ lastSession: { folder: 'D:\\x', photo: 5 } }))
    expect(readState(file).lastSession).toEqual({ folder: 'D:\\x', photo: null })
    writeFileSync(file, JSON.stringify({ lastSession: { photo: 'D:\\x\\a.jpg' } }))
    expect(readState(file).lastSession).toBeNull()
  })

  it('is plain JSON', () => {
    const file = stateFile()
    writeState(file, { recentFolders: ['D:\\a "quoted" path'], lastSession: null })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ recentFolders: ['D:\\a "quoted" path'], lastSession: null })
  })
})
