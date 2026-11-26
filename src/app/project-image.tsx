// A picture as a project's avatar: a square one is taken as it is, any other is cut square
// first, in place: drag to frame it, scroll or slide to zoom. Kept small (a data URL in the
// catalog), since the avatar is never drawn bigger than a few dozen pixels.

import { type PointerEvent, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'

/** The stored picture's side, in pixels: sharp at 2× in the settings title. */
const SIDE = 96
/** The crop frame's side on screen. */
const FRAME = 168
const MAX_ZOOM = 4

export const isImageIcon = (icon: string | undefined): icon is string =>
  icon?.startsWith('data:image/') === true

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("Couldn't read this picture"))
    img.src = src
  })
}

const size = (img: HTMLImageElement) => ({
  h: img.naturalHeight || SIDE,
  w: img.naturalWidth || SIDE,
})

/** The part `[sx, sy, side]` of `img`, as a SIDE×SIDE PNG. */
function cut(img: HTMLImageElement, sx: number, sy: number, side: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = SIDE
  canvas.height = SIDE
  const ctx = canvas.getContext('2d')
  if (ctx === null) return ''
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, sx, sy, side, side, 0, 0, SIDE, SIDE)
  return canvas.toDataURL('image/png')
}

/** A picked file, read: square already gives the avatar, else the cropper's source. */
export async function readPicture(file: File): Promise<{ square: string } | { crop: string }> {
  const src = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(new Error("Couldn't read this picture"))
    reader.readAsDataURL(file)
  })
  const img = await load(src)
  const { h, w } = size(img)
  return w === h ? { square: cut(img, 0, 0, w) } : { crop: src }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Frames a picture in a square: drag it, zoom it, then Use. */
export function SquareCrop({
  onCancel,
  onDone,
  src,
}: {
  src: string
  onDone: (dataUrl: string) => void
  onCancel: () => void
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [zoom, setZoom] = useState(1)
  // The picture's top-left corner, relative to the frame's.
  const [at, setAt] = useState({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number; from: { x: number; y: number } } | null>(null)

  useEffect(() => {
    let live = true
    void load(src).then(
      (loaded) => {
        if (!live) return
        const { h, w } = size(loaded)
        const s = FRAME / Math.min(w, h)
        // Starts centred.
        setAt({ x: (FRAME - w * s) / 2, y: (FRAME - h * s) / 2 })
        setImg(loaded)
      },
      () => onCancel()
    )
    return () => {
      live = false
    }
  }, [src, onCancel])

  if (img === null) return <div style={{ height: FRAME }} />
  const { h, w } = size(img)
  const scale = (FRAME / Math.min(w, h)) * zoom
  const fit = (p: { x: number; y: number }, s = scale) => ({
    x: clamp(p.x, FRAME - w * s, 0),
    y: clamp(p.y, FRAME - h * s, 0),
  })

  // Zooms about the frame's centre, so what is in the middle stays there.
  const zoomTo = (next: number) => {
    const z = clamp(next, 1, MAX_ZOOM)
    const s = (FRAME / Math.min(w, h)) * z
    const c = FRAME / 2
    setAt(fit({ x: c - ((c - at.x) / scale) * s, y: c - ((c - at.y) / scale) * s }, s))
    setZoom(z)
  }

  const down = (e: PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { from: at, x: e.clientX, y: e.clientY }
  }
  const move = (e: PointerEvent) => {
    const d = drag.current
    if (d === null) return
    setAt(fit({ x: d.from.x + e.clientX - d.x, y: d.from.y + e.clientY - d.y }))
  }

  return (
    <div className="flex items-center gap-6">
      <div
        className="bg-well relative flex-none cursor-grab touch-none overflow-hidden rounded-lg shadow-[inset_0_0_0_1px_var(--border)] select-none active:cursor-grabbing"
        style={{ height: FRAME, width: FRAME }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={() => (drag.current = null)}
        onWheel={(e) => zoomTo(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08))}
      >
        <img
          src={src}
          alt=""
          draggable={false}
          className="absolute max-w-none"
          style={{ height: h * scale, left: at.x, top: at.y, width: w * scale }}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <span className="text-muted-foreground text-xs">
          Drag to frame it; scroll or slide to zoom.
        </span>
        <input
          type="range"
          aria-label="Zoom"
          min={1}
          max={MAX_ZOOM}
          step={0.01}
          value={zoom}
          className="accent-foreground w-48"
          onChange={(e) => zoomTo(Number(e.target.value))}
        />
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => onDone(cut(img, -at.x / scale, -at.y / scale, FRAME / scale))}
          >
            Use
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  )
}
