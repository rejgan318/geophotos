/** Keys that move the selection along the strip (tz.md, п. 4.4.1). */
export type NavKey = 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End'

export function isNavKey(key: string): key is NavKey {
  return key === 'ArrowLeft' || key === 'ArrowRight' || key === 'Home' || key === 'End'
}

/**
 * Index to select after a key press; null when there are no photos.
 * Nothing selected: → selects the first photo, ← the last. No wrap-around at the ends.
 */
export function navigate(key: NavKey, current: number | null, count: number): number | null {
  if (count <= 0) return null
  const last = count - 1
  switch (key) {
    case 'ArrowLeft':
      return current === null ? last : Math.max(current - 1, 0)
    case 'ArrowRight':
      return current === null ? 0 : Math.min(current + 1, last)
    case 'Home':
      return 0
    case 'End':
      return last
  }
}

/**
 * The same over the photos shown in the strip (`order`, in strip order): returns the photo id.
 * A current photo hidden by the filter counts as nothing selected.
 */
export function navigateShown(key: NavKey, current: number | null, order: readonly number[]): number | null {
  const pos = current === null ? -1 : order.indexOf(current)
  const next = navigate(key, pos < 0 ? null : pos, order.length)
  return next === null ? null : order[next]!
}
