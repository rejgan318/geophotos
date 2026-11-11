import L from './leaflet-global'
import type { Translate } from '@shared/i18n'
import type { Place } from '@shared/search'
import type { MapView } from './map'

/**
 * Place search box on the map (tz.md, п. 5.3): the query goes on Enter only (Nominatim rules),
 * results are listed; choosing one moves the map there and puts a temporary mark. Photo
 * coordinates are not changed by the search itself.
 */
export function addSearchBox(map: MapView, t: Translate): void {
  const box = L.DomUtil.create('div', 'search-box leaflet-bar')
  const row = L.DomUtil.create('div', 'search-row', box)
  const input = L.DomUtil.create('input', '', row)
  input.type = 'text'
  input.placeholder = t('search.placeholder')
  input.spellcheck = false
  const clear = L.DomUtil.create('button', 'search-clear', row)
  clear.type = 'button'
  clear.textContent = '×'
  clear.title = t('search.clear')
  const message = L.DomUtil.create('div', 'search-message', box)
  const list = L.DomUtil.create('ul', 'search-results', box)

  let places: Place[] = []
  let active = -1
  let busy = false

  const show = (text: string): void => {
    message.textContent = text
    message.hidden = !text
  }
  const setActive = (i: number): void => {
    active = i
    list.querySelectorAll('li').forEach((li, n) => li.classList.toggle('active', n === i))
    list.children[i]?.scrollIntoView({ block: 'nearest' })
  }
  const hideResults = (): void => {
    list.replaceChildren()
    list.hidden = true
    places = []
    active = -1
  }
  const choose = (i: number): void => {
    const p = places[i]
    if (!p) return
    map.showPlace(p)
    hideResults()
    show('')
  }
  const run = async (): Promise<void> => {
    const q = input.value.trim()
    if (!q || busy) return
    busy = true
    hideResults()
    show(t('search.searching'))
    try {
      const res = await window.geophotos.searchPlaces(q)
      if (!res.ok) return show(t('search.error', { error: res.error }))
      if (!res.places.length) return show(t('search.nothing'))
      show('')
      places = res.places
      for (const [i, p] of places.entries()) {
        const li = L.DomUtil.create('li', '', list)
        li.textContent = p.name
        li.title = p.name
        li.addEventListener('click', () => choose(i))
        li.addEventListener('mousemove', () => active !== i && setActive(i))
      }
      list.hidden = false
      // One result: go there at once.
      if (places.length === 1) choose(0)
    } finally {
      busy = false
    }
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (active >= 0) choose(active)
      else void run()
    } else if (e.key === 'ArrowDown' && places.length) {
      e.preventDefault()
      setActive(Math.min(active + 1, places.length - 1))
    } else if (e.key === 'ArrowUp' && places.length) {
      e.preventDefault()
      setActive(Math.max(active - 1, 0))
    } else if (e.key === 'Escape') {
      if (!list.hidden) hideResults()
      else input.blur()
      show('')
    }
  })
  // A new query: the old list no longer matches it.
  input.addEventListener('input', () => {
    hideResults()
    show('')
  })
  clear.addEventListener('click', () => {
    input.value = ''
    hideResults()
    show('')
    map.clearPlace()
  })

  hideResults()
  show('')
  L.DomEvent.disableClickPropagation(box)
  L.DomEvent.disableScrollPropagation(box)

  const Control = L.Control.extend({ onAdd: () => box })
  new Control({ position: 'topleft' }).addTo(map.leaflet)
  // Above the zoom buttons.
  box.parentElement?.prepend(box)
}
