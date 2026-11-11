import { describe, expect, it } from 'vitest'
import { isBatch, parseBatchArgs } from '@shared/batch-args'

describe('batch mode parameters (tz.md, п. 10)', () => {
  it('is recognised by --batch anywhere', () => {
    expect(isBatch(['--batch', 'D:\\Trip'])).toBe(true)
    expect(isBatch(['.', '--BATCH'])).toBe(true)
    expect(isBatch(['D:\\Trip'])).toBe(false)
  })

  it('defaults: address and altitude, no subfolders, no overwriting', () => {
    expect(parseBatchArgs(['--batch', 'D:\\Trip', 'D:\\a.jpg'])).toEqual({
      paths: ['D:\\Trip', 'D:\\a.jpg'],
      address: true,
      altitude: true,
      subfolders: false,
      overwrite: false
    })
  })

  it('options in any place and case', () => {
    expect(parseBatchArgs(['--batch', '--No-Address', 'D:\\Trip', '--subfolders', '--overwrite'])).toEqual({
      paths: ['D:\\Trip'],
      address: false,
      altitude: true,
      subfolders: true,
      overwrite: true
    })
  })

  it('development: the app folder and Electron switches are skipped', () => {
    expect(parseBatchArgs(['.', '--remote-debugging-port=9333', '--batch', 'D:\\Trip'], 'D:\\dev\\geophotos')).toMatchObject({
      paths: ['D:\\Trip']
    })
    expect(parseBatchArgs(['D:\\dev\\geophotos\\', '--batch', 'D:\\Trip'], 'D:\\dev\\geophotos')).toMatchObject({ paths: ['D:\\Trip'] })
  })

  it('mistakes are reported', () => {
    expect(parseBatchArgs(['--batch'])).toEqual({ error: 'No folder or photo given' })
    expect(parseBatchArgs(['--batch', '--no-adress', 'D:\\Trip'])).toEqual({ error: 'Unknown parameter: --no-adress' })
    expect(parseBatchArgs(['--batch', '--no-address', '--no-altitude', 'D:\\Trip'])).toMatchObject({ error: expect.stringMatching(/Nothing to do/) })
  })
})
