import { statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, protocol, screen, session, shell } from 'electron'
import { windowTitle } from '@shared/app-info'
import { pathFromArgv } from '@shared/argv'
import { SUPPORTED_EXTENSIONS } from '@shared/formats'
import { assignCoords, photoCounts, photosToSave } from '@shared/edits'
import { makeTranslate, type Strings, type Translate } from '@shared/i18n'
import {
  IPC,
  parseThumbUrl,
  THUMB_SCHEME,
  validSetCoords,
  type FolderData,
  type InitData,
  type PhotosChanged,
  type SaveState,
  type StripFilter,
  type UiState,
  validUiState,
  validViewState,
  type AboutInfo,
  type ViewState
} from '@shared/ipc'
import { formatCoords, type LatLon, type Photo } from '@shared/photo'
import { addRecent, removeRecent, samePath } from '@shared/recent'
import { mapSources, type Settings } from '@shared/settings'
import { windowOnScreen } from '@shared/window-place'
import { ExifTool, exiftoolVersion } from './exiftool'
import { hasSubfolders, scanFolder, type PhotoSource } from './folder'
import { loadStrings } from './locales'
import { log, setupLog } from './logger'
import { buildMenu, MENU_ID } from './menu'
import { savePhotos, type SaveFailure } from './save'
import { PlaceSearch } from './search'
import { DefaultSettingsError, ensureUserSettingsFile, formatProblem, loadSettings, setUserSetting } from './settings'
import { readState, writeState, type AppState } from './state'
import { ThumbnailService } from './thumbnails'

// Must happen before `ready`: thumbnails are served to the window by this scheme.
protocol.registerSchemesAsPrivileged([
  { scheme: THUMB_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

const dev = !app.isPackaged
const resourcesDir = dev ? app.getAppPath() : process.resourcesPath
const paths = {
  defaults: join(resourcesDir, 'config', 'settings.json'),
  schema: join(resourcesDir, 'schemas', 'settings.schema.json'),
  locales: join(resourcesDir, 'locales'),
  user: join(app.getPath('userData'), 'settings.json'),
  state: join(app.getPath('userData'), 'state.json'),
  logs: join(app.getPath('userData'), 'logs')
}

interface OpenFolder {
  data: FolderData
  sources: PhotoSource[]
  /** Coordinates as they are in the files: what "modified" is compared with, and the log's "old". */
  fileCoords: (LatLon | null)[]
  /** Photos from subfolders are loaded too (tz.md, п. 3.2). */
  subfolders: boolean
}

let settings: Settings
let strings: Strings
let t: Translate
let exiftool: ExifTool
let thumbnails: ThumbnailService
let placeSearch: PlaceSearch
/** Version reported by exiftool at start (Help → About). */
let exiftoolVer = ''
let win: BrowserWindow | null = null
let current: OpenFolder | null = null
let generation = 0
/** Photos selected in the window (for "Save Selected"). */
let selection = new Set<number>()
let saving = false
/** The window may close: unsaved changes were dealt with (tz.md, п. 6.5). */
let closeConfirmed = false
/** An unsaved-changes question is on screen: no second one. */
let asking = false
/** Recent folders, latest first (tz.md, п. 3.1); read from the state file once at start. */
let recentFolders: string[] = []
/** Folder and photo of the previous run (tz.md, п. 7.1); replaced at exit. */
let lastSession: AppState['lastSession'] = null
/** Window place, map place and mode of the previous run; updated during this one (tz.md, п. 7.1). */
let windowState: AppState['window'] = null
let mapState: AppState['map'] = null
/** The map and strip as the window last reported them. */
let viewState: ViewState | null = null
/** What the window reports: selection, filter, view mode. */
let ui: UiState = { ids: [], current: null, filter: 'all', view: 'map', mapMode: 'pins' }
let startupPath = pathFromArgv(process.argv.slice(1), (p) => kindOf(p) !== null, app.getAppPath())

function kindOf(p: string): 'dir' | 'file' | null {
  try {
    const s = statSync(p)
    return s.isDirectory() ? 'dir' : s.isFile() ? 'file' : null
  } catch {
    return null
  }
}

function isDirectory(p: string): boolean {
  return kindOf(p) === 'dir'
}

/** Settings, language, log and exiftool; false if the program must exit. */
async function startup(): Promise<boolean> {
  let userProblems
  try {
    ;({ settings, userProblems } = loadSettings(paths))
  } catch (e) {
    const detail = e instanceof DefaultSettingsError ? e.message : String(e)
    dialog.showErrorBox('GeoPhotos', `The default settings of the program are broken.\n\n${detail}`)
    return false
  }

  const loaded = loadStrings(paths.locales, settings.language)
  strings = loaded.strings
  t = makeTranslate(strings)
  const missing = loaded.missing

  setupLog(paths.logs, { ...settings.log, console: dev })
  log.info(`GeoPhotos ${app.getVersion()} started; settings: ${paths.user}`)

  if (userProblems.length) {
    const detail = userProblems.map(formatProblem).join('\n')
    log.warn(`Settings errors, defaults used:\n${detail}`)
    dialog.showMessageBoxSync({
      type: 'warning',
      title: t('error.userSettings.title'),
      message: t('error.userSettings.message'),
      detail,
      buttons: [t('dialog.ok')]
    })
  }
  if (missing) log.warn(t('error.locale', { language: settings.language }))

  try {
    const version = await exiftoolVersion(settings.exiftoolPath)
    exiftoolVer = version
    log.info(`exiftool ${version}: ${settings.exiftoolPath}`)
  } catch (e) {
    log.error(`exiftool not found (${settings.exiftoolPath}): ${String(e)}`)
    dialog.showMessageBoxSync({
      type: 'error',
      title: t('error.exiftool.title'),
      message: t('error.exiftool.message', { path: settings.exiftoolPath }),
      detail: t('error.exiftool.detail', { settings: paths.user }),
      buttons: [t('dialog.ok')]
    })
    return false
  }
  exiftool = new ExifTool(settings.exiftoolPath)
  thumbnails = new ThumbnailService(exiftool)
  placeSearch = new PlaceSearch(settings.search.url, userAgent(), settings.language)
  return true
}

/** The program names itself to OpenStreetMap services (tile and Nominatim usage policies). */
function userAgent(): string {
  return `GeoPhotos/${app.getVersion()} (Electron; manual photo geotagging)`
}

function initData(): InitData {
  const { sources, skipped } = mapSources(settings)
  if (skipped.length) log.warn(t('error.tileSources', { keys: skipped.join(', ') }))
  // The tile source of the last run, if it is still in the settings (tz.md, п. 7.1).
  const lastSource = mapState && sources.some((s) => s.key === mapState?.source) ? mapState.source : null
  return {
    strings,
    map: {
      sources,
      defaultSource: lastSource ?? settings.map.defaultSource,
      initialView: settings.map.initialView,
      markers: settings.map.markers,
      hoverThumbSize: settings.map.hoverThumbSize,
      thumbSize: settings.map.thumbnails.size,
      saved: mapState ? { lat: mapState.lat, lon: mapState.lon, zoom: mapState.zoom } : null,
      thumbnails: mapState?.thumbnails ?? false
    },
    thumbScheme: THUMB_SCHEME
  }
}

/**
 * Updates the recent folders: the menu follows at once; the state file is saved when possible
 * (if it cannot be written now, the list is kept in memory and saved on the next change).
 */
function setRecent(update: (list: string[]) => string[]): void {
  recentFolders = update(recentFolders)
  updateMenu(recentFolders)
  saveAppState()
}

function saveAppState(): void {
  try {
    writeState(paths.state, { recentFolders, lastSession, window: windowState, map: mapState })
  } catch (e) {
    log.warn(`Cannot save state ${paths.state}: ${String(e)}`)
  }
}

/**
 * At exit, for the next start (tz.md, п. 7.1): the open folder, its current photo and the strip
 * scroll; the map place, tile source and mode. The window place is taken when it closes.
 */
function rememberSession(): void {
  const photo = ui.current === null ? undefined : current?.data.photos[ui.current]
  lastSession = current
    ? {
        folder: current.data.folder,
        photo: photo?.path ?? null,
        scroll: viewState?.scroll ?? 0,
        subfolders: current.subfolders
      }
    : null
  const thumbnails = ui.mapMode === 'thumbs'
  if (viewState) {
    const { lat, lon, zoom, source } = viewState
    mapState = { lat, lon, zoom, source, thumbnails }
  } else if (mapState) {
    mapState = { ...mapState, thumbnails }
  }
  saveAppState()
}

/**
 * Start without a parameter: the folder and photo of the previous run (tz.md, пп. 7.1–7.2).
 * A missing folder: the program starts without one; a missing photo: the folder opens with
 * the first photo selected. Both only go to the log.
 */
async function restoreSession(): Promise<void> {
  if (!lastSession) return
  const { folder, photo } = lastSession
  if (!isDirectory(folder)) {
    log.info(`Last folder not found, starting without a folder: ${folder}`)
    return
  }
  const photoOk = !!photo && kindOf(photo) === 'file'
  if (photo && !photoOk) log.info(`Last selected photo not found: ${photo}`)
  log.info(`Restoring the last session: ${folder}`)
  await openFolder(folder, photoOk && photo ? photo : undefined, {
    scroll: lastSession.scroll,
    subfolders: lastSession.subfolders
  })
}

/** Opens a folder, or the folder of a photo with that photo selected (tz.md, п. 3.1). */
async function openPath(path: string): Promise<void> {
  const kind = kindOf(path)
  if (kind === 'dir') await openFolder(path)
  else if (kind === 'file') await openFolder(dirname(path), path)
  else await folderMissing(path)
}

async function folderMissing(folder: string): Promise<void> {
  log.warn(`Folder not found: ${folder}`)
  setRecent((list) => removeRecent(list, folder))
  if (win) {
    await dialog.showMessageBox(win, {
      type: 'warning',
      title: t('error.folder.title'),
      message: t('error.folderMissing', { folder }),
      buttons: [t('dialog.ok')]
    })
  }
}

/**
 * Whether to load photos from the subfolders too (tz.md, п. 3.2): by the setting, or by asking
 * when the folder has any. "Don't ask again" writes the answer into the user settings file.
 */
async function askSubfolders(folder: string): Promise<boolean> {
  const mode = settings.folders.subfolders
  if (mode !== 'ask') return mode === 'yes'
  if (!win || !(await hasSubfolders(folder).catch(() => false))) return false
  const res = await dialog.showMessageBox(win, {
    type: 'question',
    title: t('subfolders.title'),
    message: t('subfolders.question'),
    detail: folder,
    buttons: [t('dialog.yes'), t('dialog.no')],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    checkboxLabel: t('subfolders.dontAsk'),
    checkboxChecked: false
  })
  const yes = res.response === 0
  if (res.checkboxChecked) {
    const value = yes ? 'yes' : 'no'
    settings.folders.subfolders = value
    try {
      setUserSetting(paths.user, paths.schema, paths.defaults, ['folders', 'subfolders'], value)
      log.info(`Subfolders: "${value}" saved in ${paths.user}`)
    } catch (e) {
      log.error(`Cannot save the subfolders choice in ${paths.user}: ${String(e)}`)
    }
  }
  return yes
}

/**
 * `restored`: the folder of the last run opened at start (tz.md, п. 7.1), with the strip scroll
 * and the subfolders choice of that run.
 */
async function openFolder(
  folder: string,
  selectPath?: string,
  restored?: { scroll: number; subfolders: boolean }
): Promise<void> {
  if (!win || saving) return
  if (!(await confirmDiscard())) return
  const subfolders = restored ? restored.subfolders : await askSubfolders(folder)
  if (!win) return
  win.webContents.send(IPC.folderLoading, { folder })
  let scanned
  try {
    scanned = await scanFolder(folder, exiftool, { subfolders })
  } catch (e) {
    log.error(`Cannot open folder ${folder}: ${String(e)}`)
    await dialog.showMessageBox(win, {
      type: 'error',
      title: t('error.folder.title'),
      message: t('error.folder.message', { folder }),
      detail: String(e),
      buttons: [t('dialog.ok')]
    })
    // Back to what was shown before.
    if (current) win.webContents.send(IPC.folderLoaded, current.data)
    return
  }

  generation++
  thumbnails.clear()
  const chosen = selectPath ? scanned.photos.find((p) => samePath(p.path, selectPath)) : undefined
  current = {
    data: { folder, photos: scanned.photos, generation, selected: chosen?.id ?? null },
    sources: scanned.sources,
    fileCoords: scanned.photos.map((p) => p.coords),
    subfolders
  }
  for (const dir of scanned.unreadable) log.warn(`Subfolder skipped, cannot be read: ${dir}`)
  selection = new Set(chosen ? [chosen.id] : [])
  win.webContents.send(IPC.folderLoaded, restored ? { ...current.data, restored: { scroll: restored.scroll } } : current.data)
  setRecent((list) => addRecent(list, folder))
  refreshEditState()

  const withCoords = scanned.photos.filter((p) => p.coords).length
  log.info(
    `Folder opened: ${folder}${subfolders ? ' (with subfolders)' : ''}; photos: ${scanned.photos.length}, with coordinates: ${withCoords}`
  )

  const failed = scanned.photos.filter((p) => p.error)
  for (const p of failed) log.warn(`Read error: ${p.path}: ${p.error}`)
  if (failed.length) {
    void dialog.showMessageBox(win, {
      type: 'warning',
      title: t('error.read.title'),
      message: t('error.read.message', { count: failed.length, total: scanned.photos.length }),
      detail: failed
        .slice(0, 30)
        .map((p) => `${p.name}: ${p.error}`)
        .join('\n'),
      buttons: [t('dialog.ok')]
    })
  }
}

/**
 * "Open Photo…": a file dialog filtered to photos, so the photos in folders are visible;
 * the chosen photo opens its whole folder and becomes selected (tz.md, п. 3.1).
 */
async function choosePhoto(): Promise<void> {
  if (!win) return
  // The open folder, or the last one opened, also in an earlier run.
  const last = current?.data.folder ?? recentFolders[0]
  const startDir = last && isDirectory(last) ? last : undefined
  const res = await dialog.showOpenDialog(win, {
    title: t('dialog.openPhoto'),
    properties: ['openFile'],
    filters: [
      { name: t('dialog.photos'), extensions: [...SUPPORTED_EXTENSIONS] },
      { name: t('dialog.allFiles'), extensions: ['*'] }
    ],
    ...(startDir ? { defaultPath: startDir } : {})
  })
  const file = res.filePaths[0]
  if (!res.canceled && file) await openPath(file)
}

function updateMenu(recent: string[]): void {
  Menu.setApplicationMenu(
    buildMenu(
      t,
      {
        openPhoto: () => void choosePhoto(),
        openRecent: (folder) => void openPath(folder),
        clearRecent: () => setRecent(() => []),
        save: () => void save(),
        saveSelected: () => void save(selection),
        openSettings: () => void openSettingsFile(),
        exit: () => app.quit(),
        toggleView: () => win?.webContents.send(IPC.command, { type: 'toggleView' }),
        showOnMap: () => win?.webContents.send(IPC.command, { type: 'showOnMap' }),
        toggleThumbnails: () => win?.webContents.send(IPC.command, { type: 'toggleThumbnails' }),
        setFilter: (filter: StripFilter) => win?.webContents.send(IPC.command, { type: 'setFilter', filter }),
        shortcuts: () => win?.webContents.send(IPC.command, { type: 'toggleHelp' }),
        about: () => win?.webContents.send(IPC.command, { type: 'showAbout' })
      },
      recent,
      dev
    )
  )
  refreshEditState()
}

function isDirty(): boolean {
  return !!current?.data.photos.some((p) => p.modified)
}

/** Title with `*` (tz.md, п. 4.13) and the Save items follow the unsaved changes and the selection. */
function refreshEditState(): void {
  const photos = current?.data.photos ?? []
  win?.setTitle(windowTitle(current?.data.folder, isDirty()))
  const menu = Menu.getApplicationMenu()
  const saveItem = menu?.getMenuItemById(MENU_ID.save)
  const selItem = menu?.getMenuItemById(MENU_ID.saveSelected)
  if (saveItem) saveItem.enabled = !saving && photosToSave(photos).length > 0
  if (selItem) selItem.enabled = !saving && photosToSave(photos, selection).length > 0

  // The View menu follows the window: mode, active filter; an empty filter is not available.
  const viewItem = menu?.getMenuItemById(MENU_ID.photoView)
  if (viewItem) {
    viewItem.enabled = photos.length > 0
    viewItem.checked = ui.view === 'photo'
  }
  // Show on Map: the current photo needs coordinates.
  const showItem = menu?.getMenuItemById(MENU_ID.showOnMap)
  if (showItem) showItem.enabled = ui.current !== null && !!photos[ui.current]?.coords
  const thumbsItem = menu?.getMenuItemById(MENU_ID.thumbnails)
  if (thumbsItem) thumbsItem.checked = ui.mapMode === 'thumbs'
  const counts = photoCounts(photos)
  const available: Record<StripFilter, boolean> = {
    all: photos.length > 0,
    coords: counts.withCoords > 0,
    noCoords: counts.withoutCoords > 0,
    modified: counts.modified > 0
  }
  for (const f of ['all', 'coords', 'noCoords', 'modified'] as const) {
    const item = menu?.getMenuItemById(MENU_ID.filter[f])
    if (!item) continue
    item.enabled = available[f]
    // A radio item is switched on, never off: Electron then switches the others off.
    if (ui.filter === f) item.checked = true
  }
}

/** Applies changed photos in main and sends them to the window. */
function applyPhotos(changed: Photo[]): void {
  if (!current || !changed.length) return
  for (const p of changed) current.data.photos[p.id] = p
  const msg: PhotosChanged = { generation: current.data.generation, photos: changed }
  win?.webContents.send(IPC.photosChanged, msg)
  refreshEditState()
}

function sendSaveState(state: SaveState): void {
  win?.webContents.send(IPC.saveState, state)
}

/**
 * "Save" (all modified photos) or "Save Selected" (tz.md, п. 6). Returns the photos that could
 * not be written; their list is shown in a window (п. 6.8).
 */
async function save(only?: ReadonlySet<number>): Promise<SaveFailure[]> {
  if (!current || saving) return []
  const folder = current
  const toSave = photosToSave(folder.data.photos, only)
  if (!toSave.length) return []
  saving = true
  refreshEditState()
  log.info(`Saving ${toSave.length} photo(s) in ${folder.data.folder}`)
  sendSaveState({ phase: 'progress', done: 0, total: toSave.length })
  let failed: SaveFailure[] = []
  try {
    const outcome = await savePhotos(
      exiftool,
      toSave.map((p) => ({ photo: p, source: folder.sources[p.id]!, old: folder.fileCoords[p.id] ?? null })),
      log,
      (done, total) => sendSaveState({ phase: 'progress', done, total })
    )
    failed = outcome.failed
    for (const s of outcome.saved) {
      folder.sources[s.id] = s.source
      folder.fileCoords[s.id] = s.photo.coords
    }
    saving = false
    if (current === folder) applyPhotos(outcome.saved.map((s) => s.photo))
    sendSaveState({ phase: 'done', saved: outcome.saved.length, failed: failed.length })
    log.info(`Saved: ${outcome.saved.length}, failed: ${failed.length}`)
  } catch (e) {
    // exiftool itself failed (e.g. it was closed): nothing is marked as saved.
    log.error(`Saving failed: ${String(e)}`)
    failed = toSave.map((p) => ({ id: p.id, name: p.name, error: String(e) }))
    sendSaveState({ phase: 'done', saved: 0, failed: failed.length })
  } finally {
    saving = false
    refreshEditState()
  }
  if (failed.length && win) {
    await dialog.showMessageBox(win, {
      type: 'error',
      title: t('error.write.title'),
      message: t('error.write.message', { count: failed.length, total: toSave.length }),
      detail: failed
        .slice(0, 30)
        .map((f) => `${f.name}: ${f.error}`)
        .join('\n'),
      buttons: [t('dialog.ok')]
    })
  }
  return failed
}

/**
 * Unsaved changes before leaving the folder or the program (tz.md, п. 6.5): save, don't save,
 * cancel. True if it is fine to go on. If saving fails for some photos, the program stays.
 */
async function confirmDiscard(): Promise<boolean> {
  if (!isDirty()) return true
  if (!win || asking || saving) return false
  asking = true
  try {
    const count = current!.data.photos.filter((p) => p.modified).length
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      title: t('unsaved.title'),
      message: t('unsaved.message', { count }),
      buttons: [t('unsaved.save'), t('unsaved.discard'), t('unsaved.cancel')],
      defaultId: 0,
      cancelId: 2,
      noLink: true
    })
    if (response === 2) return false
    if (response === 1) {
      log.info(`Unsaved changes discarded: ${count} photo(s)`)
      return true
    }
    return (await save()).length === 0
  } finally {
    asking = false
  }
}

function setCoords(req: unknown): void {
  if (!current || saving || !validSetCoords(req)) return
  const changed = assignCoords(current.data.photos, current.fileCoords, req.ids, req.coords)
  if (!changed.length) return
  const to = req.coords ? formatCoords(changed[0]!.coords!) : 'none'
  log.verbose(
    `Coordinates set (not saved): ${changed.length} photo(s) → ${to}: ` +
      changed.map((p) => p.name).join(', ')
  )
  applyPhotos(changed)
}

/**
 * The program's license and the licenses of the components (links in About): next to the .exe;
 * in development — LICENSE of the project and out/THIRD-PARTY-NOTICES.txt made by the build.
 */
async function openLicenseFile(which: 'license' | 'notices'): Promise<void> {
  const file = dev
    ? join(app.getAppPath(), which === 'license' ? 'LICENSE' : join('out', 'THIRD-PARTY-NOTICES.txt'))
    : join(dirname(process.execPath), which === 'license' ? 'LICENSE.txt' : 'THIRD-PARTY-NOTICES.txt')
  const err = await shell.openPath(file)
  if (err) {
    log.error(`Cannot open ${file}: ${err}`)
    if (win) void dialog.showMessageBox(win, { type: 'error', message: `${err}\n${file}`, buttons: [t('dialog.ok')] })
  }
}

/** The log folder (link in About): the log has old and new coordinates of every write (tz.md, п. 6.9). */
async function openLogFolder(): Promise<void> {
  const err = await shell.openPath(paths.logs)
  if (err) {
    log.error(`Cannot open log folder ${paths.logs}: ${err}`)
    if (win) void dialog.showMessageBox(win, { type: 'error', message: err, buttons: [t('dialog.ok')] })
  }
}

/** Help → About: versions and where the settings and the log are; the window shows links to them. */
function aboutInfo(): AboutInfo {
  return {
    version: app.getVersion(),
    exiftoolVersion: exiftoolVer,
    exiftoolPath: settings.exiftoolPath,
    settings: paths.user,
    logs: paths.logs,
    electron: process.versions.electron,
    node: process.versions.node
  }
}

async function openSettingsFile(): Promise<void> {
  try {
    if (ensureUserSettingsFile(paths.user, paths.schema, paths.defaults)) {
      log.info(`Settings file created: ${paths.user}`)
    }
    const err = await shell.openPath(paths.user)
    if (err) throw new Error(err)
    log.info(`Settings file opened: ${paths.user}`)
  } catch (e) {
    log.error(`Cannot open settings file ${paths.user}: ${String(e)}`)
    if (win) void dialog.showMessageBox(win, { type: 'error', message: String(e), buttons: [t('dialog.ok')] })
  }
}

function serveThumbnails(): void {
  protocol.handle(THUMB_SCHEME, async (req) => {
    const ref = parseThumbUrl(req.url)
    const source = ref && current?.data.generation === ref.generation ? current.sources[ref.id] : undefined
    if (!ref || !source) return new Response(null, { status: 404 })
    try {
      const jpeg = ref.large ? await thumbnails.getLarge(source) : await thumbnails.get(source)
      return new Response(new Uint8Array(jpeg), {
        headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-store' }
      })
    } catch (e) {
      log.verbose(`No thumbnail for ${source.path}: ${String(e)}`)
      return new Response(null, { status: 404 })
    }
  })
}

function createWindow(): BrowserWindow {
  // The place of the last run, if it is still on a display (tz.md, п. 7.1).
  const areas = screen.getAllDisplays().map((d) => d.workArea)
  const place = windowState && windowOnScreen(windowState, areas) ? windowState : null
  if (windowState && !place) log.info('The saved window place is off screen: default place')
  const w = new BrowserWindow({
    ...(place ? { x: place.x, y: place.y, width: place.width, height: place.height } : { width: 1280, height: 860 }),
    title: windowTitle(),
    show: false,
    // The built program takes its icon from the .exe; in development it is set here.
    ...(dev ? { icon: join(app.getAppPath(), 'build', 'icon.png') } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  // The window place for the next run, whatever closes the window: the normal size, also when
  // maximized (tz.md, п. 7.1).
  const keepPlace = (): void => {
    if (!w.isDestroyed()) windowState = { ...w.getNormalBounds(), maximized: w.isMaximized() }
  }
  w.on('move', keepPlace)
  w.on('resize', keepPlace)
  w.on('maximize', keepPlace)
  w.on('unmaximize', keepPlace)
  // maximize() also shows the window: both wait until the page is ready.
  w.once('ready-to-show', () => (place?.maximized ? w.maximize() : w.show()))
  // The title is set by main (folder, unsaved mark), not by the page.
  w.on('page-title-updated', (e) => e.preventDefault())
  // Closing the window (Exit, Alt+F4, ×) with unsaved changes asks first (tz.md, п. 6.5).
  w.on('close', (e) => {
    keepPlace()
    if (closeConfirmed || (!isDirty() && !saving)) return
    e.preventDefault()
    if (saving) return
    void confirmDiscard().then((ok) => {
      if (!ok) return
      closeConfirmed = true
      w.close()
    })
  })

  // Links (map attribution) open in the browser, never inside the window.
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  w.webContents.on('will-navigate', (e, url) => {
    if (dev && devUrl && url.startsWith(devUrl)) return
    e.preventDefault()
    if (/^https?:/.test(url)) void shell.openExternal(url)
  })

  if (dev && devUrl) void w.loadURL(devUrl)
  else void w.loadFile(join(__dirname, '../renderer/index.html'))
  return w
}

void app.whenReady().then(async () => {
  if (!(await startup())) {
    app.exit(1)
    return
  }

  // OpenStreetMap asks applications to identify themselves (tile usage policy).
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['https://tile.openstreetmap.org/*'] },
    (details, cb) => {
      details.requestHeaders['User-Agent'] = userAgent()
      cb({ requestHeaders: details.requestHeaders })
    }
  )

  serveThumbnails()
  ipcMain.handle(IPC.init, () => {
    // The window is ready: now the folder or photo from the launch parameter can be opened.
    const path = startupPath
    startupPath = undefined
    // A folder or photo given as a parameter wins over the last session (tz.md, п. 7.2).
    if (path) setImmediate(() => void openPath(path))
    else if (!current && lastSession) setImmediate(() => void restoreSession())
    // The window was reloaded (View → Reload in development): show the open folder again,
    // with its unsaved changes, which live in main.
    else if (current) {
      const data: FolderData = { ...current.data, selected: null }
      selection = new Set()
      setImmediate(() => {
        win?.webContents.send(IPC.folderLoaded, data)
        refreshEditState()
      })
    }
    return initData()
  })
  // A folder or photo dropped from Explorer (tz.md, п. 3.1).
  ipcMain.handle(IPC.openPath, (_e, path: unknown) => {
    if (typeof path === 'string' && path) void openPath(path)
  })
  ipcMain.handle(IPC.setCoords, (_e, req: unknown) => setCoords(req))
  ipcMain.on(IPC.uiState, (_e, state: unknown) => {
    ui = validUiState(state) ?? ui
    selection = new Set(ui.ids)
    refreshEditState()
  })
  ipcMain.on(IPC.viewState, (_e, v: unknown) => {
    viewState = validViewState(v) ?? viewState
  })
  ipcMain.handle(IPC.aboutInfo, () => aboutInfo())
  // Only the two known places: the window names a target, never a path.
  ipcMain.handle(IPC.aboutOpen, async (_e, target: unknown) => {
    if (target === 'settings') await openSettingsFile()
    else if (target === 'logs') await openLogFolder()
    else if (target === 'license' || target === 'notices') await openLicenseFile(target)
  })
  // Ctrl+C / Ctrl+V of coordinates (tz.md, п. 4.10): plain text only.
  ipcMain.handle(IPC.clipboardRead, () => clipboard.readText())
  ipcMain.handle(IPC.clipboardWrite, (_e, text: unknown) => {
    if (typeof text === 'string') clipboard.writeText(text)
  })
  ipcMain.handle(IPC.search, async (_e, query: unknown) => {
    if (typeof query !== 'string' || !query.trim()) return { ok: true, places: [] }
    const res = await placeSearch.search(query.trim())
    if (res.ok) log.info(`Place search "${query.trim()}": ${res.places.length} result(s)`)
    else log.warn(`Place search "${query.trim()}" failed: ${res.error}`)
    return res
  })

  const saved = readState(paths.state)
  recentFolders = saved.recentFolders
  lastSession = saved.lastSession
  windowState = saved.window
  mapState = saved.map
  ui = { ...ui, mapMode: mapState?.thumbnails ? 'thumbs' : 'pins' }
  updateMenu(recentFolders)
  win = createWindow()
  win.on('closed', () => (win = null))
})

app.on('window-all-closed', () => app.quit())
app.on('will-quit', () => {
  rememberSession()
  exiftool?.close()
})
