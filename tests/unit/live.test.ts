import { describe, expect, it } from 'vitest'
import { contentId, embeddedLiveTag, livePairs } from '@shared/live'

describe('live photos (tz.md, п. 3.3.7)', () => {
  it('a video inside the file: Google Motion Photo, Samsung, Pixel 2', () => {
    expect(embeddedLiveTag({ 'XMP:MotionPhoto': 1, 'Trailer:MotionPhotoVideo': '(Binary data 1855632 bytes)' })).toBe('MotionPhotoVideo')
    expect(embeddedLiveTag({ 'Samsung:EmbeddedVideoFile': '(Binary data 1 bytes)' })).toBe('EmbeddedVideoFile')
    expect(embeddedLiveTag({ 'Google:EmbeddedVideo': '(Binary data 1 bytes)' })).toBe('EmbeddedVideo')
    expect(embeddedLiveTag({ 'EXIF:Make': 'Xiaomi' })).toBeNull()
    expect(embeddedLiveTag(undefined)).toBeNull()
  })

  it('the identifier of an iPhone pair', () => {
    expect(contentId({ 'MakerNotes:ContentIdentifier': 'e4c7f14a-8db6' })).toBe('E4C7F14A-8DB6')
    expect(contentId({ 'QuickTime:ContentIdentifier': 'E4C7F14A-8DB6' })).toBe('E4C7F14A-8DB6')
    expect(contentId({})).toBeNull()
  })

  it('a pair: the same name and the same identifier', () => {
    const id = 'E4C7F14A'
    expect(
      livePairs([
        { name: 'IMG_9119.HEIC', video: false, contentId: id },
        { name: 'IMG_9119.MOV', video: true, contentId: id },
        { name: 'IMG_0001.JPG', video: false, contentId: null },
        { name: 'IMG_0001.MOV', video: true, contentId: null },
        { name: 'IMG_0002.HEIC', video: false, contentId: 'A' },
        { name: 'img_0002.mov', video: true, contentId: 'B' },
        { name: 'IMG_0003.heic', video: false, contentId: 'C' },
        { name: 'IMG_0003.MOV', video: true, contentId: 'C' }
      ])
    ).toEqual(
      new Map([
        ['IMG_9119.HEIC', 'IMG_9119.MOV'],
        ['IMG_0003.heic', 'IMG_0003.MOV']
      ])
    )
  })
})
