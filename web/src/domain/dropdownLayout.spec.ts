import { describe, expect, it } from 'vitest'
import { dropdownLayout } from './dropdownLayout'

const viewport = { left: 0, top: 0, right: 390, bottom: 844, width: 390 }
const anchor = { left: 24, top: 200, right: 366, bottom: 244, width: 342 }

describe('visible dropdown bounds', () => {
  it('caps phone and desktop lists independently even with hundreds of candidates', () => {
    expect(dropdownLayout(anchor, viewport, 6000, true).maxHeight).toBe(240)
    expect(dropdownLayout(anchor, viewport, 6000, false).maxHeight).toBe(320)
  })
  it('opens above the field when the keyboard leaves too little space below', () => {
    const result = dropdownLayout({ ...anchor, top: 330, bottom: 374 }, { ...viewport, bottom: 450 }, 1000, true)
    expect(result.top).toBe(86)
    expect(result.top + result.maxHeight).toBeLessThan(330)
  })
  it('stays inside a scrolled visible viewport during keyboard panning', () => {
    const result = dropdownLayout({ ...anchor, top: 440, bottom: 484 },
      { ...viewport, top: 300, bottom: 650 }, 1000, true)
    expect(result.top).toBeGreaterThanOrEqual(300)
    expect(result.top + result.maxHeight).toBeLessThanOrEqual(650)
  })
  it('ignores a save bar above the field and respects one covering the lower viewport', () => {
    const offscreenBar = { ...anchor, top: -80, bottom: -30 }
    expect(dropdownLayout(anchor, viewport, 1000, true, offscreenBar).maxHeight).toBe(240)
    const overlayBar = { ...anchor, top: 400, bottom: 450 }
    const result = dropdownLayout(anchor, viewport, 1000, true, overlayBar)
    expect(result.top + result.maxHeight).toBeLessThan(400)
  })
  it('keeps long fields within a narrow viewport and does not stretch a short list', () => {
    const result = dropdownLayout({ ...anchor, left: -10, width: 450 }, viewport, 44, true)
    expect(result.left).toBe(8)
    expect(result.width).toBe(374)
    expect(result.maxHeight).toBe(240)
    expect(result.top).toBe(248)
  })
  it('hides a panel whose field is outside the visible area while the keyboard pans the page', () => {
    expect(dropdownLayout({ ...anchor, top: 500, bottom: 544 },
      { ...viewport, bottom: 450 }, 1000, true).maxHeight).toBe(0)
    expect(dropdownLayout(anchor, { ...viewport, top: 300 }, 1000, true).maxHeight).toBe(0)
  })
})
