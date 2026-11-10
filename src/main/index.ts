import { statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, session, shell } from 'electron'
import { windowTitle } from '@shared/app-info'
import { pathFromArgv } from '@shared/argv'
import { SUPPORTED_EXTENSIONS } from '@shared/formats'
import { makeTranslate, type Strings, type Translate } from '@shared/i18n'
import { IPC, parseThumbUrl, THUMB_SCHEME, type FolderData, type InitData } from '@shared/ipc'
import { addRecent, removeRecent, samePath } from '@shared/recent'
import { mapSources, type Settings } from '@shared/settings'
import { ExifTool, exiftoolVersion } from './exiftool'
import { scanFolder, type PhotoSource } from './folder'
import { loadStrings } from './locales'
import { log, setupLog } from './logger'
import { buildMenu } from './menu'
import { DefaultSettingsError, ensureUserSettingsFile, formatProblem, loadSettings } from './settings'
import { readState, writeState } from './state'
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
}

let settings: Settings
let strings: Strings
let t: Translate
let exiftool: ExifTool
let thumbnails: ThumbnailService
let win: BrowserWindow | null = null
let current: OpenFolder | null = null
let generation = 0
/** Recent folders, latest first (tz.md, п. 3.1); read from the state file once at start. */
let recentFolders: string[] = []
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
  return true
}

function initData(): InitData {
  const { sources, skipped } = mapSources(settings)
  if (skipped.length) log.warn(t('error.tileSources', { keys: skipped.join(', ') }))
  return {
    strings,
    map: {
      sources,
      defaultSource: settings.map.defaultSource,
      initialView: settings.map.initialView,
      markers: settings.map.markers
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
  try {
    writeState(paths.state, { recentFolders })
  } catch (e) {
    log.warn(`Cannot save state ${paths.state}: ${String(e)}`)
  }
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

async function openFolder(folder: string, selectPath?: string): Promise<void> {
  if (!win) return
  win.webContents.send(IPC.folderLoading, { folder })
  let scanned
  try {
    scanned = await scanFolder(folder, exiftool)
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
    sources: scanned.sources
  }
  win.webContents.send(IPC.folderLoaded, current.data)
  win.setTitle(windowTitle(folder))
  setRecent((list) => addRecent(list, folder))

  const withCoords = scanned.photos.filter((p) => p.coords).length
  log.info(`Folder opened: ${folder}; photos: ${scanned.photos.length}, with coordinates: ${withCoords}`)

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
        openSettings: () => void openSettingsFile(),
        exit: () => app.quit()
      },
      recent,
      dev
    )
  )
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
    if (!source) return new Response(null, { status: 404 })
    try {
      const jpeg = await thumbnails.get(source)
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
  const w = new BrowserWindow({
    width: 1280,
    height: 860,
    title: windowTitle(),
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  w.once('ready-to-show', () => w.show())
  // The title is set by main (folder, unsaved mark), not by the page.
  w.on('page-title-updated', (e) => e.preventDefault())

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
      details.requestHeaders['User-Agent'] = `GeoPhotos/${app.getVersion()}`
      cb({ requestHeaders: details.requestHeaders })
    }
  )

  serveThumbnails()
  ipcMain.handle(IPC.init, () => {
    // The window is ready: now the folder or photo from the launch parameter can be opened.
    const path = startupPath
    startupPath = undefined
    if (path) setImmediate(() => void openPath(path))
    return initData()
  })
  // A folder or photo dropped from Explorer (tz.md, п. 3.1).
  ipcMain.handle(IPC.openPath, (_e, path: unknown) => {
    if (typeof path === 'string' && path) void openPath(path)
  })

  recentFolders = readState(paths.state).recentFolders
  updateMenu(recentFolders)
  win = createWindow()
  win.on('closed', () => (win = null))
})

app.on('window-all-closed', () => app.quit())
app.on('will-quit', () => exiftool?.close())
