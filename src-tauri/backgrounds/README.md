# logit backgrounds

Each `.js` file in this folder is a chat background for logit. The app lists them in
Settings › Appearance › Background and picks up a new or changed file within seconds. To make
one, write a new file here; to change one, edit its file; to remove one, delete it.

## The file

```js
// name: Night forest
// One line on what it shows.

…the body of a function (p, hash, flicker) => { … }…
```

- The first line, `// name: <Name>`, is the name shown under its tile (2 or 3 words).
- The file name is its id: lowercase words joined by hyphens, e.g. `night-forest.js`.
- The rest is the BODY of a JavaScript function `(p, hash, flicker) => { ... }`, called about
  24 times a second to draw one whole frame from scratch on a grid of square cells. Plain
  modern JavaScript: no imports, no exports, no DOM, no network, no async. It runs in a
  sandboxed worker that can only draw. Keep it under ~400 lines and fast: a frame must take
  well under 10 ms on a 160x100 grid, or the app stops the scene.
- `kites.js` and `koi.js` are full examples: read one before writing a new scene.

## The painter `p`

- `p.cols`, `p.rows`: the grid's size in cells, any size from a 90x56 thumbnail to 240x140.
  Place everything relative to them.
- `p.t`: time in seconds, a float starting around 60. Animate with it: smooth, slow, calm.
- `p.sky(stops)`: fills the whole surface with a vertical gradient,
  `stops = [[0, '#hex'], [1, '#hex'], ...]`. Call it first.
- `p.field(ink, (c, r) => level)`: a small dot in every cell, opacity `level` from 0 to 1
  (below 0.03 none). Texture: water, grass, mist, stars.
- `p.tile(c, r, fill, ink, glyph)`: a square cell of colour `fill` carrying the character
  `glyph` in a darker `ink`. This is the scene's pixel: build objects out of tiles.
- `p.glyph(c, r, ink, ch)`: a bare character, no square.

Coordinates may be fractional (they round) or off the grid (skipped). Colours are any CSS
colour. `hash(a, b?, c?)` is a stable random number in [0, 1) for integers;
`flicker(set, a, b, t)` picks a character from the string `set` for tile (a, b), turning over
now and then.

## Composition, the most important part

- A cell is 16 CSS pixels. The chat's text runs down the middle of the window behind a strong
  frosted glass about 1000 px (62 columns) wide: the middle 64 columns, from
  `p.cols / 2 - 32` to `p.cols / 2 + 32`, are blurred to nothing. Draw only the sky there.
- Every object, every point of interest, goes in the two side bands outside that column:
  `c < p.cols / 2 - 34` on the left and `c > p.cols / 2 + 34` on the right, balanced between
  both sides, close to the column rather than at the window's edges (those sit under the
  app's frosted sidebar and panels). On a grid narrower than 100 columns there are no side
  bands: keep it sparse and soft.
- A light, airy, soft palette: the app is light and flat with warm neutrals. No black or
  saturated backgrounds, no high-contrast noise.
- Original drawings made of tiles, like pixel art in characters. Sprites as arrays of strings,
  each letter mapped to a `[fill, ink]` pair, work well (see `sprite` in `kites.js`).
- Everything moves gently (drift, sway, ripple, twinkle), loops forever and never flashes.
