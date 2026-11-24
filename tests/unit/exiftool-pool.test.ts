import { cpus } from 'node:os'
import { describe, expect, it } from 'vitest'
import { FILES_PER_WORKER, maxWorkers, workersFor } from '../../src/main/exiftool'

describe('exiftool processes for a folder (tz.md, п. 3.10)', () => {
  it('one per 30 files, at least one, at most the real cores (half the logical processors)', () => {
    expect(FILES_PER_WORKER).toBe(30)
    expect(maxWorkers()).toBe(Math.max(1, Math.floor(cpus().length / 2)))
    expect(workersFor(0)).toBe(1)
    expect(workersFor(20)).toBe(1)
    expect(workersFor(31)).toBe(Math.min(2, maxWorkers()))
    expect(workersFor(122)).toBe(Math.min(5, maxWorkers()))
    expect(workersFor(100000)).toBe(maxWorkers())
  })
})
