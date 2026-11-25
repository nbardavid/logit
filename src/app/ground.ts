// The window's ground: the colour behind the sheets, picked as Yab picks a space's look. A
// colour is OKLCH: a hue, a lightness, and a reach, the share of the most chroma that hue holds
// at that lightness in sRGB (so every pick is in gamut and fades to gray at the ends). Up to
// two linked colours make it a gradient. Pure maths here; ground-store.ts applies it,
// ground-picker.tsx draws the picker.
//
// The presets, the field's wheel and the linked colours are adapted from Yab
// (github.com/yetanotherbrowser/yab, LookHarmony.swift), Copyright 2026 Serafim Korablev,
// under the Apache License 2.0 (http://www.apache.org/licenses/LICENSE-2.0); modified: ported
// to TypeScript, hue in degrees, no light/dark looks.

export type Blur = 'off' | 'soft' | 'strong'
export const BLURS: Blur[] = ['off', 'soft', 'strong']

/** A linked colour, as offsets from the main one: it turns with it (Yab's LookHarmony.Link). */
export interface Link {
  /** Degrees from the main hue. */
  hue: number
  reach: number
  light: number
}

export interface Ground {
  /** Hue in degrees, 0–360. */
  hue: number
  /** OKLab lightness, 0–1: a preset's, the field keeps it. */
  light: number
  /** Share of the most chroma this hue and lightness hold, 0–1 (Yab's reach). */
  intensity: number
  /** The colours linked to the main one, at most two: a gradient across the window. */
  links: Link[]
  /** Noise over the ground only, 0–1. */
  grain: number
  /** 1 is a solid colour; lower lets the desktop through (clamped by `minOpacity`). */
  opacity: number
  /** The native material under a translucent ground: off is plain transparency. */
  blur: Blur
}

/** A colour as the field holds it. */
export type Tone = Pick<Ground, 'hue' | 'intensity' | 'light'>

export const GROUND_SETTING = 'appearance.ground'
/** At most this many linked colours (Yab's). */
export const MAX_LINKS = 2
/** Yab's: the grain tile's opacity at full grain. */
export const GRAIN_ALPHA = 0.2
/** Yab's standard grain, where a double click puts the slider back. */
export const GRAIN_STANDARD = 0.35

type Rgb = [number, number, number]

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v))

/** OKLab to linear sRGB (Björn Ottosson's matrices). */
function oklabToLinear(L: number, a: number, b: number): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

/** sRGB (0–1, gamma) to OKLCH: lightness, chroma, hue in degrees. */
export function rgbToOklch(rgb: Rgb): [number, number, number] {
  const [r, g, b] = rgb.map(toLinear) as Rgb
  const l = Math.cbrt(0.4122214708 * r + 0.536313708 * g + 0.0514655887 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360]
}

function linearOf(L: number, c: number, hue: number): Rgb {
  const h = (hue * Math.PI) / 180
  return oklabToLinear(L, c * Math.cos(h), c * Math.sin(h))
}

// Strict at the edges, as Yab's Gamut.chroma: any tolerance lets black hold a little chroma.
const inGamut = (rgb: Rgb) => rgb.every((v) => v >= -1e-12 && v <= 1 + 1e-12)

/** The most chroma this lightness and hue hold in sRGB: Yab's gray clamp at the ends. */
export function maxChroma(L: number, hue: number): number {
  let lo = 0
  let hi = 0.4
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2
    if (inGamut(linearOf(L, mid, hue))) lo = mid
    else hi = mid
  }
  return lo
}

/** OKLCH (intensity as a share of the gamut) to sRGB 0–1. */
export function rgbOf(L: number, intensity: number, hue: number): Rgb {
  return oklchRgb(L, maxChroma(L, hue) * clamp(intensity), hue)
}

/** OKLCH with its chroma as is, to sRGB 0–1. */
export function oklchRgb(L: number, chroma: number, hue: number): Rgb {
  return linearOf(L, chroma, hue).map((v) => clamp(toGamma(clamp(v)))) as Rgb
}

const hex2 = (v: number) =>
  Math.round(clamp(v) * 255)
    .toString(16)
    .padStart(2, '0')
export const toHex = (rgb: Rgb) => `#${rgb.map(hex2).join('')}`

export function fromHex(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/** A colour as the field holds it: its hue, lightness and share of the gamut (Yab's `read`). */
export function fromRgb(rgb: Rgb): Tone {
  const [L, c, hue] = rgbToOklch(rgb)
  const light = clamp(L)
  const max = maxChroma(light, hue)
  return { hue, intensity: max > 0.001 ? clamp(c / max) : 0, light }
}

export const toneRgb = (t: Tone) => rgbOf(t.light, t.intensity, t.hue)
export const groundRgb = toneRgb

const turn = (deg: number) => ((deg % 360) + 360) % 360

/** The linked colours themselves (Yab's `colors(from:)`). */
export const linkedTones = (g: Ground): Tone[] =>
  g.links.map((l) => ({
    hue: turn(g.hue + l.hue),
    intensity: clamp(g.intensity + l.reach),
    light: clamp(g.light + l.light),
  }))

/** Every colour of the ground, the main one first. */
export const tonesOf = (g: Ground): Tone[] => [g, ...linkedTones(g)]

/** A linked colour as offsets from the main one. */
export const linkOf = (main: Tone, t: Tone): Link => ({
  hue: turn(t.hue - main.hue),
  light: t.light - main.light,
  reach: t.intensity - main.intensity,
})

// The field's hidden wheel (Yab's LookColor.point): hue round the middle, reach outwards, its
// edge 0.42 out so the handles and the −/+ under it stay clear of each other.
const WHEEL = 0.42

/** Where a colour sits on the field, 0–1 each way. */
export function pointOf(t: Tone): { x: number; y: number } {
  const h = (t.hue * Math.PI) / 180
  return { x: 0.5 + Math.cos(h) * t.intensity * WHEEL, y: 0.5 + Math.sin(h) * t.intensity * WHEEL }
}

/** A colour moved to a point of the field: its hue and reach change, its lightness stays. */
export function moveTo<T extends Tone>(t: T, p: { x: number; y: number }): T {
  const x = p.x - 0.5
  const y = p.y - 0.5
  const distance = Math.hypot(x, y)
  const hue = distance > 0.0001 ? turn((Math.atan2(y, x) * 180) / Math.PI) : t.hue
  return { ...t, hue, intensity: Math.min(1, distance / WHEEL) }
}

/** Two colours oppose each other; three sit a third apart (Yab's `suggested`). */
export function suggestedLinks(extras: number): Link[] {
  if (extras === 1) return [{ hue: 180, light: 0, reach: 0 }]
  if (extras === 2)
    return [
      { hue: 120, light: 0, reach: 0 },
      { hue: 240, light: 0, reach: 0 },
    ]
  return []
}

/** Whether the linked colours sit evenly round the wheel, as + puts them. */
export function isEven(links: Link[]): boolean {
  const even = suggestedLinks(links.length)
  return (
    even.length === links.length &&
    links.every((l, i) => {
      const apart = turn(l.hue - (even[i]?.hue ?? 0))
      return (
        Math.min(apart, 360 - apart) < 0.6 && Math.abs(l.reach) < 0.01 && Math.abs(l.light) < 0.01
      )
    })
  )
}

/** The app's own ground (styles.css `--ground`), where the picker starts. */
export const NEUTRAL = '#efeeec'
export const DEFAULT_GROUND: Ground = {
  ...fromRgb(fromHex(NEUTRAL)),
  blur: 'soft',
  grain: 0,
  links: [],
  opacity: 1,
}

export interface Preset {
  main: string
  links: string[]
}

const flat = (hexes: string[]): Preset[] => hexes.map((main) => ({ links: [], main: `#${main}` }))
const linked = (main: string, links: [string, string]): Preset => ({
  links: links.map((l) => `#${l}`),
  main: `#${main}`,
})

/** Yab's presets (after Arc's): five pages of nine, in its order. */
export const PRESET_PAGES: { name: string; presets: Preset[] }[] = [
  {
    name: 'Colors',
    presets: flat([
      'F2E9E3',
      'EC8FBB',
      'A0689A',
      'E54C6E',
      'F37C5A',
      'F3D85E',
      '44FE96',
      '74BFD6',
      '666587',
    ]),
  },
  {
    name: 'Gradients',
    presets: [
      linked('F2E9E3', ['F1E2E7', 'EFF2E5']),
      linked('EC8FBB', ['E68CE7', 'E9AA9C']),
      linked('A0689A', ['9F6A80', '886E9D']),
      linked('F37C5A', ['F23B97', 'EDF349']),
      linked('F3ED6E', ['F6BB6D', 'FAA68E']),
      linked('B7FF79', ['DDEB78', 'E3BD78']),
      linked('72F2E6', ['69E7B9', '8C95E0']),
      linked('938EDC', ['8DABDA', '8DBCD0']),
      linked('666587', ['7D5F88', '628087']),
    ],
  },
  {
    name: 'Pastels',
    presets: flat([
      'FEFBFA',
      'FFE9F3',
      'F1D1EC',
      'FFCBD1',
      'FFE0D3',
      'FFF9E5',
      'DEFDEB',
      'DCF3FC',
      'C5C6E5',
    ]),
  },
  {
    name: 'Muted',
    presets: flat([
      '4E3A5A',
      '693558',
      '8F4042',
      'B16D40',
      'D7B35D',
      'CDCCA4',
      '7AA982',
      '226149',
      '26456B',
    ]),
  },
  {
    name: 'Grays',
    presets: flat([
      'FFFFFF',
      'E5E5E5',
      'CCCCCC',
      'B2B2B2',
      '808080',
      '666666',
      '333333',
      '1A1A1A',
      '000000',
    ]),
  },
]

/** Every preset with its page and its name there ("Pastels 3"). */
export const PRESETS = PRESET_PAGES.flatMap((page, at) =>
  page.presets.map((preset, i) => ({ ...preset, name: `${page.name} ${i + 1}`, page: at }))
)

/** A preset as the ground's colours, keeping the rest of the ground. */
export function withPreset(g: Ground, preset: Preset): Ground {
  const main = fromRgb(fromHex(preset.main))
  return { ...g, ...main, links: preset.links.map((l) => linkOf(main, fromRgb(fromHex(l)))) }
}

const near = (a: Rgb, b: Rgb) => a.every((v, i) => Math.abs(v - (b[i] ?? 0)) < 1.5 / 255)

/** The page the row opens on: the preset the ground wears, the first if none (Yab's `index`). */
export function presetPageOf(g: Ground): number {
  const colours = tonesOf(g).map(toneRgb)
  const hit = PRESETS.find(
    (p) =>
      p.links.length + 1 === colours.length &&
      [p.main, ...p.links].every((hex, i) => near(fromHex(hex), colours[i] ?? [0, 0, 0]))
  )
  return hit?.page ?? 0
}

/** Transparency as Yab's wave shows it, and the opacity it gives (Yab's BackdropTransparency). */
export const opacityOf = (transparency: number) => 1 - 0.84 * clamp(transparency)
export const transparencyOf = (opacity: number) => clamp((1 - opacity) / 0.84)

/** A stored setting (a JSON string) as a ground; anything unreadable is the default. */
export function parseGround(raw: unknown): Ground | null {
  if (typeof raw !== 'string') return null
  try {
    const v = JSON.parse(raw) as Partial<Ground>
    const num = (x: unknown, fallback: number, lo: number, hi: number) =>
      typeof x === 'number' && Number.isFinite(x) ? clamp(x, lo, hi) : fallback
    const d = DEFAULT_GROUND
    const links = Array.isArray(v.links) ? v.links.slice(0, MAX_LINKS) : []
    return {
      blur: BLURS.includes(v.blur as Blur) ? (v.blur as Blur) : d.blur,
      grain: num(v.grain, d.grain, 0, 1),
      hue: num(v.hue, d.hue, 0, 360),
      intensity: num(v.intensity, d.intensity, 0, 1),
      light: num(v.light, d.light, 0, 1),
      links: links.map((l: Partial<Link>) => ({
        hue: num(l.hue, 0, 0, 360),
        light: num(l.light, 0, -1, 1),
        reach: num(l.reach, 0, -1, 1),
      })),
      opacity: num(v.opacity, d.opacity, 0, 1),
    }
  } catch {
    return null
  }
}

const round = (v: number) => Math.round(v * 1000) / 1000
export const serializeGround = (g: Ground) =>
  JSON.stringify({
    blur: g.blur,
    grain: round(g.grain),
    hue: round(g.hue),
    intensity: round(g.intensity),
    light: round(g.light),
    links: g.links.map((l) => ({
      hue: round(l.hue),
      light: round(l.light),
      reach: round(l.reach),
    })),
    opacity: round(g.opacity),
  })

// Readability. What shows through a translucent ground is unknown, so inks are checked
// against the worst backdrop the material allows: any desktop with no blur, a light frost
// for `soft` (NSVisualEffectView .sidebar), a darker one for `strong` (.hudWindow). A
// gradient is checked at each of its colours.

/** The backdrop's gray range (sRGB channel) under each material. */
export const BACKDROP: Record<Blur, [number, number]> = {
  off: [0, 1],
  soft: [0.5, 0.97],
  strong: [0.08, 0.45],
}

export function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map(toLinear) as Rgb
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export const contrast = (y1: number, y2: number) =>
  (Math.max(y1, y2) + 0.05) / (Math.min(y1, y2) + 0.05)

const over = (rgb: Rgb, o: number, gray: number) => rgb.map((c) => o * c + (1 - o) * gray) as Rgb
const mix = (a: Rgb, b: Rgb, f: number): Rgb => [
  a[0] + (b[0] - a[0]) * f,
  a[1] + (b[1] - a[1]) * f,
  a[2] + (b[2] - a[2]) * f,
]

const DARK_INK = fromHex('#1d1c1a')
const LIGHT_INK = fromHex('#fbfaf8')

/** The window's luminance range at this opacity: its colours over the darkest and lightest backdrop. */
export function luminanceRange(colours: Rgb[], opacity: number, blur: Blur): [number, number] {
  const [lo, hi] = BACKDROP[blur]
  return [
    Math.min(...colours.map((c) => luminance(over(c, opacity, lo)))),
    Math.max(...colours.map((c) => luminance(over(c, opacity, hi)))),
  ]
}

/** Light inks when they read better than dark ones on the solid colours' worst. */
export function wantsLightInk(colours: Rgb[]): boolean {
  const ys = colours.map(luminance)
  return contrast(Math.max(...ys), 1) > contrast(Math.min(...ys), 0)
}

function primaryReads(colours: Rgb[], opacity: number, blur: Blur, light: boolean) {
  const [lo, hi] = luminanceRange(colours, opacity, blur)
  return light ? contrast(hi, 1) >= 4.5 : contrast(lo, 0) >= 4.5
}

/** The least opacity at which the sidebar's text still reads at 4.5:1 over any backdrop. */
export function minOpacity(colours: Rgb[], blur: Blur): number {
  const light = wantsLightInk(colours)
  let o = 1
  while (o > 0.16 && primaryReads(colours, Math.round((o - 0.01) * 100) / 100, blur, light)) {
    o = Math.round((o - 0.01) * 100) / 100
  }
  return o
}

/** Mid grounds push the ink past the app's own, to black or white: one of them always reads. */
const EXTREME: Record<'dark' | 'light', Rgb> = { dark: [0, 0, 0], light: [1, 1, 1] }

/** Each sidebar ink: the default's mix from the main ink toward the ground, and the contrast it keeps. */
const INKS: [token: string, mix: number, least: number][] = [
  ['--foreground', 0, 4.5],
  ['--sidebar-accent-foreground', 0, 4.5],
  ['--ink-soft', 0.08, 4.5],
  ['--sidebar-foreground', 0.14, 4.5],
  ['--muted-foreground', 0.39, 4.5],
  ['--faint', 0.54, 2.9],
  ['--label', 0.63, 2.3],
]

export interface Paint {
  /** The main colour, opaque: what peeks and drag ghosts fill with. */
  solid: string
  /** The main colour at the window's opacity. */
  tint: string
  /** The window's paint: a colour, or a gradient top left to bottom right, at its opacity. */
  paint: string
  /** The same as a background image, to lay over another. */
  layer: string
  opacity: number
  hover: string
  light: boolean
  /** The sidebar's inks, by token. */
  inks: Record<string, string>
}

const rgbCss = (rgb: Rgb, o: number) => {
  const [r, g, b] = rgb.map((c) => Math.round(c * 255))
  return `rgb(${r} ${g} ${b} / ${o})`
}

/**
 * How Yab wears a picked colour on Liquid Glass (WindowGlassPolicy.transparency(for:), then
 * BackdropTransparency.opacity): a colour at transparency 0.8, a gray (OKLCH chroma under 0.02)
 * at 0.6, so the glass shows through and the pick turns pastel, still its own hue.
 */
export const coverOf = (rgb: Rgb) => opacityOf(rgbToOklch(rgb)[1] < 0.02 ? 0.6 : 0.8)

/** Light Liquid Glass under the colour, as it reads on a light desktop: brightest top left. */
const GLASS: [Rgb, Rgb] = [fromHex('#f8f8f6'), fromHex('#e2e1de')]

const over3 = (rgb: Rgb, o: number, under: Rgb) => mix(under, rgb, o)

/** A colour laid on the glass at `t`, 0 top left to 1 bottom right, `more` past Yab's cover. */
export const wornAt = (rgb: Rgb, t: number, more = 0): Rgb =>
  over3(rgb, Math.min(1, coverOf(rgb) + more), mix(GLASS[0], GLASS[1], t))

/** Whether the app's dark or light ink reads at 4.5:1 over every one of these solid colours. */
const inkReads = (colours: Rgb[]) => {
  const ys = colours.map(luminance)
  return (
    contrast(luminance(DARK_INK), Math.min(...ys)) >= 4.5 ||
    contrast(luminance(LIGHT_INK), Math.max(...ys)) >= 4.5
  )
}

/**
 * The window's paint stops, top left to bottom right, as worn on the glass: one colour runs
 * along the glass's own light; linked ones spread evenly across it (Yab's coating gradient).
 * A mid gray on the glass reads with neither ink, so then the colour covers more of it, two
 * points at a time, as Yab's Clear glass deepens its veil (WindowGlassPolicy.veil).
 */
export function wornTones(g: Ground): Rgb[] {
  const colours = tonesOf(g).map(toneRgb)
  const main = colours[0] ?? toneRgb(g)
  const at = (more: number) =>
    colours.length < 2
      ? [wornAt(main, 0, more), wornAt(main, 1, more)]
      : colours.map((c, i) => wornAt(c, i / (colours.length - 1), more))
  let more = 0
  while (more < 1 && !inkReads(underSidebar(at(more)))) more += 0.02
  return at(more)
}

/**
 * The colours the sidebar's text sits on. The gradient runs corner to corner and the sidebar
 * is the window's left column, so it reaches less than halfway: the first two stops, never the
 * last of three.
 */
export const underSidebar = (colours: Rgb[]) => colours.slice(0, 2)

/** What the window paints for this ground, with the inks that keep its sidebar readable. */
export function paintOf(g: Ground): Paint {
  const stops = wornTones(g)
  const main = stops[0] ?? toneRgb(g)
  const read = underSidebar(stops)
  const light = wantsLightInk(read)
  const opacity = round(Math.max(clamp(g.opacity), minOpacity(read, g.blur)))
  const [lo, hi] = luminanceRange(read, opacity, g.blur)
  const worst = light ? hi : lo
  const ink = light ? LIGHT_INK : DARK_INK
  const inks: Record<string, string> = {}
  for (const [token, share, least] of INKS) {
    // Checked as written (a hex), so rounding never drops it under the line.
    const at = (f: number) =>
      toHex(f >= 0 ? mix(ink, main, f) : mix(ink, EXTREME[light ? 'light' : 'dark'], -f))
    let f = share
    while (f > -1 && contrast(luminance(fromHex(at(f))), worst) < least) f -= 0.01
    inks[token] = at(f)
  }
  const tint = rgbCss(main, opacity)
  // Yab's: from the top left corner to the bottom right (BackdropCoatingView, step 0).
  const gradient = `linear-gradient(to bottom right, ${stops.map((c) => rgbCss(c, opacity)).join(', ')})`
  return {
    hover: light ? 'rgb(255 255 255 / 0.1)' : 'rgb(0 0 0 / 0.045)',
    inks,
    layer: gradient,
    light,
    opacity,
    paint: gradient,
    solid: toHex(main),
    tint,
  }
}
