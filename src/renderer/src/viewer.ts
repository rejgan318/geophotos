import type { Translate } from '@shared/i18n'
import { liveUrl, thumbUrl } from '@shared/ipc'
import type { Photo } from '@shared/photo'
import { addressText, altitudeText } from '@shared/photo'
import { nameLine, photoCoords } from './describe'
import { FILE_SVG } from './icons'

/**
 * Photo view (tz.md, п. 9.3): the current photo in place of the map, fitted whole, with the
 * file name and shooting date. The strip and the status bar stay; ← → change the photo.
 */
export class PhotoView {
  private readonly img: HTMLImageElement
  private readonly caption: HTMLElement
  private readonly placeholder: HTMLElement
  private readonly play: HTMLButtonElement
  private shownUrl = ''
  private photoId: number | null = null

  constructor(
    private readonly el: HTMLElement,
    private readonly t: Translate,
    /** "Open in Player" of a video (п. 4.14). */
    onPlay: (id: number) => void
  ) {
    this.img = document.createElement('img')
    this.img.alt = ''
    this.img.draggable = false
    this.caption = document.createElement('div')
    this.caption.className = 'viewer-caption'
    this.placeholder = document.createElement('div')
    this.placeholder.className = 'viewer-placeholder'
    this.placeholder.hidden = true
    this.play = document.createElement('button')
    this.play.className = 'viewer-play'
    this.play.textContent = t('viewer.openInPlayer')
    this.play.hidden = true
    this.play.addEventListener('click', () => {
      if (this.photoId !== null) onPlay(this.photoId)
    })
    el.append(this.img, this.placeholder, this.caption, this.play)
    this.img.addEventListener('load', () => {
      this.img.hidden = false
      this.placeholder.hidden = true
    })
    this.img.addEventListener('error', () => {
      this.img.hidden = true
      this.placeholder.hidden = false
    })
  }

  get visible(): boolean {
    return !this.el.hidden
  }

  setVisible(on: boolean): void {
    this.el.hidden = !on
    if (!on) {
      this.stopLive()
      // Shown again: the video plays again.
      this.shownUrl = ''
    }
  }

  /** Shows a photo; the image is asked for only while the view is visible. */
  show(photo: Photo | null, generation: number): void {
    this.photoId = photo?.id ?? null
    this.play.hidden = !photo?.video
    if (!photo) {
      this.stopLive()
      this.caption.replaceChildren()
      this.img.hidden = true
      this.img.removeAttribute('src')
      this.shownUrl = ''
      this.placeholder.hidden = true
      return
    }
    // Name and date (and a video's length); under them the coordinates with the altitude and the
    // address, if any (п. 4.14).
    const coords = photoCoords(photo, this.t) + (photo.altitude === null ? '' : ` · ${altitudeText(photo.altitude)}`)
    // The camera or phone (tz.md, 0.36.0): under the name, when the file names it.
    const lines = [nameLine(photo, this.t), ...(photo.camera ? [photo.camera] : []), coords]
    if (photo.address) lines.push(addressText(photo.address))
    this.caption.replaceChildren(
      ...lines.map((text) => {
        const div = document.createElement('div')
        div.textContent = text
        return div
      })
    )
    this.placeholder.innerHTML = FILE_SVG
    const name = document.createElement('span')
    name.textContent = photo.name
    this.placeholder.append(name)
    if (!this.visible) return
    const url = thumbUrl(generation, photo.id, true)
    if (url === this.shownUrl) return
    this.shownUrl = url
    this.stopLive()
    // The previous image stays until the next one is ready, so switching does not flash.
    this.img.src = url
    // A live photo plays its video once, muted, then the photo stays (tz.md, п. 3.3.7).
    if (photo.live) this.playLive(liveUrl(generation, photo.id))
  }

  private playLive(src: string): void {
    const v = document.createElement('video')
    v.className = 'viewer-live'
    v.muted = true
    v.playsInline = true
    v.src = src
    v.addEventListener('ended', () => v.remove())
    v.addEventListener('error', () => v.remove())
    this.el.insertBefore(v, this.caption)
    void v.play().catch(() => v.remove())
  }

  private stopLive(): void {
    this.el.querySelector('video.viewer-live')?.remove()
  }
}
