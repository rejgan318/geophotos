import type { Address, CoordSource, LatLon, Photo } from './photo'
import type { Place } from './search'

/**
 * Undo and Redo of coordinate changes (tz.md, п. 6.6): one step is one action — a marker moved
 * with all its photos, a drop, a paste into the selected photos, Ctrl+Del, photos dropped onto a
 * track; and (п. 5.3) a change of the favourite places. Only until Save: the history starts again on Save, Refresh and when the strip is read
 * anew. Taking photos off the strip (Del) is not undone.
 */
export type UndoKind = 'place' | 'paste' | 'clear' | 'track' | 'direction' | 'favorites'

/** What a step puts back: the coordinates of a photo with what goes with them. */
export interface PhotoState {
  id: number
  coords: LatLon | null
  coordSource: CoordSource | null
  address: Address | null
  altitude: number | null
  /** Absent — none (п. 4.21). */
  direction?: number
}

export interface UndoStep {
  kind: UndoKind
  /** Steps of one drop onto a track come one photo at a time: the same group joins them. */
  group?: number
  states: PhotoState[]
  /** A step of the favourite places (kind 'favorites'): the whole list before it. */
  favorites?: Place[]
}

export const stateOf = (p: Photo): PhotoState => ({
  id: p.id,
  coords: p.coords,
  coordSource: p.coordSource,
  address: p.address,
  altitude: p.altitude,
  ...(p.direction !== undefined ? { direction: p.direction } : {})
})

export class UndoHistory {
  private undoSteps: UndoStep[] = []
  private redoSteps: UndoStep[] = []

  /** A change was made: how the changed photos were before it. Redo is gone. */
  record(kind: UndoKind, before: readonly Photo[], group?: number): void {
    if (!before.length) return
    this.redoSteps = []
    const last = this.undoSteps.at(-1)
    if (group !== undefined && last && last.group === group) {
      // The same drop: a photo already in the step keeps its first (earliest) state.
      for (const p of before) if (!last.states.some((s) => s.id === p.id)) last.states.push(stateOf(p))
      return
    }
    this.undoSteps.push({ kind, ...(group !== undefined ? { group } : {}), states: before.map(stateOf) })
  }

  /** The favourite places changed (п. 5.3): the list before the change. Redo is gone. */
  recordFavorites(before: readonly Place[]): void {
    this.redoSteps = []
    this.undoSteps.push({ kind: 'favorites', states: [], favorites: [...before] })
  }

  /**
   * The step to undo, moving it to Redo with the photos (or the favourites) as they are now;
   * null — nothing to undo.
   */
  undo(photos: readonly Photo[], favorites: readonly Place[] = []): UndoStep | null {
    return this.move(this.undoSteps, this.redoSteps, photos, favorites)
  }

  /** The step to redo, moving it back to Undo; null — nothing to redo. */
  redo(photos: readonly Photo[], favorites: readonly Place[] = []): UndoStep | null {
    return this.move(this.redoSteps, this.undoSteps, photos, favorites)
  }

  private move(from: UndoStep[], to: UndoStep[], photos: readonly Photo[], favorites: readonly Place[]): UndoStep | null {
    const step = from.pop()
    if (!step) return null
    if (step.favorites) {
      to.push({ kind: step.kind, states: [], favorites: [...favorites] })
      return step
    }
    const now = step.states.map((s) => photos[s.id]).filter((p): p is Photo => !!p)
    to.push({ kind: step.kind, states: now.map(stateOf) })
    return step
  }

  /** What Undo and Redo would do now (the Edit menu): the kind and how many photos. */
  next(): { undo: { kind: UndoKind; count: number } | null; redo: { kind: UndoKind; count: number } | null } {
    const peek = (s: UndoStep | undefined): { kind: UndoKind; count: number } | null =>
      s ? { kind: s.kind, count: s.states.length } : null
    return { undo: peek(this.undoSteps.at(-1)), redo: peek(this.redoSteps.at(-1)) }
  }

  clear(): void {
    this.undoSteps = []
    this.redoSteps = []
  }
}
