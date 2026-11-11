import { formatCoords, type LatLon } from './photo'

/**
 * What Ctrl+C puts into the clipboard for a photo (tz.md, п. 4.10): the program's own format, read
 * back by Ctrl+V. For now it is the coordinates; the address and altitude join them later.
 */
export function clipboardText(c: LatLon): string {
  return formatCoords(c)
}

/**
 * Lenient parsing of a coordinate pair (tz.md, п. 4.12): whatever can be read unambiguously as
 * latitude and longitude — decimal degrees, degrees-minutes(-seconds), N/S/E/W (and С/Ю/В/З)
 * before or after the numbers. Null if the text is not one pair, or can be read two ways.
 */
export function parseCoords(text: string): LatLon | null {
  const clean = normalize(text)
  if (clean === null) return null
  // A comma is either the decimal mark or a separator; the text must mean one pair either way.
  const results = [readPair(clean, false), readPair(clean, true)].filter((r): r is LatLon => r !== null)
  if (!results.length) return null
  const [first] = results
  if (results.some((r) => Math.abs(r.lat - first!.lat) > 1e-9 || Math.abs(r.lon - first!.lon) > 1e-9)) return null
  return first!
}

/** Labels, brackets and variants of the degree marks are dropped or unified. */
function normalize(text: string): string | null {
  let s = text
    .replace(/[′’‘ʹ`´]/g, "'")
    .replace(/[″”“ʺ]|''/g, '"')
    .replace(/[º˚]/g, '°')
    .replace(/[−–]/g, '-')
    .replace(/[()[\]{}]/g, ' ')
    // Labels like `lat:`, `lon:`, `Широта:` (and the bare words).
    .replace(/(?:latitude|longitude|long|lng|lat|lon|широта|долгота)\s*[:=]?/giu, ' ')
    .replace(/\p{L}+\s*[:=]/gu, ' ')
  s = s.trim()
  return s ? s : null
}

const LAT_LETTERS: Record<string, number> = { N: 1, S: -1, С: 1, Ю: -1 }
const LON_LETTERS: Record<string, number> = { E: 1, W: -1, В: 1, З: -1 }

type Token =
  | { kind: 'num'; value: number; text: string; mark: number | null }
  | { kind: 'letter'; axis: 'lat' | 'lon'; sign: number }

/** Marks of degrees, minutes and seconds: the place of a number in an angle. */
const MARKS: Record<string, number> = { '°': 0, "'": 1, '"': 2 }

function tokenize(s: string, decimalComma: boolean): Token[] | null {
  let text = s
  if (decimalComma) {
    // Every comma must sit between digits as a decimal mark; numbers have no dots then.
    if (/\d\.\d/.test(text)) return null
    text = text.replace(/(\d),(\d)/g, '$1.$2')
    if (text.includes(',')) return null
  }
  text = text.replace(/[,;]/g, ' ')
  const tokens: Token[] = []
  const re = /\s+|([-+]?\d+(?:\.\d+)?)\s*([°'"])?|(\p{L}+)|(.)/gu
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m[1] !== undefined) {
      tokens.push({ kind: 'num', value: Number(m[1]), text: m[1], mark: m[2] ? MARKS[m[2]]! : null })
    } else if (m[3] !== undefined) {
      const letter = m[3].toUpperCase()
      if (letter in LAT_LETTERS) tokens.push({ kind: 'letter', axis: 'lat', sign: LAT_LETTERS[letter]! })
      else if (letter in LON_LETTERS) tokens.push({ kind: 'letter', axis: 'lon', sign: LON_LETTERS[letter]! })
      else return null
    } else if (m[4] !== undefined) {
      return null
    }
  }
  return tokens
}

type Num = Extract<Token, { kind: 'num' }>

function readPair(s: string, decimalComma: boolean): LatLon | null {
  const tokens = tokenize(s, decimalComma)
  if (!tokens) return null
  const letters = tokens.filter((t) => t.kind === 'letter')
  let lat: number | null
  let lon: number | null

  if (letters.length) {
    // One letter per coordinate, one of each axis; all before their numbers or all after.
    if (letters.length !== 2 || letters[0]!.axis === letters[1]!.axis) return null
    const groups: { letter: Extract<Token, { kind: 'letter' }>; nums: Num[] }[] = []
    const prefix = tokens[0]!.kind === 'letter'
    if (!prefix && tokens.at(-1)!.kind !== 'letter') return null
    let nums: Num[] = []
    for (const t of tokens) {
      if (t.kind === 'num') {
        nums.push(t)
        continue
      }
      if (prefix) groups.push({ letter: t, nums: (nums = []) })
      else {
        groups.push({ letter: t, nums })
        nums = []
      }
    }
    let a: number | null = null
    let b: number | null = null
    for (const g of groups) {
      const v = angle(g.nums, false)
      if (v === null) return null
      if (g.letter.axis === 'lat') a = v * g.letter.sign
      else b = v * g.letter.sign
    }
    lat = a
    lon = b
  } else {
    const nums = tokens as Num[]
    let groups: Num[][]
    if (nums.some((n) => n.mark !== null)) {
      // Degrees-minutes-seconds without letters: each coordinate starts with its degrees.
      groups = []
      for (const n of nums) {
        if (n.mark === 0 || !groups.length) groups.push([n])
        else groups.at(-1)!.push(n)
      }
    } else {
      // Plain numbers: exactly two.
      groups = nums.map((n) => [n])
    }
    if (groups.length !== 2) return null
    const [first, second] = groups.map((g) => angle(g, true))
    if (first == null || second == null) return null
    // Without letters the order is latitude, longitude — unless it can only be the other way.
    if (Math.abs(first) > 90 && Math.abs(second) <= 90) {
      lat = second
      lon = first
    } else {
      lat = first
      lon = second
    }
  }
  if (lat === null || lon === null) return null
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  return { lat, lon }
}

/**
 * Degrees, minutes, seconds → degrees. Numbers take their places by their marks, unmarked ones
 * the next place. Only degrees can have a sign, and only when no letter gives it.
 */
function angle(nums: Num[], signed: boolean): number | null {
  if (!nums.length || nums.length > 3) return null
  const parts: (number | undefined)[] = []
  let place = 0
  for (const [i, n] of nums.entries()) {
    const at = n.mark ?? place
    if (at < place || at > 2) return null
    if (i > 0 && /^[-+]/.test(n.text)) return null
    parts[at] = n.value
    place = at + 1
  }
  const [d, m, s] = parts
  if (d === undefined) return null
  if (!signed && /^[-+]/.test(nums[0]!.text)) return null
  if (m !== undefined && (m >= 60 || !Number.isInteger(d))) return null
  if (s !== undefined && (s >= 60 || m === undefined || !Number.isInteger(m))) return null
  const v = Math.abs(d) + (m ?? 0) / 60 + (s ?? 0) / 3600
  return nums[0]!.text.startsWith('-') ? -v : v
}
