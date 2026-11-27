import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EGG_ZOOM, eggCode, eggsInView, eggTitle, shotFits, validEggs, validFoundEggs } from '@shared/eggs'

const EGGS_DIR = join(__dirname, '..', '..', 'eggs')

describe('easter eggs (tz.md, п. 9.3)', () => {
  it('the coding is undone by coding again', () => {
    const data = new Uint8Array([0, 1, 2, 255, 0xff, 0xd8, 42, 7, 9, 10, 11, 12, 13, 14, 15])
    const coded = eggCode(data)
    expect(coded).not.toEqual(data)
    expect(eggCode(coded)).toEqual(data)
  })

  it('the eggs of the program: 14, each with a JPEG and its name in three languages', () => {
    const list = validEggs(JSON.parse(new TextDecoder().decode(eggCode(readFileSync(join(EGGS_DIR, 'eggs.bin'))))))
    expect(list).toHaveLength(14)
    for (const egg of list) {
      for (const lang of ['en', 'ru', 'uk']) expect(egg.title[lang]).toBeTruthy()
      const jpeg = eggCode(readFileSync(join(EGGS_DIR, egg.file)))
      expect([jpeg[0], jpeg[1], jpeg[2]]).toEqual([0xff, 0xd8, 0xff])
    }
  })

  it('a stored file is not a plain JPEG', () => {
    const raw = readFileSync(join(EGGS_DIR, '01.bin'))
    expect([raw[0], raw[1]]).not.toEqual([0xff, 0xd8])
  })

  const view = { south: 48.85, west: 2.28, north: 48.87, east: 2.31 }
  const tower = { id: 1, lat: 48.8584, lon: 2.2945 }

  it('found when well inside the view, from the egg zoom', () => {
    expect(eggsInView([tower], view, EGG_ZOOM, new Set())).toEqual([tower])
    expect(eggsInView([tower], view, EGG_ZOOM + 2, new Set())).toEqual([tower])
    expect(eggsInView([tower], view, EGG_ZOOM - 1, new Set())).toEqual([])
  })

  it('not found again, nor at the very edge of the view', () => {
    expect(eggsInView([tower], view, EGG_ZOOM, new Set([1]))).toEqual([])
    const edge = { id: 2, lat: 48.8698, lon: 2.2945 }
    expect(eggsInView([edge], view, EGG_ZOOM, new Set())).toEqual([])
  })

  it('found on another copy of the world (the map scrolled past 180°)', () => {
    const shifted = { south: 48.85, west: 362.28, north: 48.87, east: 362.31 }
    expect(eggsInView([tower], shifted, EGG_ZOOM, new Set())).toEqual([tower])
  })

  it('the place of shooting is the point when it is on the typical screen with the sight in the middle', () => {
    // About 140 m away: the place of shooting.
    expect(shotFits({ lat: 45, lon: 10 }, { lat: 45.001, lon: 10.001 })).toBe(true)
    // More than a kilometre away (from a boat, say): the sight itself.
    expect(shotFits({ lat: 45, lon: 10 }, { lat: 44.99, lon: 10.008 })).toBe(false)
  })

  it('the name in the language of the program, English when there is none', () => {
    expect(eggTitle({ en: 'Rome', ru: 'Рим' }, 'ru')).toBe('Рим')
    expect(eggTitle({ en: 'Rome' }, 'uk')).toBe('Rome')
  })

  it('found eggs of the state: broken and repeated entries are left out', () => {
    expect(
      validFoundEggs([
        { id: 2, date: '2026-11-27T10:00:00.000Z' },
        { id: 2, date: '2026-11-27T11:00:00.000Z' },
        { id: 'x', date: '2026-11-27T10:00:00.000Z' },
        { id: 5, date: 'never' },
        { id: 7, date: '2026-11-27T12:00:00.000Z' }
      ])
    ).toEqual([
      { id: 2, date: '2026-11-27T10:00:00.000Z' },
      { id: 7, date: '2026-11-27T12:00:00.000Z' }
    ])
    expect(validFoundEggs(null)).toEqual([])
  })

  it('the list of eggs: a file name only of the eggs folder', () => {
    const ok = { id: 1, lat: 1, lon: 2, title: { en: 'A' }, file: '01.bin' }
    expect(validEggs([ok, { ...ok, id: 2, file: '../x.bin' }, { ...ok, id: 3, title: { ru: 'Б' } }, ok])).toEqual([ok])
  })
})
