import { describe, expect, it } from 'vitest'
import type { Photo } from '@shared/photo'
import {
  afterRemoval,
  displayName,
  EMPTY_PROJECT,
  inFolder,
  isEmptyProject,
  isUnder,
  parentOf,
  renumber,
  titleFolder,
  withAdded,
  withRemoved,
  type Project
} from '@shared/project'

const TRIP = 'D:\\Trip'

const photo = (id: number, path: string, date: string | null): Photo =>
  ({ id, name: path, path, date, coords: null, modified: false }) as unknown as Photo

describe('project: paths (tz.md, пп. 3.1–3.2)', () => {
  it('the folder of a file, a root keeps its slash', () => {
    expect(parentOf('D:\\Trip\\IMG_1.jpg')).toBe('D:\\Trip')
    expect(parentOf('D:/Trip/2024/IMG_1.jpg')).toBe('D:\\Trip\\2024')
    expect(parentOf('E:\\IMG_1.jpg')).toBe('E:\\')
  })

  it('inside a folder at any level, whatever the case and slashes', () => {
    expect(isUnder('D:\\Trip\\IMG_1.jpg', TRIP)).toBe(true)
    expect(isUnder('d:/trip/2024/IMG_1.jpg', 'D:\\Trip\\')).toBe(true)
    expect(isUnder('D:\\Trip2\\IMG_1.jpg', TRIP)).toBe(false)
    expect(isUnder(TRIP, TRIP)).toBe(false)
    expect(isUnder('E:\\x\\a.jpg', 'E:\\')).toBe(true)
  })

  it('names: the path from the opened folder, the full path for files from elsewhere', () => {
    expect(displayName(TRIP, 'D:\\Trip\\IMG_1.jpg')).toBe('IMG_1.jpg')
    expect(displayName(TRIP, 'D:\\Trip\\2024-05\\IMG_1.jpg')).toBe('2024-05\\IMG_1.jpg')
    expect(displayName(TRIP, 'E:\\Phone\\IMG_2.jpg')).toBe('E:\\Phone\\IMG_2.jpg')
    expect(displayName(null, 'E:\\Phone\\IMG_2.jpg')).toBe('E:\\Phone\\IMG_2.jpg')
    expect(displayName('E:\\', 'E:\\IMG_2.jpg')).toBe('IMG_2.jpg')
  })

  it('files of the folder: its own, and of the subfolders only when they are loaded', () => {
    const flat: Project = { ...EMPTY_PROJECT, folder: TRIP }
    expect(inFolder(flat, 'D:\\Trip\\IMG_1.jpg')).toBe(true)
    expect(inFolder(flat, 'D:\\Trip\\2024\\IMG_1.jpg')).toBe(false)
    expect(inFolder({ ...flat, subfolders: true }, 'D:\\Trip\\2024\\IMG_1.jpg')).toBe(true)
    expect(inFolder(EMPTY_PROJECT, 'D:\\Trip\\IMG_1.jpg')).toBe(false)
  })

  it('the title names the folder; without one, the folder of the first added file (п. 4.13)', () => {
    expect(titleFolder({ ...EMPTY_PROJECT, folder: TRIP, added: ['E:\\a\\1.jpg'] })).toBe(TRIP)
    expect(titleFolder({ ...EMPTY_PROJECT, added: ['E:\\a\\1.jpg', 'F:\\b\\2.jpg'] })).toBe('E:\\a')
    expect(titleFolder(EMPTY_PROJECT)).toBe('')
    expect(isEmptyProject(EMPTY_PROJECT)).toBe(true)
    expect(isEmptyProject({ ...EMPTY_PROJECT, folder: TRIP })).toBe(false)
  })
})

describe('project: adding and taking off files (пп. 3.1, 6.6)', () => {
  const trip: Project = { ...EMPTY_PROJECT, folder: TRIP }

  it('files from elsewhere join the added ones once, in their order', () => {
    const p = withAdded(trip, ['E:\\Phone\\b.jpg', 'E:\\Phone\\a.jpg'])
    expect(p.added).toEqual(['E:\\Phone\\b.jpg', 'E:\\Phone\\a.jpg'])
    expect(withAdded(p, ['e:\\phone\\A.JPG']).added).toEqual(p.added)
  })

  it('a file of the folder taken off is remembered; added again — it comes back', () => {
    const off = withRemoved(trip, ['D:\\Trip\\IMG_1.jpg'])
    expect(off.removed).toEqual(['D:\\Trip\\IMG_1.jpg'])
    expect(off.added).toEqual([])
    const back = withAdded(off, ['D:\\Trip\\IMG_1.jpg'])
    expect(back.removed).toEqual([])
    expect(back.added).toEqual([])
  })

  it('an added file taken off is simply forgotten', () => {
    const p = withAdded(trip, ['E:\\Phone\\a.jpg', 'E:\\Phone\\b.jpg'])
    const off = withRemoved(p, ['E:\\Phone\\a.jpg'])
    expect(off.added).toEqual(['E:\\Phone\\b.jpg'])
    expect(off.removed).toEqual([])
  })

  it('a file of a subfolder not loaded is an added file, named by its path from the folder', () => {
    const p = withAdded(trip, ['D:\\Trip\\2024\\IMG_9.jpg'])
    expect(p.added).toEqual(['D:\\Trip\\2024\\IMG_9.jpg'])
    expect(displayName(p.folder, p.added[0]!)).toBe('2024\\IMG_9.jpg')
  })

  it('without a folder everything is added', () => {
    expect(withAdded(EMPTY_PROJECT, ['D:\\Trip\\IMG_1.jpg']).added).toEqual(['D:\\Trip\\IMG_1.jpg'])
  })
})

describe('project: the strip after a change', () => {
  it('photos come in time order with ids from 0, each with what goes with it', () => {
    const items = [
      { photo: photo(0, 'D:\\Trip\\b.jpg', '2024-05-02T10:00:00'), tag: 'b' },
      { photo: photo(1, 'E:\\a.jpg', '2024-05-01T10:00:00'), tag: 'a' },
      { photo: photo(2, 'D:\\Trip\\c.jpg', null), tag: 'c' }
    ]
    const out = renumber(items)
    expect(out.map((i) => i.tag)).toEqual(['a', 'b', 'c'])
    expect(out.map((i) => i.photo.id)).toEqual([0, 1, 2])
  })

  it('after taking off: the next photo, else the one before, else none (п. 6.6)', () => {
    const order = [0, 1, 2, 3, 4]
    expect(afterRemoval(order, new Set([1, 2]))).toBe(3)
    expect(afterRemoval(order, new Set([4]))).toBe(3)
    expect(afterRemoval(order, new Set([1, 4]))).toBe(3)
    expect(afterRemoval(order, new Set([0, 1, 2, 3, 4]))).toBeNull()
    expect(afterRemoval(order, new Set())).toBeNull()
  })
})
