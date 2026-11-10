import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { ExifTool } from '../../src/main/exiftool'

/** Real test photos (make-project.md, п. 7); tests that need them are skipped if absent. */
export const MASTER_DIR =
  process.env['GEOPHOTOS_TEST_DIR'] ?? resolve(import.meta.dirname, '../../../data/geophotos-testdata/master')

export const hasMaster = existsSync(MASTER_DIR) && readdirSync(MASTER_DIR).length > 0

export const EXIFTOOL = process.env['GEOPHOTOS_EXIFTOOL'] ?? 'exiftool'

export function newExifTool(): ExifTool {
  return new ExifTool(EXIFTOOL)
}

/** A fresh temporary folder; removed by the returned function. */
export function tempDir(): { dir: string; remove: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'geophotos-test-'))
  return { dir, remove: () => rmSync(dir, { recursive: true, force: true }) }
}

/** Copies the master set: tests never touch the originals. */
export async function copyMaster(dir: string): Promise<void> {
  await cp(MASTER_DIR, dir, { recursive: true })
}

/** A small JPEG; metadata is then written by exiftool. */
export async function makeJpeg(path: string): Promise<void> {
  await sharp({ create: { width: 64, height: 48, channels: 3, background: '#4080c0' } })
    .jpeg()
    .toFile(path)
}

/** Writes tags with exiftool, without leaving *_original copies. */
export async function writeTags(et: ExifTool, file: string, tags: string[]): Promise<void> {
  const { stdout, stderr } = await et.run(['-overwrite_original', ...tags, file])
  if (!/1 image files? (updated|created)/.test(stdout.toString())) {
    throw new Error(`exiftool write failed: ${stdout.toString()} ${stderr}`)
  }
}
