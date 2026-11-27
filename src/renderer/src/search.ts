import L from './leaflet-global'
import type { Translate } from '@shared/i18n'
import type { PlaceMenuItem, PlaceMenuKind } from '@shared/ipc'
import type { LatLon } from '@shared/photo'
import { clipboardText } from '@shared/coords-parse'
import { addFavorite, addRecentPlace, FAVORITE_KEYS, RECENT_SHOWN, removeFavorite, removeRecentPlace, replaceFavorite, samePlace, type Place } from '@shared/search'
import type { MapView } from './map'

/** The places of the search box: what the window and the map ask of it (tz.md, п. 5.3). */
export interface PlacesBox {
  /** Ctrl+F, Edit → Find Place: the field with the list of places. */
  focus(): void
  /** The favourite places after Undo or Redo (п. 6.6). */
  setFavorites(list: Place[]): void
  /** A right click on the mark or a favourite (`index`): its menu from main. */
  menu(kind: PlaceMenuKind, x: number, y: number, at: LatLon, index: number): void
  /** An item of that menu was chosen. */
  command(item: PlaceMenuItem): void
  /** A favourite place was dragged to a new point. */
  favoriteMoved(index: number, to: LatLon): void
  /** Ctrl+1…9: to the favourite place with this number (1-based); false — there is none. */
  goFavorite(n: number): boolean
  /** There is a favourite place with this number (Ctrl+1…9). */
  hasFavorite(n: number): boolean
}

type Row = { place: Place; kind: 'result' | 'recent' | 'favorite' }

/**
 * Place search box on the map (tz.md, п. 5.3): the query goes on Enter only (Nominatim rules),
 * results are listed; choosing one moves the map there and puts the mark, and the field is empty
 * again. An empty field shows the places gone to lately and, under a line, the favourite places.
 * Photo coordinates are not changed by the search itself.
 */
export function addSearchBox(map: MapView, t: Translate, recentInit: Place[], favoritesInit: Place[]): PlacesBox {
  let recent = [...recentInit]
  let favorites = [...favoritesInit]
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

  let rows: Row[] = []
  let active = -1
  let busy = false
  /** The list shows the places (history and favourites), not results. */
  let history = false
  /** A favourite's name is edited in the list: the field losing focus does not close it. */
  let editing = false
  /** Whose menu is open (п. 5.3). */
  let target: { kind: PlaceMenuKind; index: number; at: LatLon } | null = null

  const show = (text: string): void => {
    message.textContent = text
    message.hidden = !text
  }
  const items = (): HTMLLIElement[] => [...list.querySelectorAll<HTMLLIElement>('li')]
  const setActive = (i: number): void => {
    active = i
    items().forEach((li, n) => li.classList.toggle('active', n === i))
    items()[i]?.scrollIntoView({ block: 'nearest' })
  }
  const hideResults = (): void => {
    list.replaceChildren()
    list.hidden = true
    list.classList.remove('search-history')
    rows = []
    active = -1
    history = false
    editing = false
  }

  /** The favourites changed here: the map, main (kept, one Undo step) and the list follow. */
  const changeFavorites = (next: Place[]): void => {
    favorites = next
    map.setFavorites(favorites)
    window.geophotos.action({ type: 'setFavorites', favorites })
    if (history) showList()
  }
  const renameFavorite = (index: number, name: string): void => {
    const old = favorites[index]
    if (old && name && name !== old.name) changeFavorites(replaceFavorite(favorites, old, { ...old, name }))
  }

  /** Goes to a place; a found one goes into the history (п. 5.3). */
  const go = (r: Row): void => {
    if (r.kind === 'favorite') return map.goTo(r.place)
    map.showPlace(r.place)
    recent = addRecentPlace(recent, r.place)
    window.geophotos.action({ type: 'rememberPlace', place: r.place })
  }
  const choose = (i: number): void => {
    const r = rows[i]
    if (!r) return
    go(r)
    // The place is found: the field is empty again and the map has the focus (its «+» / «−»).
    input.value = ''
    hideResults()
    show('')
    map.focus()
  }

  const button = (li: HTMLElement, cls: string, text: string, title: string, click: () => void): void => {
    const b = L.DomUtil.create('button', cls, li)
    b.type = 'button'
    b.textContent = text
    b.title = title
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      click()
    })
  }

  /**
   * The history as the list shows it (п. 5.3): without the current place — the one the mark stands
   * for; it is the present and comes into the history once it is no longer current.
   */
  const shownRecent = (): Place[] => {
    const now = map.currentPlace()
    return recent.filter((p) => !now || !samePlace(p, now)).slice(0, RECENT_SHOWN)
  }

  /** An empty field: the places gone to lately, then under a line the favourite ones. */
  /**
   * `digit` — the field holds just this digit (п. 5.3): the list stays with that place of the
   * history lit; otherwise the field must be empty, and the first row is lit (Enter goes there).
   */
  const showList = (digit?: number): void => {
    if ((digit === undefined && input.value.trim()) || busy || (!recent.length && !favorites.length)) return
    const keep = digit !== undefined ? digit - 1 : active >= 0 ? active : 0
    hideResults()
    history = true
    const past = shownRecent()
    if (!past.length && !favorites.length) return hideResults()
    rows = [...past.map((place): Row => ({ place, kind: 'recent' })), ...favorites.map((place): Row => ({ place, kind: 'favorite' }))]
    list.classList.add('search-history')
    rows.forEach((r, i) => {
      const li = L.DomUtil.create('li', '', list)
      if (r.kind === 'favorite' && i === past.length && past.length) li.classList.add('search-first-favorite')
      // Numbers: the history — underlined, Alt + digit while the list is open; the first nine
      // favourites — plain, Ctrl + digit anywhere (п. 5.3).
      const n = r.kind === 'recent' ? i + 1 : i - past.length + 1
      const num = L.DomUtil.create('span', 'search-num', li)
      if (r.kind === 'recent' || n <= FAVORITE_KEYS) num.textContent = String(n)
      const name = L.DomUtil.create('span', 'search-name', li)
      name.textContent = r.place.name
      li.title =
        r.kind === 'favorite'
          ? [r.place.name, ...(n <= FAVORITE_KEYS ? [`Ctrl+${n}`] : []), t('search.renameHint')].join('\n')
          : `${r.place.name}\nAlt+${n}`
      if (r.kind === 'recent') {
        button(li, 'search-star', '☆', t('search.star'), () => {
          recent = removeRecentPlace(recent, r.place)
          window.geophotos.action({ type: 'forgetPlace', place: r.place })
          changeFavorites(addFavorite(favorites, r.place))
        })
      } else {
        // Given up: it goes, not into the history (a mistake is undone with Ctrl+Z).
        button(li, 'search-star on', '★', t('search.unstar'), () => changeFavorites(removeFavorite(favorites, r.place)))
      }
      li.addEventListener('click', () => !editing && choose(i))
      li.addEventListener('mousemove', () => !editing && active !== i && setActive(i))
    })
    list.hidden = false
    if (keep >= 0 && keep < rows.length) setActive(keep)
  }

  /** The name of a favourite becomes a field in the list (F2): Enter keeps it, Esc not. */
  const renameInList = (i: number): void => {
    const r = rows[i]
    const li = items()[i]
    if (!r || r.kind !== 'favorite' || !li || editing) return
    const index = favorites.findIndex((p) => samePlace(p, r.place))
    const name = li.querySelector('.search-name')
    if (index < 0 || !name) return
    editing = true
    const field = document.createElement('input')
    field.type = 'text'
    field.className = 'search-rename'
    field.value = r.place.name
    field.spellcheck = false
    name.replaceWith(field)
    let done = false
    const finish = (keep: boolean): void => {
      if (done) return
      done = true
      editing = false
      const text = field.value.trim()
      input.focus()
      if (keep) renameFavorite(index, text)
      showList()
    }
    field.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter') finish(true)
      else if (e.key === 'Escape') finish(false)
    })
    field.addEventListener('blur', () => finish(true))
    field.addEventListener('click', (e) => e.stopPropagation())
    field.focus()
    field.select()
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
      rows = res.places.map((place) => ({ place, kind: 'result' }))
      rows.forEach((r, i) => {
        const li = L.DomUtil.create('li', '', list)
        li.textContent = r.place.name
        li.title = r.place.name
        li.addEventListener('click', () => choose(i))
        li.addEventListener('mousemove', () => active !== i && setActive(i))
      })
      list.hidden = false
      // One result: go there at once.
      if (rows.length === 1) choose(0)
    } finally {
      busy = false
    }
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (active >= 0) choose(active)
      else void run()
    } else if (e.key === 'ArrowDown' && rows.length) {
      e.preventDefault()
      setActive(Math.min(active + 1, rows.length - 1))
    } else if (e.key === 'ArrowUp' && rows.length) {
      e.preventDefault()
      setActive(Math.max(active - 1, 0))
    } else if (e.altKey && !e.ctrlKey && history && /^Digit[1-9]$/.test(e.code)) {
      // Alt + digit: the place of the history with this number (п. 5.3); none — nothing.
      e.preventDefault()
      const i = Number(e.code.slice(5)) - 1
      if (rows[i]?.kind === 'recent') choose(i)
    } else if (e.key === 'F2' && history && active >= 0) {
      e.preventDefault()
      renameInList(active)
    } else if (e.key === 'Escape') {
      // Back to the map at once.
      hideResults()
      show('')
      map.focus()
    }
  })
  // The places: on a click into the empty field or Ctrl+F; they go when the field loses focus (a
  // click in the list keeps the focus: mousedown is held, except in the name being edited).
  input.addEventListener('click', () => showList())
  input.addEventListener('focus', () => showList())
  list.addEventListener('mousedown', (e) => {
    if (!(e.target instanceof HTMLInputElement)) e.preventDefault()
  })
  input.addEventListener('blur', () => {
    if (history && !editing) hideResults()
  })
  // A new query: the old list no longer matches it.
  input.addEventListener('input', () => {
    hideResults()
    show('')
    // Just a digit of a place of the history: the list stays with it lit — Enter goes there; more
    // typing is a query as usual (п. 5.3).
    const m = /^\s*([1-9])\s*$/.exec(input.value)
    const n = m ? Number(m[1]) : 0
    if (n && n <= shownRecent().length) showList(n)
  })
  // Only the typed text: the mark stays (п. 5.3).
  clear.addEventListener('click', () => {
    input.value = ''
    hideResults()
    show('')
    input.focus()
  })

  hideResults()
  show('')
  L.DomEvent.disableClickPropagation(box)
  L.DomEvent.disableScrollPropagation(box)

  const Control = L.Control.extend({ onAdd: () => box })
  new Control({ position: 'topleft' }).addTo(map.leaflet)
  // Above the zoom buttons.
  box.parentElement?.prepend(box)
  map.setFavorites(favorites)

  /** The mark becomes a favourite place (п. 5.3): its name, or the address of the point, or its coordinates. */
  const markToFavorite = async (): Promise<void> => {
    const mark = map.mark()
    if (!mark) return
    const name = mark.name || (await window.geophotos.placeName(mark.lat, mark.lon)) || `${mark.lat.toFixed(6)}, ${mark.lon.toFixed(6)}`
    const place: Place = { ...mark, name }
    // A found place moves out of the history, as with its star in the list (п. 5.3).
    const found = map.currentPlace()
    if (found && recent.some((p) => samePlace(p, found))) {
      recent = removeRecentPlace(recent, found)
      window.geophotos.action({ type: 'forgetPlace', place: found })
    }
    changeFavorites(addFavorite(favorites, place))
    map.clearPlace()
    const index = favorites.findIndex((p) => samePlace(p, place))
    // The name right away, selected: typing replaces it.
    map.editFavoriteName(index, (text) => renameFavorite(index, text))
  }

  return {
    focus(): void {
      // Being typed right now: only selected, nothing is lost. Left over from before (the field was
      // left without choosing): a new start — the field empty and the list of places (п. 5.3).
      if (document.activeElement === input && input.value) return input.select()
      input.value = ''
      hideResults()
      show('')
      input.focus()
      showList()
    },
    setFavorites(next: Place[]): void {
      favorites = [...next]
      map.setFavorites(favorites)
      if (history) showList()
    },
    menu(kind, x, y, at, index): void {
      target = { kind, index, at }
      window.geophotos.action({ type: 'placeMenu', kind, x, y, lat: at.lat, lon: at.lon })
    },
    command(item): void {
      const tg = target
      if (!tg) return
      if (item === 'copyCoords') void window.geophotos.writeClipboard(clipboardText(tg.at))
      else if (item === 'addFavorite') void markToFavorite()
      else if (item === 'removeMark') map.clearPlace()
      else if (item === 'rename') map.editFavoriteName(tg.index, (text) => renameFavorite(tg.index, text))
      else if (item === 'removeFavorite') {
        const p = favorites[tg.index]
        if (p) changeFavorites(removeFavorite(favorites, p))
      }
    },
    hasFavorite(n): boolean {
      return n >= 1 && n <= FAVORITE_KEYS && n <= favorites.length
    },
    goFavorite(n): boolean {
      const p = n >= 1 && n <= FAVORITE_KEYS ? favorites[n - 1] : undefined
      if (!p) return false
      input.value = ''
      hideResults()
      show('')
      map.goTo(p)
      map.focus()
      return true
    },
    favoriteMoved(index, to): void {
      const old = favorites[index]
      // Moved: the name stays, the outline of a found place no longer fits.
      if (old) changeFavorites(replaceFavorite(favorites, old, { name: old.name, lat: to.lat, lon: to.lon }))
    }
  }
}
