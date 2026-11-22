import { baseNameOf } from './formats'

/**
 * Live photos (tz.md, п. 3.3.7):
 * - a video inside the photo file: Google Motion Photo (Xiaomi, Pixel, newer Samsung) —
 *   `MotionPhotoVideo`; older Samsung — `EmbeddedVideoFile`; Pixel 2 MicroVideo — `EmbeddedVideo`;
 * - an iPhone Live Photo: the photo (HEIC, JPEG) and a MOV of the same name, with the same
 *   `ContentIdentifier` in both.
 */
export const LIVE_VIDEO_TAGS = ['MotionPhotoVideo', 'EmbeddedVideoFile', 'EmbeddedVideo'] as const

type Rec = Record<string, unknown>

function anyGroup(rec: Rec, tag: string): unknown {
  if (tag in rec) return rec[tag]
  const suffix = `:${tag}`
  for (const [k, v] of Object.entries(rec)) if (k.endsWith(suffix)) return v
  return undefined
}

/** The tag of the video inside a photo file, or null if it has none. */
export function embeddedLiveTag(rec: Rec | undefined): string | null {
  if (!rec) return null
  for (const tag of LIVE_VIDEO_TAGS) if (anyGroup(rec, tag) !== undefined) return tag
  return null
}

/** The Apple ContentIdentifier that ties a Live Photo to its MOV; null if none. */
export function contentId(rec: Rec | undefined): string | null {
  const v = rec ? anyGroup(rec, 'ContentIdentifier') : undefined
  return typeof v === 'string' && v.trim() ? v.trim().toUpperCase() : null
}

export interface LiveCandidate {
  name: string
  video: boolean
  contentId: string | null
}

/**
 * iPhone Live Photos of one folder: photo name → name of its MOV. A pair is a photo and a video of
 * the same name (case does not matter) with the same ContentIdentifier; a name match alone is
 * not enough (a camera's IMG_0001.JPG and an unrelated IMG_0001.MOV).
 */
export function livePairs(files: readonly LiveCandidate[]): Map<string, string> {
  const videos = new Map<string, LiveCandidate[]>()
  for (const f of files) {
    if (!f.video || !f.contentId) continue
    const key = baseNameOf(f.name).toLowerCase()
    videos.set(key, [...(videos.get(key) ?? []), f])
  }
  const pairs = new Map<string, string>()
  const taken = new Set<string>()
  for (const f of files) {
    if (f.video || !f.contentId) continue
    const match = videos.get(baseNameOf(f.name).toLowerCase())?.find((v) => v.contentId === f.contentId && !taken.has(v.name))
    if (match) {
      pairs.set(f.name, match.name)
      taken.add(match.name)
    }
  }
  return pairs
}
