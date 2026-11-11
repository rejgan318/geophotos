import { Menu, type MenuItemConstructorOptions } from 'electron'
import type { Translate } from '@shared/i18n'
import type { StripFilter } from '@shared/ipc'

export interface MenuHandlers {
  openPhoto(): void
  openRecent(folder: string): void
  clearRecent(): void
  save(): void
  saveSelected(): void
  openSettings(): void
  exit(): void
  toggleView(): void
  showOnMap(): void
  setFilter(filter: StripFilter): void
  shortcuts(): void
  about(): void
}

/** Ids of menu items that are enabled and disabled while the program runs. */
export const MENU_ID = {
  save: 'file.save',
  saveSelected: 'file.saveSelected',
  photoView: 'view.photo',
  showOnMap: 'view.showOnMap',
  filter: {
    all: 'view.filter.all',
    coords: 'view.filter.coords',
    noCoords: 'view.filter.noCoords',
    modified: 'view.filter.modified'
  }
} as const

/** Traditional window menu (tz.md, п. 4.9). Reload and developer tools exist only in development. */
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
        { id: MENU_ID.save, label: t('menu.save'), accelerator: 'CmdOrCtrl+S', click: h.save, enabled: false },
        { id: MENU_ID.saveSelected, label: t('menu.saveSelected'), click: h.saveSelected, enabled: false },
        { type: 'separator' },
        { label: t('menu.openSettings'), click: h.openSettings },
        { type: 'separator' },
        { label: t('menu.exit'), click: h.exit }
      ]
    }
  ]
  // View: map / photo (Space; the window handles the key, so Space still types in text fields)
  // and the filters of the status bar counter (tz.md, пп. 4.13, 9.3).
  const filterItem = (filter: StripFilter, label: string): MenuItemConstructorOptions => ({
    id: MENU_ID.filter[filter],
    label: t(label),
    type: 'radio',
    checked: filter === 'all',
    click: () => h.setFilter(filter)
  })
  const devItems: MenuItemConstructorOptions[] = dev
    ? [
        { type: 'separator' },
        { label: t('menu.reload'), role: 'reload' },
        { label: t('menu.devTools'), role: 'toggleDevTools' }
      ]
    : []
  template.push({
    label: t('menu.view'),
    submenu: [
      {
        id: MENU_ID.photoView,
        label: t('menu.photoView'),
        type: 'checkbox',
        accelerator: 'Space',
        registerAccelerator: false,
        click: h.toggleView
      },
      {
        id: MENU_ID.showOnMap,
        label: t('menu.showOnMap'),
        accelerator: 'C',
        registerAccelerator: false,
        click: h.showOnMap
      },
      { type: 'separator' },
      filterItem('all', 'menu.filterAll'),
      filterItem('coords', 'menu.filterCoords'),
      filterItem('noCoords', 'menu.filterNoCoords'),
      filterItem('modified', 'menu.filterModified'),
      ...devItems
    ]
  })
  template.push({
    label: t('menu.help'),
    submenu: [
      { label: t('menu.shortcuts'), accelerator: 'F1', click: h.shortcuts },
      { type: 'separator' },
      { label: t('menu.about'), click: h.about }
    ]
  })
  return Menu.buildFromTemplate(template)
}
