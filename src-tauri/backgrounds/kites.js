// name: Kites
// Kites over a summer sky, clouds and birds drifting by.
// A logit background: the body of (p, hash, flicker) => void, drawn every frame.

const wrap = (x, span) => ((x % span) + span) % span
const wave = (x) => 0.5 + 0.5 * Math.sin(x)
function sprite(p, art, c0, r0, inks, set, seed = 0) {
  const c = Math.round(c0)
  const r = Math.round(r0)
  for (const [dr, line] of art.entries()) {
    for (let dc = 0; dc < line.length; dc++) {
      const pair = inks[line[dc] ?? ' ']
      if (pair) p.tile(c + dc, r + dr, pair[0], pair[1], flicker(set, dc + seed * 37, dr, p.t))
    }
  }
}
function slant(lean, upright, right, left) {
  if (lean > upright) return right
  if (lean < -upright) return left
  return '|'
}
function line(p, from, to, ink, sag = 0) {
  const steps = Math.max(1, Math.abs(to[1] - from[1]))
  let prev = from[0]
  for (let i = 0; i <= steps; i++) {
    const u = i / steps
    const c = from[0] + (to[0] - from[0]) * u + Math.sin(Math.PI * u) * sag
    const lean = c - prev
    prev = c
    p.glyph(c, from[1] + (to[1] - from[1]) * u, ink, slant(lean, 0.3, '\\', '/'))
  }
}
const KITE = [
  '    s',
  '   asb',
  '  aasbb',
  ' aaasbbb',
  'sssssssss',
  ' cccsddd',
  '  ccsdd',
  '   csd',
  '    s',
]
const CLOUDS = [
  ['   @@@@', ' @@@@@@@@@', '@@@@@@@@@@@@@', ' ooooooooooo'],
  ['  @@@', '@@@@@@@@', ' oooooo'],
  ['     @@@@@', '  @@@@@@@@@@', '@@@@@@@@@@@@@@@@', ' ooooooooooooo'],
]
const SPAR = ['rgba(74,62,56,0.8)', 'rgba(255,255,255,0.7)']
const KITES = [
  {
    at: [0.3, 0.12],
    inks: {
      a: ['#ef7d5f', '#b4482e'],
      b: ['#f6b25e', '#bf7a21'],
      c: ['#f6b25e', '#bf7a21'],
      d: ['#ef7d5f', '#b4482e'],
      s: SPAR,
    },
    phase: 0,
    tail: '#ef7d5f',
  },
  {
    at: [0.68, 0.3],
    inks: {
      a: ['#5fa8a0', '#2e716a'],
      b: ['#f2cf6b', '#b48f22'],
      c: ['#f2cf6b', '#b48f22'],
      d: ['#5fa8a0', '#2e716a'],
      s: SPAR,
    },
    phase: 2.1,
    tail: '#5fa8a0',
  },
]
function birds(p, count, band, ink) {
  for (let i = 0; i < count; i++) {
    const c = wrap(p.t * (0.9 + hash(i, 1) * 0.8) + hash(i, 2) * p.cols, p.cols + 12) - 6
    const r = p.rows * (band[0] + (band[1] - band[0]) * hash(i, 3)) + Math.sin(p.t * 0.6 + i) * 0.8
    const up = Math.floor(p.t * 2.6 + hash(i, 4) * 2) % 2 === 0
    p.glyph(c, r, ink, up ? 'v' : '-')
  }
}
const kites = (p) => {
  const { cols, rows, t } = p
  p.sky([
    [0, '#d4e6f4'],
    [0.6, '#e8f1f8'],
    [1, '#f5f8fb'],
  ])
  p.field(
    '#4f7fa8',
    (c, r) =>
      0.03 + 0.13 * wave(c * 0.31 + r * 0.17 + t * 0.8) * wave(r * 0.23 - t * 0.5 + c * 0.05)
  )
  for (let i = 0; i < 5; i++) {
    const art = CLOUDS[i % CLOUDS.length] ?? []
    const speed = 0.25 + 0.3 * hash(i, 1)
    const c = wrap(t * speed + hash(i, 3) * (cols + 20), cols + 20) - 17
    sprite(
      p,
      art,
      c,
      rows * (0.04 + 0.62 * hash(i, 2)),
      { '@': ['#ffffff', '#a9c2d9'], 'o': ['#e1ecf5', '#9fb8cf'] },
      '~=-:.',
      i
    )
  }
  birds(p, 3, [0.05, 0.22], 'rgba(58,72,94,0.55)')
  for (const kite of KITES) {
    const cx = Math.round(cols * kite.at[0] + 2.5 * Math.sin(t * 0.45 + kite.phase))
    const top = Math.round(rows * kite.at[1] + 1.5 * Math.sin(t * 0.7 + kite.phase))
    const out = kite.at[0] < 0.5 ? -1 : 1
    line(p, [cx, top + 5], [cx + out * 8, rows + 2], 'rgba(80,70,64,0.32)', -out * 2)
    for (let i = 0; i < 12; i++) {
      const c = cx + Math.sin(t * 2.2 - i * 0.55 + kite.phase) * (0.4 + i * 0.22)
      const r = top + 9 + i
      if (i % 3 === 2) p.tile(c, r, kite.tail, 'rgba(255,255,255,0.8)', '%')
      else p.glyph(c, r, 'rgba(80,70,64,0.5)', '~')
    }
    sprite(p, KITE, cx - 4, top, kite.inks, '%$#&*+x', kite.phase * 10)
  }
}
kites(p)
