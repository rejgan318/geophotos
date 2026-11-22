import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { installExiftool } from '../../src/main/exiftool-install'
import { tempDir } from './helpers'

// An installed exiftool for Windows (exe + exiftool_files) to pack into a zip like the official one.
const INSTALLED = join(process.env['LOCALAPPDATA'] ?? '', 'Programs', 'ExifTool')
const has = existsSync(join(INSTALLED, 'ExifTool.exe')) && existsSync(join(INSTALLED, 'exiftool_files'))
const TAR = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tar.exe')

/** A fetch that answers like exiftool.org and SourceForge, from memory; counts the requests. */
function fakeServer(zip: Buffer, sha: string): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input)
    if (url.endsWith('/ver.txt')) return new Response('99.1\n')
    if (url.endsWith('/checksums.txt')) return new Response(`SHA2-256(exiftool-99.1_64.zip)= ${sha}\n`)
    if (url.includes('exiftool-99.1_64.zip')) return new Response(new Uint8Array(zip), { headers: { 'content-length': String(zip.length) } })
    return new Response('not found', { status: 404 })
  }) as typeof fetch
}

describe.skipIf(!has)('installing exiftool for GeoPhotos (tz.md, п. 2.2)', () => {
  const tmp = tempDir()
  let zip: Buffer
  afterAll(() => tmp.remove())

  beforeAll(() => {
    // The layout of the official zip: exiftool-<v>_64/exiftool(-k).exe and exiftool_files.
    const src = join(tmp.dir, 'src', 'exiftool-99.1_64')
    mkdirSync(src, { recursive: true })
    cpSync(join(INSTALLED, 'ExifTool.exe'), join(src, 'exiftool(-k).exe'))
    cpSync(join(INSTALLED, 'exiftool_files'), join(src, 'exiftool_files'), { recursive: true })
    const zipPath = join(tmp.dir, 'exiftool-99.1_64.zip')
    execFileSync(TAR, ['-a', '-cf', zipPath, '-C', join(tmp.dir, 'src'), 'exiftool-99.1_64'])
    zip = readFileSync(zipPath)
  }, 120_000)

  const deps = (f: typeof fetch) => ({ fetch: f, userAgent: 'GeoPhotos-test', log: { info: () => {} } })

  it('downloads, checks, unpacks and renames; exiftool runs', async () => {
    const dir = join(tmp.dir, 'GeoPhotos')
    const progress: number[] = []
    const sha = createHash('sha256').update(zip).digest('hex')
    const res = await installExiftool(dir, { ...deps(fakeServer(zip, sha)), onProgress: (d) => progress.push(d) })
    expect(res.path).toBe(join(dir, 'exiftool.exe'))
    expect(res.version).toMatch(/^\d+\.\d+$/)
    expect(existsSync(join(dir, 'exiftool_files'))).toBe(true)
    expect(existsSync(join(dir, 'exiftool(-k).exe'))).toBe(false)
    expect(progress.at(-1)).toBe(zip.length)
  }, 120_000)

  it('a zip whose checksum does not match is not unpacked', async () => {
    const dir = join(tmp.dir, 'Bad')
    await expect(installExiftool(dir, deps(fakeServer(zip, '0'.repeat(64))))).rejects.toThrow(/checksum/)
    expect(existsSync(join(dir, 'exiftool.exe'))).toBe(false)
  }, 120_000)

  it('no checksum for the version: nothing is downloaded', async () => {
    const f = (async (input: string | URL | Request) =>
      String(input).endsWith('/ver.txt') ? new Response('99.2') : new Response('nothing')) as typeof fetch
    await expect(installExiftool(join(tmp.dir, 'None'), deps(f))).rejects.toThrow(/No SHA-256/)
  })
})
