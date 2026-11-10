import { Menu, type MenuItemConstructorOptions } from 'electron'
import type { Translate } from '@shared/i18n'

export interface MenuHandlers {
  openPhoto(): void
  openRecent(folder: string): void
  clearRecent(): void
  openSettings(): void
  exit(): void
}

/** Traditional window menu (tz.md, п. 4.9). The View menu exists only in development. */
export function buildMenu(t: Translate, h: MenuHandlers, recent: string[], dev: boolean): Menu {
  const recentItems: MenuItemConstructorOptions[] = recent.length
    ? [
        // "&" would turn the next letter of a path into a shortcut: double it.
        ...recent.map((folder) => ({ label: folder.replace(/&/g, '&&'), click: () => h.openRecent(folder) })),
        { type: 'separator' as const },
        { label: t('menu.clearRecent'), click: h.clearRecent }
      ]
    : [{ label: t('menu.noRecent'), enabled: false }]

  const template: MenuItemConstructorOptions[] = [
    {
      label: t('menu.file'),
      submenu: [
        { label: t('menu.openPhoto'), accelerator: 'CmdOrCtrl+O', click: h.openPhoto },
        { label: t('menu.openRecent'), submenu: recentItems },
        { type: 'separator' },
        { label: t('menu.openSettings'), click: h.openSettings },
        { type: 'separator' },
        { label: t('menu.exit'), click: h.exit }
      ]
    }
  ]
  if (dev) {
    template.push({
      label: t('menu.view'),
      submenu: [
        { label: t('menu.reload'), role: 'reload' },
        { label: t('menu.devTools'), role: 'toggleDevTools' }
      ]
    })
  }
  return Menu.buildFromTemplate(template)
}
