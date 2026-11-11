import { readFile } from 'node:fs/promises'
import sharp, { type Sharp } from 'sharp'
import type { ExifTool } from './exiftool'
import type { PhotoSource } from './folder'

/** Longest side of a thumbnail, px: strip thumbnails are ~120 px, ×2 for high-DPI screens. */
export const THUMB_SIZE = 320

/** Longest side of the photo view image, px: enough for a large screen, fast to make. */
export const LARGE_SIZE = 2560

/** Large images kept in memory: the current photo and its neighbours. */
const LARGE_CACHE = 6

/** Applies EXIF orientation 1–8 explicitly (embedded previews carry none of their own). */
function orient(img: Sharp, orientation: number): Sharp {
  switch (orientation) {
    case 2: return img.flop()
    case 3: return img.rotate(180)
    case 4: return img.flip()
    case 5: return img.rotate(90).flop()
    case 6: return img.rotate(90)
    case 7: return img.rotate(270).flop()
    case 8: return img.rotate(270)
    default: return img
  }
}

function resized(img: Sharp, size: number): Promise<Buffer> {
  return img
    .resize(size, size, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: size > THUMB_SIZE ? 88 : 82 })
    .toBuffer()
}

/** Makes one thumbnail JPEG (tz.md, п. 3.3.4). Throws when the photo cannot be shown. */
export function makeThumbnail(source: PhotoSource, exiftool: ExifTool): Promise<Buffer> {
  return makeImage(source, exiftool, THUMB_SIZE)
}

/**
 * A JPEG of the photo with the given longest side, from the same source as the thumbnail
 * (п. 3.3.4: RAW, DNG and HEIC — their embedded preview). Throws when the photo cannot be shown.
 */
export async function makeImage(source: PhotoSource, exiftool: ExifTool, size: number): Promise<Buffer> {
  const toThumb = (img: Sharp): Promise<Buffer> => resized(img, size)
  if (source.preview === 'image') {
    // Read into memory: avoids any trouble with non-Latin paths in the image library.
    return toThumb(sharp(await readFile(source.path), { failOn: 'none' }).rotate())
  }
  if (source.previewTag) {
    const jpeg = await exiftool.binary(source.path, source.previewTag)
    if (jpeg) return toThumb(orient(sharp(jpeg, { failOn: 'none' }), source.orientation))
  }
  if (source.preview === 'heic') {
    const { default: decode } = await import('heic-decode')
    const { width, height, data } = await decode({ buffer: await readFile(source.path) })
    return toThumb(sharp(Buffer.from(data.buffer), { raw: { width, height, channels: 4 } }))
  }
  throw new Error('no embedded preview')
}

/**
 * Thumbnails on demand with a small cache and a limit on parallel work,
 * so scrolling through hundreds of photos does not start hundreds of decodes at once.
 */
export class ThumbnailService {
  private cache = new Map<string, Promise<Buffer>>()
  /** Large images, least recently used first. */
  private large = new Map<string, Promise<Buffer>>()
  private running = 0
  private waiting: (() => void)[] = []

  constructor(
    private readonly exiftool: ExifTool,
    private readonly parallel = 3
  ) {}

  get(source: PhotoSource): Promise<Buffer> {
    let p = this.cache.get(source.path)
    if (!p) {
      p = this.limited(() => makeThumbnail(source, this.exiftool))
      this.cache.set(source.path, p)
    }
    return p
  }

  /** The image of the photo view: not queued behind the strip thumbnails, a few kept in memory. */
  getLarge(source: PhotoSource): Promise<Buffer> {
    let p = this.large.get(source.path)
    if (p) {
      this.large.delete(source.path)
    } else {
      p = makeImage(source, this.exiftool, LARGE_SIZE)
      p.catch(() => this.large.delete(source.path))
    }
    this.large.set(source.path, p)
    while (this.large.size > LARGE_CACHE) this.large.delete(this.large.keys().next().value!)
    return p
  }

  clear(): void {
    this.cache.clear()
    this.large.clear()
  }

  private async limited<T>(job: () => Promise<T>): Promise<T> {
    if (this.running >= this.parallel) await new Promise<void>((r) => this.waiting.push(r))
    this.running++
    try {
      return await job()
    } finally {
      this.running--
      this.waiting.shift()?.()
    }
  }
}
