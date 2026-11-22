/**
 * Where exiftool is usually put on Windows (tz.md, п. 2.2): looked at when the path of the
 * settings does not work. The first one that runs is used.
 */
export function exiftoolCandidates(env: Record<string, string | undefined>, programDir: string): string[] {
  const list: string[] = []
  const add = (base: string | undefined, ...parts: string[]): void => {
    if (base) list.push([base.replace(/[\\/]+$/, ''), ...parts].join('\\'))
  }
  // Next to the program.
  add(programDir, 'exiftool.exe')
  add(programDir, 'exiftool', 'exiftool.exe')
  // The installer of Oliver Betz (also what winget installs): for the user or for all users.
  add(env['LOCALAPPDATA'], 'Programs', 'ExifTool', 'ExifTool.exe')
  add(env['ProgramFiles'], 'ExifTool', 'ExifTool.exe')
  add(env['ProgramFiles(x86)'], 'ExifTool', 'ExifTool.exe')
  // winget links, Chocolatey, Scoop.
  add(env['LOCALAPPDATA'], 'Microsoft', 'WinGet', 'Links', 'exiftool.exe')
  add(env['ProgramData'], 'chocolatey', 'bin', 'exiftool.exe')
  add(env['USERPROFILE'], 'scoop', 'shims', 'exiftool.exe')
  // The way exiftool.org describes for the plain download: renamed and put into Windows.
  add(env['SystemRoot'], 'exiftool.exe')
  const seen = new Set<string>()
  return list.filter((p) => {
    const k = p.toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** The page to download exiftool from. */
export const EXIFTOOL_DOWNLOAD_URL = 'https://exiftool.org/'

/**
 * Installing exiftool for GeoPhotos (tz.md, п. 2.2): the latest version and the checksums come
 * from exiftool.org; the zip itself from SourceForge, where exiftool.org links it. The checksum of
 * exiftool.org is what makes the download from a mirror trustworthy.
 */
export const EXIFTOOL_VERSION_URL = 'https://exiftool.org/ver.txt'
export const EXIFTOOL_CHECKSUMS_URL = 'https://exiftool.org/checksums.txt'

/** "13.64" from ver.txt; null if it is not a version. */
export function parseExiftoolVersion(text: string): string | null {
  const v = text.trim()
  return /^\d{1,3}\.\d{1,3}$/.test(v) ? v : null
}

/** Name of the 64-bit Windows zip: "exiftool-13.64_64.zip". */
export function exiftoolZipName(version: string): string {
  return `exiftool-${version}_64.zip`
}

export function exiftoolZipUrl(version: string): string {
  return `https://sourceforge.net/projects/exiftool/files/${exiftoolZipName(version)}/download`
}

/** SHA-256 of a file from checksums.txt ("SHA2-256(name)= hex"), lower case; null if not there. */
export function parseSha256(checksums: string, fileName: string): string | null {
  for (const line of checksums.split(/\r?\n/)) {
    const m = /^SHA2-256\(([^)]+)\)\s*=\s*([0-9a-f]{64})\s*$/i.exec(line.trim())
    if (m && m[1] === fileName) return m[2]!.toLowerCase()
  }
  return null
}
