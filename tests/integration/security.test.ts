import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { scanFolder } from '../../src/main/folder'
import { savePhotos } from '../../src/main/save'
import { EXIFTOOL, makeJpeg, newExifTool, tempDir } from './helpers'

const et = newExifTool()
afterAll(() => et.close())

// Security review 2026-11-22: exiftool gets its arguments one per line (-stay_open, -@ -). A line
// break inside a value made the rest of it exiftool options; `-if` runs Perl code.
describe('a line break in metadata does not become exiftool options', () => {
  const tmp = tempDir()
  afterAll(() => tmp.remove())

  it('an address with a line break read from a photo is written back on one line, no code runs', async () => {
    const file = join(tmp.dir, 'evil.jpg')
    const marker = join(tmp.dir, 'PWNED.txt')
    await makeJpeg(file)
    const city = `Kyiv\n-if\nopen(F, '>', '${marker.replace(/\\/g, '/')}'); close F; 1`
    // Set up by a plain exiftool run: its arguments are not split by lines.
    execFileSync(EXIFTOOL, ['-overwrite_original', '-n', '-EXIF:GPSLatitude=50', '-EXIF:GPSLatitudeRef=N', '-EXIF:GPSLongitude=30', '-EXIF:GPSLongitudeRef=E', `-XMP-photoshop:City=${city}`, file])

    const scan = await scanFolder(tmp.dir, et)
    const p = scan.photos[0]!
    expect(p.address?.city).not.toMatch(/[\r\n]/)
    // Only the altitude changes (Get Altitude): the address of the file is written back.
    const out = await savePhotos(et, [{ photo: { ...p, altitude: 123, modified: true }, source: scan.sources[0]!, old: p.coords }], { info: () => {}, error: () => {} })
    expect(out.failed).toEqual([])
    expect(existsSync(marker)).toBe(false)
    expect(out.saved[0]?.photo.address?.city).toMatch(/^Kyiv -if open/)
  })

  it('a command with a line break in an argument is refused', async () => {
    await expect(et.run(['-ver\n-if\n1'])).rejects.toThrow(/line break/)
    // The process still works.
    const { stdout } = await et.run(['-ver'])
    expect(stdout.toString().trim()).toMatch(/^\d+\.\d+/)
  })
})
