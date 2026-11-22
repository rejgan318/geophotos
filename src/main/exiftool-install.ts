import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  EXIFTOOL_CHECKSUMS_URL,
  EXIFTOOL_VERSION_URL,
  exiftoolZipName,
  exiftoolZipUrl,
  parseExiftoolVersion,
  parseSha256
} from '@shared/exiftool-places'
import { exiftoolVersion } from './exiftool'

export interface InstallDeps {
  fetch: typeof fetch
  userAgent: string
  /** Bytes downloaded of the zip; total 0 when unknown. */
  onProgress?: (done: number, total: number) => void
  signal?: AbortSignal
  log: { info(msg: string): void }
}

/** tar of Windows (Windows 10 and later): it unpacks zip; by its full path, not by PATH. */
function tarPath(): string {
  return join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tar.exe')
}

function run(file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout: 120_000 }, (err, _out, stderr) => {
      if (err) reject(new Error(`${String(err)} ${stderr}`.trim()))
      else resolve()
    })
  })
}

async function getText(deps: InstallDeps, url: string): Promise<string> {
  const r = await deps.fetch(url, { headers: { 'User-Agent': deps.userAgent }, ...(deps.signal ? { signal: deps.signal } : {}) })
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`)
  return r.text()
}

async function download(deps: InstallDeps, url: string): Promise<Buffer> {
  const r = await deps.fetch(url, { headers: { 'User-Agent': deps.userAgent }, redirect: 'follow', ...(deps.signal ? { signal: deps.signal } : {}) })
  if (!r.ok || !r.body) throw new Error(`${url}: HTTP ${r.status}`)
  const total = Number(r.headers.get('content-length') ?? 0) || 0
  const chunks: Uint8Array[] = []
  let done = 0
  const reader = r.body.getReader()
  for (;;) {
    const { done: end, value } = await reader.read()
    if (end) break
    chunks.push(value)
    done += value.length
    deps.onProgress?.(done, total)
  }
  return Buffer.concat(chunks)
}

/**
 * Installs exiftool into `dir` (tz.md, п. 2.2): the latest version from exiftool.org, the Windows
 * zip checked against the SHA-256 of exiftool.org, `exiftool(-k).exe` as `exiftool.exe` and its
 * folder `exiftool_files`. Returns the path of exiftool.exe and its version; throws with the reason.
 */
export async function installExiftool(dir: string, deps: InstallDeps): Promise<{ path: string; version: string }> {
  const version = parseExiftoolVersion(await getText(deps, EXIFTOOL_VERSION_URL))
  if (!version) throw new Error(`No version in ${EXIFTOOL_VERSION_URL}`)
  const zipName = exiftoolZipName(version)
  const expected = parseSha256(await getText(deps, EXIFTOOL_CHECKSUMS_URL), zipName)
  if (!expected) throw new Error(`No SHA-256 of ${zipName} in ${EXIFTOOL_CHECKSUMS_URL}`)
  const url = exiftoolZipUrl(version)
  deps.log.info(`Installing exiftool ${version}: ${url} → ${dir}`)

  const zip = await download(deps, url)
  const actual = createHash('sha256').update(zip).digest('hex')
  if (actual !== expected) throw new Error(`The checksum of ${zipName} does not match (${actual}, expected ${expected})`)

  const tmp = await mkdtemp(join(tmpdir(), 'geophotos-exiftool-'))
  try {
    const zipPath = join(tmp, zipName)
    await writeFile(zipPath, zip)
    await run(tarPath(), ['-xf', zipPath, '-C', tmp])
    const src = join(tmp, zipName.replace(/\.zip$/, ''))
    const exe = join(src, 'exiftool(-k).exe')
    const files = join(src, 'exiftool_files')
    if (!existsSync(exe) || !existsSync(files)) throw new Error(`Unexpected contents of ${zipName}`)
    await mkdir(dir, { recursive: true })
    const target = join(dir, 'exiftool.exe')
    await rm(join(dir, 'exiftool_files'), { recursive: true, force: true })
    await cp(files, join(dir, 'exiftool_files'), { recursive: true })
    await copyFile(exe, target)
    const runs = await exiftoolVersion(target)
    deps.log.info(`exiftool ${runs} installed: ${target}`)
    return { path: target, version: runs }
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {})
  }
}

/** Whether files can be created in a folder (the folder of the program may be read-only). */
export async function canWriteIn(dir: string): Promise<boolean> {
  const probe = join(dir, `.geophotos-write-test-${process.pid}`)
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(probe, '')
    await rm(probe, { force: true })
    return true
  } catch {
    return false
  }
}
