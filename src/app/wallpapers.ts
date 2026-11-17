// Chat backgrounds: living scenes drawn in characters on a grid. Each is a file the user owns
// (`<data>/backgrounds/<id>.js`, made by asking Claude in a chat; Kites and Koi are seeded
// there once), run in a sandboxed worker (`scene-worker.ts`). Settings › Appearance picks one;
// None keeps the plain chat.

/** The picked background: 'None' or a scene's id. */
export const WALLPAPER_SETTING = 'ui.wallpaper'
/** How blurred the background is, in CSS pixels. */
export const WALLPAPER_BLUR_SETTING = 'ui.wallpaperBlur'
/** How blurred the scene is behind the chat's text column, in CSS pixels. */
export const WALLPAPER_TEXT_BLUR_SETTING = 'ui.wallpaperTextBlur'
/** How white the frost behind the text column is, in percent (0 is clear glass). */
export const WALLPAPER_VEIL_SETTING = 'ui.wallpaperVeil'
export const NO_WALLPAPER = 'None'

/** A background file, as `backgrounds_list` reads it. */
export interface SceneFile {
  /** The file's name without `.js`. */
  id: string
  name: string
  /** The body of a `(p, hash, flicker) => void` function. */
  code: string
}

/** The scene a stored pick names: by id, or by its old built-in name ('Koi' is koi.js). */
export function pickedScene(scenes: readonly SceneFile[], picked: string): SceneFile | undefined {
  if (picked === NO_WALLPAPER) return undefined
  return scenes.find((s) => s.id === picked) ?? scenes.find((s) => s.id === picked.toLowerCase())
}

/** What a scene draws with. Columns and rows are cells; fractional ones round to the grid. */
export interface Paint {
  cols: number
  rows: number
  /** Seconds. */
  t: number
  /** The whole surface, top to bottom, through these stops (`at` from 0 to 1). */
  sky(stops: readonly (readonly [number, string])[]): void
  /** A dot in every cell, as opaque as `level` says (0 to 1; below 0.03 is none). */
  field(ink: string, level: (c: number, r: number) => number): void
  /** A square of colour carrying a glyph in a darker shade: a scene's "pixel". */
  tile(c: number, r: number, fill: string, ink: string, glyph: string): void
  /** A bare character. */
  glyph(c: number, r: number, ink: string, ch: string): void
}

/** A stable random number in [0, 1) for these integers. */
export function hash(a: number, b = 0, c = 0): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1440670441)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h = Math.imul(h ^ (h >>> 16), 2246822519)
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296
}

/** A tile's glyph: each one turns over now and then, on its own beat. */
export function flicker(set: string, a: number, b: number, t: number): string {
  const beat = Math.floor(t * 0.6 + hash(a, b, 9) * 8)
  return set[Math.floor(hash(a, b, beat) * set.length)] ?? set[0] ?? ' '
}
