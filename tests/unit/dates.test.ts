import { describe, expect, it } from 'vitest'
import { formatWallTime } from '@shared/date-format'
import { dateFromName, isCameraVideo, videoDate, wallTime, zoneAt } from '@shared/dates'
import { firstTrackPoint, pickAltitude, pickCoords, pickDate, readError, toPhoto, videoDuration } from '@shared/metadata'
import { canEdit, durationText, fileSizeParts } from '@shared/photo'
import { assignAddress, assignCoords, dropOnPhoto } from '@shared/edits'
import { pointsWithoutAddress } from '@shared/geocode'
import { pointsWithoutAltitude } from '@shared/elevation'
import type { Photo } from '@shared/photo'

// Records as `exiftool -j -n -G0` gives them for the user's sample videos (tz.md, п. 3.3.6).
const SAMSUNG = {
  'File:FileName': '20190816_192927.mp4',
  'File:MIMEType': 'video/mp4',
  'File:FileModifyDate': '2019:08:16 19:29:50+03:00',
  'QuickTime:CreateDate': '2019:08:16 23:29:50',
  'QuickTime:Duration': 20.604,
  'QuickTime:GPSCoordinates': '40.6252 -73.2877'
}
const ANDROID = {
  'File:MIMEType': 'video/mp4',
  'QuickTime:CreateDate': '2025:04:26 15:12:20',
  'QuickTime:GPSCoordinates': '-12.1439 -77.0239'
}
const CANON_5D = {
  'File:MIMEType': 'video/quicktime',
  'QuickTime:CreateDate': '2010:07:03 21:19:02',
  'QuickTime:Model': 'Canon EOS 5D Mark II',
  'QuickTime:CompressorVersion': 'CanonAVC0002',
  'QuickTime:Duration': 16.24
}
const CANON_NO_MODEL = {
  'QuickTime:CreateDate': '2010:08:21 05:32:16',
  'QuickTime:CompressorVersion': 'CanonAVC0001'
}
const CANON_ADOBE = {
  'QuickTime:CreateDate': '2012:01:19 15:54:15',
  'QuickTime:Model': 'Canon EOS 5D Mark II',
  'XMP:CreateDate': '2012:01:19 15:54:15Z'
}
const OLYMPUS = {
  'QuickTime:CreateDate': '2005:07:02 17:50:33',
  'MakerNotes:Make': 'OLYMPUS DIGITAL CAMERA',
  'MakerNotes:Model': 'SX756'
}
const EDITED = {
  'QuickTime:CreateDate': '2021:05:01 12:49:31',
  'XMP:CreateDate': '2021:05:01 15:49:31+03:00'
}
const IPHONE = {
  'QuickTime:CreateDate': '2023:06:01 09:00:00',
  'QuickTime:CreationDate': '2023:06:01 12:00:00+03:00',
  'QuickTime:Make': 'Apple'
}

describe('time of videos (tz.md, п. 4.2)', () => {
  it('phones: UTC turned into the wall time of the place of shooting', () => {
    // The names show the time on the phone's clock: 19:29:27 in New York, 10:12:11 in Lima.
    expect(videoDate(SAMSUNG, { lat: 40.6252, lon: -73.2877 })).toBe('2019-08-16 19:29:50')
    expect(videoDate(ANDROID, { lat: -12.1439, lon: -77.0239 })).toBe('2025-04-26 10:12:20')
  })

  it('cameras: the QuickTime date as it is (checked against a photo of the same camera)', () => {
    expect(videoDate(CANON_5D, null)).toBe('2010-07-03 21:19:02')
    expect(videoDate(CANON_NO_MODEL, null)).toBe('2010-08-21 05:32:16')
    expect(videoDate(OLYMPUS, null)).toBe('2005-07-02 17:50:33')
  })

  it('"Z" added by a program is not a zone; a real offset is', () => {
    expect(videoDate(CANON_ADOBE, null)).toBe('2012-01-19 15:54:15')
    expect(videoDate(EDITED, null)).toBe('2021-05-01 15:49:31')
    expect(videoDate(IPHONE, null)).toBe('2023-06-01 12:00:00')
  })

  it('AVI: the RIFF date as it is; nothing — null', () => {
    expect(videoDate({ 'RIFF:DateTimeOriginal': '2006:05:01 10:00:00' }, null)).toBe('2006-05-01 10:00:00')
    expect(videoDate({ 'Composite:Duration': 6.45 }, null)).toBeNull()
    expect(videoDate({ 'QuickTime:CreateDate': '0000:00:00 00:00:00' }, null)).toBeNull()
    expect(videoDate({ 'QuickTime:CreateDate': '1904:01:01 00:00:00' }, null)).toBeNull()
  })

  it('camera or phone', () => {
    expect(isCameraVideo(CANON_5D)).toBe(true)
    expect(isCameraVideo(CANON_NO_MODEL)).toBe(true)
    expect(isCameraVideo(OLYMPUS)).toBe(true)
    expect(isCameraVideo(SAMSUNG)).toBe(false)
    expect(isCameraVideo(IPHONE)).toBe(false)
  })

  it('time zones and wall times', () => {
    expect(zoneAt({ lat: 40.6252, lon: -73.2877 })).toBe('America/New_York')
    expect(zoneAt({ lat: 49.997, lon: 36.238 })).toBe('Europe/Kyiv')
    expect(wallTime(new Date('2019-08-16T23:29:50Z'), 'Europe/Kyiv')).toBe('2019-08-17 02:29:50')
    expect(wallTime(new Date('2019-01-16T00:00:00Z'), 'America/New_York')).toBe('2019-01-15 19:00:00')
  })
})

describe('dates in the regional format (п. 4.13)', () => {
  it('as the locale writes them, the wall time unchanged', () => {
    expect(formatWallTime('2010-07-03 21:19:02', 'ru-RU')).toBe('03.07.2010 21:19:02')
    expect(formatWallTime('2010-07-03 21:19:02', 'uk-UA')).toBe('03.07.2010 21:19:02')
    expect(formatWallTime('2010-07-03 21:19:02', 'de-DE')).toBe('03.07.2010 21:19:02')
    expect(formatWallTime('2010-07-03 21:19:02', 'en-US')).toMatch(/^07\/03\/2010 0?9:19:02\sPM$/)
    expect(formatWallTime('2010-07-03 21:19:02', 'en-GB')).toBe('03/07/2010 21:19:02')
    // A night that does not exist in summer-time zones is shown as written.
    expect(formatWallTime('2019-03-31 03:30:00', 'ru-RU')).toBe('31.03.2019 03:30:00')
  })

  it('date only; a bad value as it is', () => {
    expect(formatWallTime('1998-03-19 00:00:00', 'ru-RU', true)).toBe('19.03.1998')
    expect(formatWallTime('nonsense', 'ru-RU')).toBe('nonsense')
  })
})

describe('date from the file name (п. 4.2)', () => {
  it('date and time', () => {
    expect(dateFromName('20190816_192927.mp4')).toBe('2019-08-16 19:29:27')
    expect(dateFromName('VID_20250426_101211.mp4')).toBe('2025-04-26 10:12:11')
    expect(dateFromName('IMG_20190816_192927.jpg')).toBe('2019-08-16 19:29:27')
    expect(dateFromName('2019-08-16 19.29.27.jpg')).toBe('2019-08-16 19:29:27')
  })

  it('date only', () => {
    expect(dateFromName('1998 03 19 Юля и Аня дома на Ньютона.avi')).toBe('1998-03-19 00:00:00')
    expect(dateFromName('1998-03-19.avi')).toBe('1998-03-19 00:00:00')
    expect(dateFromName('trip_1998_03_19.avi')).toBe('1998-03-19 00:00:00')
    expect(dateFromName('2024-05\\19980319.avi')).toBe('1998-03-19 00:00:00')
  })

  it('no date: numbers of cameras, impossible dates, the subfolder is not looked at', () => {
    expect(dateFromName('MVI_0592.MOV')).toBeNull()
    expect(dateFromName('M2U00030.MPG')).toBeNull()
    expect(dateFromName('P7020044.MOV')).toBeNull()
    expect(dateFromName('IMG_20191340_101010.jpg')).toBeNull()
    expect(dateFromName('Кабачковая икра.mp4')).toBeNull()
    expect(dateFromName('2024-05\\IMG_0001.jpg')).toBeNull()
    expect(dateFromName('1975 03 19.avi')).toBeNull()
  })

  it('pickDate: shooting date, then the name, then the file', () => {
    expect(pickDate({ 'File:FileModifyDate': '2019:10:12 22:09:28+03:00' }, '1998 03 19 дома.avi', { coords: null })).toEqual({
      date: '1998-03-19 00:00:00',
      source: 'name'
    })
    expect(pickDate({ 'File:FileModifyDate': '2007:04:08 10:19:20+03:00' }, 'M2U00030.MPG', { coords: null })).toEqual({
      date: '2007-04-08 10:19:20',
      source: 'file'
    })
    // Photos without EXIF date use the name too.
    expect(pickDate({ 'File:FileModifyDate': '2020:01:01 00:00:00' }, 'IMG_20190816_192927.jpg')).toEqual({
      date: '2019-08-16 19:29:27',
      source: 'name'
    })
    expect(pickDate({ 'EXIF:DateTimeOriginal': '2018:01:01 10:00:00' }, 'IMG_20190816_192927.jpg').source).toBe('shot')
  })
})

describe('video metadata (п. 3.3.6)', () => {
  it('QuickTime coordinates and altitude', () => {
    expect(pickCoords(SAMSUNG, undefined)).toEqual({ coords: { lat: 40.6252, lon: -73.2877 }, source: 'quicktime' })
    expect(pickAltitude({ 'QuickTime:GPSCoordinates': '40.6 -73.2 12.5' }, undefined)).toBe(12.5)
    expect(pickCoords({ 'QuickTime:GPSCoordinates': '0 0' }, undefined).coords).toBeNull()
    // The sidecar comes first (п. 3.7).
    expect(pickCoords(SAMSUNG, { 'XMP:GPSLatitude': 1, 'XMP:GPSLongitude': 2 }).source).toBe('sidecar')
  })

  it('the first point of a track, only when there is nothing else', () => {
    const rec = {
      'Doc2:GPSLatitude': 48.1, 'Doc2:GPSLongitude': 11.6,
      'Doc1:GPSLatitude': 48.0, 'Doc1:GPSLatitudeRef': 'N', 'Doc1:GPSLongitude': 11.5, 'Doc1:GPSLongitudeRef': 'W',
      'Doc1:GPSAltitude': 520
    }
    const track = firstTrackPoint(rec)
    expect(track).toEqual({ coords: { lat: 48.0, lon: -11.5 }, altitude: 520 })
    expect(pickCoords({}, undefined, track)).toEqual({ coords: { lat: 48.0, lon: -11.5 }, source: 'track' })
    expect(pickCoords(SAMSUNG, undefined, track).source).toBe('quicktime')
    expect(firstTrackPoint({ 'Main:FileName': 'a.mp4' })).toBeNull()
  })

  it('length, and a video is not an error', () => {
    expect(videoDuration(CANON_5D)).toBe(16.24)
    expect(videoDuration({ 'Composite:Duration': 6.45 })).toBe(6.45)
    expect(readError(SAMSUNG, true)).toBeUndefined()
    expect(readError({ 'File:MIMEType': 'image/jpeg', 'File:FileType': 'JPEG' }, true)).toMatch(/Not a video/)
    expect(durationText(16.24)).toBe('0:16')
    expect(durationText(339)).toBe('5:39')
    expect(durationText(3723)).toBe('1:02:03')
  })

  it('file size for the status bar (п. 4.13): 1024-based, one decimal under 10', () => {
    expect(fileSizeParts(512)).toEqual({ value: 512, digits: 0, unit: 'size.b' })
    expect(fileSizeParts(6669869)).toEqual({ value: 6.4, digits: 1, unit: 'size.mb' })
    expect(fileSizeParts(90473565)).toEqual({ value: 86, digits: 0, unit: 'size.mb' })
    expect(fileSizeParts(310102360)).toEqual({ value: 296, digits: 0, unit: 'size.mb' })
    expect(fileSizeParts(2.5 * 1024 ** 3)).toEqual({ value: 2.5, digits: 1, unit: 'size.gb' })
  })

  it('the file size is read', () => {
    expect(toPhoto('a.jpg', 'a.jpg', { 'File:MIMEType': 'image/jpeg', 'File:FileSize': 6669869 }, undefined).size).toBe(6669869)
    expect(toPhoto('a.jpg', 'a.jpg', { 'File:MIMEType': 'image/jpeg' }, undefined).size).toBeUndefined()
  })

  it('toPhoto of a video', () => {
    const p = toPhoto('20190816_192927.mp4', 'D:\\v\\20190816_192927.mp4', SAMSUNG, undefined, { video: true })
    expect(p).toMatchObject({
      date: '2019-08-16 19:29:50',
      dateSource: 'shot',
      coords: { lat: 40.6252, lon: -73.2877 },
      coordSource: 'quicktime',
      video: { duration: 20.604 }
    })
    expect(p.error).toBeUndefined()
    expect(toPhoto('a.jpg', 'a.jpg', { 'File:MIMEType': 'image/jpeg' }, undefined).video).toBeUndefined()
  })
})

describe('videos are only shown in 0.20.0 (tz.md, п. 9.3)', () => {
  const base = { dateSource: 'shot' as const, coordSource: null, address: null, altitude: null, modified: false }
  const photos: Photo[] = [
    { ...base, id: 0, name: 'a.jpg', path: 'a.jpg', date: null, coords: null },
    { ...base, id: 1, name: 'v.mp4', path: 'v.mp4', date: null, coords: { lat: 1, lon: 2 }, video: { duration: 5 } },
    { ...base, id: 2, name: 'w.avi', path: 'w.avi', date: null, coords: null, video: { duration: null } }
  ]
  const file = photos.map((p) => ({ coords: p.coords, address: p.address, altitude: p.altitude }))

  it('they are not changed', () => {
    expect(canEdit(photos[0]!)).toBe(true)
    expect(canEdit(photos[1]!)).toBe(false)
    expect(assignCoords(photos, file, [0, 1, 2], { lat: 5, lon: 6 }).map((p) => p.id)).toEqual([0])
    expect(assignCoords(photos, file, [1], null)).toEqual([])
    const addr = { country: 'X', countryCode: 'XX', state: '', city: '', location: '' }
    expect(assignAddress(photos, file, [1], addr)).toEqual([])
  })

  it('no addresses or altitudes are asked for them', () => {
    expect(pointsWithoutAddress(photos, new Set()).size).toBe(0)
    expect(pointsWithoutAltitude(photos, new Set()).size).toBe(0)
  })

  it('a photo dropped onto a video with coordinates gets them; a video without gets nothing', () => {
    expect(dropOnPhoto(photos, [0], 1)).toEqual({ ids: [0], coords: { lat: 1, lon: 2 } })
    expect(dropOnPhoto(photos, [1], 2)).toBeNull()
  })
})
