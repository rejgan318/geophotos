import type { Translate } from '@shared/i18n'
import { thumbUrl } from '@shared/ipc'
import type { Photo } from '@shared/photo'
import { addressText, altitudeText } from '@shared/photo'
import { photoCoords, photoDate } from './describe'
import { FILE_SVG } from './icons'

/**
 * Photo view (tz.md, п. 9.3): the current photo in place of the map, fitted whole, with the
 * file name and shooting date. The strip and the status bar stay; ← → change the photo.
 */
export class PhotoView {
  private readonly img: HTMLImageElement
  private readonly caption: HTMLElement
  private readonly placeholder: HTMLElement
  private shownUrl = ''

  constructor(
    private readonly el: HTMLElement,
    private readonly t: Translate
  ) {
    this.img = document.createElement('img')
    this.img.alt = ''
    this.img.draggable = false
    this.caption = document.createElement('div')
    this.caption.className = 'viewer-caption'
    this.placeholder = document.createElement('div')
    this.placeholder.className = 'viewer-placeholder'
    this.placeholder.hidden = true
    el.append(this.img, this.placeholder, this.caption)
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
  }

  /** Shows a photo; the image is asked for only while the view is visible. */
  show(photo: Photo | null, generation: number): void {
    if (!photo) {
      this.caption.replaceChildren()
      this.img.hidden = true
      this.img.removeAttribute('src')
      this.shownUrl = ''
      this.placeholder.hidden = true
      return
    }
    // Name and date; under them the coordinates with the altitude and the address, if any (п. 4.14).
    const coords = photoCoords(photo, this.t) + (photo.altitude === null ? '' : ` · ${altitudeText(photo.altitude)}`)
    const lines = [`${photo.name} · ${photoDate(photo, this.t)}`, coords]
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
    // The previous image stays until the next one is ready, so switching does not flash.
    this.img.src = url
  }
}
