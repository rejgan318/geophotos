export const MAX_RECENT = 10

/** Windows paths: same folder regardless of case and trailing slash. */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string): string => p.replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase()
  return norm(a) === norm(b)
}

/** Puts the folder first, without duplicates, at most `max` entries (tz.md, п. 3.1). */
export function addRecent(list: readonly string[], folder: string, max = MAX_RECENT): string[] {
  return [folder, ...list.filter((f) => !samePath(f, folder))].slice(0, max)
}

export function removeRecent(list: readonly string[], folder: string): string[] {
  return list.filter((f) => !samePath(f, folder))
}
