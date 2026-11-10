import { describe, expect, it } from 'vitest'
import { APP_NAME, windowTitle } from '@shared/app-info'

describe('windowTitle', () => {
  it('is the app name when no folder is open', () => {
    expect(windowTitle()).toBe(APP_NAME)
  })

  it('shows the folder and marks unsaved changes', () => {
    expect(windowTitle('D:\\Trip')).toBe('D:\\Trip — GeoPhotos')
    expect(windowTitle('D:\\Trip', true)).toBe('* D:\\Trip — GeoPhotos')
  })
})
