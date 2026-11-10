import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { windowTitle } from '@shared/app-info'

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: windowTitle(),
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.once('ready-to-show', () => win.show())

  // In dev electron-vite serves the renderer; in the built app it is a local file.
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

void app.whenReady().then(() => {
  createMainWindow()
})

app.on('window-all-closed', () => {
  app.quit()
})
