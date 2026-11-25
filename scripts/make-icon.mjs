// Makes build/icon.ico (the program icon) and build/installerSidebar.bmp from build/icon.svg. The icon: every size Windows uses,
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

// The picture of the first and last pages of the installer (tz.md, п. 2.5): 164×314, a 24-bit
// BMP as NSIS wants it — the icon on the dark background of the program.
const SIDEBAR = { width: 164, height: 314, icon: 112, background: { r: 0x1e, g: 0x1e, b: 0x1e } }
const iconPng = await sharp(svg, { density: 384 }).resize(SIDEBAR.icon, SIDEBAR.icon).png().toBuffer()
const { data } = await sharp({ create: { width: SIDEBAR.width, height: SIDEBAR.height, channels: 3, background: SIDEBAR.background } })
  .composite([{ input: iconPng, left: (SIDEBAR.width - SIDEBAR.icon) >> 1, top: 70 }])
  .removeAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true })
const rowSize = Math.ceil((SIDEBAR.width * 3) / 4) * 4
const pixels = Buffer.alloc(rowSize * SIDEBAR.height)
for (let y = 0; y < SIDEBAR.height; y++) {
  // BMP rows go bottom-up, pixels as BGR.
  const out = (SIDEBAR.height - 1 - y) * rowSize
  for (let x = 0; x < SIDEBAR.width; x++) {
    const i = (y * SIDEBAR.width + x) * 3
    pixels[out + x * 3] = data[i + 2]
    pixels[out + x * 3 + 1] = data[i + 1]
    pixels[out + x * 3 + 2] = data[i]
  }
}
const bmpHeader = Buffer.alloc(54)
bmpHeader.write('BM', 0)
bmpHeader.writeUInt32LE(54 + pixels.length, 2)
bmpHeader.writeUInt32LE(54, 10) // pixels start
bmpHeader.writeUInt32LE(40, 14) // BITMAPINFOHEADER
bmpHeader.writeInt32LE(SIDEBAR.width, 18)
bmpHeader.writeInt32LE(SIDEBAR.height, 22)
bmpHeader.writeUInt16LE(1, 26) // planes
bmpHeader.writeUInt16LE(24, 28) // bits per pixel
bmpHeader.writeUInt32LE(pixels.length, 34)
writeFileSync(resolve(root, 'build/installerSidebar.bmp'), Buffer.concat([bmpHeader, pixels]))
console.log(`build/installerSidebar.bmp: ${SIDEBAR.width}×${SIDEBAR.height}`)
