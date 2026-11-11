// Collects the licenses of third-party components that go into the built program
// (THIRD-PARTY-NOTICES.txt next to GeoPhotos.exe; linked from Help → About).
// Usage: node scripts/third-party-notices.mjs [output file]; default: out/THIRD-PARTY-NOTICES.txt
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const output = resolve(root, process.argv[2] ?? 'out/THIRD-PARTY-NOTICES.txt')

// Bundled into the window by the build although they are dev dependencies of the project.
const BUNDLED_IN_WINDOW = ['leaflet', 'leaflet.markercluster']

/** Folders of the production dependencies, all levels, as npm installed them. */
function productionPackages() {
  // npm is a .cmd file on Windows: it runs through the shell, the command is a constant.
  const out = execSync('npm ls --omit=dev --all --parseable', { cwd: root, encoding: 'utf8' })
  const dirs = out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && resolve(l) !== root)
  for (const name of BUNDLED_IN_WINDOW) dirs.push(join(root, 'node_modules', name))
  return [...new Set(dirs.map((d) => resolve(d)))]
}

// Standard texts for packages that ship no license file (the license still requires the text).
const TEMPLATES = {
  MIT: `Permission is hereby granted, free of charge, to any person obtaining a copy of this software
and associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`,
  ISC: `Permission to use, copy, modify, and/or distribute this software for any purpose with or without
fee is hereby granted, provided that the above copyright notice and this permission notice appear
in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS
SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE
AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT,
NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE
OF THIS SOFTWARE.`
}

/** Author of a package without the e-mail and site: "Name <mail> (url)" → "Name". */
function authorOf(pkg) {
  const a = typeof pkg.author === 'string' ? pkg.author : pkg.author?.name
  return a ? a.replace(/\s*[<(].*$/, '').trim() : null
}

function licenseTexts(dir) {
  return readdirSync(dir)
    .filter((f) => /^(licen[cs]e|copying|notice)/i.test(f))
    .sort()
    .map((f) => readFileSync(join(dir, f), 'utf8').trim())
}

function describe(dir) {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const license = typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? 'see package')
  const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url
  const home = pkg.homepage ?? repo ?? ''
  const texts = licenseTexts(dir)
  const lines = [`${pkg.name} ${pkg.version}`, `License: ${license}`]
  if (home) lines.push(`Source: ${String(home).replace(/^git\+/, '')}`)
  // sharp's platform package carries libvips and its libraries as DLLs: list them.
  const versions = join(dir, 'versions.json')
  if (existsSync(versions)) {
    const libs = JSON.parse(readFileSync(versions, 'utf8'))
    lines.push(`Includes: ${Object.entries(libs).map(([k, v]) => `${k} ${v}`).join(', ')}`)
  }
  lines.push('')
  if (texts.length) {
    lines.push(texts.join('\n\n'))
  } else if (TEMPLATES[license]) {
    const holder = authorOf(pkg) ?? `the authors of ${pkg.name}`
    lines.push(`(The package has no license file; the standard ${license} text follows.)`)
    lines.push('', `Copyright (c) ${holder}`, '', TEMPLATES[license])
  } else {
    lines.push(`(The package has no license file; its license is ${license}.)`)
  }
  return { name: pkg.name, text: lines.join('\n') }
}

const parts = productionPackages()
  .filter((d) => existsSync(join(d, 'package.json')))
  .map(describe)
  .sort((a, b) => a.name.localeCompare(b.name))

const header = `GeoPhotos — third-party components

GeoPhotos itself is under the MIT License (LICENSE.txt).
The program includes the components listed below, each under its own license.

Not listed here:
- Electron and Chromium: see LICENSE.electron.txt and LICENSES.chromium.html in the program folder.
- ExifTool by Phil Harvey: not included; the program runs an ExifTool installed separately.
- Map tiles and place search come from online services (OpenStreetMap, Esri, Google, Nominatim)
  under their own terms; nothing of them is included.
`
const sep = `\n\n${'='.repeat(78)}\n\n`
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, header + sep + parts.map((p) => p.text).join(sep) + '\n', 'utf8')
console.log(`Third-party notices: ${parts.length} components → ${output}`)
