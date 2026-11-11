/** Small icons shared by the strip badges and the filter buttons of the status bar (tz.md, пп. 4.3, 4.13). */

/** Has coordinates: map pin. */
export const PIN_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>'

/**
 * No coordinates: the pin crossed out. The slash has a dark edge so it reads on the pin;
 * its colour is the icon's (`currentColor`).
 */
export const PIN_OFF_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/><path d="M4 3l16 18" stroke="#1e1e1e" stroke-width="5" stroke-linecap="round"/><path d="M4 3l16 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>'

/** Modified, not saved: pencil. */
export const PENCIL_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17.2V21h3.8L17.8 10l-3.8-3.8zM20.7 7.1a1 1 0 0 0 0-1.4l-2.4-2.4a1 1 0 0 0-1.4 0l-1.9 1.9 3.8 3.8z"/></svg>'

/** All photos: a picture (frame with mountains and sun). */
export const PHOTO_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h18v16H3zm2 2v9.6l4-4.6 3.5 4 2.5-2.8 4 4.4V6zm11 1.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4z" fill-rule="evenodd"/></svg>'

/** File placeholder of a photo that cannot be shown. */
export const FILE_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h8l6 6v14H6zM14 2v6h6" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>'
