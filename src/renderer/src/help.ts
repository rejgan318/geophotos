/** Help → Keyboard Shortcuts (F1): a window over the program; the list is in help-content.ts. */
import type { Translate } from '@shared/i18n'
import { SECTIONS } from './help-content'

/** "Ctrl+help.key.click" → "Ctrl+Click": parts that are text keys are translated. */
function keyLabel(key: string, t: Translate): string {
  return key
    .split('+')
    .map((part) => (part.startsWith('help.') ? t(part) : part))
    .join('+')
}

export class HelpView {
  private readonly el: HTMLElement

  constructor(t: Translate) {
    this.el = document.createElement('div')
    this.el.className = 'overlay'
    this.el.hidden = true
    const box = document.createElement('div')
    box.className = 'overlay-box help-box'
    box.setAttribute('role', 'dialog')
    box.setAttribute('aria-label', t('help.title'))

    const head = document.createElement('div')
    head.className = 'overlay-head'
    const title = document.createElement('h2')
    title.textContent = t('help.title')
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'overlay-close'
    close.textContent = '×'
    close.title = t('help.close')
    close.addEventListener('click', () => this.hide())
    head.append(title, close)
    box.append(head)

    for (const section of SECTIONS) {
      const h = document.createElement('h3')
      h.textContent = t(section.title)
      const table = document.createElement('table')
      for (const row of section.rows) {
        const tr = document.createElement('tr')
        const left = document.createElement('td')
        if ('keys' in row) {
          for (const [i, key] of row.keys.entries()) {
            if (i) left.append(' ')
            const kbd = document.createElement('kbd')
            kbd.textContent = keyLabel(key, t)
            left.append(kbd)
          }
        } else if ('action' in row) {
          left.textContent = t(row.action)
          left.className = 'help-action'
        } else {
          const icon = document.createElement('span')
          icon.className = 'help-icon'
          icon.style.setProperty('--icon-color', row.color)
          icon.innerHTML = row.icon
          left.append(icon)
        }
        const right = document.createElement('td')
        right.textContent = t(row.text)
        tr.append(left, right)
        table.append(tr)
      }
      box.append(h, table)
    }

    this.el.append(box)
    // A click outside the box closes the help.
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.hide()
    })
    document.body.append(this.el)
  }

  get visible(): boolean {
    return !this.el.hidden
  }

  toggle(): void {
    this.el.hidden = !this.el.hidden
  }

  hide(): void {
    this.el.hidden = true
  }
}
