import { statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, nativeTheme, protocol, screen, session, shell } from 'electron'
import { windowTitle } from '@shared/app-info'
import { pathsFromArgv } from '@shared/argv'
import { isBatch, parseBatchArgs } from '@shared/batch-args'
import { isSupported, SUPPORTED_EXTENSIONS } from '@shared/formats'
import { isTrackFile, TRACK_EXTENSIONS, trackPreviewSvg, withTrackColors } from '@shared/track'
import { EXIFTOOL_DOWNLOAD_URL, exiftoolCandidates } from '@shared/exiftool-places'
import { assignAddress, assignAltitude, assignCoords, pastePhotoData, photoCounts, photosAt, photosToSave } from '@shared/edits'
import { checkedAltitude, ELEVATION_BATCH, needsAltitude, pointsWithoutAltitude } from '@shared/elevation'
import { formatDuration } from '@shared/duration'
import { pointKey, pointsWithoutAddress } from '@shared/geocode'
import { RetryBook } from '@shared/retry'
import { makeTranslate, type Strings, type Translate } from '@shared/i18n'
import {
  IPC,
  parseThumbUrl,
  THUMB_SCHEME,
  validRemovePhotos,
  validSetCoords,
  type FolderData,
  type InitData,
  type PhotosChanged,
  type SaveState,
  type StripFilter,
  type StripPosition,
  type UiState,
  validUiState,
  validViewState,
  type AboutInfo,
  type BatchState,
  type ViewState,
  type TrackForMap
} from '@shared/ipc'
import { addressText, formatCoords, type FileMeta, type Photo } from '@shared/photo'
import { addRecent, idsByPath, removeRecent, samePath } from '@shared/recent'
import {
  afterRemoval,
  displayName,
  EMPTY_PROJECT,
  isEmptyProject,
  parentOf,
  renumber,
  titleFolder,
  withAdded,
  withRemoved,
  type Project
} from '@shared/project'
import { mapSources, type Settings } from '@shared/settings'
import { windowOnScreen } from '@shared/window-place'
import { ExifTool, exiftoolVersion, workersFor } from './exiftool'
import { hasSubfolders, scanFiles, scanFolder, type PhotoSource, type ScannedFolder } from './folder'
import { listLanguages, loadStrings } from './locales'
import { AUTO_LANGUAGE, resolveLanguage } from '@shared/language'
import { log, setupLog } from './logger'
import { buildMenu, MENU_ID } from './menu'
import { savePhotos, type SaveFailure } from './save'
import { PlaceSearch } from './search'
import { DefaultSettingsError, ensureUserSettingsFile, formatProblem, loadSettings, setUserSetting } from './settings'
import { readState, writeState, type AppState, type ToolsState } from './state'
import { runBatch, type BatchOptions } from './batch'
import { ElevationService } from './elevation'
import { Geocoder } from './geocode'
import { ThumbnailService } from './thumbnails'
import { canWriteIn, installExiftool } from './exiftool-install'
import { checkForUpdates, installAndRestart, isInstalled } from './updates'
import { releasePageUrl, type UpdateState } from '@shared/updates'
import sharp from 'sharp'

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

/** The project on the strip (tz.md, п. 3.1); `photos`, `sources` and `fileMeta` go by photo id. */
interface OpenFolder {
  data: FolderData
  sources: PhotoSource[]
  /** Coordinates and address as they are in the files: what "modified" is compared with, the log's "old". */
  fileMeta: FileMeta[]
  /** The folder (with its subfolders choice, п. 3.2), added files, files taken off the strip. */
  project: Project
}

/** A photo with what main keeps about it: the unit the strip is rebuilt of. */
interface Entry {
  photo: Photo
  source: PhotoSource
  fileMeta: FileMeta
}

function entriesOf(folder: OpenFolder | null): Entry[] {
  if (!folder) return []
  return folder.data.photos.map((photo, id) => ({ photo, source: folder.sources[id]!, fileMeta: folder.fileMeta[id]! }))
}

function entriesOfScan(scanned: ScannedFolder): Entry[] {
  return scanned.photos.map((photo, id) => ({
    photo,
    source: scanned.sources[id]!,
    fileMeta: { coords: photo.coords, address: photo.address, altitude: photo.altitude }
  }))
}

/** Lower-case paths of the files on the strip, with the MOV of live pairs (п. 3.3.7). */
function filesOf(entries: readonly Entry[]): Set<string> {
  const set = new Set<string>()
  for (const e of entries) {
    set.add(e.source.path.toLowerCase())
    if (e.source.live?.kind === 'pair') set.add(e.source.live.video.path.toLowerCase())
  }
  return set
}

/**
 * exiftool processes for the open project (tz.md, п. 3.10): as many as its files call for — they
 * read it again (Refresh, adding) and give the previews of RAW while the strip scrolls. A smaller
 * project closes the extra ones.
 */
function fitWorkers(): void {
  exiftool.setWorkers(workersFor(current?.data.photos.length ?? 0))
}

/** Makes the project on the strip of these photos (ids already in order). */
function projectOf(entries: readonly Entry[], project: Project, selected: number | null): OpenFolder {
  return {
    // Track colours follow the order of tracks in the strip (tz.md, п. 3.9.5).
    data: { folder: titleFolder(project), photos: withTrackColors(entries.map((e) => e.photo), settings.tracks.colors.length), generation, selected },
    sources: entries.map((e) => e.source),
    fileMeta: entries.map((e) => e.fileMeta),
    project
  }
}

let settings: Settings
/** Languages there are locale files for (Tools → Language, tz.md, п. 2.3). */
let languages: { code: string; name: string }[] = []
/** Tools → Language → Restart: the program starts again once it has really closed. */
let restartOnQuit = false
/** A new version is downloaded or released (tz.md, п. 2.5); shown in the status bar. */
let updateState: UpdateState | null = null
/** "Restart" of the update was clicked: install it when the program exits. */
let updateOnQuit = false
/** The language last chosen in Tools → Language in this run; null — none yet. */
let languageChoice: string | null = null
let strings: Strings
let t: Translate
let exiftool: ExifTool
let thumbnails: ThumbnailService
let placeSearch: PlaceSearch
let geocoder: Geocoder
let elevation: ElevationService
/** Modes of the Tools menu (tz.md, пп. 5.5, 5.6); kept between runs. */
let tools: ToolsState = { address: false, altitude: false }
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
/** The folder files were last added from (Add Files…, tz.md, п. 3.1); kept between runs. */
let addFolder: string | null = null
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
let ui: UiState = { ids: [], current: null, filter: 'all', view: 'map', mapMode: 'pins', grid: false }
/** Where the strip is (tz.md, п. 4.1); kept in the state file. */
let stripPosition: StripPosition = 'bottom'
/** Started with --batch (tz.md, п. 10): no main window, the batch and the exit code. */
const batchArgs = isBatch(process.argv.slice(1)) ? parseBatchArgs(process.argv.slice(1), app.getAppPath()) : null
/** The batch window is running: the program state of the main window is not touched. */
let batchOnly = batchArgs !== null
let startupPaths = batchArgs ? [] : pathsFromArgv(process.argv.slice(1), (p) => kindOf(p) !== null, app.getAppPath())

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

  // Nothing chosen yet ("auto"): the language of Windows, if the program has it (tz.md, п. 2.3).
  languages = listLanguages(paths.locales)
  const chosen = settings.language
  settings = { ...settings, language: resolveLanguage(chosen, app.getPreferredSystemLanguages(), languages.map((l) => l.code)) }
  const loaded = loadStrings(paths.locales, settings.language)
  strings = loaded.strings
  t = makeTranslate(strings)
  const missing = loaded.missing

  setupLog(paths.logs, { ...settings.log, console: dev })
  log.info(`GeoPhotos ${app.getVersion()} started; settings: ${paths.user}`)
  if (chosen === AUTO_LANGUAGE) log.info(`Language: ${settings.language} (Windows: ${app.getPreferredSystemLanguages().join(', ')})`)

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

  const found = await findExiftool(settings.exiftoolPath)
  if (!found) return false
  settings = { ...settings, exiftoolPath: found.path }
  exiftoolVer = found.version
  exiftool = new ExifTool(settings.exiftoolPath)
  // As many thumbnails at once as there are exiftool processes (previews of RAW come from them), at least 3.
  thumbnails = new ThumbnailService(exiftool, () => Math.max(3, exiftool.size), systemThumbnail)
  placeSearch = new PlaceSearch(settings.search.url, userAgent(), settings.language)
  geocoder = new Geocoder(settings.geocode.url, userAgent(), settings.language, settings.geocode.minIntervalMs)
  elevation = new ElevationService(settings.elevation.url, userAgent())
  return true
}

/**
 * exiftool (tz.md, п. 2.2): the path of the settings; if it does not run, the usual places of
 * Windows. Not found — a message with "Download exiftool", "Open Settings File" and "Close";
 * null then, and the program exits.
 */
async function findExiftool(configured: string): Promise<{ path: string; version: string } | null> {
  try {
    const version = await exiftoolVersion(configured)
    log.info(`exiftool ${version}: ${configured}`)
    return { path: configured, version }
  } catch (e) {
    log.warn(`exiftool does not run (${configured}): ${String(e)}`)
  }
  for (const path of exiftoolCandidates(process.env, dirname(process.execPath))) {
    if (kindOf(path) !== 'file') continue
    try {
      const version = await exiftoolVersion(path)
      log.info(`exiftool ${version} found: ${path} (the path of the settings, "${configured}", does not run)`)
      return { path, version }
    } catch (e) {
      log.warn(`exiftool found but does not run: ${path}: ${String(e)}`)
    }
  }
  log.error(`exiftool not found (${configured}, nor in the usual places)`)
  // The choice comes again after a failed install or a wrong file, until something works or Close.
  for (;;) {
    const choice = dialog.showMessageBoxSync({
      type: 'error',
      title: t('error.exiftool.title'),
      message: t('error.exiftool.message', { path: configured }),
      detail: t('error.exiftool.detail'),
      buttons: [t('error.exiftool.install'), t('error.exiftool.download'), t('error.exiftool.choose'), t('dialog.close')],
      defaultId: 0,
      cancelId: 3,
      noLink: true
    })
    if (choice === 0) {
      const done = await installForGeoPhotos()
      if (done) return done
      continue
    }
    if (choice === 1) {
      await shell.openExternal(EXIFTOOL_DOWNLOAD_URL).catch((e: unknown) => log.error(`Cannot open ${EXIFTOOL_DOWNLOAD_URL}: ${String(e)}`))
      return null
    }
    if (choice === 2) {
      const done = await chooseExiftool()
      if (done) return done
      continue
    }
    return null
  }
}

/** Remembers the path of exiftool in the settings file (tz.md, п. 2.2); a failure is logged only. */
function saveExiftoolPath(path: string): void {
  try {
    setUserSetting(paths.user, paths.schema, paths.defaults, ['exiftoolPath'], path)
    log.info(`exiftool path saved in ${paths.user}: ${path}`)
  } catch (e) {
    log.error(`Cannot save the exiftool path in ${paths.user}: ${String(e)}`)
  }
}

/** "Choose exiftool.exe…": the file is run before it is taken; a wrong one is told. */
async function chooseExiftool(): Promise<{ path: string; version: string } | null> {
  const files = dialog.showOpenDialogSync({
    title: t('error.exiftool.choose'),
    properties: ['openFile'],
    filters: [{ name: 'exiftool.exe', extensions: ['exe'] }]
  })
  const path = files?.[0]
  if (!path) return null
  try {
    const version = await exiftoolVersion(path)
    log.info(`exiftool ${version} chosen: ${path}`)
    saveExiftoolPath(path)
    return { path, version }
  } catch (e) {
    log.warn(`The chosen file is not a working exiftool: ${path}: ${String(e)}`)
    dialog.showMessageBoxSync({ type: 'error', title: t('error.exiftool.title'), message: t('error.exiftool.notExiftool', { path }), detail: String(e), buttons: [t('dialog.ok')] })
    return null
  }
}

/** True while exiftool is being installed: its progress window may be the only one. */
let installingExiftool = false

/**
 * "Install for GeoPhotos" (п. 2.2): next to GeoPhotos.exe, or in the user's profile when the
 * folder of the program is read-only (the path then goes to the settings). The progress is shown
 * in the window of the batch mode, with Cancel.
 */
async function installForGeoPhotos(): Promise<{ path: string; version: string } | null> {
  const programDir = dirname(process.execPath)
  // The installed program: its folder is wiped by updating and uninstalling (tz.md, п. 2.5).
  const inProgram = !isInstalled() && (await canWriteIn(programDir))
  const dir = inProgram ? programDir : join(process.env['LOCALAPPDATA'] ?? app.getPath('userData'), 'GeoPhotos', 'exiftool')
  const abort = new AbortController()
  installingExiftool = true
  const w = createBatchWindow()
  try {
    await new Promise<void>((r) => w.webContents.once('did-finish-load', () => r()))
    const onCancel = (): void => abort.abort()
    ipcMain.on(IPC.batchCancel, onCancel)
    w.on('close', () => abort.abort())
    const report = (done: number, total: number): void => {
      if (w.isDestroyed()) return
      const mb = (n: number): number => Math.round(n / 1048576)
      w.webContents.send(IPC.batchState, { phase: 'exiftool', done, total, phaseDone: mb(done), phaseTotal: mb(total), seconds: null } satisfies BatchState)
      w.setProgressBar(total ? done / total : 2)
    }
    report(0, 0)
    try {
      const res = await installExiftool(dir, { fetch, userAgent: userAgent(), onProgress: report, signal: abort.signal, log })
      if (!inProgram) saveExiftoolPath(res.path)
      return res
    } finally {
      ipcMain.off(IPC.batchCancel, onCancel)
    }
  } catch (e) {
    const cancelled = abort.signal.aborted
    log.error(`exiftool not installed${cancelled ? ' (cancelled)' : ''}: ${String(e)}`)
    if (!w.isDestroyed()) w.destroy()
    if (!cancelled) {
      dialog.showMessageBoxSync({ type: 'error', title: t('error.exiftool.title'), message: t('error.exiftool.installFailed'), detail: String(e), buttons: [t('dialog.ok')] })
    }
    return null
  } finally {
    if (!w.isDestroyed()) w.destroy()
    installingExiftool = false
  }
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
    tracks: settings.tracks,
    thumbScheme: THUMB_SCHEME,
    // Regional format of Windows (as in Explorer), for dates (tz.md, п. 4.13).
    dateLocale: app.getSystemLocale() || strings['locale'] || 'en-US',
    update: updateState,
    stripPosition
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
    writeState(paths.state, { recentFolders, lastSession, window: windowState, map: mapState, tools, addFolder, stripPosition })
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
  const project = current?.project
  lastSession =
    project && !isEmptyProject(project)
      ? {
          folder: project.folder,
          photo: photo?.path ?? null,
          scroll: viewState?.scroll ?? 0,
          subfolders: project.subfolders,
          added: project.added,
          removed: project.removed
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
 * Start without a parameter: the project and photo of the previous run (tz.md, пп. 7.1–7.2).
 * A missing folder: the program starts without it (the added files stay); missing added files
 * drop out; a missing photo: the first photo is selected. All only go to the log.
 */
async function restoreSession(): Promise<void> {
  if (!lastSession) return
  const { photo } = lastSession
  let folder = lastSession.folder
  if (folder && !isDirectory(folder)) {
    log.info(`Last folder not found, starting without it: ${folder}`)
    folder = null
  }
  const added = lastSession.added.filter((p) => {
    const ok = kindOf(p) === 'file'
    if (!ok) log.info(`Added file of the last session not found: ${p}`)
    return ok
  })
  const project: Project = { folder, subfolders: lastSession.subfolders, added, removed: folder ? lastSession.removed : [] }
  if (isEmptyProject(project)) return
  const photoOk = !!photo && kindOf(photo) === 'file'
  if (photo && !photoOk) log.info(`Last selected photo not found: ${photo}`)
  log.info(`Restoring the last session: ${folder ?? '(no folder)'}; added files: ${added.length}`)
  await loadProject(project, { selectPath: photoOk && photo ? photo : undefined, restored: { scroll: lastSession.scroll } })
}

/**
 * File → Refresh (F5, tz.md, п. 3.8): the project is read again — new files of the folder come
 * (not those taken off the strip), deleted ones go, changes made outside show. The current and
 * selected photos, the filter, the map and the strip scroll stay; unsaved changes are asked about
 * first, as when another folder is opened (п. 6.5).
 */
async function refresh(): Promise<void> {
  const folder = current
  if (!folder || saving) return
  if (!(await confirmDiscard())) return
  const pathOf = (id: number | null): string | undefined => (id === null ? undefined : folder.data.photos[id]?.path)
  const paths = ui.ids.map(pathOf).filter((p): p is string => !!p)
  log.info(`Refresh: ${folder.data.folder}`)
  await loadProject(folder.project, {
    selectPath: pathOf(ui.current),
    restored: { scroll: viewState?.scroll ?? 0 },
    keep: { paths, filter: ui.filter }
  })
}

/**
 * Folders and files dropped from Explorer or given at start (tz.md, п. 3.1): the first folder
 * opens (a new project; other folders are not taken), then the files are added to the strip.
 */
async function openPaths(list: readonly string[]): Promise<void> {
  const dirs = list.filter(isDirectory)
  const files = list.filter((p) => kindOf(p) === 'file')
  if (dirs.length > 1) log.info(`Several folders given, only the first opens: ${dirs.join('; ')}`)
  if (dirs[0] && !(await openFolder(dirs[0]))) return
  if (files.length) await addFiles(files)
}

/** Open Recent (п. 3.1): the folder, or a message that it is gone. */
async function openRecent(folder: string): Promise<void> {
  if (isDirectory(folder)) await openFolder(folder)
  else await folderMissing(folder)
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
 * Opens a folder (tz.md, п. 3.1): a new project — the strip is the whole folder; unsaved changes
 * and the subfolders are asked about first (пп. 6.5, 3.2). `selectPath`: the photo to select.
 * False if it did not open (cancelled, cannot be read).
 */
async function openFolder(folder: string, selectPath?: string): Promise<boolean> {
  if (!win || saving) return false
  if (!(await confirmDiscard())) return false
  const subfolders = await askSubfolders(folder)
  return loadProject({ folder, subfolders, added: [], removed: [] }, { selectPath })
}

/** The photos of a project: its folder without the files taken off, and the added files. */
async function scanProject(project: Project): Promise<{ entries: Entry[]; unreadable: string[] }> {
  const unreadable: string[] = []
  const entries: Entry[] = []
  if (project.folder) {
    const scanned = await scanFolder(project.folder, exiftool, { subfolders: project.subfolders })
    unreadable.push(...scanned.unreadable)
    entries.push(...entriesOfScan(scanned).filter((e) => !project.removed.some((r) => samePath(r, e.photo.path))))
  }
  if (project.added.length) {
    const scanned = await scanFiles(project.folder, project.added, exiftool)
    unreadable.push(...scanned.unreadable)
    const have = filesOf(entries)
    entries.push(...entriesOfScan(scanned).filter((e) => !have.has(e.photo.path.toLowerCase())))
  }
  return { entries: renumber(entries), unreadable }
}

/**
 * Reads a project and shows it: opening a folder, Refresh (`keep`), the last session at start
 * (`restored`, tz.md, п. 7.1: the strip scroll comes back, the map stays).
 */
async function loadProject(
  project: Project,
  opts: { selectPath?: string; restored?: { scroll: number }; keep?: { paths: string[]; filter: StripFilter } } = {}
): Promise<boolean> {
  const { selectPath, restored, keep } = opts
  if (!win) return false
  const folder = titleFolder(project)
  win.webContents.send(IPC.folderLoading, { folder })
  const started = Date.now()
  let scanned
  try {
    scanned = await scanProject(project)
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
    return false
  }

  generation++
  thumbnails.clear()
  liveVideos.clear()
  const photos = scanned.entries.map((e) => e.photo)
  const chosen = selectPath ? photos.find((p) => samePath(p.path, selectPath)) : undefined
  current = projectOf(scanned.entries, project, chosen?.id ?? null)
  for (const dir of scanned.unreadable) log.warn(`Folder skipped, cannot be read: ${dir}`)
  // A new folder: every point may be asked again (tz.md, п. 5.5).
  addressRetry.clear()
  altitudeRetry.clear()
  selection = new Set(chosen ? [chosen.id] : [])
  win.webContents.send(IPC.folderLoaded, {
    ...current.data,
    ...(restored ? { restored: { scroll: restored.scroll } } : {}),
    ...(keep ? { keep: { ids: idsByPath(current.data.photos, keep.paths), filter: keep.filter } } : {})
  })
  // Only folders go to Open Recent (п. 3.1).
  const opened = project.folder
  if (opened) setRecent((list) => addRecent(list, opened))
  refreshEditState()
  kickQueues()

  const withCoords = photos.filter((p) => p.coords).length
  const parts = [
    opened ? `folder ${opened}${project.subfolders ? ' (with subfolders)' : ''}` : 'no folder',
    ...(project.added.length ? [`added files: ${project.added.length}`] : []),
    ...(project.removed.length ? [`taken off the strip: ${project.removed.length}`] : [])
  ]
  fitWorkers()
  log.info(
    `Opened: ${parts.join('; ')}; photos: ${photos.length}, with coordinates: ${withCoords}; ` +
      `read in ${((Date.now() - started) / 1000).toFixed(2)} s, exiftool processes: ${exiftool.size}`
  )
  reportReadErrors(photos)
  return true
}

/** Files that could not be read: in the log and in a window (tz.md, п. 6.7). */
function reportReadErrors(photos: readonly Photo[]): void {
  const failed = photos.filter((p) => p.error)
  for (const p of failed) log.warn(`Read error: ${p.path}: ${p.error}`)
  if (failed.length && win) {
    void dialog.showMessageBox(win, {
      type: 'warning',
      title: t('error.read.title'),
      message: t('error.read.message', { count: failed.length, total: photos.length }),
      detail: failed
        .slice(0, 30)
        .map((p) => `${p.name}: ${p.error}`)
        .join('\n'),
      buttons: [t('dialog.ok')]
    })
  }
}

/** Adding files that is under way: the next add waits for it, so both land on the strip. */
let addingFiles: Promise<void> = Promise.resolve()

/**
 * Adds files to the strip (tz.md, п. 3.1: Add Files…, dropped files, files given at start)
 * without starting a new project: what is on the strip stays, with its unsaved changes. Files
 * already on it are not added again. The added photos become selected, the first of them current;
 * the map shows those with coordinates.
 */
function addFiles(list: readonly string[]): Promise<void> {
  addingFiles = addingFiles.then(() => addFilesNow(list)).catch((e) => log.error(`Adding files failed: ${String(e)}`))
  return addingFiles
}

async function addFilesNow(list: readonly string[]): Promise<void> {
  if (!win) return
  const present = filesOf(entriesOf(current))
  const unique = [...new Map(list.filter((p) => isSupported(p) || isTrackFile(p)).map((p) => [p.toLowerCase(), p] as const)).values()]
  const fresh = unique.filter((p) => !present.has(p.toLowerCase()))
  if (!fresh.length) {
    log.info(`Nothing to add: ${list.length} file(s), on the strip already or not photos or videos`)
    return
  }
  const base = current?.project ?? EMPTY_PROJECT
  win.webContents.send(IPC.folderLoading, { folder: titleFolder(base), adding: true })
  let scanned: ScannedFolder
  try {
    scanned = await scanFiles(base.folder, fresh, exiftool)
  } catch (e) {
    log.error(`Cannot add files: ${String(e)}`)
    if (current) win.webContents.send(IPC.folderLoaded, keptView(current))
    await dialog.showMessageBox(win, {
      type: 'error',
      title: t('error.add.title'),
      message: t('error.add.message', { count: fresh.length }),
      detail: String(e),
      buttons: [t('dialog.ok')]
    })
    return
  }
  // Saving changes the photos it writes: they are merged after it.
  while (saving) await sleep(200)
  if (!win) return

  // The strip as it is now: it may have changed meanwhile.
  const kept = entriesOf(current)
  const project = current?.project ?? EMPTY_PROJECT
  const have = filesOf(kept)
  const added = entriesOfScan(scanned)
    .filter((e) => !have.has(e.photo.path.toLowerCase()))
    .map((e) => ({ ...e, photo: { ...e.photo, name: displayName(project.folder, e.photo.path) } }))
  for (const dir of scanned.unreadable) log.warn(`Folder skipped, cannot be read: ${dir}`)
  if (!added.length) {
    log.info('Nothing added')
    if (current) win.webContents.send(IPC.folderLoaded, keptView(current))
    return
  }
  // A MOV on the strip by itself that is the pair of an added photo goes with the photo (п. 3.3.7).
  const paired = new Set(added.flatMap((e) => (e.source.live?.kind === 'pair' ? [e.source.live.video.path.toLowerCase()] : [])))
  const stays = kept.filter((e) => !paired.has(e.source.path.toLowerCase()))
  const addedPaths = new Set(added.map((e) => e.photo.path.toLowerCase()))
  const entries = renumber([...stays, ...added])
  const ids = entries.filter((e) => addedPaths.has(e.photo.path.toLowerCase())).map((e) => e.photo.id)
  // In the order they were given: the title names the folder of the first one (п. 4.13).
  const given = fresh.map((p) => p.toLowerCase())
  const rank = (p: string): number => given.indexOf(p.toLowerCase())
  const next = withAdded(
    { ...project, added: project.added.filter((p) => !paired.has(p.toLowerCase())) },
    added.map((e) => e.photo.path).sort((a, b) => rank(a) - rank(b))
  )
  generation++
  // The added photos become selected; a track is selected alone (tz.md, п. 3.9.4): only tracks
  // added — the first of them. The map shows all that was added.
  const photoIds = ids.filter((id) => !entries[id]!.photo.track)
  const chosen = photoIds.length ? photoIds : ids.slice(0, 1)
  current = projectOf(entries, next, chosen[0] ?? null)
  selection = new Set(chosen)
  win.webContents.send(IPC.folderLoaded, { ...current.data, keep: { ids: chosen, filter: ui.filter }, show: ids })
  refreshEditState()
  kickQueues()
  fitWorkers()
  log.info(`Files added: ${added.length}; photos on the strip: ${entries.length}: ${added.map((e) => e.photo.path).join(', ')}`)
  reportReadErrors(added.map((e) => e.photo))
}

/** The strip as it is, sent again (after the "adding…" status): selection, filter, map, scroll stay. */
function keptView(folder: OpenFolder): FolderData {
  return {
    ...folder.data,
    selected: ui.current,
    restored: { scroll: viewState?.scroll ?? 0 },
    keep: { ids: ui.ids, filter: ui.filter }
  }
}

/**
 * Del (tz.md, п. 6.6): the selected photos or track leave the strip, the files on disk stay. If
 * some have unsaved changes, the user is asked first; those changes are then lost. Files of the
 * folder taken off are remembered (Refresh and the next run do not bring them back). The next item
 * of the strip becomes current.
 */
async function removePhotos(req: unknown): Promise<void> {
  if (!win || !current || saving || asking || !validRemovePhotos(req) || req.generation !== current.data.generation) return
  const asked = current
  const askedIds = new Set(req.ids.filter((id) => id < asked.data.photos.length))
  if (!askedIds.size) return
  const changed = [...askedIds].filter((id) => asked.data.photos[id]!.modified).length
  if (changed) {
    asking = true
    try {
      const { response } = await dialog.showMessageBox(win, {
        type: 'question',
        title: t('remove.title'),
        message: t('remove.message', { count: changed }),
        buttons: [t('remove.remove'), t('unsaved.cancel')],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      })
      if (response !== 0) return
    } finally {
      asking = false
    }
  }
  // The strip may have changed while the question was open.
  const folder = current
  if (!win || !folder || folder !== asked || saving) return
  const ids = askedIds
  const gone = folder.data.photos.filter((p) => ids.has(p.id))
  const nextOld = afterRemoval(folder.data.photos.map((p) => p.id), ids)
  const nextPath = nextOld === null ? null : folder.data.photos[nextOld]!.path
  const entries = renumber(entriesOf(folder).filter((e) => !ids.has(e.photo.id)))
  const project = withRemoved(folder.project, gone.map((p) => p.path))
  const nextId = nextPath === null ? null : (entries.find((e) => e.photo.path === nextPath)?.photo.id ?? null)
  generation++
  current = isEmptyProject(project) ? null : projectOf(entries, project, nextId)
  selection = new Set(nextId === null ? [] : [nextId])
  const lost = gone.filter((p) => p.modified).length
  log.info(
    `Taken off the strip: ${gone.length}${lost ? ` (unsaved changes of ${lost} lost)` : ''}: ${gone.map((p) => p.path).join(', ')}`
  )
  const data: FolderData = current
    ? { ...current.data, restored: { scroll: viewState?.scroll ?? 0 }, keep: { ids: [...selection], filter: ui.filter } }
    : { folder: '', photos: [], generation, selected: null }
  win.webContents.send(IPC.folderLoaded, data)
  refreshEditState()
  kickQueues()
  fitWorkers()
}

/** The file dialog of Open Folder… and Add Files… (п. 3.1): filtered to photos and videos. */
async function chooseFiles(title: string, many: boolean, prefer: string | null = null): Promise<string[]> {
  if (!win) return []
  // `prefer` if it is still there; else the open folder, or the last one opened, also in an earlier run.
  const startDir = [prefer, current?.data.folder, recentFolders[0]].find((d): d is string => !!d && isDirectory(d))
  const res = await dialog.showOpenDialog(win, {
    title,
    properties: many ? ['openFile', 'multiSelections'] : ['openFile'],
    filters: [
      // Tracks too (tz.md, п. 3.9.2).
      { name: t('dialog.photos'), extensions: [...SUPPORTED_EXTENSIONS, ...TRACK_EXTENSIONS] },
      { name: t('dialog.allFiles'), extensions: ['*'] }
    ],
    ...(startDir ? { defaultPath: startDir } : {})
  })
  return res.canceled ? [] : res.filePaths
}

/**
 * Open Folder… (tz.md, п. 3.1): a file dialog filtered to photos, so the photos in folders are
 * visible (the folder dialog of Windows shows no files); the chosen photo opens its whole folder
 * and becomes selected.
 */
async function chooseFolder(): Promise<void> {
  const [file] = await chooseFiles(t('dialog.openFolder'), false)
  if (file) await openFolder(parentOf(file), file)
}

/** Add Files… (п. 3.1): the chosen files join the strip. */
async function chooseAddFiles(): Promise<void> {
  // The dialog opens where files were added from the last time (п. 3.1), not in the open folder.
  const files = await chooseFiles(t('dialog.addFiles'), true, addFolder)
  if (!files.length) return
  addFolder = parentOf(files[0]!)
  saveAppState()
  await addFiles(files)
}

function updateMenu(recent: string[]): void {
  Menu.setApplicationMenu(
    buildMenu(
      t,
      {
        openFolder: () => void chooseFolder(),
        addFiles: () => void chooseAddFiles(),
        openRecent: (folder) => void openRecent(folder),
        refresh: () => void refresh(),
        clearRecent: () => setRecent(() => []),
        save: () => void save(),
        saveSelected: () => void save(selection),
        openSettings: () => void openSettingsFile(),
        openLogs: () => void openLogFolder(),
        exit: () => app.quit(),
        copyCoords: () => win?.webContents.send(IPC.command, { type: 'copyCoords' }),
        pasteCoords: () => win?.webContents.send(IPC.command, { type: 'pasteCoords' }),
        clearCoords: () => win?.webContents.send(IPC.command, { type: 'clearCoords' }),
        removeFromStrip: () => win?.webContents.send(IPC.command, { type: 'removeFromStrip' }),
        selectAll: () => win?.webContents.send(IPC.command, { type: 'selectAll' }),
        toggleView: () => win?.webContents.send(IPC.command, { type: 'toggleView' }),
        showOnMap: () => win?.webContents.send(IPC.command, { type: 'showOnMap' }),
        toggleAddress: () => toggleAddress(),
        toggleAltitude: () => toggleAltitude(),
        setLanguage: (code) => void setLanguage(code),
        toggleThumbnails: () => win?.webContents.send(IPC.command, { type: 'toggleThumbnails' }),
        toggleGrid: () => win?.webContents.send(IPC.command, { type: 'toggleGrid' }),
        setStripPosition: (position) => setStripPosition(position),
        setFilter: (filter: StripFilter) => win?.webContents.send(IPC.command, { type: 'setFilter', filter }),
        shortcuts: () => win?.webContents.send(IPC.command, { type: 'toggleHelp' }),
        about: () => win?.webContents.send(IPC.command, { type: 'showAbout' })
      },
      recent,
      dev,
      { list: languages, current: settings.language }
    )
  )
  refreshEditState()
}

/** View → Strip Position (tz.md, п. 4.1): the window rearranges at once; kept for the next run. */
function setStripPosition(position: StripPosition): void {
  stripPosition = position
  saveAppState()
  win?.webContents.send(IPC.command, { type: 'setStripPosition', position })
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
  const refreshItem = menu?.getMenuItemById(MENU_ID.refresh)
  if (refreshItem) refreshItem.enabled = !!current && !saving
  const saveItem = menu?.getMenuItemById(MENU_ID.save)
  const selItem = menu?.getMenuItemById(MENU_ID.saveSelected)
  if (saveItem) saveItem.enabled = !saving && photosToSave(photos).length > 0
  if (selItem) selItem.enabled = !saving && photosToSave(photos, selection).length > 0

  // Edit (tz.md, п. 4.9): Copy — the current photo has coordinates; Paste, Clear, Remove — there is
  // a selection (photos for Paste and Clear: a track has no coordinates of its own); Select All —
  // there are photos.
  const picked = [...selection].map((id) => photos[id]).filter((p): p is Photo => !!p)
  const pickedPhotos = picked.filter((p) => !p.track)
  const enable = (id: string, on: boolean): void => {
    const item = menu?.getMenuItemById(id)
    if (item) item.enabled = on
  }
  const currentPhoto = ui.current === null ? undefined : photos[ui.current]
  enable(MENU_ID.copyCoords, !!currentPhoto?.coords && !currentPhoto.track)
  enable(MENU_ID.pasteCoords, !saving && pickedPhotos.length > 0)
  enable(MENU_ID.clearCoords, !saving && pickedPhotos.some((p) => p.coords))
  enable(MENU_ID.removeFromStrip, !saving && picked.length > 0)
  enable(MENU_ID.selectAll, photos.some((p) => !p.track))

  // The View menu follows the window: mode, active filter; an empty filter is not available.
  const viewItem = menu?.getMenuItemById(MENU_ID.photoView)
  if (viewItem) {
    viewItem.enabled = photos.length > 0
    viewItem.checked = ui.view === 'photo'
  }
  // Show on Map: the current photo needs coordinates.
  const showItem = menu?.getMenuItemById(MENU_ID.showOnMap)
  // A track is shown whole (tz.md, п. 3.9.4).
  if (showItem) showItem.enabled = ui.current !== null && (!!photos[ui.current]?.coords || !!photos[ui.current]?.track)
  const addressItem = menu?.getMenuItemById(MENU_ID.address)
  if (addressItem) addressItem.checked = tools.address
  const altitudeItem = menu?.getMenuItemById(MENU_ID.altitude)
  if (altitudeItem) altitudeItem.checked = tools.altitude
  const thumbsItem = menu?.getMenuItemById(MENU_ID.thumbnails)
  if (thumbsItem) thumbsItem.checked = ui.mapMode === 'thumbs'
  const gridItem = menu?.getMenuItemById(MENU_ID.grid)
  if (gridItem) {
    gridItem.enabled = photos.length > 0
    gridItem.checked = ui.grid
  }
  const stripItem = menu?.getMenuItemById(MENU_ID.strip[stripPosition])
  if (stripItem) stripItem.checked = true
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
  // New coordinates may need an address and an altitude (tz.md, пп. 5.5, 5.6).
  kickQueues()
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Points whose address did not come in this folder (п. 5.5): no answer — asked again later in the
 * background; no address there, or the last try failed — not asked again.
 */
const addressRetry = new RetryBook()
let addressRunning = false

/** Points of the open folder that need an address, except those in `blocked`. */
function addressPoints(blocked: ReadonlySet<string>): number {
  return tools.address && current ? pointsWithoutAddress(current.data.photos, blocked).size : 0
}

/** Points to ask for their address now (п. 5.5); 0 when the mode is off. */
function addressLeft(): number {
  return addressPoints(addressRetry.blocked(Date.now()))
}

/** Points still to get an address: now, or later on a retry. */
function addressAll(): number {
  return addressPoints(addressRetry.finalKeys())
}

/** Points whose altitude did not come (п. 5.6), as for the addresses. */
const altitudeRetry = new RetryBook()
let altitudeRunning = false

function altitudePoints(blocked: ReadonlySet<string>): number {
  return tools.altitude && current ? pointsWithoutAltitude(current.data.photos, blocked).size : 0
}

/** Points to ask for their altitude now; 0 when the mode is off. */
function altitudeLeft(): number {
  return altitudePoints(altitudeRetry.blocked(Date.now()))
}

/** Points still to get an altitude: now, or later on a retry. */
function altitudeAll(): number {
  return altitudePoints(altitudeRetry.finalKeys())
}

/**
 * Nothing to ask now, but some points wait for a retry: pause a little (at most a second, so a
 * mode turned off or another folder stops the wait at once). False when nothing waits.
 */
async function waitForRetry(book: RetryBook, all: () => number): Promise<boolean> {
  if (!all()) return false
  reportQueue()
  const now = Date.now()
  await sleep(Math.min(1000, Math.max(50, (book.nextAt(now) ?? now + 1000) - now)))
  return true
}

/**
 * About how long the rest takes, seconds: an address request at most once per interval, the
 * altitudes a request per 100 points; the two go side by side.
 */
function pendingSeconds(addresses: number, altitudes: number): number {
  const a = (addresses * Math.max(geocoder.intervalMs, 500)) / 1000
  const h = Math.ceil(altitudes / ELEVATION_BATCH)
  return Math.ceil(Math.max(a, h))
}

/** The status bar: points still to get (waiting retries too), about how long the rest takes now. */
function reportQueue(): void {
  const now = Date.now()
  const asking = addressLeft() + altitudeLeft()
  // Only retries left: about the time until the nearest one.
  const next = Math.min(addressRetry.nextAt(now) ?? Infinity, altitudeRetry.nextAt(now) ?? Infinity)
  win?.webContents.send(IPC.queueState, {
    address: addressAll(),
    altitude: altitudeAll(),
    seconds: asking || next === Infinity ? pendingSeconds(addressLeft(), altitudeLeft()) : Math.ceil((next - now) / 1000)
  })
}

/** Starts getting addresses and altitudes if their modes are on and some photos need them. */
function kickQueues(): void {
  reportQueue()
  if (!addressRunning && addressAll() > 0) void runAddresses()
  if (!altitudeRunning && altitudeAll() > 0) void runAltitudes()
}

/**
 * Get Altitude (п. 5.6): up to 100 points per request, the altitude for every photo at a point
 * that has none. Waits while saving; stops when the mode is turned off or the folder closes.
 */
async function runAltitudes(): Promise<void> {
  altitudeRunning = true
  try {
    for (;;) {
      while (saving) await sleep(200)
      const folder = current
      if (!tools.altitude || !folder) break
      const batch = [...pointsWithoutAltitude(folder.data.photos, altitudeRetry.blocked(Date.now()))].slice(0, ELEVATION_BATCH)
      if (!batch.length) {
        if (await waitForRetry(altitudeRetry, altitudeAll)) continue
        break
      }
      const res = await elevation.get(batch.map(([, c]) => c))
      if (current !== folder || !tools.altitude) continue
      if (!res.ok) {
        for (const [key] of batch) altitudeRetry.failed(key, Date.now())
        log.warn(`Altitudes for ${batch.length} point(s) not received (asked again later): ${res.error}`)
        reportQueue()
        continue
      }
      const changed: Photo[] = []
      batch.forEach(([key, point], i) => {
        const alt = res.values[i]
        if (alt === null || alt === undefined) {
          altitudeRetry.nothing(key)
          return
        }
        // A 0 that the terrain confirms stays and is not asked again in this folder (п. 5.6).
        const at = photosAt(folder.data.photos, point).filter((id) => needsAltitude(folder.data.photos[id]!.altitude))
        const ids = at.filter((id) => checkedAltitude(folder.data.photos[id]!.altitude, alt) !== null)
        if (ids.length < at.length) altitudeRetry.nothing(key)
        else altitudeRetry.done(key)
        const zeros = ids.filter((id) => folder.data.photos[id]!.altitude === 0)
        if (zeros.length) log.info(`Altitude 0 at ${formatCoords(point)} is wrong (terrain ${Math.round(alt)} m): ${zeros.length} photo(s)`)
        changed.push(...assignAltitude(folder.data.photos, folder.fileMeta, ids, alt))
      })
      log.verbose(`Altitudes found (not saved): ${batch.length} point(s), ${changed.length} photo(s)`)
      if (changed.length) applyPhotos(changed)
      else reportQueue()
    }
  } finally {
    altitudeRunning = false
    reportQueue()
  }
}

/**
 * Tools → Language (tz.md, п. 2.3): saved in the settings file, and the program restarts at once
 * (settings apply at start, п. 8.5): it closes the usual way (unsaved changes are asked about) and
 * comes back with its folder as at any start.
 */
async function setLanguage(code: string): Promise<void> {
  // Compared with the last choice, not the running language: choosing back must be saved too.
  if (code === (languageChoice ?? settings.language)) return
  try {
    setUserSetting(paths.user, paths.schema, paths.defaults, ['language'], code)
    languageChoice = code
    log.info(`Language "${code}" saved in ${paths.user}`)
  } catch (e) {
    log.error(`Cannot save the language in ${paths.user}: ${String(e)}`)
    if (win) void dialog.showMessageBox(win, { type: 'error', message: String(e), buttons: [t('dialog.ok')] })
    updateMenu(recentFolders)
    return
  }
  restartOnQuit = true
  app.quit()
}

/** Tools → Get Altitude (п. 5.6): on — altitudes for all photos of the folder that need one. */
function toggleAltitude(): void {
  tools = { ...tools, altitude: !tools.altitude }
  log.info(`Get Altitude: ${tools.altitude ? 'on' : 'off'}`)
  saveAppState()
  refreshEditState()
  if (tools.altitude) altitudeRetry.clear()
  kickQueues()
}

/**
 * Gets Get Address done (п. 5.5): one point at a time, the found address for every photo at that
 * point that has none. Waits while saving; stops when the mode is turned off or the folder closes.
 */
async function runAddresses(): Promise<void> {
  addressRunning = true
  try {
    for (;;) {
      while (saving) await sleep(200)
      const folder = current
      if (!tools.address || !folder) break
      const next = pointsWithoutAddress(folder.data.photos, addressRetry.blocked(Date.now())).entries().next()
      if (next.done) {
        if (await waitForRetry(addressRetry, addressAll)) continue
        break
      }
      const [key, point] = next.value
      const res = await geocoder.reverse(point)
      if (current !== folder || !tools.address) continue
      if (!res.ok || !res.address) {
        if (res.ok) {
          addressRetry.nothing(key)
          log.info(`No address at ${formatCoords(point)}`)
        } else {
          addressRetry.failed(key, Date.now())
          const again = addressRetry.isFinal(key) ? 'given up' : 'asked again later'
          log.warn(`Address for ${formatCoords(point)} not received (${again}): ${res.error}`)
        }
        reportQueue()
        continue
      }
      addressRetry.done(key)
      const ids = photosAt(folder.data.photos, point).filter((id) => !folder.data.photos[id]!.address)
      const changed = assignAddress(folder.data.photos, folder.fileMeta, ids, res.address)
      log.verbose(`Address found (not saved): ${formatCoords(point)} → ${addressText(res.address)}: ${changed.length} photo(s)`)
      if (changed.length) applyPhotos(changed)
      else reportQueue()
    }
  } finally {
    addressRunning = false
    reportQueue()
  }
}

/** Tools → Get Address (п. 5.5): on — addresses for all photos of the folder that need one. */
function toggleAddress(): void {
  tools = { ...tools, address: !tools.address }
  log.info(`Get Address: ${tools.address ? 'on' : 'off'}`)
  saveAppState()
  refreshEditState()
  if (tools.address) addressRetry.clear()
  kickQueues()
}


/**
 * Photos of the open folder still waiting for an address or an altitude (пп. 5.5, 5.6), also
 * those whose point waits for a retry; points given up on are left out.
 */
function pendingPhotos(): Photo[] {
  if (!current || (!tools.address && !tools.altitude)) return []
  return current.data.photos.filter((p) => {
    if (!p.coords) return false
    const key = pointKey(p.coords)
    return (
      (tools.address && !p.address && !addressRetry.isFinal(key)) ||
      (tools.altitude && p.altitude === null && !altitudeRetry.isFinal(key))
    )
  })
}

/**
 * Closing the program (tz.md, пп. 6.5, 10). While addresses or altitudes are still being found:
 * stay, save and finish them in the background, or exit without them; then, as always, the
 * question about unsaved changes.
 */
async function confirmExit(): Promise<'stay' | 'exit' | 'background'> {
  const left = pendingPhotos().length
  if (left && win) {
    asking = true
    let response: number
    try {
      ;({ response } = await dialog.showMessageBox(win, {
        type: 'question',
        title: t('exitPending.title'),
        message: t('exitPending.message', { count: left, time: formatDuration(pendingSeconds(addressLeft(), altitudeLeft()), t) }),
        buttons: [t('exitPending.stay'), t('exitPending.background'), t('exitPending.exit')],
        defaultId: 1,
        cancelId: 0,
        noLink: true
      }))
    } finally {
      asking = false
    }
    if (response === 0) return 'stay'
    if (response === 1) {
      log.info(`Exit: ${left} photo(s) are finished in the background`)
      const failed = await save(undefined, { askPending: false })
      // Not saved (cancelled, or some files failed: their list is shown): the program stays.
      return failed !== null && failed.length === 0 ? 'background' : 'stay'
    }
    log.info(`Exit without ${left} address(es)/altitude(s)`)
  }
  return (await confirmDiscard()) ? 'exit' : 'stay'
}

/**
 * The main window closes; the rest of the addresses and altitudes are found and written in the
 * progress window of the batch mode, which closes by itself when done (tz.md, п. 10).
 */
async function finishInBackground(w: BrowserWindow): Promise<void> {
  const paths = pendingPhotos().map((p) => p.path)
  const opts: BatchOptions = { address: tools.address, altitude: tools.altitude, subfolders: false, overwrite: false }
  // The session is remembered now; the background work does not change it.
  rememberSession()
  batchOnly = true
  current = null
  const done = runBatchWindow(paths, opts)
  w.destroy()
  app.exit(await done)
}

/**
 * Saving while addresses or altitudes are still being found (пп. 5.5, 5.6): wait for them, save
 * without them, or cancel (false).
 */
async function askPendingBeforeSave(): Promise<boolean> {
  const addresses = addressLeft()
  const altitudes = altitudeLeft()
  if ((!addresses && !altitudes) || !win) return true
  const list = [
    ...(addresses ? [t('pending.addresses', { count: addresses })] : []),
    ...(altitudes ? [t('pending.altitudes', { count: altitudes })] : [])
  ].join(', ')
  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    title: t('pending.title'),
    message: t('pending.message', { list, time: formatDuration(pendingSeconds(addresses, altitudes), t) }),
    buttons: [t('pending.wait'), t('pending.skip'), t('unsaved.cancel')],
    defaultId: 0,
    cancelId: 2,
    noLink: true
  })
  if (response === 2) return false
  if (response === 0) {
    log.info(`Saving waits for ${addresses} address(es), ${altitudes} altitude(s)`)
    for (let n = addressLeft() + altitudeLeft(); n > 0; n = addressLeft() + altitudeLeft()) {
      sendSaveState({ phase: 'waiting', left: n })
      await sleep(300)
    }
    sendSaveState({ phase: 'waiting', left: 0 })
  }
  return true
}

function sendSaveState(state: SaveState): void {
  win?.webContents.send(IPC.saveState, state)
}

/**
 * "Save" (all modified photos) or "Save Selected" (tz.md, п. 6). Returns the photos that could
 * not be written (their list is shown in a window, п. 6.8), or null if saving was cancelled.
 */
async function save(only?: ReadonlySet<number>, opts: { askPending?: boolean } = {}): Promise<SaveFailure[] | null> {
  if (!current || saving) return []
  if (opts.askPending !== false && !(await askPendingBeforeSave())) return null
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
      toSave.map((p) => ({ photo: p, source: folder.sources[p.id]!, old: folder.fileMeta[p.id]?.coords ?? null })),
      log,
      (done, total) => sendSaveState({ phase: 'progress', done, total })
    )
    failed = outcome.failed
    for (const s of outcome.saved) {
      folder.sources[s.id] = s.source
      folder.fileMeta[s.id] = { coords: s.photo.coords, address: s.photo.address, altitude: s.photo.altitude }
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
    const failed = await save()
    return failed !== null && failed.length === 0
  } finally {
    asking = false
  }
}

function setCoords(req: unknown): void {
  if (!current || saving || !validSetCoords(req)) return
  const changed =
    req.copied && req.coords
      ? pastePhotoData(current.data.photos, current.fileMeta, req.ids, req.coords, req.copied.address, req.copied.altitude)
      : assignCoords(current.data.photos, current.fileMeta, req.ids, req.coords)
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

/** Help → About: versions; the window links to the licenses. */
function aboutInfo(): AboutInfo {
  return {
    version: app.getVersion(),
    exiftoolVersion: exiftoolVer,
    exiftoolPath: settings.exiftoolPath,
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

/**
 * The frame Explorer shows for a video (tz.md, п. 3.3.6), as PNG. Windows renders it with the
 * codecs of the system and keeps it in its own thumbnail cache.
 */
async function systemThumbnail(path: string, size: number): Promise<Buffer> {
  const img = await nativeImage.createThumbnailFromPath(path, { width: size, height: size })
  if (img.isEmpty()) throw new Error('empty system thumbnail')
  return img.toPNG()
}

/** "Open in Player" of the photo view (п. 4.14): the video in the default program of Windows. */
async function openInPlayer(id: unknown): Promise<void> {
  const photo = typeof id === 'number' ? current?.data.photos[id] : undefined
  if (!photo?.video) return
  const err = await shell.openPath(photo.path)
  if (err) {
    log.error(`Cannot open ${photo.path} in the player: ${err}`)
    if (win) void dialog.showMessageBox(win, { type: 'error', message: `${err}\n${photo.path}`, buttons: [t('dialog.ok')] })
  } else log.info(`Opened in the player: ${photo.path}`)
}

/** Videos of live photos, a few kept in memory: the strip plays them again on every hover. */
const liveVideos = new Map<string, Promise<Buffer>>()

/**
 * The video of a live photo (tz.md, п. 3.3.7): taken out of the file by exiftool, or the MOV of
 * the pair. Ranges are answered, as video players ask for them.
 */
async function serveLive(source: PhotoSource, range: string | null): Promise<Response> {
  const live = source.live
  if (!live) return new Response(null, { status: 404 })
  let p = liveVideos.get(source.path)
  if (!p) {
    p = live.kind === 'pair'
      ? readFile(live.video.path)
      : exiftool.binary(source.path, live.tag).then((b) => {
          if (!b) throw new Error('no video inside')
          return b
        })
    liveVideos.set(source.path, p)
    while (liveVideos.size > 8) liveVideos.delete(liveVideos.keys().next().value!)
  }
  try {
    const all = await p
    const headers = { 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'cache-control': 'no-store' }
    const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null
    if (m && (m[1] || m[2])) {
      const start = m[1] ? Number(m[1]) : Math.max(0, all.length - Number(m[2]))
      const end = m[1] && m[2] ? Math.min(Number(m[2]), all.length - 1) : all.length - 1
      if (start >= all.length || start > end) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${all.length}` } })
      return new Response(new Uint8Array(all.subarray(start, end + 1)), {
        status: 206,
        headers: { ...headers, 'content-range': `bytes ${start}-${end}/${all.length}`, 'content-length': String(end - start + 1) }
      })
    }
    return new Response(new Uint8Array(all), { headers: { ...headers, 'content-length': String(all.length) } })
  } catch (e) {
    liveVideos.delete(source.path)
    log.verbose(`No live video for ${source.path}: ${String(e)}`)
    return new Response(null, { status: 404 })
  }
}

/** Thumbnails of tracks by path and colour: the colour changes when tracks are added or taken off. */
const trackThumbs = new Map<string, Promise<Buffer>>()

/** The shape of a track in its colour (tz.md, п. 3.9.3), as a JPEG like the photo thumbnails. */
function trackThumbnail(source: PhotoSource, color: string): Promise<Buffer> {
  const key = `${source.path.toLowerCase()}|${color}`
  let p = trackThumbs.get(key)
  if (!p) {
    const data = source.track?.data
    p = data ? sharp(Buffer.from(trackPreviewSvg(data, color))).jpeg({ quality: 85 }).toBuffer() : Promise.reject(new Error('track not read'))
    trackThumbs.set(key, p)
    while (trackThumbs.size > 200) trackThumbs.delete(trackThumbs.keys().next().value!)
  }
  return p
}

function serveThumbnails(): void {
  protocol.handle(THUMB_SCHEME, async (req) => {
    const ref = parseThumbUrl(req.url)
    const source = ref && current?.data.generation === ref.generation ? current.sources[ref.id] : undefined
    if (!ref || !source) return new Response(null, { status: 404 })
    if (ref.live) return serveLive(source, req.headers.get('range'))
    if (source.preview === 'track') {
      const info = current?.data.photos[ref.id]?.track
      const colors = settings.tracks.colors
      try {
        const jpeg = await trackThumbnail(source, colors[(info?.color ?? 0) % colors.length]!)
        return new Response(new Uint8Array(jpeg), { headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-store' } })
      } catch {
        return new Response(null, { status: 404 })
      }
    }
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
    backgroundColor: WINDOW_BG,
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
    if (closeConfirmed || (!isDirty() && !saving && !pendingPhotos().length)) return
    e.preventDefault()
    if (saving || asking) {
      restartOnQuit = false
      updateOnQuit = false
      return
    }
    void confirmExit().then((how) => {
      if (how === 'stay') {
        restartOnQuit = false
        updateOnQuit = false
        return
      }
      closeConfirmed = true
      if (how === 'background') void finishInBackground(w)
      else w.close()
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

/** The progress window of the batch mode (tz.md, п. 10): small, no menu. */
function createBatchWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 520,
    height: 250,
    minWidth: 360,
    minHeight: 180,
    maximizable: false,
    title: 'GeoPhotos',
    show: false,
    backgroundColor: WINDOW_BG,
    ...(dev ? { icon: join(app.getAppPath(), 'build', 'icon.png') } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  w.setMenu(null)
  w.once('ready-to-show', () => w.show())
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (dev && devUrl) void w.loadURL(`${devUrl}/batch.html`)
  else void w.loadFile(join(__dirname, '../renderer/batch.html'))
  return w
}

/**
 * Runs a batch in its progress window (tz.md, п. 10) and waits until the window is closed.
 * Returns the exit code: 0 — all done, 1 — some errors, 3 — cancelled.
 */
async function runBatchWindow(paths: string[], opts: BatchOptions): Promise<number> {
  const w = createBatchWindow()
  await new Promise<void>((r) => w.webContents.once('did-finish-load', () => r()))
  let cancel = false
  let running = true
  const onCancel = (): void => {
    if (!cancel) log.info('Batch: cancelled by the user')
    cancel = true
  }
  ipcMain.on(IPC.batchCancel, onCancel)
  // Closing the window while it works is a Cancel; afterwards it just closes.
  w.on('close', (e) => {
    if (!running) return
    e.preventDefault()
    onCancel()
  })
  log.info(
    `Batch: ${paths.join(', ')}; address: ${opts.address}, altitude: ${opts.altitude}, ` +
      `subfolders: ${opts.subfolders}, overwrite: ${opts.overwrite}`
  )
  const outcome = await runBatch(
    paths,
    opts,
    {
      exiftool,
      reverse: (c) => geocoder.reverse(c),
      elevations: (points) => elevation.get(points),
      log,
      addressIntervalMs: geocoder.intervalMs
    },
    (p) => {
      if (w.isDestroyed()) return
      w.webContents.send(IPC.batchState, p)
      // The taskbar shows the progress too; unknown total — the moving bar.
      w.setProgressBar(p.total ? p.done / p.total : 2)
    },
    () => cancel
  )
  running = false
  ipcMain.off(IPC.batchCancel, onCancel)
  for (const f of outcome.failed) log.error(`Batch error: ${f.name}: ${f.error}`)
  log.info(
    `Batch done: written ${outcome.written}, skipped ${outcome.skipped}, errors ${outcome.failed.length}` +
      (outcome.cancelled ? ', cancelled' : '')
  )
  if (!w.isDestroyed()) {
    w.setProgressBar(-1)
    w.webContents.send(IPC.batchDone, outcome)
    if (outcome.failed.length) w.flashFrame(true)
    await new Promise<void>((r) => w.once('closed', () => r()))
  }
  return outcome.cancelled ? 3 : outcome.failed.length ? 1 : 0
}

/** The window background before the page paints: the same as --bg in style.css (tz.md, п. 4.16). */
const WINDOW_BG = '#2b2b2b'

void app.whenReady().then(async () => {
  // The program is dark whatever the Windows theme: the menu bar, title bar, scrollbars and the
  // Windows dialogs too (tz.md, п. 4.16).
  nativeTheme.themeSource = 'dark'
  // Before startup: the progress window of installing exiftool asks for its texts (tz.md, п. 2.2).
  ipcMain.handle(IPC.batchInit, () => ({ strings }))
  if (!(await startup())) {
    app.exit(1)
    return
  }

  // Batch mode (tz.md, п. 10): the batch window only; wrong parameters are told and the program ends.
  if (batchArgs) {
    if ('error' in batchArgs) {
      log.error(`Batch mode: ${batchArgs.error}`)
      await dialog.showMessageBox({ type: 'error', title: 'GeoPhotos', message: t('batch.badArgs', { error: batchArgs.error }), buttons: [t('dialog.ok')] })
      app.exit(2)
      return
    }
    const { paths: list, ...opts } = batchArgs
    app.exit(await runBatchWindow(list, opts))
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
    const given = startupPaths
    startupPaths = []
    // Folders and files given as parameters win over the last session (tz.md, п. 7.2).
    if (given.length) setImmediate(() => void openPaths(given))
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
  // Folders and files dropped from Explorer (tz.md, п. 3.1).
  ipcMain.handle(IPC.openPaths, (_e, list: unknown) => {
    if (Array.isArray(list)) void openPaths(list.filter((p): p is string => typeof p === 'string' && p !== ''))
  })
  ipcMain.handle(IPC.removePhotos, (_e, req: unknown) => removePhotos(req))
  ipcMain.handle(IPC.trackData, (_e, gen: unknown, id: unknown): TrackForMap | null => {
    if (!current || gen !== current.data.generation || typeof id !== 'number') return null
    const track = current.sources[id]?.track
    return track ? { data: track.data, zone: track.zone } : null
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
  ipcMain.handle(IPC.openInPlayer, (_e, id: unknown) => openInPlayer(id))
  ipcMain.handle(IPC.aboutInfo, () => aboutInfo())
  // The update in the status bar (tz.md, п. 2.5): the release page, or exit and install.
  ipcMain.handle(IPC.updateApply, async () => {
    if (updateState?.kind === 'available') await shell.openExternal(releasePageUrl(updateState.version))
    else if (updateState?.kind === 'ready') {
      updateOnQuit = true
      win?.close()
    }
  })
  // Only known places: the window names a target, never a path.
  ipcMain.handle(IPC.aboutOpen, async (_e, target: unknown) => {
    if (target === 'license' || target === 'notices') await openLicenseFile(target)
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
  tools = saved.tools
  addFolder = saved.addFolder
  stripPosition = saved.stripPosition
  ui = { ...ui, mapMode: mapState?.thumbnails ? 'thumbs' : 'pins' }
  updateMenu(recentFolders)
  win = createWindow()
  win.on('closed', () => (win = null))
  // After the window is up: the check never delays the start (tz.md, п. 2.5).
  if (settings.checkUpdates) {
    win.webContents.once('did-finish-load', () => {
      void checkForUpdates({
        userAgent: userAgent(),
        onState: (s) => {
          updateState = s
          win?.webContents.send(IPC.updateState, s)
        }
      })
    })
  }
})

// The progress window of installing exiftool closes before the main window opens (tz.md, п. 2.2).
app.on('window-all-closed', () => {
  if (!installingExiftool) app.quit()
})
app.on('will-quit', () => {
  if (updateOnQuit) installAndRestart()
  else if (restartOnQuit) app.relaunch()
  // The batch mode does not touch the state of the main window (last folder, map…).
  if (!batchOnly) rememberSession()
  exiftool?.close()
})
