import './batch.css'
import { formatDuration } from '@shared/duration'
import { makeTranslate } from '@shared/i18n'
import type { BatchDone, BatchState } from '@shared/ipc'

/**
 * The progress window of the batch mode (tz.md, п. 10): what is being done, a bar, about how long
 * is left, Cancel; at the end the result, and the window closes by itself if there were no errors.
 */
const byId = (id: string): HTMLElement => document.getElementById(id)!

async function start(): Promise<void> {
  const { strings } = await window.geophotos.batchInit()
  const t = makeTranslate(strings)
  document.title = `GeoPhotos — ${t('batch.title')}`
  const phase = byId('phase')
  const bar = byId('bar') as HTMLProgressElement
  const eta = byId('eta')
  const summary = byId('summary')
  const errors = byId('errors')
  const auto = byId('auto')
  const button = byId('button') as HTMLButtonElement
  let finished = false
  // The window follows the height of its content (no empty space; a list of errors makes it taller).
  const box = byId('batch')
  new ResizeObserver(() => window.geophotos.batchFit(Math.ceil(box.getBoundingClientRect().height))).observe(box)

  phase.textContent = t('batch.starting')
  button.textContent = t('batch.cancel')
  button.addEventListener('click', () => {
    if (finished) return window.close()
    window.geophotos.batchCancel()
    button.disabled = true
    button.textContent = t('batch.cancelling')
  })

  window.geophotos.onBatchState((s: BatchState) => {
    // The same window shows installing exiftool (tz.md, п. 2.2).
    if (s.phase === 'exiftool') document.title = `GeoPhotos — ${t('install.title')}`
    phase.textContent = t(s.phase === 'exiftool' && !s.phaseTotal ? 'batch.phase.exiftoolStart' : `batch.phase.${s.phase}`, { done: s.phaseDone, total: s.phaseTotal })
    if (s.total) bar.value = s.done / s.total
    else bar.removeAttribute('value')
    eta.textContent = s.seconds === null ? '' : t('batch.eta', { time: formatDuration(s.seconds, t) })
  })

  window.geophotos.onBatchDone((d: BatchDone) => {
    finished = true
    bar.value = 1
    eta.textContent = ''
    phase.textContent = t(d.cancelled ? 'batch.cancelled' : 'batch.done')
    summary.hidden = false
    summary.textContent = t('batch.summary', { written: d.written, skipped: d.skipped, failed: d.failed.length })
    if (d.failed.length) {
      errors.hidden = false
      errors.replaceChildren(
        ...d.failed.map((f) => {
          const li = document.createElement('li')
          li.textContent = `${f.name}: ${f.error}`
          return li
        })
      )
    }
    button.disabled = false
    button.textContent = t('batch.close')
    // Nothing to look at: the window goes away by itself.
    if (!d.failed.length && !d.cancelled) {
      let left = 10
      const tick = (): void => {
        auto.textContent = t('batch.autoClose', { s: left })
        if (left-- <= 0) window.close()
        else setTimeout(tick, 1000)
      }
      tick()
    }
  })
}

void start()
