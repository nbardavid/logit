// Draws a scene's Paint calls onto a 2D canvas context: shared by the window (built-in scenes)
// and the sandboxed worker (scenes Claude wrote).

import type { Paint } from './wallpapers'

type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** A Paint onto a 2D context, `cell` CSS pixels a cell; small cells drop the glyphs. */
export function painter(ctx: Context2D, w: number, h: number, cell: number, t: number): Paint {
  const cols = Math.ceil(w / cell)
  const rows = Math.ceil(h / cell)
  const glyphs = cell >= 9
  const inside = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows
  ctx.font = `600 ${Math.round(cell * 0.68)}px "Geist Mono", ui-monospace, monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const gap = glyphs ? 1 : 0
  return {
    cols,
    field(ink, level) {
      // Dots grouped by how opaque they are: one path and one fill per group.
      const size = Math.max(1, cell * 0.11)
      const groups: Path2D[] = Array.from({ length: 8 }, () => new Path2D())
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          const v = level(c, r)
          if (v < 0.03) continue
          const g = Math.min(7, Math.floor(v * 16))
          groups[g]?.rect(c * cell + (cell - size) / 2, r * cell + (cell - size) / 2, size, size)
        }
      ctx.fillStyle = ink
      for (const [g, path] of groups.entries()) {
        ctx.globalAlpha = (g + 0.5) / 16
        ctx.fill(path)
      }
      ctx.globalAlpha = 1
    },
    glyph(c0, r0, ink, ch) {
      const c = Math.round(c0)
      const r = Math.round(r0)
      if (!inside(c, r)) return
      ctx.fillStyle = ink
      if (glyphs) ctx.fillText(ch, c * cell + cell / 2, r * cell + cell / 2 + 0.5)
      else ctx.fillRect(c * cell + cell * 0.3, r * cell + cell * 0.3, cell * 0.4, cell * 0.4)
    },
    rows,
    sky(stops) {
      const gradient = ctx.createLinearGradient(0, 0, 0, rows * cell)
      for (const [at, colour] of stops) gradient.addColorStop(Math.min(1, Math.max(0, at)), colour)
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, w, h)
    },
    t,
    tile(c0, r0, fill, ink, glyph) {
      const c = Math.round(c0)
      const r = Math.round(r0)
      if (!inside(c, r)) return
      ctx.fillStyle = fill
      ctx.fillRect(c * cell + gap / 2, r * cell + gap / 2, cell - gap, cell - gap)
      if (!glyphs) return
      ctx.fillStyle = ink
      ctx.fillText(glyph, c * cell + cell / 2, r * cell + cell / 2 + 0.5)
    },
  }
}
