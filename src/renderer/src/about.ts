/** Help → About: versions and links to the licenses. Settings and logs are in Tools (tz.md, п. 4.9). */
import type { Translate } from '@shared/i18n'
import type { AboutTarget } from '@shared/ipc'
import { formatInstant } from '@shared/date-format'

/** The easter eggs for About (tz.md, п. 9.3): how many there are and those found, in the order found. */
export interface EggList {
  readonly total: number
  list(): { id: number; title: string; date: string }[]
}

export class AboutView {
  private readonly el: HTMLElement
  private readonly body: HTMLElement
  /** The list of found eggs is open (until About closes). */
  private eggsOpen = false

  constructor(
    private readonly t: Translate,
    private readonly dateLocale: string,
    private readonly eggs: EggList,
    private readonly goToEgg: (id: number) => void
  ) {
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
    this.eggsOpen = false
  }

  /**
   * "Found N of 14 ▸" after the first egg (tz.md, п. 9.3); a click opens the list of found places
   * here, the date of each in its hint. A place: About closes, the map goes to the egg.
   */
  private eggsBlock(): HTMLElement[] {
    const found = this.eggs.list()
    if (!found.length) return []
    const head = document.createElement('p')
    const toggle = document.createElement('a')
    toggle.href = '#'
    toggle.className = 'about-eggs'
    toggle.textContent = `${this.t('about.eggs', { n: String(found.length), total: String(this.eggs.total) })} ${this.eggsOpen ? '▾' : '▸'}`
    const list = document.createElement('ol')
    list.className = 'about-egg-list'
    list.hidden = !this.eggsOpen
    for (const f of found) {
      const li = document.createElement('li')
      const a = document.createElement('a')
      a.href = '#'
      a.textContent = f.title
      a.title = formatInstant(Date.parse(f.date), null, this.dateLocale)
      a.addEventListener('click', (e) => {
        e.preventDefault()
        this.hide()
        this.goToEgg(f.id)
      })
      li.append(a)
      list.append(li)
    }
    toggle.addEventListener('click', (e) => {
      e.preventDefault()
      this.eggsOpen = !this.eggsOpen
      list.hidden = !this.eggsOpen
      toggle.textContent = `${this.t('about.eggs', { n: String(found.length), total: String(this.eggs.total) })} ${this.eggsOpen ? '▾' : '▸'}`
    })
    head.append(toggle)
    return [head, list]
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
      line(`Electron ${info.electron} · Node.js ${info.node}`),
      ...this.eggsBlock()
    )
    this.el.hidden = false
  }
}
