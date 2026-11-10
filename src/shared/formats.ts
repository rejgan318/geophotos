/**
 * Supported formats (tz.md, п. 3.3), checked against exiftool 13.62.
 * `file` — coordinates are written into the file itself (п. 3.3.2);
 * `xmp` — RAW, coordinates go only to the XMP sidecar (п. 3.3.3).
 */
export type WriteMode = 'file' | 'xmp'

/** How a thumbnail is made (п. 3.3.4). */
export type PreviewKind =
  | 'image' // decoded directly (JPEG, PNG, WebP, AVIF, TIFF)
  | 'embedded' // embedded JPEG preview extracted by exiftool (RAW, DNG)
  | 'heic' // embedded JPEG preview, or full HEIC decoding when there is none

interface FormatInfo {
  write: WriteMode
  raw: boolean
  preview: PreviewKind
}

const FILE_IMAGE = ['jpg', 'jpeg', 'jpe', 'png', 'webp', 'avif', 'tif', 'tiff']
const FILE_HEIC = ['heic', 'heif', 'hif']
const RAW_XMP = [
  'cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'arq', 'raf', 'rw2', 'rwl', 'raw',
  'orf', 'ori', 'pef', 'srw', '3fr', 'fff', 'iiq', 'x3f', 'gpr', 'erf', 'mef', 'mos', 'mrw',
  'dcr', 'kdc', 'k25'
]

const FORMATS = new Map<string, FormatInfo>([
  ...FILE_IMAGE.map((e) => [e, { write: 'file', raw: false, preview: 'image' }] as const),
  ...FILE_HEIC.map((e) => [e, { write: 'file', raw: false, preview: 'heic' }] as const),
  // DNG is written inside, like Lightroom does (п. 3.3.2).
  ['dng', { write: 'file', raw: true, preview: 'embedded' }],
  ...RAW_XMP.map((e) => [e, { write: 'xmp', raw: true, preview: 'embedded' }] as const)
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
