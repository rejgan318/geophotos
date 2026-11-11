import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import Ajv, { type ErrorObject } from 'ajv'
import {
  applyEdits,
  modify,
  parse,
  parseTree,
  printParseErrorCode,
  type Edit,
  type Node as JsonNode,
  type ParseError
} from 'jsonc-parser'
import { mergeSettings, type Settings } from '@shared/settings'

/** A problem in a config file: file, field, reason (tz-config.md, п. 4.3). */
export interface ConfigProblem {
  file: string
  field: string
  reason: string
}

export interface SettingsPaths {
  defaults: string
  schema: string
  user: string
}

export interface LoadedSettings {
  settings: Settings
  /** Problems in the user file; when present, the defaults are used instead of it. */
  userProblems: ConfigProblem[]
}

export class DefaultSettingsError extends Error {
  constructor(readonly problems: ConfigProblem[]) {
    super(problems.map(formatProblem).join('\n'))
  }
}

export function formatProblem(p: ConfigProblem): string {
  return `${p.file}: ${p.field} — ${p.reason}`
}

/**
 * Reads the defaults and the user file, checks both by the schema and merges them (tz.md, пп. 8.3–8.4).
 * A broken defaults file is a program error: throws DefaultSettingsError.
 */
export function loadSettings(paths: SettingsPaths): LoadedSettings {
  const ajv = new Ajv({ allErrors: true })
  const validate = ajv.compile(readJsonc(paths.schema).value as object)

  const check = (file: string, value: unknown): ConfigProblem[] =>
    validate(value) ? [] : (validate.errors ?? []).map((e) => ajvProblem(file, e))

  const defFile = basename(paths.defaults)
  const def = readJsonc(paths.defaults)
  const defProblems = def.problems.length ? def.problems : check(defFile, def.value)
  if (defProblems.length) throw new DefaultSettingsError(defProblems)
  const defaults = def.value as Settings

  if (!existsSync(paths.user)) return { settings: defaults, userProblems: [] }

  const user = readJsonc(paths.user)
  if (user.problems.length) return { settings: defaults, userProblems: user.problems }

  const userFile = paths.user
  if (typeof user.value !== 'object' || user.value === null || Array.isArray(user.value)) {
    return {
      settings: defaults,
      userProblems: [{ file: userFile, field: '(root)', reason: 'must be an object' }]
    }
  }

  // The user file holds only changed fields, so it is checked merged with the defaults:
  // field paths are the same in both, and every reported field comes from the user file.
  const merged = mergeSettings(defaults, user.value)
  const problems = check(userFile, merged)
  if (problems.length) return { settings: defaults, userProblems: problems }
  return { settings: merged, userProblems: [] }
}

function readJsonc(file: string): { value: unknown; problems: ConfigProblem[] } {
  const name = file
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (e) {
    return { value: undefined, problems: [{ file: name, field: '(file)', reason: String(e) }] }
  }
  const errors: ParseError[] = []
  const value: unknown = parse(text, errors, { allowTrailingComma: true })
  const problems = errors.map((e) => {
    const { line, column } = lineColumn(text, e.offset)
    return {
      file: name,
      field: `line ${line}, column ${column}`,
      reason: printParseErrorCode(e.error)
    }
  })
  return { value, problems }
}

function lineColumn(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset).split('\n')
  return { line: before.length, column: (before.at(-1)?.length ?? 0) + 1 }
}

function ajvProblem(file: string, e: ErrorObject): ConfigProblem {
  const path = e.instancePath.split('/').filter(Boolean)
  if (e.keyword === 'additionalProperties') {
    path.push(String((e.params as { additionalProperty: string }).additionalProperty))
    return { file, field: path.join('.'), reason: 'unknown field' }
  }
  return { file, field: path.join('.') || '(root)', reason: e.message ?? e.keyword }
}

/**
 * Creates the user settings file (tz-config.md, п. 6.3) when it does not exist or holds nothing
 * but `$schema`: every field with its default value and a comment from the schema above it.
 * A file with fields is never overwritten. Returns true if the file was (re)created.
 */
export function ensureUserSettingsFile(userPath: string, schemaPath: string, defaultsPath: string): boolean {
  if (existsSync(userPath)) {
    const current = parse(readFileSync(userPath, 'utf8')) as unknown
    const keys =
      current && typeof current === 'object' && !Array.isArray(current)
        ? Object.keys(current).filter((k) => k !== '$schema')
        : ['(not an object)']
    if (keys.length) return false
  }
  const schema = readJsonc(schemaPath).value as SchemaNode
  const defaults = readJsonc(defaultsPath).value as Record<string, unknown>
  mkdirSync(dirname(userPath), { recursive: true })
  writeFileSync(userPath, buildUserSettingsText(defaults, schema, pathToFileURL(schemaPath).href), 'utf8')
  return true
}

/**
 * Sets one field of the user settings file, keeping its comments and layout (tz-config.md,
 * п. 5.1). A missing file is created first, as by Open Settings File (п. 6.3).
 */
export function setUserSetting(
  userPath: string,
  schemaPath: string,
  defaultsPath: string,
  field: string[],
  value: unknown
): void {
  ensureUserSettingsFile(userPath, schemaPath, defaultsPath)
  const text = readFileSync(userPath, 'utf8')
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const edits = modify(text, field, value, { formattingOptions: { ...FORMAT, eol } })
  writeFileSync(userPath, applyEdits(text, edits), 'utf8')
}

/** The part of JSON Schema used for comments. */
interface SchemaNode {
  description?: string
  enum?: unknown[]
  minimum?: number
  maximum?: number
  properties?: Record<string, SchemaNode>
  additionalProperties?: SchemaNode | boolean
  $ref?: string
  definitions?: Record<string, SchemaNode>
}

const FORMAT = { insertSpaces: true, tabSize: 2, eol: '\n' }
const HEADER = [
  'GeoPhotos user settings. Change values right here; changes apply after restart.',
  'Every field starts with its default value. A field removed from this file takes',
  'its default value. Hints and checks while typing: open in an editor that supports',
  'JSON Schema, e.g. VS Code.'
]

/**
 * Text of a full user settings file. Values are written with jsonc-parser `modify`
 * (tz-config.md, п. 5); comments are inserted above each property.
 */
export function buildUserSettingsText(
  defaults: Record<string, unknown>,
  schema: SchemaNode,
  schemaUrl: string
): string {
  let text = '{}'
  const set = (path: string[], value: unknown): void => {
    text = applyEdits(text, modify(text, path, value, { formattingOptions: FORMAT }))
  }
  set(['$schema'], schemaUrl)
  for (const [key, value] of Object.entries(defaults)) if (key !== '$schema') set([key], value)

  const root = parseTree(text)
  const edits: Edit[] = []
  const lineStart = (offset: number): number => text.lastIndexOf('\n', offset - 1) + 1

  const header = HEADER.map((l) => `  // ${l}\n`).join('')
  const schemaProp = root?.children?.find((p) => p.children?.[0]?.value === '$schema')
  if (schemaProp) edits.push({ offset: lineStart(schemaProp.offset), length: 0, content: header })

  // Entries of a map (like tile sources) share one schema: each of their fields is
  // explained where it first appears, not in every entry.
  const commented = new Set<SchemaNode>()
  const walk = (obj: JsonNode | undefined, node: SchemaNode | undefined, depth: number, inMapEntry: boolean): void => {
    for (const prop of obj?.children ?? []) {
      const key = String(prop.children?.[0]?.value)
      if (key === '$schema') continue
      const sub = childSchema(schema, node, key)
      const lines = sub ? commentLines(sub) : []
      if (lines.length && sub && !commented.has(sub)) {
        if (inMapEntry) commented.add(sub)
        const indent = '  '.repeat(depth)
        const blank = depth === 1 ? '\n' : ''
        edits.push({
          offset: lineStart(prop.offset),
          length: 0,
          content: blank + lines.map((l) => `${indent}// ${l}\n`).join('')
        })
      }
      const value = prop.children?.[1]
      if (value?.type === 'object') {
        walk(value, sub ? resolve(schema, sub) : undefined, depth + 1, isMapEntry(node))
      }
    }
  }
  walk(root, schema, 1, false)
  return applyEdits(text, edits) + '\n'
}

function resolve(root: SchemaNode, node: SchemaNode): SchemaNode {
  if (!node.$ref) return node
  const name = node.$ref.replace('#/definitions/', '')
  return root.definitions?.[name] ?? node
}

function isMapEntry(node: SchemaNode | undefined): boolean {
  return !!node && !node.properties && typeof node.additionalProperties === 'object'
}

function childSchema(root: SchemaNode, node: SchemaNode | undefined, key: string): SchemaNode | undefined {
  if (!node) return undefined
  const n = resolve(root, node)
  const sub = n.properties?.[key] ?? (typeof n.additionalProperties === 'object' ? n.additionalProperties : undefined)
  return sub ? resolve(root, sub) : undefined
}

/** Description wrapped to ~80 characters, then allowed values or range. */
function commentLines(node: SchemaNode): string[] {
  const lines = node.description ? wrap(node.description, 80) : []
  if (node.enum) lines.push(`Allowed: ${node.enum.map((v) => String(v)).join(', ')}.`)
  else if (node.minimum !== undefined && node.maximum !== undefined) lines.push(`Range: ${node.minimum} to ${node.maximum}.`)
  else if (node.minimum !== undefined) lines.push(`Minimum: ${node.minimum}.`)
  return lines
}

function wrap(text: string, width: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/)) {
    if (line && line.length + word.length + 1 > width) {
      lines.push(line)
      line = word
    } else {
      line = line ? `${line} ${word}` : word
    }
  }
  if (line) lines.push(line)
  return lines
}
