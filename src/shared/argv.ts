/**
 * What to open from the launch parameters (tz.md, п. 3.1): every argument that is an existing
 * folder or file, in their order. Switches (starting with "-") and the app's own folder (in
 * development) are skipped.
 */
export function pathsFromArgv(args: string[], exists: (p: string) => boolean, appPath?: string): string[] {
  const norm = (p: string): string => p.replace(/[\\/]+$/, '').toLowerCase()
  const app = appPath ? norm(appPath) : undefined
  return args.filter((a) => !!a && !a.startsWith('-') && a !== '.' && !(app && norm(a) === app) && exists(a))
}
