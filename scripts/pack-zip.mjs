// The release zip (tz.md, п. 9.3): dist/GeoPhotos-<version>-win-x64.zip with one folder `GeoPhotos`
// inside — the contents of dist/win-unpacked. Run after `npm run build`; Windows only (tar.exe of
// Windows makes the zip). Prints the path and the SHA-256 of the zip.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const unpacked = join(root, 'dist', 'win-unpacked')
if (!existsSync(join(unpacked, 'GeoPhotos.exe'))) {
  console.error(`No ${unpacked}\\GeoPhotos.exe: run npm run build first.`)
  process.exit(1)
}
const zip = join(root, 'dist', `GeoPhotos-${version}-win-x64.zip`)
const tar = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tar.exe')

const tmp = mkdtempSync(join(tmpdir(), 'geophotos-zip-'))
try {
  cpSync(unpacked, join(tmp, 'GeoPhotos'), { recursive: true, preserveTimestamps: true })
  rmSync(zip, { force: true })
  execFileSync(tar, ['-a', '-cf', zip, '-C', tmp, 'GeoPhotos'], { stdio: 'inherit' })
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
const sha = createHash('sha256').update(readFileSync(zip)).digest('hex').toUpperCase()
console.log(zip)
console.log(`SHA-256: ${sha}`)
