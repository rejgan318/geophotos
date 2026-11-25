import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { isNewer, LATEST_YML_URL, latestVersion, type UpdateState } from '@shared/updates'
import { log } from './logger'

/**
 * Updates (tz.md, п. 2.5). The installed program (made by the NSIS installer: its uninstaller lies
 * next to GeoPhotos.exe) is updated by electron-updater: downloaded in the background, installed
 * on exit. The zip version only learns the latest version from `latest.yml` of the release.
 *
 * GEOPHOTOS_UPDATE_URL — a folder with `latest.yml` (and the installer) instead of GitHub: for
 * checking the update locally (make-project.md, п. 7).
 */

/** The program was put by the installer, not unpacked from the zip. */
export function isInstalled(): boolean {
  return app.isPackaged && existsSync(join(dirname(process.execPath), `Uninstall ${app.getName()}.exe`))
}

type Updater = (typeof import('electron-updater'))['autoUpdater']
let updater: Updater | null = null
let ready = false

/** Starts the check; `onState` is called once, when there is something to show. */
export async function checkForUpdates(opts: { userAgent: string; onState: (s: UpdateState) => void }): Promise<void> {
  if (!app.isPackaged) return
  const override = process.env['GEOPHOTOS_UPDATE_URL']
  try {
    if (isInstalled()) {
      // electron-updater is CommonJS with its autoUpdater behind a getter: imported dynamically, it
      // is found under default.
      const mod = (await import('electron-updater')) as typeof import('electron-updater') & { default?: typeof import('electron-updater') }
      const autoUpdater = mod.default?.autoUpdater ?? mod.autoUpdater
      updater = autoUpdater
      autoUpdater.logger = log
      autoUpdater.autoDownload = true
      autoUpdater.autoInstallOnAppQuit = true
      if (override) autoUpdater.setFeedURL({ provider: 'generic', url: override })
      autoUpdater.on('update-downloaded', (info) => {
        ready = true
        log.info(`Update ${info.version} downloaded; installed on exit`)
        opts.onState({ kind: 'ready', version: info.version })
      })
      autoUpdater.on('error', (e) => log.warn(`Update check failed: ${e.message}`))
      await autoUpdater.checkForUpdates()
      return
    }
    const url = override ? `${override.replace(/\/$/, '')}/latest.yml` : LATEST_YML_URL
    const res = await fetch(url, { headers: { 'User-Agent': opts.userAgent } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const version = latestVersion(await res.text())
    if (!version) throw new Error('no version in latest.yml')
    const current = app.getVersion()
    if (isNewer(version, current)) {
      log.info(`A newer version is released: ${version} (this one ${current}, zip: not updated by itself)`)
      opts.onState({ kind: 'available', version })
    } else log.info(`No newer version than ${current}`)
  } catch (e) {
    // Without network or GitHub: silently, only in the log (tz.md, п. 2.5).
    log.warn(`Update check failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/** On exit after "restart": install the downloaded version silently and start it. */
export function installAndRestart(): void {
  if (updater && ready) updater.quitAndInstall(true, true)
}
