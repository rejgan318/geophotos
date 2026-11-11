/** Help → About: versions and links to the licenses. Settings and logs are in Tools (tz.md, п. 4.9). */
import type { Translate } from '@shared/i18n'
import type { AboutTarget } from '@shared/ipc'

export class AboutView {
  private readonly el: HTMLElement
  private readonly body: HTMLElement

  constructor(private readonly t: Translate) {
    this.el = document.createElement('div')
    this.el.className = 'overlay'
    this.el.hidden = true
    const box = document.createElement('div')
    box.className = 'overlay-box about-box'
    box.setAttribute('role', 'dialog')
    box.setAttribute('aria-label', t('about.title'))

    const head = document.createElement('div')
    head.className = 'overlay-head'
    const title = document.createElement('h2')
    title.textContent = t('about.title')
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'overlay-close'
    close.textContent = '×'
    close.title = t('help.close')
    close.addEventListener('click', () => this.hide())
    head.append(title, close)
    this.body = document.createElement('div')
    box.append(head, this.body)
    this.el.append(box)
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.hide()
    })
    document.body.append(this.el)
  }

  get visible(): boolean {
    return !this.el.hidden
  }

  hide(): void {
    this.el.hidden = true
  }

  /** Shows the window with fresh data from main. */
  async show(): Promise<void> {
    const info = await window.geophotos.aboutInfo()
    const t = this.t
    const line = (...parts: (string | Node)[]): HTMLElement => {
      const p = document.createElement('p')
      p.append(...parts)
      return p
    }
    const link = (target: AboutTarget, path: string): HTMLElement => {
      const a = document.createElement('a')
      a.href = '#'
      a.textContent = path
      a.title = t('about.openHint')
      a.addEventListener('click', (e) => {
        e.preventDefault()
        void window.geophotos.openAboutTarget(target)
      })
      return a
    }
    const name = document.createElement('strong')
    name.textContent = `GeoPhotos ${info.version}`
    this.body.replaceChildren(
      line(name),
      line(t('about.description')),
      line(t('about.exiftool', { version: info.exiftoolVersion, path: info.exiftoolPath })),
      line(`${t('about.license')} `, link('license', 'MIT'), ' · ', link('notices', t('about.notices'))),
      // Attribution asked by the elevation service (tz.md, п. 5.6).
      line(t('about.elevation')),
      line(`Electron ${info.electron} · Node.js ${info.node}`)
    )
    this.el.hidden = false
  }
}
