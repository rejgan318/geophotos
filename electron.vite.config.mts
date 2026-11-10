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
    resolve: { alias: shared }
  }
})
