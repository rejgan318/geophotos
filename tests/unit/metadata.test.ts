import { describe, expect, it } from 'vitest'
import {
  comparePhotos,
  embeddedPreviewTag,
  exifCoords,
  parseExifDate,
  pickAddress,
  pickCoords,
  pickDate,
  readError,
  toPhoto,
  xmpCoords
} from '@shared/metadata'

describe('parseExifDate', () => {
  it('reads exiftool dates as local wall time', () => {
    expect(parseExifDate('2025:06:09 20:40:06')).toBe('2025-06-09 20:40:06')
    expect(parseExifDate('2025:06:09 20:40:06+03:00')).toBe('2025-06-09 20:40:06')
    expect(parseExifDate('2025:06:09 20:40:06.123')).toBe('2025-06-09 20:40:06')
    expect(parseExifDate('2025-06-09T20:40')).toBe('2025-06-09 20:40:00')
  })

  it('rejects empty and zero dates', () => {
    expect(parseExifDate('0000:00:00 00:00:00')).toBeNull()
    expect(parseExifDate('')).toBeNull()
    expect(parseExifDate(undefined)).toBeNull()
    expect(parseExifDate(12)).toBeNull()
  })
})

describe('coordinates', () => {
  it('EXIF: sign comes from Ref tags', () => {
    expect(
      exifCoords({
        'EXIF:GPSLatitude': 33.8568,
        'EXIF:GPSLatitudeRef': 'S',
        'EXIF:GPSLongitude': 151.2153,
        'EXIF:GPSLongitudeRef': 'E'
      })
    ).toEqual({ lat: -33.8568, lon: 151.2153 })
    expect(
      exifCoords({
        'EXIF:GPSLatitude': 40.7,
        'EXIF:GPSLatitudeRef': 'N',
        'EXIF:GPSLongitude': 74,
        'EXIF:GPSLongitudeRef': 'W'
      })
    ).toEqual({ lat: 40.7, lon: -74 })
  })

  it('EXIF without one of the values is no coordinates', () => {
    expect(exifCoords({ 'EXIF:GPSLatitude': 10 })).toBeNull()
  })

  it('XMP: signed values', () => {
    expect(xmpCoords({ 'XMP:GPSLatitude': -1.5, 'XMP:GPSLongitude': -2.5 })).toEqual({ lat: -1.5, lon: -2.5 })
  })

  it('out-of-range values are rejected', () => {
    expect(xmpCoords({ 'XMP:GPSLatitude': 91, 'XMP:GPSLongitude': 0 })).toBeNull()
  })

  const exif = { 'EXIF:GPSLatitude': 1, 'EXIF:GPSLatitudeRef': 'N', 'EXIF:GPSLongitude': 1, 'EXIF:GPSLongitudeRef': 'E' }
  const xmp = { 'XMP:GPSLatitude': 2, 'XMP:GPSLongitude': 2 }
  const sidecar = { 'XMP:GPSLatitude': 3, 'XMP:GPSLongitude': 3 }

  it('priority: sidecar XMP, embedded XMP, EXIF (tz.md, п. 3.7)', () => {
    expect(pickCoords({ ...exif, ...xmp }, sidecar)).toEqual({ coords: { lat: 3, lon: 3 }, source: 'sidecar' })
    expect(pickCoords({ ...exif, ...xmp }, undefined)).toEqual({ coords: { lat: 2, lon: 2 }, source: 'xmp' })
    expect(pickCoords(exif, {})).toEqual({ coords: { lat: 1, lon: 1 }, source: 'exif' })
    expect(pickCoords({}, undefined)).toEqual({ coords: null, source: null })
  })
})

describe('dates', () => {
  it('shooting date first, file date otherwise (tz.md, п. 4.2)', () => {
    expect(pickDate({ 'EXIF:DateTimeOriginal': '2020:01:02 03:04:05', 'File:FileModifyDate': '2024:01:01 00:00:00+02:00' }))
      .toEqual({ date: '2020-01-02 03:04:05', source: 'shot' })
    expect(pickDate({ 'XMP:DateTimeOriginal': '2020:01:02 03:04:05+01:00' }))
      .toEqual({ date: '2020-01-02 03:04:05', source: 'shot' })
    expect(pickDate({ 'File:FileModifyDate': '2024:01:01 10:00:00+02:00' }))
      .toEqual({ date: '2024-01-01 10:00:00', source: 'file' })
  })
})

describe('address (tz.md, п. 5.5)', () => {
  const xmp = { 'XMP:Country': 'Україна', 'XMP:CountryCode': 'ua', 'XMP:State': 'Львівська', 'XMP:City': 'Львів', 'XMP:Location': 'Ринок, 1' }
  const iptc = { 'IPTC:Country-PrimaryLocationName': 'Ukraine', 'IPTC:City': 'Lviv' }

  it('sidecar first, then embedded XMP, then IPTC; the code in upper case', () => {
    expect(pickAddress({ ...xmp, ...iptc }, undefined)).toEqual({
      country: 'Україна', countryCode: 'UA', state: 'Львівська', city: 'Львів', location: 'Ринок, 1'
    })
    expect(pickAddress(iptc, undefined)).toEqual({ country: 'Ukraine', countryCode: '', state: '', city: 'Lviv', location: '' })
    expect(pickAddress({ ...xmp }, { 'XMP:City': 'Kyiv' })).toMatchObject({ city: 'Kyiv', country: '' })
    expect(pickAddress({ 'EXIF:Make': 'Canon' }, undefined)).toBeNull()
  })
})

describe('photos', () => {
  const base = { path: 'x', coords: null, coordSource: null, address: null, dateSource: 'shot' as const, modified: false }

  it('order: by date, then by name; no date last', () => {
    const list = [
      { ...base, name: 'b.jpg', date: '2020-01-01 00:00:00' },
      { ...base, name: 'z.jpg', date: null },
      { ...base, name: 'a10.jpg', date: '2020-01-01 00:00:00' },
      { ...base, name: 'a9.jpg', date: '2020-01-01 00:00:00' },
      { ...base, name: 'c.jpg', date: '2019-12-31 23:59:59' }
    ]
    expect(list.sort(comparePhotos).map((p) => p.name)).toEqual(['c.jpg', 'a9.jpg', 'a10.jpg', 'b.jpg', 'z.jpg'])
  })

  it('read errors are kept', () => {
    expect(readError({ 'ExifTool:Error': 'File format error' })).toBe('File format error')
    expect(toPhoto('a.jpg', 'p', { 'ExifTool:Error': 'bad' }, undefined).error).toBe('bad')
    expect(toPhoto('a.jpg', 'p', undefined, undefined).error).toBeTruthy()
    expect(readError({ 'File:MIMEType': 'text/plain', 'File:FileType': 'TXT' })).toBe('Not an image (file type: TXT)')
    expect(readError({ 'File:MIMEType': 'image/x-canon-cr2' })).toBeUndefined()
  })

  it('embedded preview: first present tag', () => {
    expect(embeddedPreviewTag({ 'EXIF:ThumbnailImage': '(Binary)', 'EXIF:PreviewImage': '(Binary)' })).toBe('PreviewImage')
    expect(embeddedPreviewTag({ 'EXIF:ThumbnailImage': '(Binary)' })).toBe('ThumbnailImage')
    expect(embeddedPreviewTag({})).toBeNull()
  })
})
