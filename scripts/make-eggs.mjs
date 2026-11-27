// Prepares the easter eggs (tz.md, п. 9.3) from a folder outside the repository:
//   node scripts/make-eggs.mjs <folder> [--out eggs] [--preview <folder>]
// The folder holds the photos and eggs-source.json:
//   [{ "photo": "x.jpg", "sight": [lat, lon], "shot": [lat, lon], "title": { "en": …, "ru": …, "uk": … },
//      "clean": [x, y, w, h] }]   — clean (optional): a mark of a site on the sky, painted over.
// Each egg's point is the place of shooting if it is seen on a typical map with the sight in the
// middle at the egg zoom, otherwise the sight. Writes <out>/eggs.bin (the list) and <out>/NN.bin
// (the photos), coded (EGG_KEY): plain photos never get into the repository.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { eggCode, shotFits, worldPx, EGG_ZOOM } from '../src/shared/eggs.ts'

const args = process.argv.slice(2)
const src = args[0]
if (!src) {
  console.error('Usage: node scripts/make-eggs.mjs <folder> [--out eggs] [--preview <folder>]')
  process.exit(1)
}
const opt = (name, def) => {
  const i = args.indexOf(name)
  return i > 0 ? args[i + 1] : def
}
const out = opt('--out', 'eggs')
const preview = opt('--preview', null)

const list = JSON.parse(readFileSync(join(src, 'eggs-source.json'), 'utf8'))

/** Paints over a rectangle of sky: a smooth colour fitted to the sky around it. Dark pixels (not sky) stay. */
async function clean(input, [bx, by, bw, bh]) {
  const { data, info } = await sharp(input).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height } = info
  const lum = (i) => 0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2]
  const inBox = (x, y) => x >= bx && x < bx + bw && y >= by && y < by + bh
  // Least squares of c = a + b·x + c·y + d·y² over the sky around the box (blue, light).
  const rows = []
  const pad = 40
  for (let y = Math.max(0, by - pad); y < Math.min(height, by + bh + pad); y++) {
    for (let x = Math.max(0, bx - pad); x < Math.min(width, bx + bw + pad); x++) {
      if (inBox(x, y)) continue
      const i = (y * width + x) * 3
      if (data[i + 2] > data[i] + 15 && lum(i) > 140) rows.push([x, y, data[i], data[i + 1], data[i + 2]])
    }
  }
  const feats = ([x, y]) => [1, x / width, y / height, (y / height) ** 2]
  const fit = (ch) => {
    const n = 4
    const A = Array.from({ length: n }, () => new Array(n + 1).fill(0))
    for (const r of rows) {
      const f = feats(r)
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) A[i][j] += f[i] * f[j]
        A[i][n] += f[i] * r[2 + ch]
      }
    }
    for (let i = 0; i < n; i++) {
      let p = i
      for (let k = i + 1; k < n; k++) if (Math.abs(A[k][i]) > Math.abs(A[p][i])) p = k
      ;[A[i], A[p]] = [A[p], A[i]]
      for (let k = 0; k < n; k++) {
        if (k === i) continue
        const m = A[k][i] / A[i][i]
        for (let j = i; j <= n; j++) A[k][j] -= m * A[i][j]
      }
    }
    return A.map((r, i) => r[n] / r[i])
  }
  const coef = [fit(0), fit(1), fit(2)]
  for (let y = by; y < Math.min(height, by + bh); y++) {
    for (let x = bx; x < Math.min(width, bx + bw); x++) {
      const i = (y * width + x) * 3
      if (lum(i) < 140) continue
      const f = feats([x, y])
      for (let ch = 0; ch < 3; ch++) {
        const v = coef[ch].reduce((s, c, k) => s + c * f[k], 0) + (Math.random() - 0.5) * 2
        data[i + ch] = Math.max(0, Math.min(255, Math.round(v)))
      }
    }
  }
  return sharp(data, { raw: { width, height, channels: 3 } })
}

const distance = (a, b) => {
  const r = Math.PI / 180
  const x = (b[1] - a[1]) * r * Math.cos(((a[0] + b[0]) / 2) * r)
  const y = (b[0] - a[0]) * r
  return Math.round(6371000 * Math.hypot(x, y))
}

mkdirSync(out, { recursive: true })
for (const f of readdirSync(out)) if (f.endsWith('.bin')) rmSync(join(out, f))
if (preview) mkdirSync(preview, { recursive: true })

const eggs = []
for (const [i, e] of list.entries()) {
  const id = i + 1
  const file = `${String(id).padStart(2, '0')}.bin`
  const input = join(src, e.photo)
  const image = e.clean ? await clean(input, e.clean) : sharp(input)
  // Re-coded without the metadata of the original files.
  const jpeg = await image.rotate().resize(1280, 1280, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer()
  writeFileSync(join(out, file), eggCode(jpeg))
  if (preview) writeFileSync(join(preview, `${String(id).padStart(2, '0')}.jpg`), jpeg)
  const sight = { lat: e.sight[0], lon: e.sight[1] }
  const shot = { lat: e.shot[0], lon: e.shot[1] }
  const fits = shotFits(sight, shot)
  const point = fits ? shot : sight
  const a = worldPx(sight.lat, sight.lon, EGG_ZOOM)
  const b = worldPx(shot.lat, shot.lon, EGG_ZOOM)
  console.log(`${file} ${e.title.en.padEnd(34)} ${String(distance(e.sight, e.shot)).padStart(5)} m  dx ${Math.round(b.x - a.x).toString().padStart(5)} px, dy ${Math.round(b.y - a.y).toString().padStart(5)} px  → ${fits ? 'shot' : 'SIGHT'}`)
  eggs.push({ id, lat: point.lat, lon: point.lon, title: e.title, file })
}
writeFileSync(join(out, 'eggs.bin'), eggCode(new TextEncoder().encode(JSON.stringify(eggs))))
console.log(`${eggs.length} eggs → ${out}`)
