import { describe, expect, it } from 'vitest'
import { APP_NAME, windowTitle } from '@shared/app-info'

describe('windowTitle', () => {
  it('is the app name when no folder is open', () => {
    expect(windowTitle()).toBe(APP_NAME)
  })

  it('shows the name of the folder (not its whole path) and marks unsaved changes (tz.md, п. 4.13)', () => {
    expect(windowTitle('D:\\Photos\\2024\\Trip')).toBe('Trip — GeoPhotos')
    expect(windowTitle('D:\\Photos\\2024\\Trip\\')).toBe('Trip — GeoPhotos')
    expect(windowTitle('D:\\Trip', true)).toBe('* Trip — GeoPhotos')
    // A whole disk has no name: the drive is shown.
    expect(windowTitle('E:\\')).toBe('E:\\ — GeoPhotos')
  })
})
