import { comparePhotos } from './metadata'
import type { Photo } from './photo'
import { samePath } from './recent'

/**
 * The project (tz.md, п. 3.1): what the strip is made of — the opened folder (whole, with or
 * without its subfolders, п. 3.2) and files added to it. Opening a folder starts a new project;
 * adding files keeps it. Files of the folder taken off the strip (Del, п. 6.6) are remembered,
 * so Refresh (п. 3.8) and the next run (п. 7.1) do not bring them back.
 */
export interface Project {
  /** The opened folder; null — only added files. */
  folder: string | null
  /** Photos from the subfolders of the folder are loaded too. */
  subfolders: boolean
  /** Files added outside the folder (and its loaded subfolders), in the order they came. */
  added: string[]
  /** Files of the folder taken off the strip. */
  removed: string[]
}

export const EMPTY_PROJECT: Project = { folder: null, subfolders: false, added: [], removed: [] }

const norm = (p: string): string => p.replace(/\//g, '\\').replace(/\\+$/, '')

/** The folder a file is in. */
export function parentOf(path: string): string {
  const p = norm(path)
  const i = p.lastIndexOf('\\')
  if (i < 0) return ''
  // "E:\photo.jpg" → "E:\" (a root keeps its slash).
  return i === 2 && p[1] === ':' ? p.slice(0, 3) : p.slice(0, i)
}

/** Whether the path is inside the folder, at any level (not the folder itself). */
export function isUnder(path: string, folder: string): boolean {
  const f = norm(folder).toLowerCase()
  const p = norm(path).toLowerCase()
  return p.length > f.length + 1 && p.startsWith(f.endsWith('\\') ? f : `${f}\\`)
}

/**
 * Name of a photo in the strip, status bar and photo view (tz.md, п. 3.2): the path from the
 * opened folder for its files (`2024-05\IMG_0001.jpg`), the full path for other added files.
 */
export function displayName(folder: string | null, path: string): string {
  const p = norm(path)
  if (folder && isUnder(p, folder)) {
    const f = norm(folder)
    return p.slice(f.endsWith('\\') ? f.length : f.length + 1)
  }
  return p
}

/** Whether a file is one the opened folder itself loads (the folder, or its subfolders if loaded). */
export function inFolder(project: Project, path: string): boolean {
  const { folder } = project
  if (!folder) return false
  return project.subfolders ? isUnder(path, folder) : samePath(parentOf(path), folder)
}

/**
 * The folder the window title names (tz.md, п. 4.13): the opened one; without it, the folder
 * of the first added file; '' when the project is empty.
 */
export function titleFolder(project: Project): string {
  if (project.folder) return project.folder
  const first = project.added[0]
  return first ? parentOf(first) : ''
}

/** Whether the project has nothing in it: no folder, no added files. */
export function isEmptyProject(project: Project): boolean {
  return !project.folder && project.added.length === 0
}

const has = (list: readonly string[], path: string): boolean => list.some((p) => samePath(p, path))
const without = (list: readonly string[], paths: readonly string[]): string[] => list.filter((p) => !has(paths, p))

/**
 * The project after files were added (Add Files…, dropped files, п. 3.1): files of the folder
 * taken off earlier come back (out of `removed`), others join `added`. Files already in it are
 * left as they are.
 */
export function withAdded(project: Project, paths: readonly string[]): Project {
  const back = paths.filter((p) => inFolder(project, p))
  const others = paths.filter((p) => !inFolder(project, p) && !has(project.added, p))
  const added = [...project.added]
  for (const p of others) if (!has(added, p)) added.push(p)
  return { ...project, added, removed: without(project.removed, back) }
}

/** The project after files were taken off the strip (Del, п. 6.6). */
export function withRemoved(project: Project, paths: readonly string[]): Project {
  const ofFolder = paths.filter((p) => inFolder(project, p) && !has(project.removed, p))
  return { ...project, added: without(project.added, paths), removed: [...project.removed, ...ofFolder] }
}

/**
 * Photos of the strip in time order (tz.md, п. 4.2) with their ids renumbered from 0: after
 * files were added or taken off. What goes with each photo (`T`) keeps its place by it.
 */
export function renumber<T extends { photo: Photo }>(items: readonly T[]): T[] {
  return [...items]
    .sort((a, b) => comparePhotos(a.photo, b.photo))
    .map((it, id) => ({ ...it, photo: { ...it.photo, id } }))
}

/**
 * The photo to be current after some were taken off the strip (п. 6.6): the next one in the
 * strip after the last of them, else the nearest one before it; null if none is left.
 * `order` is the strip before; returns a photo of it that stays.
 */
export function afterRemoval(order: readonly number[], removed: ReadonlySet<number>): number | null {
  let last = -1
  order.forEach((id, i) => {
    if (removed.has(id)) last = i
  })
  if (last < 0) return null
  for (let i = last + 1; i < order.length; i++) if (!removed.has(order[i]!)) return order[i]!
  for (let i = last - 1; i >= 0; i--) if (!removed.has(order[i]!)) return order[i]!
  return null
}
