import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

/** Checks that exiftool starts; returns its version (tz.md, п. 2.2). */
export function exiftoolVersion(exiftoolPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(exiftoolPath, ['-ver'], { timeout: 20000, windowsHide: true }, (err, stdout) => {
      if (err) reject(err)
      else resolve(stdout.trim())
    })
  })
}

interface Pending {
  id: number
  args: string[]
  resolve: (r: { stdout: Buffer; stderr: string }) => void
  reject: (e: Error) => void
}

/**
 * One exiftool process kept running with `-stay_open` (make-project.md, п. 2):
 * commands are sent through stdin and run one at a time.
 * File names are passed and returned as UTF-8 (needed for non-Latin names on Windows).
 */
export class ExifTool {
  private proc: ChildProcessWithoutNullStreams | null = null
  private queue: Pending[] = []
  private current: Pending | null = null
  private stdout: Buffer[] = []
  private stderr = ''
  private nextId = 1

  constructor(private readonly exiftoolPath: string) {}

  /** Runs one exiftool command; resolves with raw stdout (binary-safe) and stderr. */
  run(args: string[]): Promise<{ stdout: Buffer; stderr: string }> {
    return new Promise((resolve, reject) => {
      this.queue.push({ id: this.nextId++, args, resolve, reject })
      this.pump()
    })
  }

  /** Runs a command with `-j` and returns the parsed JSON array. */
  async json(args: string[]): Promise<Record<string, unknown>[]> {
    const { stdout, stderr } = await this.run(['-j', ...args])
    const text = stdout.toString('utf8').trim()
    if (!text) {
      if (stderr.trim()) throw new Error(stderr.trim())
      return []
    }
    return JSON.parse(text) as Record<string, unknown>[]
  }

  /** Extracts a binary tag (e.g. PreviewImage); null when the file has none. */
  async binary(file: string, tag: string): Promise<Buffer | null> {
    const { stdout } = await this.run(['-b', `-${tag}`, file])
    return stdout.length ? stdout : null
  }

  close(): void {
    const proc = this.proc
    this.proc = null
    if (!proc) return
    try {
      proc.stdin.write('-stay_open\nFalse\n')
      proc.stdin.end()
    } catch {
      proc.kill()
    }
  }

  private start(): ChildProcessWithoutNullStreams {
    const proc = spawn(
      this.exiftoolPath,
      ['-stay_open', 'True', '-@', '-', '-common_args', '-charset', 'filename=utf8', '-charset', 'utf8'],
      { windowsHide: true }
    )
    proc.stdout.on('data', (chunk: Buffer) => this.onStdout(chunk))
    proc.stderr.on('data', (chunk: Buffer) => this.onStderr(chunk))
    const fail = (err: Error): void => {
      if (this.proc !== proc) return
      this.proc = null
      const pending = [...(this.current ? [this.current] : []), ...this.queue]
      this.current = null
      this.queue = []
      for (const p of pending) p.reject(err)
    }
    proc.on('error', fail)
    proc.on('exit', (code) => fail(new Error(`exiftool exited with code ${code}`)))
    return proc
  }

  private pump(): void {
    if (this.current || !this.queue.length) return
    this.proc ??= this.start()
    const cmd = this.queue.shift()!
    this.current = cmd
    this.stdout = []
    this.stderr = ''
    // -echo4 prints the marker to stderr after the command, so stderr of this command is complete.
    const lines = [...cmd.args, '-echo4', `{ready${cmd.id}}`, `-execute${cmd.id}`]
    this.proc.stdin.write(lines.join('\n') + '\n')
  }

  private onStdout(chunk: Buffer): void {
    this.stdout.push(chunk)
    this.tryFinish()
  }

  private onStderr(chunk: Buffer): void {
    this.stderr += chunk.toString('utf8')
    this.tryFinish()
  }

  private tryFinish(): void {
    const cmd = this.current
    if (!cmd) return
    const marker = `{ready${cmd.id}}`
    const errEnd = this.stderr.lastIndexOf(marker)
    if (errEnd < 0) return
    const out = Buffer.concat(this.stdout)
    const outEnd = out.lastIndexOf(marker)
    if (outEnd < 0) return
    this.current = null
    // The line break after the previous marker may arrive in this command's output: skip it.
    let start = 0
    while (start < outEnd && (out[start] === 0x0d || out[start] === 0x0a)) start++
    const stdout = out.subarray(start, outEnd)
    const stderr = this.stderr.slice(0, errEnd)
    cmd.resolve({ stdout, stderr })
    this.pump()
  }
}
