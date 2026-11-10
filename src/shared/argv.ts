/**
 * What to open from the launch parameters (tz.md, п. 3.1): the last argument that is an existing
 * folder or file. Switches (starting with "-") and the app's own folder (in development) are skipped.
 */
export function pathFromArgv(
  args: string[],
  exists: (p: string) => boolean,
  appPath?: string
): string | undefined {
  const norm = (p: string): string => p.replace(/[\\/]+$/, '').toLowerCase()
  const app = appPath ? norm(appPath) : undefined
  for (let i = args.length - 1; i >= 0; i--) {
    const a = args[i]!
    if (!a || a.startsWith('-') || a === '.') continue
    if (app && norm(a) === app) continue
    if (exists(a)) return a
  }
  return undefined
}
