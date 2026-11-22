/**
 * Supported formats (tz.md, п. 3.3), checked against exiftool 13.62 (videos — 13.64).
 * `file` — coordinates are written into the file itself (пп. 3.3.2, 3.3.6);
 * `xmp` — RAW and the videos exiftool cannot write: only the XMP sidecar (пп. 3.3.3, 3.3.6).
 */
export type WriteMode = 'file' | 'xmp'

/** How a thumbnail is made (п. 3.3.4). */
export type PreviewKind =
  | 'image' // decoded directly (JPEG, PNG, WebP, AVIF, TIFF)
  | 'embedded' // embedded JPEG preview extracted by exiftool (RAW, DNG)
  | 'heic' // embedded JPEG preview, or full HEIC decoding when there is none
  | 'system' // the thumbnail of the system, as Explorer shows it (videos, п. 3.3.6)

export interface FormatInfo {
  write: WriteMode
  raw: boolean
  video: boolean
  preview: PreviewKind
  /** Videos in which a GPS track may be found by reading deeper (п. 3.3.6). */
  track: boolean
}

const FILE_IMAGE = ['jpg', 'jpeg', 'jpe', 'png', 'webp', 'avif', 'tif', 'tiff']
const FILE_HEIC = ['heic', 'heif', 'hif']
const RAW_XMP = [
  'cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'arq', 'raf', 'rw2', 'rwl', 'raw',
  'orf', 'ori', 'pef', 'srw', '3fr', 'fff', 'iiq', 'x3f', 'gpr', 'erf', 'mef', 'mos', 'mrw',
  'dcr', 'kdc', 'k25'
]

/** Videos exiftool writes (the QuickTime family): into the file (п. 3.3.6). */
const VIDEO_FILE = ['mov', 'qt', 'mp4', 'm4v', '3gp', '3gpp', '3g2', '3gp2', 'mqv', 'f4v']
/** Videos exiftool only reads: the XMP sidecar (п. 3.3.6). */
const VIDEO_XMP = [
  'avi', 'divx', 'mpg', 'mpeg', 'm2v', 'vob', 'mts', 'm2ts', 'm2t', 'ts', 'mkv', 'webm', 'wmv',
  'asf', 'flv', 'dv', 'ogv', 'mxf'
]
/** Containers where exiftool finds GPS tracks: QuickTime timed metadata, AVCHD streams. */
const VIDEO_TRACK = new Set([...VIDEO_FILE, 'mts', 'm2ts', 'm2t', 'ts'])

const photo = (write: WriteMode, raw: boolean, preview: PreviewKind): FormatInfo =>
  ({ write, raw, video: false, preview, track: false })
const video = (write: WriteMode, ext: string): FormatInfo =>
  ({ write, raw: false, video: true, preview: 'system', track: VIDEO_TRACK.has(ext) })

const FORMATS = new Map<string, FormatInfo>([
  ...FILE_IMAGE.map((e) => [e, photo('file', false, 'image')] as const),
  ...FILE_HEIC.map((e) => [e, photo('file', false, 'heic')] as const),
  // DNG is written inside, like Lightroom does (п. 3.3.2).
  ['dng', photo('file', true, 'embedded')],
  ...RAW_XMP.map((e) => [e, photo('xmp', true, 'embedded')] as const),
  ...VIDEO_FILE.map((e) => [e, video('file', e)] as const),
  ...VIDEO_XMP.map((e) => [e, video('xmp', e)] as const)
])

/** All supported extensions, lower-case, without the dot (for the file dialog filter). */
export const SUPPORTED_EXTENSIONS: readonly string[] = [...FORMATS.keys()]

/** Lower-case extension without the dot: "IMG_1.CR2" → "cr2". */
export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot < 0 ? '' : fileName.slice(dot + 1).toLowerCase()
}

/** Name without extension: "IMG_1.CR2" → "IMG_1". */
export function baseNameOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot < 0 ? fileName : fileName.slice(0, dot)
}

export function formatOf(fileName: string): FormatInfo | undefined {
  return FORMATS.get(extensionOf(fileName))
}

export function isSupported(fileName: string): boolean {
  return FORMATS.has(extensionOf(fileName))
}

export function isSidecar(fileName: string): boolean {
  return extensionOf(fileName) === 'xmp'
}

/** XMP sidecar name, as in Lightroom: "IMG_0001.CR2" → "IMG_0001.xmp" (п. 6.4). */
export function sidecarNameOf(fileName: string): string {
  return `${baseNameOf(fileName)}.xmp`
}

/**
 * Files that read and write the XMP sidecar of their name (tz.md, п. 3.7): the RAW file if there
 * is one, else a video that is written only to the sidecar (п. 3.3.6), else every file of that
 * name (as a JPEG on its own).
 */
export function sidecarOwners(names: readonly string[]): Set<string> {
  const rank = (n: string): number => {
    const f = formatOf(n)
    return f?.raw ? 2 : f?.video && f.write === 'xmp' ? 1 : 0
  }
  const best = new Map<string, number>()
  for (const n of names) {
    const base = baseNameOf(n).toLowerCase()
    best.set(base, Math.max(best.get(base) ?? 0, rank(n)))
  }
  return new Set(names.filter((n) => rank(n) === best.get(baseNameOf(n).toLowerCase())))
}