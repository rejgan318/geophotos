import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { applyEdits, modify, parse } from 'jsonc-parser'
import { MAX_RECENT } from '@shared/recent'

/**
 * Program state between runs (tz.md, п. 7.5): a service file in userData, separate from the
 * settings, not edited by the user. It keeps the recent folders (п. 3.1), latest first, and the
 * folder and photo open when the program was closed (п. 7.1).
 */
export interface AppState {
  recentFolders: string[]
  /** The open folder and the current photo at exit; opened at the next start without a parameter. */
  lastSession: { folder: string; photo: string | null } | null
}

const EMPTY: AppState = { recentFolders: [], lastSession: null }

function readSession(v: unknown): AppState['lastSession'] {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const s = v as Record<string, unknown>
  if (typeof s['folder'] !== 'string' || !s['folder']) return null
  return { folder: s['folder'], photo: typeof s['photo'] === 'string' && s['photo'] ? s['photo'] : null }
}

/** Reads the state; a missing or broken file gives the default (empty) state. */
export function readState(file: string): AppState {
  try {
    const value = parse(readFileSync(file, 'utf8')) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...EMPTY }
    const v = value as Record<string, unknown>
    const list = Array.isArray(v['recentFolders']) ? v['recentFolders'] : []
    const recentFolders = list.filter((f): f is string => typeof f === 'string' && f !== '').slice(0, MAX_RECENT)
    // Earlier builds kept only the last folder.
    if (!recentFolders.length && typeof v['lastFolder'] === 'string' && v['lastFolder']) {
      recentFolders.push(v['lastFolder'])
    }
    return { recentFolders, lastSession: readSession(v['lastSession']) }
  } catch {
    return { ...EMPTY }
  }
}

/**
 * Writes the state through a temporary file, so a crash never leaves a half-written file.
 * If the file is open in another program, replacing it fails on Windows: then it is
 * overwritten in place. Throws only if neither works.
 */
export function writeState(file: string, state: AppState): void {
  let text = '{}'
  for (const [key, value] of Object.entries(state)) {
    text = applyEdits(text, modify(text, [key], value, { formattingOptions: { insertSpaces: true, tabSize: 2 } }))
  }
  text += '\n'
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  try {
    writeFileSync(tmp, text, 'utf8')
    renameSync(tmp, file)
  } catch {
    rmSync(tmp, { force: true })
    writeFileSync(file, text, 'utf8')
  }
}
