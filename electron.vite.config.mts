import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'

const shared = { '@shared': resolve(import.meta.dirname, 'src/shared') }

export default defineConfig({
  main: {
    resolve: { alias: shared }
  },
  preload: {
    resolve: { alias: shared }
  },
  renderer: {
    resolve: { alias: shared },
    // Two pages: the main window and the progress window of the batch mode (tz.md, п. 10).
    build: {
      rollupOptions: {
        input: {
          index: resolve(import.meta.dirname, 'src/renderer/index.html'),
          batch: resolve(import.meta.dirname, 'src/renderer/batch.html')
        }
      }
    }
  }
})
