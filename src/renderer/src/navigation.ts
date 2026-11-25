/** Keys that move the selection along the strip (tz.md, пп. 4.4.1, 4.17). */
export type NavKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End' | 'PageUp' | 'PageDown'

export function isNavKey(key: string): key is NavKey {
  return ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(key)
}

/**
 * Index to select after a key press; null when there are no photos or the key does nothing here.
 * `row` is how far ↑ ↓ go: 0 — they do nothing (the strip at the bottom), 1 — the strip on the
 * left, the number of columns — the grid. Nothing selected: → ↓ select the first photo, ← ↑ the
 * last. No wrap-around at the ends; ↓ from a row with nothing below goes to the last photo.
 * `page` is how far PageUp / PageDown go: the photos one screen of the strip holds (in the grid,
 * the visible rows times the columns); beyond the ends — the first or the last photo.
 */
export function navigate(key: NavKey, current: number | null, count: number, row = 0, page = 1): number | null {
  if (count <= 0) return null
  const last = count - 1
  switch (key) {
    case 'ArrowLeft':
      return current === null ? last : Math.max(current - 1, 0)
    case 'ArrowRight':
      return current === null ? 0 : Math.min(current + 1, last)
    case 'ArrowUp':
      if (row <= 0) return null
      return current === null ? last : current - row >= 0 ? current - row : current
    case 'ArrowDown':
      if (row <= 0) return null
      return current === null ? 0 : Math.min(current + row, last)
    case 'PageUp':
      return current === null ? last : Math.max(current - Math.max(page, 1), 0)
    case 'PageDown':
      return current === null ? 0 : Math.min(current + Math.max(page, 1), last)
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
export function navigateShown(
  key: NavKey,
  current: number | null,
  order: readonly number[],
  row = 0,
  page = 1
): number | null {
  const pos = current === null ? -1 : order.indexOf(current)
  const next = navigate(key, pos < 0 ? null : pos, order.length, row, page)
  return next === null ? null : order[next]!
}
