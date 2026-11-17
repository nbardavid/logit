// name: Koi
// A koi pond seen from above: fish under lily pads, petals on the water.
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
const KOI_INKS = {
  charcoal: ['#4e5d58', '#8e9f99'],
  cream: ['#e4e1c9', '#9f9a7c'],
  olive: ['#8db265', '#527636'],
  rust: ['#cf7650', '#86412a'],
  tan: ['#b99c5c', '#75602c'],
}
const FISH = [
  { at: [0.36, 0.34], coat: ['cream', 'rust'], reach: [0.2, 0.22], speed: 0.05, turns: [1, 2] },
  { at: [0.64, 0.6], coat: ['tan', 'olive'], reach: [0.2, 0.26], speed: 0.045, turns: [2, 1] },
  {
    at: [0.42, 0.66],
    coat: ['cream', 'rust', 'charcoal'],
    reach: [0.24, 0.18],
    speed: 0.04,
    turns: [3, 2],
  },
]
const GIRTH = [
  1.5, 2.2, 2.6, 2.85, 2.95, 2.95, 2.85, 2.65, 2.4, 2.1, 1.8, 1.5, 1.2, 0.95, 0.75, 0.6, 0.5, 0.4,
]
function spine(fish, cols, rows, t, step) {
  const at = (s) => [
    cols * (fish.at[0] + fish.reach[0] * Math.sin(fish.turns[0] * s)),
    rows * (fish.at[1] + fish.reach[1] * Math.sin(fish.turns[1] * s + 0.9)),
  ]
  let s = t * fish.speed
  let prev = at(s)
  const points = [prev]
  let run = 0
  for (let i = 0; i < 6000 && points.length < GIRTH.length; i++) {
    s -= 0.001
    const next = at(s)
    run += Math.hypot(next[0] - prev[0], next[1] - prev[1])
    prev = next
    if (run >= step) {
      run = 0
      points.push(next)
    }
  }
  return points
}
function onBody(points, girth, c, r) {
  let edge = 1 / 0
  let u = 0
  let across = 0
  for (let k = 0; k + 1 < points.length; k++) {
    const a = points[k]
    const b = points[k + 1]
    if (!a || !b) continue
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const along = Math.min(
      1,
      Math.max(0, ((c - a[0]) * dx + (r - a[1]) * dy) / (dx * dx + dy * dy || 1))
    )
    const ex = c - (a[0] + dx * along)
    const ey = r - (a[1] + dy * along)
    const d = Math.hypot(ex, ey)
    const g = girth(k) + (girth(k + 1) - girth(k)) * along
    if (d - g < edge) {
      edge = d - g
      u = k + along
      across = (Math.sign(dx * ey - dy * ex) * d) / g
    }
  }
  return { across, inside: edge <= 0, u }
}
function wedge(o, dir, half, near, far, draw) {
  const reach = Math.ceil(far) + 1
  const c0 = Math.round(o[0])
  const r0 = Math.round(o[1])
  for (let dr = -reach; dr <= reach; dr++)
    for (let dc = -reach; dc <= reach; dc++) {
      const x = c0 + dc - o[0]
      const y = r0 + dr - o[1]
      const d = Math.hypot(x, y)
      if (d < near || d > far) continue
      if (Math.abs(wrap(Math.atan2(y, x) - dir + Math.PI, Math.PI * 2) - Math.PI) <= half)
        draw(c0 + dc, r0 + dr, d)
    }
}
const PADS = [
  { at: [0.34, 0.2], notch: 0.6, r: 4.2 },
  { at: [0.66, 0.68], notch: 2.4, r: 3.6 },
  { at: [0.28, 0.74], notch: 4.1, r: 3 },
  { at: [0.72, 0.24], notch: 5.2, r: 4.8 },
  { at: [0.77, 0.29], notch: 1.2, r: 2.2 },
]
const LOTUS = [' p p ', 'ppypp', ' ppp ']
const FIN = ['rgba(226,244,236,0.4)', 'rgba(62,116,104,0.75)']
const koi = (p) => {
  const { cols, rows, t } = p
  const scale = Math.min(1.1, Math.max(0.4, Math.min(cols / 80, rows / 48)))
  p.sky([
    [0, '#6dbfae'],
    [0.55, '#4ea493'],
    [1, '#3f9384'],
  ])
  p.field(
    '#e4fbf3',
    (c, r) =>
      0.1 +
      0.3 *
        wave(c * 0.23 + Math.sin(r * 0.19 + t * 0.4) * 2 + t * 0.3) *
        wave(r * 0.21 - t * 0.35 + Math.sin(c * 0.13) * 1.5)
  )
  for (let i = 0; i < 5; i++) {
    const period = 6 + 3 * hash(i, 1)
    const cycle = Math.floor((t + hash(i, 2) * period) / period)
    const age = wrap(t + hash(i, 2) * period, period)
    const c0 = cols * (0.2 + 0.6 * hash(i, cycle, 3))
    const r0 = rows * (0.1 + 0.8 * hash(i, cycle, 4))
    const radius = age * 1.6
    const ink = `rgba(255,255,255,${(0.8 * (1 - age / period)).toFixed(2)})`
    const reach = Math.ceil(radius) + 1
    for (let dr = -reach; dr <= reach; dr++)
      for (let dc = -reach; dc <= reach; dc++)
        if (Math.abs(Math.hypot(dc, dr) - radius) < 0.5) p.glyph(c0 + dc, r0 + dr, ink, 'o')
  }
  const bodies = FISH.map((fish, i) => {
    const raw = spine(fish, cols, rows, t, scale)
    const girth = (k) => (GIRTH[k] ?? 0.4) * scale
    const points = raw.map((b, k) => {
      const a = raw[Math.max(0, k - 1)] ?? b
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
      const off = Math.sin(t * 3 - k * 0.45 + i) * 0.45 * scale * (k / GIRTH.length)
      return [b[0] - ((b[1] - a[1]) / len) * off, b[1] + ((b[0] - a[0]) / len) * off]
    })
    const cells = []
    const pad = 3 * scale + 1
    const xs = points.map((q) => q[0])
    const ys = points.map((q) => q[1])
    for (let r = Math.floor(Math.min(...ys) - pad); r <= Math.ceil(Math.max(...ys) + pad); r++)
      for (let c = Math.floor(Math.min(...xs) - pad); c <= Math.ceil(Math.max(...xs) + pad); c++) {
        const at = onBody(points, girth, c, r)
        if (at.inside) cells.push({ across: at.across, c, r, u: at.u })
      }
    return { cells, fish, girth, i, points }
  })
  const drop = Math.max(1, Math.round(1.5 * scale))
  for (const { cells } of bodies)
    for (const cell of cells)
      p.tile(cell.c + drop, cell.r + drop, 'rgba(16,64,58,0.07)', 'rgba(0,0,0,0)', ' ')
  for (const { cells, fish, girth, i, points } of bodies) {
    const head = points[0]
    const neck = points[1]
    const tail = points.at(-1)
    const before = points.at(-2)
    if (!head || !neck || !tail || !before) continue
    const fin = (c, r, d) =>
      p.tile(c, r, FIN[0], FIN[1], flicker('~=-', Math.round(d * 2) + i * 13, i, t))
    const back = Math.atan2(tail[1] - before[1], tail[0] - before[0])
    wedge(tail, back + Math.sin(t * 4 + i) * 0.45, 0.5, 0.5, 3.6 * scale, fin)
    const ahead = Math.atan2(head[1] - neck[1], head[0] - neck[0])
    const root = points[3] ?? head
    for (const side of [-1, 1])
      wedge(
        root,
        ahead + side * (Math.PI * 0.62 + Math.sin(t * 2.6 + i) * 0.2),
        0.35,
        girth(3),
        girth(3) + 2.4 * scale,
        fin
      )
    const seed = i * 2.3 + 1
    for (const { across, c, r, u } of cells) {
      const n =
        Math.sin(u * 0.7 + seed) +
        Math.sin(u * 0.31 + across * 1.6 + seed * 1.7) +
        0.7 * Math.sin(across * 2.3 - u * 0.5 + seed * 2.9)
      const third = fish.coat[2]
      let name = fish.coat[0]
      if (n > 0.5) name = fish.coat[1]
      else if (third && n < -1.2) name = third
      const ink = KOI_INKS[name]
      p.tile(
        c,
        r,
        ink[0],
        ink[1],
        flicker('tS%;$', Math.round(u * 2) + i * 41, Math.round(across * 3), t)
      )
    }
    if (scale >= 0.6)
      for (const side of [-1, 1]) {
        const a = ahead + side * 1.05
        p.tile(
          head[0] + Math.cos(a) * 1.1 * scale,
          head[1] + Math.sin(a) * 1.1 * scale,
          '#33403c',
          '#6d7d77',
          'o'
        )
      }
  }
  for (const [i, pad] of PADS.entries()) {
    const c0 = cols * pad.at[0] + Math.sin(t * 0.12 + i) * 0.8
    const r0 = rows * pad.at[1] + Math.cos(t * 0.1 + i * 2) * 0.6
    const turn = pad.notch + Math.sin(t * 0.08 + i) * 0.3
    const radius = pad.r * Math.max(0.6, scale)
    const reach = Math.ceil(radius)
    for (let dr = -reach; dr <= reach; dr++)
      for (let dc = -reach; dc <= reach; dc++) {
        const d = Math.hypot(dc, dr)
        if (d > radius) continue
        const off = Math.abs(wrap(Math.atan2(dr, dc) - turn + Math.PI, Math.PI * 2) - Math.PI)
        if (off < 0.32 && d > 0.6) continue
        const rim = d > radius - 1
        p.tile(
          c0 + dc,
          r0 + dr,
          rim ? '#6a9a50' : '#7fae62',
          rim ? '#3f6a2d' : '#4a7536',
          flicker(rim ? '%&' : '/\\|-', dc + i * 17, dr, t)
        )
      }
    if (i === 0)
      sprite(
        p,
        LOTUS,
        c0 - 2,
        r0 - 2,
        { p: ['#ee9fb4', '#b4566e'], y: ['#f4d06b', '#b48f22'] },
        '*%&',
        7
      )
  }
  for (let i = 0; i < 9; i++) {
    const c = wrap(cols * hash(i, 1) + t * (0.25 + 0.2 * hash(i, 2)), cols + 4) - 2
    const r = rows * hash(i, 3) + Math.sin(t * 0.3 + i) * 2
    p.tile(c, r, '#f0a7b9', '#b65a72', flicker('t%', i, 0, t))
  }
}
koi(p)
