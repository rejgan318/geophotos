export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Whether a saved window can be put back where it was (tz.md, п. 7.1): enough of its title bar
 * (the top 30 px, at least 100 px wide) is inside the work area of some display, so it can be
 * grabbed with the mouse. Otherwise (a display was unplugged) the window gets the default place.
 */
export function windowOnScreen(win: Rect, workAreas: Rect[]): boolean {
  const bar: Rect = { x: win.x, y: win.y, width: win.width, height: 30 }
  return workAreas.some((a) => {
    const w = Math.min(bar.x + bar.width, a.x + a.width) - Math.max(bar.x, a.x)
    const h = Math.min(bar.y + bar.height, a.y + a.height) - Math.max(bar.y, a.y)
    return w >= 100 && h >= 20
  })
}
