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

/** Has an address (tz.md, п. 5.5): a house. */
export const ADDRESS_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l9 8h-2.5v9h-5v-6h-3v6h-5v-9H3z"/></svg>'

/** Has an altitude (tz.md, п. 5.6): a mountain. */
export const ALTITUDE_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 20L9 7l4 7 2.5-4L22 20z"/></svg>'

/** A video (tz.md, п. 3.3.6): a strip of film. */
export const VIDEO_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3h16v18H4zm2 2v2h2V5zm10 0v2h2V5zM6 9v2h2V9zm10 0v2h2V9zM6 13v2h2v-2zm10 0v2h2v-2zM6 17v2h2v-2zm10 0v2h2v-2zM10 5v14h4V5z" fill-rule="evenodd"/></svg>'

/** A live photo (tz.md, п. 3.3.7): a dot in two rings, as phones mark them. */
export const LIVE_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="1.6 2"/></svg>'

/** File placeholder of a photo that cannot be shown. */
export const FILE_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h8l6 6v14H6zM14 2v6h6" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>'

/** A track (tz.md, п. 3.9.3): a winding path between two points. */
export const TRACK_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="5" r="2.5"/><path d="M5 19c3-1 3-5 7-6s5-3 7-8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="3 2.5"/></svg>'

/** A waypoint of a track (tz.md, п. 3.9.5): a flag; its foot is the point (viewBox 20×26, foot at 3,25). */
export function flagSvg(color: string): string {
  return (
    '<svg viewBox="0 0 20 26" width="100%" height="100%" aria-hidden="true">' +
    '<path d="M3 25V2" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/>' +
    '<path d="M3 25V2" stroke="#333" stroke-width="1.6" stroke-linecap="round"/>' +
    `<path d="M4 2.5h13l-3.2 4.5 3.2 4.5H4z" fill="${color}" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>`
  )
}

/** The place of the current photo on a track (tz.md, п. 3.9.7): a ring. */
export const RING_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="3.5"/></svg>'
