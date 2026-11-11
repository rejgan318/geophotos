import { describe, expect, it } from 'vitest'
import { windowOnScreen } from '@shared/window-place'

const main = { x: 0, y: 0, width: 1920, height: 1040 }
const left = { x: -1280, y: 0, width: 1280, height: 984 }

describe('saved window place (tz.md, п. 7.1)', () => {
  it('a window on any display is put back', () => {
    expect(windowOnScreen({ x: 100, y: 50, width: 1280, height: 860 }, [main])).toBe(true)
    expect(windowOnScreen({ x: -1200, y: 40, width: 1100, height: 700 }, [main, left])).toBe(true)
  })

  it('a window on a display that is gone is not', () => {
    expect(windowOnScreen({ x: -1200, y: 40, width: 1100, height: 700 }, [main])).toBe(false)
    expect(windowOnScreen({ x: 3000, y: 100, width: 800, height: 600 }, [main])).toBe(false)
  })

  it('the title bar must be reachable, not just a corner of the window', () => {
    // Only 50 px of the title bar on screen.
    expect(windowOnScreen({ x: -1230, y: 40, width: 1280, height: 860 }, [main])).toBe(false)
    // Title bar above the top of the screen.
    expect(windowOnScreen({ x: 100, y: -500, width: 1280, height: 860 }, [main])).toBe(false)
    // Partly off the right edge, title bar still grabbable.
    expect(windowOnScreen({ x: 1700, y: 100, width: 800, height: 600 }, [main])).toBe(true)
  })
})
