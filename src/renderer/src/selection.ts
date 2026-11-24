/**
 * Selection in the strip (tz.md, п. 4.4): click, Ctrl+click, Shift+click, Ctrl+A.
 * `current` is the photo shown in the status bar and followed by the map; `anchor` is where a
 * Shift+click range starts. `order` is the photos shown in the strip, in strip order (with a
 * filter on, hidden photos are not in it).
 */
export interface Selection {
  ids: ReadonlySet<number>
  current: number | null
  anchor: number | null
}

export const EMPTY_SELECTION: Selection = { ids: new Set(), current: null, anchor: null }

export function single(id: number): Selection {
  return { ids: new Set([id]), current: id, anchor: id }
}

/** Photos between two photos of the strip, both included; null if either is not shown. */
function range(order: readonly number[], a: number, b: number): number[] | null {
  const i = order.indexOf(a)
  const j = order.indexOf(b)
  if (i < 0 || j < 0) return null
  return order.slice(Math.min(i, j), Math.max(i, j) + 1)
}

/**
 * A click on a photo with the modifier keys held. A track (`isTrack`, tz.md, п. 3.9.4) is always
 * selected alone, whatever the keys; it never joins photos, and photos never join it.
 */
export function clickSelect(
  sel: Selection,
  id: number,
  mods: { ctrl: boolean; shift: boolean },
  order: readonly number[],
  isTrack: (id: number) => boolean = () => false
): Selection {
  if (isTrack(id) || [...sel.ids].some(isTrack)) return single(id)
  const span = mods.shift && sel.anchor !== null ? range(order, sel.anchor, id) : null
  if (span) {
    const ids = new Set(mods.ctrl ? sel.ids : [])
    for (const i of span) if (!isTrack(i)) ids.add(i)
    return { ids, current: id, anchor: sel.anchor }
  }
  if (mods.ctrl) {
    const ids = new Set(sel.ids)
    if (ids.has(id)) {
      // The last selected photo stays: a photo is always selected (tz.md, п. 4.4).
      if (ids.size === 1) return sel
      ids.delete(id)
      const current = sel.current === id ? ([...ids].at(-1) ?? null) : sel.current
      return { ids, current, anchor: id }
    }
    ids.add(id)
    return { ids, current: id, anchor: id }
  }
  return single(id)
}

/** Ctrl+A: all photos shown in the strip, not the tracks (п. 3.9.4); the current one stays if it is one of them. */
export function selectAll(sel: Selection, all: readonly number[], isTrack: (id: number) => boolean = () => false): Selection {
  const order = all.filter((id) => !isTrack(id))
  if (!order.length) return sel
  const current = sel.current !== null && order.includes(sel.current) ? sel.current : order[0]!
  return { ids: new Set(order), current, anchor: sel.anchor !== null && order.includes(sel.anchor) ? sel.anchor : current }
}

/**
 * Keeps only the photos shown in the strip (a filter hides the rest, tz.md, п. 4.13).
 * A photo is always selected (п. 4.4): if none of the selected ones is shown, or nothing was
 * selected, the first shown photo is (`order` — shown photos in strip order).
 */
export function restrictSelection(sel: Selection, order: readonly number[]): Selection {
  const shown = new Set(order)
  const first = order[0]
  if (sel.ids.size && [...sel.ids].every((id) => shown.has(id)) && (sel.current === null || shown.has(sel.current))) {
    return sel
  }
  const ids = new Set([...sel.ids].filter((id) => shown.has(id)))
  if (!ids.size) return first === undefined ? EMPTY_SELECTION : single(first)
  const current = sel.current !== null && ids.has(sel.current) ? sel.current : ([...ids].at(-1) ?? null)
  const anchor = sel.anchor !== null && shown.has(sel.anchor) ? sel.anchor : current
  return { ids, current, anchor }
}

/**
 * Photos a drag from the strip carries: the selection if the dragged photo is in it,
 * otherwise only the dragged photo (it becomes the selection, as in Lightroom).
 */
export function dragSelection(sel: Selection, id: number): Selection {
  return sel.ids.has(id) ? { ...sel, current: id } : single(id)
}
