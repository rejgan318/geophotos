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
