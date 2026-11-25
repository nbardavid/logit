import { describe, expect, test } from 'bun:test'

import {
  contrast,
  coverOf,
  DEFAULT_GROUND,
  fromHex,
  fromRgb,
  type Ground,
  groundRgb,
  luminance,
  luminanceRange,
  maxChroma,
  minOpacity,
  moveTo,
  NEUTRAL,
  paintOf,
  parseGround,
  pointOf,
  PRESET_PAGES,
  presetPageOf,
  PRESETS,
  rgbOf,
  rgbToOklch,
  serializeGround,
  toHex,
  toneRgb,
  tonesOf,
  underSidebar,
  withPreset,
  wornTones,
} from './ground'

const ground = (patch: Partial<Ground>): Ground => ({ ...DEFAULT_GROUND, ...patch })

describe('colour', () => {
  test('the default ground is the app neutral', () => {
    expect(toHex(groundRgb(DEFAULT_GROUND))).toBe(NEUTRAL)
  })

  test('every pick stays in gamut and goes gray at the ends', () => {
    expect(maxChroma(0.999, 30)).toBeLessThan(0.01)
    expect(maxChroma(0.6, 30)).toBeGreaterThan(0.1)
    for (const v of rgbOf(0.7, 1, 140)) expect(v).toBeWithin(0, 1.0001)
  })

  test('a stored ground reads back, and junk is no ground', () => {
    const g = ground({ blur: 'strong', hue: 200, opacity: 0.7 })
    expect(parseGround(serializeGround(g))?.hue).toBe(200)
    expect(parseGround(serializeGround(g))?.blur).toBe('strong')
    expect(parseGround('{nope')).toBeNull()
    expect(parseGround(undefined)).toBeNull()
    expect(parseGround('{"hue": 900}')?.hue).toBe(360)
    const linked = withPreset(
      DEFAULT_GROUND,
      PRESET_PAGES[1]?.presets[3] ?? { links: [], main: '#000000' }
    )
    expect(parseGround(serializeGround(linked))?.links).toHaveLength(2)
  })
})

describe("Yab's presets and wheel", () => {
  test('five pages of nine, Colors first, as Yab orders them', () => {
    expect(PRESET_PAGES.map((p) => p.presets.length)).toEqual([9, 9, 9, 9, 9])
    expect(PRESET_PAGES.map((p) => p.name)).toEqual([
      'Colors',
      'Gradients',
      'Pastels',
      'Muted',
      'Grays',
    ])
    expect(PRESETS[0]?.main).toBe('#F2E9E3')
  })

  test('a preset picked gives back its own colours, and the row opens on its page', () => {
    for (const preset of PRESETS) {
      const g = withPreset(DEFAULT_GROUND, preset)
      const hexes = tonesOf(g).map((t) => toHex(toneRgb(t)).toUpperCase())
      const want = [preset.main, ...preset.links]
      for (const [i, hex] of hexes.entries()) {
        const got = Number.parseInt(hex.slice(1), 16)
        const was = Number.parseInt((want[i] ?? '').slice(1), 16)
        for (const shift of [16, 8, 0])
          expect(Math.abs(((got >> shift) & 255) - ((was >> shift) & 255))).toBeLessThanOrEqual(1)
      }
      expect(presetPageOf(g)).toBe(preset.page)
    }
  })

  test('the wheel turns a colour round the middle without touching its lightness', () => {
    const g = ground({ hue: 90, intensity: 0.5, light: 0.4 })
    const back = moveTo(g, pointOf(g))
    expect(back.hue).toBeCloseTo(90)
    expect(back.intensity).toBeCloseTo(0.5)
    expect(moveTo(g, { x: 1, y: 0.5 })).toMatchObject({ hue: 0, intensity: 1, light: 0.4 })
  })
})

describe('inks', () => {
  test('a pick is worn on light glass, as Yab wears it: pastel, its own hue', () => {
    const mint = fromHex('#45f08f')
    const [top = mint, bottom = mint] = wornTones({
      ...DEFAULT_GROUND,
      ...fromRgb(mint),
      links: [],
    })
    expect(toHex(top)).toBe('#bdf5d4')
    expect(luminance(bottom)).toBeLessThan(luminance(top))
    expect(Math.abs(rgbToOklch(top)[2] - rgbToOklch(mint)[2])).toBeLessThan(6)
    expect(coverOf(mint)).toBeCloseTo(0.328)
    expect(coverOf(fromHex('#808080'))).toBeCloseTo(0.496)
    expect(paintOf(DEFAULT_GROUND).light).toBe(false)
  })

  test('every preset keeps its sidebar text at 4.5:1, solid or over any desktop', () => {
    for (const preset of PRESETS) {
      for (const blur of ['off', 'soft', 'strong'] as const) {
        for (const opacity of [1, 0.6, 0.16]) {
          const g = { ...withPreset(DEFAULT_GROUND, preset), blur, opacity }
          const paint = paintOf(g)
          const [lo, hi] = luminanceRange(underSidebar(wornTones(g)), paint.opacity, blur)
          const worst = paint.light ? hi : lo
          const ink = luminance(fromHex(paint.inks['--foreground'] ?? ''))
          const muted = luminance(fromHex(paint.inks['--muted-foreground'] ?? ''))
          expect(contrast(ink, worst)).toBeGreaterThanOrEqual(4.5)
          expect(contrast(muted, worst)).toBeGreaterThanOrEqual(4.5)
        }
      }
    }
  })

  test('opacity is clamped no lower than reading allows', () => {
    const rgb = underSidebar(wornTones(ground({ intensity: 0.5, light: 0.32 })))
    expect(minOpacity(rgb, 'off')).toBeGreaterThan(0.3)
    expect(minOpacity(rgb, 'strong')).toBeLessThan(minOpacity(rgb, 'off'))
    expect(paintOf(ground({ intensity: 0.5, light: 0.32, opacity: 0 })).opacity).toBe(
      minOpacity(rgb, 'soft')
    )
  })
})
