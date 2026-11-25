import { Menu, type MenuItemConstructorOptions } from 'electron'
import type { Translate } from '@shared/i18n'
import type { StripFilter, StripPosition } from '@shared/ipc'
import type { ContextItem, ContextItemState } from '@shared/context-menu'

export interface MenuHandlers {
  openFolder(): void
  addFiles(): void
  openRecent(folder: string): void
  refresh(): void
  clearRecent(): void
  save(): void
  saveSelected(): void
  copyCoords(): void
  pasteCoords(): void
  clearCoords(): void
  removeFromStrip(): void
  selectAll(): void
  openSettings(): void
  openLogs(): void
  exit(): void
  toggleView(): void
  showOnMap(): void
  toggleThumbnails(): void
  toggleGrid(): void
  setStripPosition(position: StripPosition): void
  setFilter(filter: StripFilter): void
  toggleAddress(): void
  toggleAltitude(): void
  setLanguage(code: string): void
  shortcuts(): void
  about(): void
}

/** Ids of menu items that are enabled and disabled while the program runs. */
export const MENU_ID = {
  refresh: 'file.refresh',
  save: 'file.save',
  saveSelected: 'file.saveSelected',
  copyCoords: 'edit.copyCoords',
  pasteCoords: 'edit.pasteCoords',
  clearCoords: 'edit.clearCoords',
  removeFromStrip: 'edit.removeFromStrip',
  selectAll: 'edit.selectAll',
  photoView: 'view.photo',
  showOnMap: 'view.showOnMap',
  thumbnails: 'view.thumbnails',
  grid: 'view.grid',
  strip: { bottom: 'view.strip.bottom', left: 'view.strip.left' },
  address: 'tools.address',
  altitude: 'tools.altitude',
  filter: {
    all: 'view.filter.all',
    coords: 'view.filter.coords',
    noCoords: 'view.filter.noCoords',
    modified: 'view.filter.modified'
  }
} as const

/** Traditional window menu (tz.md, п. 4.9). Reload and developer tools exist only in development. */
export function buildMenu(
  t: Translate,
  h: MenuHandlers,
  recent: string[],
  dev: boolean,
  languages: { list: { code: string; name: string }[]; current: string } = { list: [], current: '' }
): Menu {
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
        { label: t('menu.openFolder'), accelerator: 'CmdOrCtrl+O', click: h.openFolder },
        { label: t('menu.addFiles'), accelerator: 'CmdOrCtrl+Shift+O', click: h.addFiles },
        { label: t('menu.openRecent'), submenu: recentItems },
        { id: MENU_ID.refresh, label: t('menu.refresh'), accelerator: 'F5', click: h.refresh, enabled: false },
        { type: 'separator' },
        { id: MENU_ID.save, label: t('menu.save'), accelerator: 'CmdOrCtrl+S', click: h.save, enabled: false },
        { id: MENU_ID.saveSelected, label: t('menu.saveSelected'), click: h.saveSelected, enabled: false },
        { type: 'separator' },
        { label: t('menu.exit'), click: h.exit }
      ]
    }
  ]
  // Edit (tz.md, п. 4.9): what the keys already do, made visible — Ctrl+C copies coordinates, not
  // the photo. The window handles the keys (text fields keep their own copy, paste and select all),
  // so the shortcuts are only shown here, not registered.
  const editItem = (id: string, label: string, accelerator: string, click: () => void): MenuItemConstructorOptions => ({
    id,
    label: t(label),
    accelerator,
    registerAccelerator: false,
    enabled: false,
    click
  })
  template.push({
    label: t('menu.edit'),
    submenu: [
      editItem(MENU_ID.copyCoords, 'menu.copyCoords', 'CmdOrCtrl+C', h.copyCoords),
      editItem(MENU_ID.pasteCoords, 'menu.pasteCoords', 'CmdOrCtrl+V', h.pasteCoords),
      editItem(MENU_ID.clearCoords, 'menu.clearCoords', 'CmdOrCtrl+Delete', h.clearCoords),
      { type: 'separator' },
      editItem(MENU_ID.removeFromStrip, 'menu.removeFromStrip', 'Delete', h.removeFromStrip),
      { type: 'separator' },
      editItem(MENU_ID.selectAll, 'menu.selectAll', 'CmdOrCtrl+A', h.selectAll)
    ]
  })
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
      {
        id: MENU_ID.thumbnails,
        label: t('menu.thumbnails'),
        type: 'checkbox',
        accelerator: 'T',
        registerAccelerator: false,
        click: h.toggleThumbnails
      },
      { type: 'separator' },
      // Layout (tz.md, пп. 4.1, 4.17): where the strip is, and the strip over the whole window.
      {
        label: t('menu.stripPosition'),
        submenu: (['bottom', 'left'] as const).map((p) => ({
          id: MENU_ID.strip[p],
          label: t(p === 'bottom' ? 'menu.stripBottom' : 'menu.stripLeft'),
          type: 'radio' as const,
          checked: p === 'bottom',
          click: () => h.setStripPosition(p)
        }))
      },
      {
        id: MENU_ID.grid,
        label: t('menu.grid'),
        type: 'checkbox',
        accelerator: 'G',
        registerAccelerator: false,
        click: h.toggleGrid
      },
      { type: 'separator' },
      filterItem('all', 'menu.filterAll'),
      filterItem('coords', 'menu.filterCoords'),
      filterItem('noCoords', 'menu.filterNoCoords'),
      filterItem('modified', 'menu.filterModified'),
      ...devItems
    ]
  })
  // Tools: modes that fill in data for the photos of the folder (tz.md, пп. 5.5, 5.6), the
  // settings file and the log folder (пп. 8.2, 6.9).
  template.push({
    label: t('menu.tools'),
    submenu: [
      { id: MENU_ID.address, label: t('menu.getAddress'), type: 'checkbox', click: h.toggleAddress },
      { id: MENU_ID.altitude, label: t('menu.getAltitude'), type: 'checkbox', click: h.toggleAltitude },
      { type: 'separator' },
      // Each language named in itself (tz.md, п. 2.3); applied after a restart (п. 8.5).
      {
        label: t('menu.language'),
        submenu: languages.list.map(({ code, name }) => ({
          label: name,
          type: 'radio' as const,
          checked: code === languages.current,
          click: () => h.setLanguage(code)
        }))
      },
      { type: 'separator' },
      { label: t('menu.openSettings'), click: h.openSettings },
      { label: t('menu.openLogs'), click: h.openLogs }
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

/** Labels and shown keys of the context menu items: the same as in the Edit and View menus (tz.md, п. 4.19). */
const CONTEXT: Record<ContextItem, { label: string; accelerator?: string }> = {
  showOnMap: { label: 'menu.showOnMap', accelerator: 'C' },
  copyCoords: { label: 'menu.copyCoords', accelerator: 'CmdOrCtrl+C' },
  pasteCoords: { label: 'menu.pasteCoords', accelerator: 'CmdOrCtrl+V' },
  clearCoords: { label: 'menu.clearCoords', accelerator: 'CmdOrCtrl+Delete' },
  removeFromStrip: { label: 'menu.removeFromStrip', accelerator: 'Delete' },
  showInExplorer: { label: 'menu.showInExplorer' },
  openDefault: { label: 'menu.openDefault' }
}

/** The context menu of a photo: Show on Map, the editing items, then the file ones. */
export function buildContextMenu(t: Translate, items: ContextItemState[], run: (item: ContextItem) => void): Menu {
  const template: MenuItemConstructorOptions[] = []
  items.forEach(({ item, enabled }, i) => {
    if (i > 0 && (item === 'showInExplorer' || items[i - 1]!.item === 'showOnMap')) template.push({ type: 'separator' })
    const c = CONTEXT[item]
    template.push({
      label: t(c.label),
      enabled,
      ...(c.accelerator ? { accelerator: c.accelerator, registerAccelerator: false } : {}),
      click: () => run(item)
    })
  })
  return Menu.buildFromTemplate(template)
}
