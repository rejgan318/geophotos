import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { cpus } from 'node:os'

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

/** Files one exiftool process reads in about a second: a process started for fewer does not pay off (tz.md, п. 3.10). */
export const FILES_PER_WORKER = 30

/**
 * Real cores: the logical processors of a CPU are usually two per core, and exiftool gains
 * nothing from the second one (measured: 8 processes on 16 logical processors are as fast as 15).
 */
export function maxWorkers(): number {
  return Math.max(1, Math.floor(cpus().length / 2))
}

/** exiftool processes for so many files (tz.md, п. 3.10): one per 30 files, at most the real cores. */
export function workersFor(files: number): number {
  return Math.min(maxWorkers(), Math.max(1, Math.ceil(files / FILES_PER_WORKER)))
}

/**
 * exiftool processes kept running with `-stay_open` (make-project.md, п. 2; tz.md, п. 3.10): one
 * at first; more for a big folder (`setWorkers`), each command to the least busy one. Reading many
 * files is split among them (`jsonFiles`).
 */
export class ExifTool {
  private workers: ExifToolWorker[]

  constructor(private readonly exiftoolPath: string) {
    this.workers = [new ExifToolWorker(exiftoolPath)]
  }

  /** How many processes there are now. */
  get size(): number {
    return this.workers.length
  }

  /**
   * Keeps `n` processes: more are started when needed, extra ones close (after the command they
   * are running). At least one.
   */
  setWorkers(n: number): void {
    const want = Math.max(1, Math.floor(n))
    while (this.workers.length < want) this.workers.push(new ExifToolWorker(this.exiftoolPath))
    while (this.workers.length > want) this.workers.pop()!.closeWhenIdle()
  }

  /** At least `n` processes (never fewer than now). */
  ensureWorkers(n: number): void {
    if (n > this.workers.length) this.setWorkers(n)
  }

  /** See ExifToolWorker.run; the command goes to the least busy process. */
  run(args: string[]): Promise<{ stdout: Buffer; stderr: string }> {
    let best = this.workers[0]!
    for (const w of this.workers) if (w.load < best.load) best = w
    return best.run(args)
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

  /**
   * Reads many files with the same options, split among the processes (as many as the files call
   * for, `workersFor`); the records of all parts together.
   */
  async jsonFiles(args: string[], files: readonly string[]): Promise<Record<string, unknown>[]> {
    if (!files.length) return []
    this.ensureWorkers(workersFor(files.length))
    const parts = Math.min(this.workers.length, Math.ceil(files.length / 4))
    const chunks = Array.from({ length: parts }, (_, i) => files.filter((_, j) => j % parts === i))
    const results = await Promise.all(chunks.map((c) => this.json([...args, ...c])))
    return results.flat()
  }

  /** Extracts a binary tag (e.g. PreviewImage); null when the file has none. */
  async binary(file: string, tag: string): Promise<Buffer | null> {
    const { stdout } = await this.run(['-b', `-${tag}`, file])
    return stdout.length ? stdout : null
  }

  close(): void {
    for (const w of this.workers) w.close()
    this.workers = [new ExifToolWorker(this.exiftoolPath)]
  }
}

/**
 * One exiftool process kept running with `-stay_open`: commands are sent through stdin and run
 * one at a time. File names are passed and returned as UTF-8 (needed for non-Latin names on
 * Windows). Started with its first command.
 */
class ExifToolWorker {
  /** Close as soon as the queue is empty (the pool no longer needs this process). */
  private retiring = false
  private proc: ChildProcessWithoutNullStreams | null = null
  private queue: Pending[] = []
  private current: Pending | null = null
  private stdout: Buffer[] = []
  private stderr = ''
  private nextId = 1

  constructor(private readonly exiftoolPath: string) {}

  /**
   * Runs one exiftool command; resolves with raw stdout (binary-safe) and stderr.
   * Arguments go to exiftool one per line: a line break inside a value (an address from a file or
   * from a service) would make the rest of it exiftool options, and `-if` runs Perl code. Such a
   * command is refused.
   */
  run(args: string[]): Promise<{ stdout: Buffer; stderr: string }> {
    const bad = args.find((a) => /[\r\n\0]/.test(a))
    if (bad !== undefined) {
      return Promise.reject(new Error(`An exiftool argument contains a line break: ${JSON.stringify(bad.slice(0, 80))}`))
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ id: this.nextId++, args, resolve, reject })
      this.pump()
    })
  }

  /** Commands waiting and running: the pool sends new ones to the least busy process. */
  get load(): number {
    return this.queue.length + (this.current ? 1 : 0)
  }

  /** Closes now if idle, else after the commands already given to it. */
  closeWhenIdle(): void {
    this.retiring = true
    if (!this.load) this.close()
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
    if (this.current) return
    if (!this.queue.length) {
      if (this.retiring) this.close()
      return
    }
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
