import { describe, expect, it } from 'vitest'
import { dropdownLayout } from './dropdownLayout'

const viewport = { left: 0, top: 0, right: 390, bottom: 844, width: 390 }
const anchor = { left: 24, top: 200, right: 366, bottom: 244, width: 342 }

describe('visible dropdown bounds', () => {
  it('keeps a short rightmost field panel readable without leaving the phone viewport', () => {
    const result = dropdownLayout({ left: 273, right: 365, top: 400, bottom: 444, width: 92 }, viewport, 1000, true)
    expect(result.width).toBe(260)
    expect(result.left + result.width).toBeLessThanOrEqual(viewport.right - 8)
    expect(result.left).toBeGreaterThanOrEqual(8)
  })
  it('caps phone and desktop lists independently even with hundreds of candidates', () => {
    expect(dropdownLayout(anchor, viewport, 6000, true).maxHeight).toBe(240)
    expect(dropdownLayout(anchor, viewport, 6000, false).maxHeight).toBe(320)
  })
  it('uses space above the field when the keyboard leaves too little below', () => {
    const result = dropdownLayout({ ...anchor, top: 330, bottom: 374 }, { ...viewport, bottom: 450 }, 1000, true)
    expect(result.direction).toBe('above')
    expect(result.top).toBe(86)
    expect(result.maxHeight).toBe(240)
    expect(result.top + result.maxHeight).toBeLessThan(330)
  })
  it('opens a bottommost drawer field above without relying on further body scrolling', () => {
    const body = { ...viewport, top: 164, bottom: 774 }
    const result = dropdownLayout({ ...anchor, top: 718, bottom: 762 }, body, 600, true)
    expect(result.direction).toBe('above')
    expect(result.maxHeight).toBe(240)
    expect(result.top).toBeGreaterThanOrEqual(body.top + 8)
    expect(result.top + result.maxHeight).toBeLessThan(718)
  })
  it('positions short upward lists using their actual height', () => {
    const result = dropdownLayout({ ...anchor, top: 794, bottom: 838 }, viewport, 44, true)
    expect(result.direction).toBe('above')
    expect(result.top).toBe(744)
  })
  it('stays inside a scrolled visible viewport during keyboard panning', () => {
    const result = dropdownLayout({ ...anchor, top: 440, bottom: 484 },
      { ...viewport, top: 300, bottom: 650 }, 1000, true)
    expect(result.top).toBeGreaterThanOrEqual(300)
    expect(result.top + result.maxHeight).toBeLessThanOrEqual(650)
  })
  it('reserves only real candidate space and never more than the visible body can hold', () => {
    expect(dropdownLayout(anchor, viewport, 44, true).revealHeight).toBe(44)
    expect(dropdownLayout(anchor, viewport, 1000, true).revealHeight).toBe(132)
    const smallBody = { ...viewport, top: 300, bottom: 450 }
    expect(dropdownLayout({ ...anchor, top: 330, bottom: 374 }, smallBody, 1000, true).revealHeight).toBe(102)
  })
  it('makes room for search and candidates on either side of a keyboard-constrained field', () => {
    const body = { ...viewport, top: 164, bottom: 444 }
    for (const top of [288, 278]) {
      const field = { ...anchor, top, bottom: top + 44 }
      const initial = dropdownLayout(field, body, 600, true)
      expect(initial.maxHeight).toBeLessThan(132)
      expect(initial.revealScroll < 0).toBe(initial.direction === 'above')
      const revealed = dropdownLayout({ ...field, top: field.top - initial.revealScroll,
        bottom: field.bottom - initial.revealScroll }, body, 600, true)
      expect(revealed.maxHeight).toBeGreaterThanOrEqual(132)
      expect(revealed.revealScroll).toBe(0)
      expect(revealed.top).toBeGreaterThanOrEqual(body.top)
      expect(revealed.top + revealed.maxHeight).toBeLessThanOrEqual(body.bottom)
    }
  })
  it('uses downward scroll space when a short upward list cannot move because the body is at its start', () => {
    const body = { ...viewport, top: 108, bottom: 350 }
    const field = { ...anchor, top: 226, bottom: 270 }
    const initial = dropdownLayout(field, body, 600, true, undefined, 0)
    expect(initial.direction).toBe('below')
    const revealed = dropdownLayout({ ...field, top: field.top - initial.revealScroll,
      bottom: field.bottom - initial.revealScroll }, body, 600, true, undefined, initial.revealScroll)
    expect(revealed.maxHeight).toBe(132)
    expect(revealed.top + revealed.maxHeight).toBeLessThanOrEqual(body.bottom)
  })
  it('ignores a save bar above the field and respects one covering the lower viewport', () => {
    const offscreenBar = { ...anchor, top: -80, bottom: -30 }
    expect(dropdownLayout(anchor, viewport, 1000, true, offscreenBar).maxHeight).toBe(240)
    const overlayBar = { ...anchor, top: 400, bottom: 450 }
    const result = dropdownLayout(anchor, viewport, 1000, true, overlayBar)
    expect(result.top + result.maxHeight).toBeLessThanOrEqual(400)
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
