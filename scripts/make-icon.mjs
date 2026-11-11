// Makes build/icon.ico (the program icon) from build/icon.svg: every size Windows uses,
// each stored as PNG inside the .ico. Run after changing the SVG: node scripts/make-icon.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import sharp from 'sharp'

const root = resolve(import.meta.dirname, '..')
const svg = readFileSync(resolve(root, 'build/icon.svg'))
const SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]

const images = []
for (const size of SIZES) {
  images.push({ size, png: await sharp(svg, { density: 384 }).resize(size, size).png().toBuffer() })
}

// ICO: 6-byte header, a 16-byte entry per image, then the images.
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0) // reserved
header.writeUInt16LE(1, 2) // type: icon
header.writeUInt16LE(images.length, 4)
let offset = 6 + 16 * images.length
const entries = images.map(({ size, png }) => {
  const e = Buffer.alloc(16)
  e.writeUInt8(size >= 256 ? 0 : size, 0) // width, 0 means 256
  e.writeUInt8(size >= 256 ? 0 : size, 1) // height
  e.writeUInt8(0, 2) // no palette
  e.writeUInt8(0, 3) // reserved
  e.writeUInt16LE(1, 4) // color planes
  e.writeUInt16LE(32, 6) // bits per pixel
  e.writeUInt32LE(png.length, 8)
  e.writeUInt32LE(offset, 12)
  offset += png.length
  return e
})
const ico = Buffer.concat([header, ...entries, ...images.map((i) => i.png)])
writeFileSync(resolve(root, 'build/icon.ico'), ico)
// The window icon in development (the built program takes it from the .exe).
writeFileSync(resolve(root, 'build/icon.png'), images.find((i) => i.size === 256).png)
console.log(`build/icon.ico: ${SIZES.join(', ')} px, ${ico.length} bytes`)
