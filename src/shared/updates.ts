/**
 * Checking for a newer version (tz.md, п. 2.5): the version of the latest release on GitHub is in
 * its `latest.yml` (made by electron-builder for the updater). Pure logic, without Electron.
 */

export const REPO = 'rejgan318/geophotos'

/** `latest.yml` of the latest release: the redirect of GitHub always leads to the newest one. */
export const LATEST_YML_URL = `https://github.com/${REPO}/releases/latest/download/latest.yml`

/** The page of a release, opened for the zip version. */
export function releasePageUrl(version: string): string {
  return `https://github.com/${REPO}/releases/tag/v${version}`
}

/** The `version:` line of a `latest.yml`; null if there is none or it is not X.Y.Z. */
export function latestVersion(yml: string): string | null {
  const m = /^version:\s*['"]?(\d+\.\d+\.\d+)['"]?\s*$/m.exec(yml)
  return m ? m[1]! : null
}

/** True if `candidate` (X.Y.Z) is newer than `current` (X.Y.Z, maybe with -suffix). */
export function isNewer(candidate: string, current: string): boolean {
  const parse = (v: string): number[] | null => {
    const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v)
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
  }
  const a = parse(candidate)
  const b = parse(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!
  // The same numbers: a release is newer than a test build of it (0.30.0 > 0.30.0-test).
  return /-/.test(current) && !/-/.test(candidate)
}

/** What the status bar shows (tz.md, п. 2.5). */
export type UpdateState =
  /** Installed program: the new version is downloaded; a click restarts and installs it. */
  | { kind: 'ready'; version: string }
  /** Zip version: a newer one exists; a click opens its release page. */
  | { kind: 'available'; version: string }
